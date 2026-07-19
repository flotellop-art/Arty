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
//  1. euOnly (RÈGLE 5.3, BUG 8)  2. données privées (BUG 12)
//  3. pièces jointes (documents/mixte → Claude ; images seules avec carve-out
//  vision explicite)  4. choix manuel  5. cascade auto (YouTube → URL →
//  intent ChatGPT → hybride → trivial → défaut capable, BUG 58).
// Toute permutation peut réintroduire BUG 12 — modifier UNIQUEMENT avec un
// test de non-régression.
// ─────────────────────────────────────────────────────────────────────────────
import {
  HYBRID_TRIGGERS,
  PRIVATE_DATA_TRIGGERS,
  TRAIL_TRIGGERS,
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

/**
 * Un mode EU ne doit jamais se replier vers un fournisseur hors Europe.
 * Si Mistral n'est pas disponible pour le plan/BYOK courant, l'appel est
 * bloqué avant tout envoi (création et anciennes conversations expirées).
 */
export function canExecuteRoute(input: Pick<RouteInput, 'euOnly' | 'availability'>): boolean {
  return !input.euOnly || input.availability.mistral
}

export function resolveRoute(input: RouteInput): RouteDecision {
  const text = input.originalText
  const isPrivateData = input.hasPrivateHistory || PRIVATE_DATA_TRIGGERS.some((r) => r.test(text))
  const hasImagesOnly =
    input.hasFiles &&
    input.hasImages &&
    !input.hasPdf &&
    !input.hasOtherFiles
  const overrides: RouteOverride[] = []

  let provider: AIProvider
  let reason: RouteReason

  if (input.euOnly) {
    // Verrou Europe — court-circuit absolu, ignore même le choix manuel
    // (l'UI verrouille le sélecteur en mode EU). RÈGLE 5.3 / BUG 8.
    provider = 'mistral'
    reason = { code: 'eu_only' }
    if (input.selectedModel !== 'auto' && input.selectedModel !== 'mistral') {
      overrides.push({ requested: input.selectedModel, applied: 'mistral', reason: { code: 'eu_only' } })
    }
  } else if (isPrivateData) {
    // Le contenu privé précède TOUS les carve-outs photo. Sans ce garde, une
    // image jointe à « mes mails » ou à un historique Google pouvait partir
    // chez Mistral/OpenAI avant même d'atteindre la règle private_data.
    provider = 'claude'
    reason = { code: 'private_data' }
    if (input.selectedModel !== 'auto' && input.selectedModel !== 'claude') {
      overrides.push({
        requested: input.selectedModel,
        applied: 'claude',
        reason: { code: 'private_data' },
      })
    }
  } else if (input.hasFiles) {
    // PDF, document ou lot mixte : invariant BUG 12 inchangé. Le carve-out
    // ci-dessous ne concerne qu'un lot composé exclusivement d'images.
    if (!hasImagesOnly) {
      provider = 'claude'
      reason = { code: 'files_to_claude' }
      if (input.selectedModel !== 'auto' && input.selectedModel !== 'claude') {
        overrides.push({ requested: input.selectedModel, applied: 'claude', reason: { code: 'files_to_claude' } })
      }
    } else if (input.selectedModel === 'claude') {
      provider = 'claude'
      reason = { code: 'manual_selection' }
    } else if (input.selectedModel === 'mistral') {
      if (input.availability.mistral) {
        provider = 'mistral'
        reason = { code: 'files_mistral_native' }
      } else {
        provider = 'claude'
        reason = { code: 'fallback_no_provider', params: { preferred: 'mistral' } }
        overrides.push({ requested: 'mistral', applied: 'claude', reason })
      }
    } else if (input.selectedModel === 'gemini') {
      // Gemini reste text-only dans Arty : redirection visible vers Claude.
      provider = 'claude'
      reason = { code: 'files_to_claude' }
      overrides.push({ requested: 'gemini', applied: 'claude', reason })
    } else if (input.selectedModel === 'openai') {
      if (
        input.hasSupportedVisionImages &&
        input.visionOpenAIEnabled &&
        input.availability.openaiVision
      ) {
        provider = 'openai'
        reason = { code: 'image_vision_openai' }
      } else {
        provider = 'claude'
        reason = input.hasSupportedVisionImages && input.visionOpenAIEnabled
          ? { code: 'fallback_no_provider', params: { preferred: 'openai' } }
          : { code: 'files_to_claude' }
        overrides.push({ requested: 'openai', applied: 'claude', reason })
      }
    } else if (
      input.hasSupportedVisionImages &&
      input.visionOpenAIEnabled &&
      input.visionAutoRoutingEnabled &&
      input.availability.openaiVision
    ) {
      provider = 'openai'
      reason = { code: 'image_vision_openai' }
    } else {
      provider = 'claude'
      reason =
        input.hasSupportedVisionImages &&
        input.visionOpenAIEnabled &&
        input.visionAutoRoutingEnabled
        ? { code: 'fallback_no_provider', params: { preferred: 'openai' } }
        : { code: 'files_to_claude' }
    }
  } else if (input.selectedModel !== 'auto') {
    // Choix manuel respecté après les gardes absolues euOnly/private/files.
    // La règle private_data ci-dessus s'applique volontairement aussi à
    // Mistral manuel, conformément à BUG 12 et à la matrice PR-C.
    if (!input.availability[input.selectedModel]) {
      // Sélection manuelle devenue indisponible (expiration d'abonnement,
      // absence de clé BYOK Pro, cache de sélecteur ancien) : verrou AVANT
      // l'envoi, puis repli Claude/Haiku au lieu d'attendre un 403 serveur.
      provider = 'claude'
      reason = { code: 'fallback_no_provider', params: { preferred: input.selectedModel } }
      overrides.push({
        requested: input.selectedModel,
        applied: 'claude',
        reason: { code: 'fallback_no_provider', params: { preferred: input.selectedModel } },
      })
    } else {
      provider = input.selectedModel
      reason = { code: 'manual_selection' }
    }
  } else {
    // ── Cascade AUTO ─────────────────────────────────────────────────────
    const a = input.availability

    if (hasYouTubeUrl(text)) {
      // Gemini lit la vidéo nativement (part fileData). Sans Gemini, repli
      // Claude (comportement historique — il ne lira pas la vidéo non plus).
      provider = a.gemini ? 'gemini' : 'claude'
      reason = a.gemini
        ? { code: 'youtube_native' }
        : { code: 'fallback_no_provider', params: { preferred: 'gemini' } }
    } else if (hasUrl(text)) {
      // URL → Claude (web_fetch lit vraiment la page ; Mistral hallucine sur
      // les URLs). La fiabilité de lecture prime sur l'intent ChatGPT. Une
      // mention dans le texte reste une intention AUTO, pas un choix manuel :
      // elle explique la priorité mais ne déclenche aucun toast d'override.
      provider = 'claude'
      reason = { code: 'url_web_fetch' }
    } else if (TRAIL_TRIGGERS.some((r) => r.test(text))) {
      // Sentiers / traces GPX → Claude : les outils find_trails /
      // export_trail_gpx (géodonnées OSM + génération GPX) n'existent que
      // dans la boucle d'outils Claude. Même principe que url_web_fetch :
      // la capacité réelle prime sur le défaut Gemini, qui ne peut que
      // paraphraser des résultats de recherche sans produire de trace.
      provider = 'claude'
      reason = { code: 'trail_tools' }
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
    usesOpenAIVision: provider === 'openai' && reason.code === 'image_vision_openai',
    subModel,
    thinking,
    // Une conversation qui contient des données Google privées ne doit
    // jamais déclencher une recherche publique, même si le nouveau message
    // (ex. « résume ça » ou une question météo) la demanderait isolément.
    webSearch: !isPrivateData && shouldUseWebSearch(text),
    needsHybrid: provider === 'hybrid',
    isPrivateData,
    reason,
    subModelReason,
    overrides,
  }
}
