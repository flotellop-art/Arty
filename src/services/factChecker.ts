// Fact-checker post-pass : vérifie les claims factuels d'une réponse IA
// avec un second appel Claude (Haiku par défaut, Sonnet en mode strict).
//
// Run AFTER chaque réponse assistant complétée. Le résultat est attaché
// à Message.factCheck et affiché en badge sous la bulle. Async, ne bloque
// pas l'affichage de la réponse — l'utilisateur voit la réponse normale,
// le badge apparaît 1-2 secondes après.
//
// Indépendant du provider qui a généré la réponse (Mistral, Claude, Gemini,
// OpenAI) — le fact-checker prend (question, réponse) en entrée brute.

import { apiUrl } from './apiBase'
import { getValidAccessToken } from './googleAuth'
import * as scoped from './scopedStorage'
import * as storage from './storage'
import type { FactCheckResult, FactCheckClaim } from '../types'

export type Verdict = FactCheckClaim['verdict']
export type { FactCheckResult, FactCheckClaim }

export type FactCheckMode = 'off' | 'auto' | 'haiku' | 'sonnet'

const SETTING_KEY = 'fact-check-mode'

export function getFactCheckMode(): FactCheckMode {
  const v = scoped.getItem(SETTING_KEY)
  if (v === 'off' || v === 'sonnet' || v === 'haiku' || v === 'auto') return v
  // Défaut : 'auto' pour les payants (Haiku rapide / Sonnet sur sujets
  // sensibles), 'off' pour les free (cap quota).
  let plan: string | null = null
  try { plan = localStorage.getItem('arty-plan-cache') } catch {}
  return plan === 'free' ? 'off' : 'auto'
}

export function setFactCheckMode(mode: FactCheckMode): void {
  scoped.setItem(SETTING_KEY, mode)
  try { window.dispatchEvent(new CustomEvent('fact-check-mode-changed', { detail: mode })) } catch {}
}

// Détecte les sujets "à risque" qui justifient le passage à Sonnet 4.6
// (plus rigoureux, attrape les mensonges narratifs et sources douteuses).
// Pour le reste, Haiku 4.5 suffit (3x moins cher, 2x plus rapide).
//
// Mots-clés couvrent : finance, santé, juridique, devis pro, médicaments,
// data techniques précises (puissance kW, taux %, RGE/RT/RE 20XX, etc.).
const SENSITIVE_TOPIC_REGEX =
  /\b(prix|tarif|devis|coût|coute|euros?|€|investiss|rendement|taux|crédit|emprunt|prêt|placement|fiscal|impôt|tva|économ|patrimoine|finance|m[ée]dic|sympt|dose|posologie|m[ée]decin|ordonnance|maladie|santé|juridi|avocat|contrat|loi|article\s+\d|tribunal|condamn|jurisprudence|rgpd|kwh?|cv|ampèr|volts?|puissance|garanti|assurance|certificat|norme\s+|RT\s*20\d{2}|RE\s*20\d{2}|RGE)\b/i

export function selectFactCheckerModel(
  question: string,
  response: string
): 'haiku' | 'sonnet' {
  const text = (question + ' ' + response).toLowerCase()
  return SENSITIVE_TOPIC_REGEX.test(text) ? 'sonnet' : 'haiku'
}

const SYSTEM_PROMPT = `Tu es un fact-checker rigoureux. On te donne une question d'utilisateur et une réponse d'IA. Ton job : identifier les claims factuels VÉRIFIABLES (chiffres précis, dates, noms propres, prix, scores, statistiques, citations), donner un verdict pour CHACUN, et PROPOSER UNE CORRECTION quand tu es confiant que c'est faux.

Verdicts possibles :
- "verified" : tu es très confiant que le claim est exact (info stable, largement connue, ou logiquement déductible)
- "uncertain" : tu n'as pas assez d'info pour confirmer (recommande à l'utilisateur de vérifier)
- "wrong" : tu es très confiant que le claim est faux ET tu connais la version correcte

Pour les claims "wrong", AJOUTE deux champs :
- "originalText" : le passage EXACT de la réponse à corriger (substring verbatim, pour qu'on puisse faire un find/replace)
- "correction" : le texte qui doit le remplacer dans la réponse

Si tu sais que le claim est faux MAIS tu ne connais pas la bonne réponse, marque-le "uncertain" plutôt que "wrong" et omet "correction".

Sois CONSERVATEUR : préfère "uncertain" à "wrong" quand tu doutes. Ignore les claims évidents ("Paris est en France"), les opinions ("c'est joli"), et les conseils généraux.

Si la réponse contient ZÉRO claim factuel risqué, retourne "claims": [] et "overall_confidence": "high".

RÉPONDS UNIQUEMENT EN JSON VALIDE, sans texte avant ou après, sans backticks, format strict :
{
  "overall_confidence": "high" | "medium" | "low",
  "claims": [
    { "claim": "string", "verdict": "verified" | "uncertain" | "wrong", "explanation": "string courte", "originalText": "...", "correction": "..." }
  ]
}

Les champs "originalText" et "correction" ne sont REQUIS que pour les verdicts "wrong" où tu es certain de la bonne réponse.

Échelle overall_confidence :
- "high" : 0 claim risqué OU tous "verified"
- "medium" : claims "uncertain" présents
- "low" : au moins 1 "wrong" OU plusieurs "uncertain" critiques`

