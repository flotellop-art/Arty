// ─────────────────────────────────────────────────────────────────────────────
// Moteur de routage unifié (refonte routage, étape 2).
//
// AVANT : la décision « quel modèle traite ce message ? » était éclatée en
// 3 sites qui recalculaient chacun dans leur coin — useConversation
// (euOnly/fichiers), aiRouter.detectProvider (cascade auto), anthropicClient
// (isPrivateData/thinking/sous-modèle sur un texte parfois contaminé par la
// recherche hybride ou pris au tour précédent).
//
// APRÈS : resolveRoute est LA fonction de décision. Pure (aucune lecture de
// singleton — gatherRouteInput collecte les entrées), appelée UNE fois par
// message sur le texte ORIGINAL, elle retourne une décision complète avec la
// RAISON de chaque choix et les OVERRIDES (redirections contredisant le choix
// utilisateur) — la matière de la transparence UI.
//
// ⚠️ L'ORDRE des règles est un invariant de sécurité/confiance, pas du style :
//  1. euOnly (RÈGLE 5.3, BUG 8)  2. fichiers (BUG 12)  3. choix manuel
//  (+ garde données privées)  4. cascade auto (privé → YouTube → URL →
//  intent ChatGPT → hybride → trivial → défaut capable, BUG 58).
// Toute permutation peut réintroduire BUG 12 — modifier UNIQUEMENT avec un
// test de non-régression.
// ─────────────────────────────────────────────────────────────────────────────
import {
  HYBRID_TRIGGERS,
  PRIVATE_DATA_TRIGGERS,
  hasUrl,
  hasYouTubeUrl,
  isTrivialChat,
  resolveClaudeThinking,
  selectClaudeSubModelWithReason,
  shouldUseWebSearch,
  type AIProvider,
  type ClaudeSubModel,
  type ClaudeThinkingDirective,
} from '../aiRouter'
import { detectOpenAIIntent } from '../modelSelector'
import type { RouteDecision, RouteInput, RouteOverride, RouteReason } from './types'