export async function factCheckResponse(
  question: string,
  response: string,
  mode: FactCheckMode = getFactCheckMode()
): Promise<FactCheckResult | null> {
  if (mode === 'off' || !response || response.length < 80) return null

  // Mode 'auto' : route vers Sonnet sur sujets sensibles, Haiku sinon.
  const effectiveMode: 'haiku' | 'sonnet' =
    mode === 'auto'
      ? selectFactCheckerModel(question, response)
      : mode

  const model = effectiveMode === 'sonnet' ? 'claude-sonnet-4-6' : 'claude-haiku-4-5-20251001'
  const modelLabel = effectiveMode === 'sonnet' ? 'Sonnet 4.6' : 'Haiku 4.5'

  const userMessage = `Question utilisateur :\n${question.slice(0, 2000)}\n\nRéponse à vérifier :\n${response.slice(0, 6000)}`

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'anthropic-version': '2023-06-01',
  }
  const googleToken = await getValidAccessToken()
  if (googleToken) headers['x-google-token'] = googleToken

  let res: Response
  try {
    res = await fetch(apiUrl('/api/ai/proxy'), {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
      }),
    })
  } catch {
    return null
  }

  if (!res.ok) return null

  let text = ''
  try {
    const data = (await res.json()) as { content?: Array<{ type?: string; text?: string }> }
    text = data.content?.find((c) => c.type === 'text')?.text || ''
  } catch {
    return null
  }
  if (!text) return null

  // Le LLM peut wrapper le JSON dans des backticks ou ajouter du texte.
  // On extrait le premier objet JSON valide qu'on trouve.
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return null

  let parsed: { overall_confidence?: unknown; claims?: unknown }
  try {
    parsed = JSON.parse(jsonMatch[0])
  } catch {
    return null
  }

  const overall = parsed.overall_confidence
  const overallConfidence: FactCheckResult['overallConfidence'] =
    overall === 'high' || overall === 'medium' || overall === 'low' ? overall : 'medium'

  const rawClaims = Array.isArray(parsed.claims) ? parsed.claims : []
  const claims: FactCheckClaim[] = rawClaims
    .filter((c): c is Record<string, unknown> => typeof c === 'object' && c !== null)
    .map((c) => {
      const verdict = c.verdict === 'verified' || c.verdict === 'uncertain' || c.verdict === 'wrong'
        ? c.verdict
        : 'uncertain'
      const claim: FactCheckClaim = {
        claim: String(c.claim || '').slice(0, 500),
        verdict: verdict as Verdict,
        explanation: String(c.explanation || '').slice(0, 500),
      }
      // Correction proposée — uniquement pour 'wrong' avec originalText et
      // correction présents. Le fact-checker doit fournir le passage
      // EXACT à remplacer pour qu'on puisse faire un find/replace fiable.
      if (verdict === 'wrong' && typeof c.originalText === 'string' && typeof c.correction === 'string') {
        const orig = c.originalText.trim()
        const corr = c.correction.trim()
        if (orig.length > 0 && orig.length < 500 && corr.length > 0 && corr.length < 500) {
          claim.originalText = orig
          claim.correction = corr
        }
      }
      return claim
    })
    .filter((c) => c.claim.length > 0)
    .slice(0, 10) // cap à 10 claims max pour éviter une explosion UI

  return {
    overallConfidence,
    claims,
    modelLabel,
    checkedAt: Date.now(),
  }
}

// Helper end-to-end : trouve le dernier (question, réponse) dans une
// conversation, lance le fact-check, attache le résultat à Message.factCheck
// et persiste. À appeler après chaque onDone d'une réponse assistant.
// Ne fait rien si mode 'off' ou si on ne trouve pas la paire.
export async function runFactCheckOnLatest(
  conversationId: string,
  refreshConversations: () => void
): Promise<void> {
  const mode = getFactCheckMode()
  if (mode === 'off') return

  const conv = storage.getConversation(conversationId)
  if (!conv) return

  // Trouver le dernier message assistant non-streaming
  let lastAssistantIdx = -1
  for (let i = conv.messages.length - 1; i >= 0; i--) {
    const m = conv.messages[i]
    if (m && m.role === 'assistant' && m.id !== 'streaming') {
      lastAssistantIdx = i
      break
    }
  }
  if (lastAssistantIdx < 0) return

  // Trouver le user message qui le précède
  let userMsg: typeof conv.messages[number] | undefined
  for (let i = lastAssistantIdx - 1; i >= 0; i--) {
    if (conv.messages[i]?.role === 'user') {
      userMsg = conv.messages[i]
      break
    }
  }
  if (!userMsg) return

  const assistantMsg = conv.messages[lastAssistantIdx]!
  // Skip si déjà fact-checké (idempotent)
  if (assistantMsg.factCheck) return

  const originalContent = assistantMsg.content
  const result = await factCheckResponse(userMsg.content, originalContent, mode)
  if (!result) return

  // Applique les corrections trouvées par find/replace direct dans le
  // contenu. On garde l'original dans factCheck.originalContent pour que
  // le dropdown puisse afficher le diff.
  let correctedContent = originalContent
  let appliedCount = 0
  for (const c of result.claims) {
    if (c.verdict === 'wrong' && c.originalText && c.correction) {
      // Remplacement uniquement si le passage exact est trouvé. Sinon on
      // n'altère pas la réponse — on laisse le claim flagger via badge.
      if (correctedContent.includes(c.originalText)) {
        correctedContent = correctedContent.replace(c.originalText, c.correction)
        appliedCount++
      }
    }
  }
  if (appliedCount > 0) {
    result.originalContent = originalContent
    result.appliedCorrections = appliedCount
  }

  // Re-lit la conv (peut avoir changé pendant l'await) et update le message
  // exact via son ID.
  const freshConv = storage.getConversation(conversationId)
  if (!freshConv) return
  const target = freshConv.messages.find((m) => m.id === assistantMsg.id)
  if (!target) return
  target.content = correctedContent
  target.factCheck = result
  freshConv.updatedAt = Date.now()
  storage.saveConversation(freshConv)
  refreshConversations()
}