export function resolveRoute(input: RouteInput): RouteDecision {
  const text = input.originalText
  const isPrivateData = PRIVATE_DATA_TRIGGERS.some((r) => r.test(text))
  const overrides: RouteOverride[] = []

  let provider: AIProvider
  let reason: RouteReason

  if (input.euOnly) {
    // Verrou Europe — court-circuit absolu, ignore même le choix manuel
    // (l'UI verrouille le sélecteur en mode EU). RÈGLE 5.3 / BUG 8.
    provider = 'mistral'
    reason = { code: 'eu_only' }
  } else if (input.hasFiles) {
    // Fichiers attachés → Claude (lecture native PDF/image, BUG 12).
    // Exception : Mistral choisi manuellement + pas de PDF → vision native
    // Mistral (seul canal image compatible EU).
    if (input.selectedModel === 'mistral' && !input.hasPdf) {
      provider = 'mistral'
      reason = { code: 'files_mistral_native' }
    } else {
      provider = 'claude'
      reason = { code: 'files_to_claude' }
      if (input.selectedModel !== 'auto' && input.selectedModel !== 'claude') {
        // Le choix manuel (Gemini/OpenAI, ou Mistral avec PDF) est contredit
        // — tracé pour que l'UI le signale au lieu de basculer en silence.
        overrides.push({ requested: input.selectedModel, applied: 'claude', reason: { code: 'files_to_claude' } })
      }
    }
  } else if (input.selectedModel !== 'auto') {
    // Choix manuel respecté, SAUF données privées vers un modèle sans tools
    // Google (Gemini/OpenAI) → Claude. Mistral manuel reste honoré : il a le
    // tool-calling complet Gmail/Drive/Calendar.
    if (isPrivateData && (input.selectedModel === 'gemini' || input.selectedModel === 'openai')) {
      provider = 'claude'
      reason = { code: 'private_data' }
      overrides.push({ requested: input.selectedModel, applied: 'claude', reason: { code: 'private_data' } })
    } else {
      provider = input.selectedModel
      reason = { code: 'manual_selection' }
    }
  } else {
    // ── Cascade AUTO ─────────────────────────────────────────────────────
    const a = input.availability

    if (isPrivateData) {
      // Mails / Drive / agenda / contacts → Claude (tools natifs). Web search
      // ou hybride sur des données privées = hallucination garantie (BUG 12).
      provider = 'claude'
      reason = { code: 'private_data' }
    } else if (hasYouTubeUrl(text)) {
      // Gemini lit la vidéo nativement (part fileData). Sans Gemini, repli
      // Claude (comportement historique — il ne lira pas la vidéo non plus).
      provider = a.gemini ? 'gemini' : 'claude'
      reason = a.gemini
        ? { code: 'youtube_native' }
        : { code: 'fallback_no_provider', params: { preferred: 'gemini' } }
    } else if (hasUrl(text)) {
      // URL → Claude (web_fetch lit vraiment la page ; Mistral hallucine sur
      // les URLs). La fiabilité de lecture prime sur l'intent ChatGPT — si
      // l'utilisateur mentionnait explicitement ChatGPT, on trace l'override
      // au lieu de l'ignorer en silence.
      provider = 'claude'
      reason = { code: 'url_web_fetch' }
      if (a.openai && detectOpenAIIntent(text)) {
        overrides.push({ requested: 'openai', applied: 'claude', reason: { code: 'url_web_fetch' } })
      }
    } else if (a.openai && detectOpenAIIntent(text)) {
      provider = 'openai'
      reason = { code: 'openai_intent' }
    } else if (a.gemini && HYBRID_TRIGGERS.some((r) => r.test(text))) {
      // Rapport / comparatif / réglementation / prix → recherche Gemini puis
      // rédaction Claude.
      provider = 'hybrid'
      reason = { code: 'hybrid_research' }
    } else if (isTrivialChat(text)) {
      // Salutations / micro-réponses → chemin rapide sans recherche web.
      provider = a.mistral ? 'mistral' : 'claude'
      reason = { code: 'trivial_chat' }
    } else if (a.gemini) {
      // Défaut : Gemini avec google_search (données à jour). Défaut = modèle
      // CAPABLE, jamais cheap-first (BUG 58).
      provider = 'gemini'
      reason = { code: 'default_capable' }
    } else if (a.mistral) {
      provider = 'mistral'
      reason = { code: 'fallback_no_provider', params: { preferred: 'gemini' } }
    } else {
      provider = 'claude'
      reason = { code: 'fallback_no_provider', params: { preferred: 'gemini' } }
    }
  }

  // ── Sous-décision Claude ───────────────────────────────────────────────
  // Aussi pour 'hybrid' : Gemini fait la recherche mais c'est CLAUDE qui
  // rédige la réponse affichée. Calculée ici sur le texte ORIGINAL — plus
  // jamais sur le message enrichi de la recherche (bug contamination) ni sur
  // le tour précédent (bug fichier).
  const writesWithClaude = provider === 'claude' || provider === 'hybrid'
  const thinking: ClaudeThinkingDirective = writesWithClaude
    ? resolveClaudeThinking(text, input.reflectionLevel, input.plan.isPro)
    : { enabled: false, budget: 0, effort: null }

  let subModel: ClaudeSubModel | undefined
  let subModelReason: RouteReason | undefined
  if (writesWithClaude) {
    const choice = selectClaudeSubModelWithReason(text, thinking, isPrivateData, input.plan.isPro, {
      plan: input.plan.plan,
      creditsCoverPremium: input.plan.creditsCoverPremium,
    })
    subModel = choice.model
    subModelReason = { code: choice.reason }
  }

  return {
    provider,
    subModel,
    thinking,
    webSearch: shouldUseWebSearch(text),
    needsHybrid: provider === 'hybrid',
    isPrivateData,
    reason,
    subModelReason,
    overrides,
  }
}
