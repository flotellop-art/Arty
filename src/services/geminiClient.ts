import { getGeminiKey } from './activeApiKey'
import { apiUrl } from './apiBase'
import { buildAiHeaders, fetchWithTimeout, readWithInactivityTimeout } from './aiHttp'
import { buildLocationContext } from './locationContext'
import { recordUsage } from './costTracker'
import { dispatchModelUsed } from './modelLabels'
import { extractYouTubeUrls } from './aiRouter'
import { isMapToolQuery, isWeatherQuery } from './router/intentPatterns'
import type { RouteReason } from './router/types'
import { updateTrialFromResponse } from './trialClient'
import type { ReflectionLevel } from './reflectionLevel'
import i18n from '../i18n'

// Modèle Flash par défaut du CHAT (gros volume). gemini-2.5-flash coûte
// ~5× moins en input ($0.30 vs $1.50) et ~3.6× moins en output ($2.50 vs $9)
// que gemini-3.5-flash, et supporte AUSSI BIEN google_search, url_context,
// google_maps et le function calling (vérifié juin 2026 — function calling
// même *amélioré* sur le refresh 2.5). Pour le chat grand public (Q/R,
// rédaction, réponses web-grounded en français) la qualité est équivalente :
// le saut 3.5 ne paie que du raisonnement agentique/code que ce chemin
// n'exerce pas. Le grounding 2.5 est facturé PAR PROMPT (vs par requête sur
// 3.x), souvent moins cher pour un chat où beaucoup de tours déclenchent une
// recherche. Si Google renomme, le 404 affiche errors.geminiModelNotFound.
// Noms valides : GET https://generativelanguage.googleapis.com/v1beta/models
const GEMINI_CHAT_MODEL = 'gemini-2.5-flash'

// Modèle de la moitié RECHERCHE du mode hybride (geminiResearch). On garde
// 3.5-flash : c'est l'orchestration multi-étapes / synthèse longue qui
// alimente le rapport rédigé ensuite par Claude — exactement là où le saut
// 3.5 (agentique, long-horizon) apporte quelque chose. Volume faible,
// qualité sensible → pas d'économie ici.
const GEMINI_RESEARCH_MODEL = 'gemini-3.5-flash'

// Killswitch : `arty-gemini-cheap-disabled = '1'` (DevTools / localStorage)
// repasse le CHAT sur 3.5-flash sans redéploiement, si une régression est
// observée en prod. Ne touche pas la recherche hybride (déjà sur 3.5).
const GEMINI_CHEAP_KILLSWITCH = 'arty-gemini-cheap-disabled'
function geminiChatModel(): string {
  try {
    if (localStorage.getItem(GEMINI_CHEAP_KILLSWITCH) === '1') {
      return GEMINI_RESEARCH_MODEL
    }
  } catch {
    // localStorage indispo (tests/SSR) — garder le défaut éco.
  }
  return GEMINI_CHAT_MODEL
}

// CRIT-5 — Sans timeout, un Cloudflare cold-start ou un réseau flaky peut
// laisser pendre une requête 60-90s. Force un cap explicite.
const GEMINI_TIMEOUT_MS = 60_000

// CRIT-6 — Retry transient errors (429, 5xx). Gemini preview model est
// particulièrement exposé aux ratelimits. Backoff exponentiel.
const RETRY_DELAYS_MS = [1000, 2000, 4000]
function shouldRetry(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600)
}

/**
 * fetch + retry exponentiel sur 429/5xx + erreurs réseau transient.
 * Préserve les erreurs d'abort utilisateur (pas de retry sur AbortError).
 */
async function fetchWithRetry(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  externalSignal?: AbortSignal,
): Promise<Response> {
  let lastError: unknown
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const res = await fetchWithTimeout(url, init, timeoutMs, externalSignal)
      if (!shouldRetry(res.status) || attempt === RETRY_DELAYS_MS.length) return res
      // P0.7 — 429 cap premium mensuel = définitif, ne pas retenter 7 s.
      if (res.status === 429) {
        const peek = await res.clone().text().catch(() => '')
        try {
          if ((JSON.parse(peek) as { error?: string })?.error === 'premium_cap_reached') return res
        } catch { /* body non-JSON → rate limit upstream, retry normal */ }
      }
      lastError = new Error(`HTTP ${res.status}`)
    } catch (err) {
      // Abort utilisateur = on ne retry pas
      if (externalSignal?.aborted) throw err
      lastError = err
      if (attempt === RETRY_DELAYS_MS.length) throw err
    }
    await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]))
  }
  throw lastError instanceof Error ? lastError : new Error('Retry exhausted')
}

// Gemini API client with streaming

const GEMINI_SYSTEM = `Tu es Arty, un assistant IA personnel.
Tu parles comme un pote compétent — direct, cash, pas de flatterie.
Tutoie l'utilisateur. Phrases courtes. Pas de "Excellente question !" ni de formules creuses.
Quand tu fais une recherche, cite tes sources avec les liens.
Tu es utilisé spécifiquement pour les tâches nécessitant l'accès à du contenu web (YouTube, Google Maps, actus temps réel).

Règles de vérité : Cite toujours tes sources avec les URLs. Si tu n'es pas certain d'un fait (date, prix, nom), dis-le explicitement. Préfère 'je ne sais pas' à une réponse inventée.`

/**
 * Adapte le budget thinking de Gemini à la nature de la requête :
 * - 0 pour les lookups factuels (météo, horaires, itinéraires) où la
 *   recherche externe fournit la réponse directement
 * - 512 pour les news / prix simples
 * - 2048 pour les analyses / comparaisons / synthèses
 * - 1024 par défaut
 */
export function getGeminiThinkingBudget(message: string, isMapQuery: boolean): number {
  // « ouvert|fermé » (horaires d'ouverture) reste inline : lookup factuel qui
  // n'est ni météo ni carte. isMapToolQuery est re-testé ici pour couvrir les
  // appels directs (tests, comparateur) où le param isMapQuery ne viendrait
  // pas du même message — en prod l'appelant passe déjà isMapToolQuery(msg).
  if (isMapQuery || isMapToolQuery(message) || isWeatherQuery(message) || /ouvert|fermé/i.test(message)) {
    return 0
  }
  if (/prix|tarif|actualité|news|résultat|score/i.test(message)) {
    return 512
  }
  if (/résumé|analyse|explique|compare|synthèse/i.test(message)) {
    return 2048
  }
  return 1024
}

/**
 * Applique le niveau de réflexion choisi par l'utilisateur au budget Gemini.
 *  - rapide          → 0 (réflexion coupée)
 *  - approfondi/max  → 2048 (palier « profond » de Gemini Flash)
 *  - auto            → heuristique par message (getGeminiThinkingBudget)
 * Gemini Flash n'expose qu'un budget de pensée (pas de niveaux d'effort comme
 * Claude) ; « approfondi » et « max » convergent donc vers le même palier.
 */
export function resolveGeminiThinkingBudget(
  message: string,
  isMapQuery: boolean,
  level: ReflectionLevel
): number {
  if (level === 'rapide') return 0
  if (level === 'approfondi' || level === 'max') return 2048
  return getGeminiThinkingBudget(message, isMapQuery)
}

interface GeminiStreamOptions {
  systemPrompt?: string
  // Force un modèle précis (utilisé par le comparateur multi-modèles).
  // Si absent, fallback sur geminiChatModel() (défaut Arty).
  model?: string
  // Niveau de réflexion utilisateur (réglage global). Passé uniquement par le
  // vrai chat Gemini (useConversation) — jamais par le comparateur. Absent ⇒
  // 'auto' (heuristique par message). Voir reflectionLevel.ts.
  reflectionLevel?: ReflectionLevel
  // Appel d'arrière-plan (comparateur) : l'event 'arty-model-used' est marqué
  // background → ignoré par le badge de conversation (F-4).
  background?: boolean
  // Conversation d'origine (targetId) — scope l'event 'arty-model-used'.
  conversationId?: string
  // Raison du routage (refonte routage, étape 4) — resolveRoute, via
  // useConversation. Portée par l'event 'arty-model-used' pour l'UI.
  routeReason?: RouteReason
}

export function streamGeminiMessage(
  messages: Array<{ role: string; content: string }>,
  onToken: (text: string) => void,
  onDone: () => void,
  onError: (error: Error) => void,
  options?: GeminiStreamOptions,
  apiKeyOverride?: string
): AbortController {
  const controller = new AbortController()

  const apiKey = apiKeyOverride || getGeminiKey()

  runGeminiStream(apiKey, messages, onToken, onDone, onError, options, controller)
  return controller
}

async function runGeminiStream(
  apiKey: string | null,
  messages: Array<{ role: string; content: string }>,
  onToken: (text: string) => void,
  onDone: () => void,
  onError: (error: Error) => void,
  options: GeminiStreamOptions | undefined,
  controller: AbortController
) {
  // Modèle effectif : `options.model` (forcé par le comparateur) ou
  // geminiChatModel() (défaut Arty pour le chat normal). Résolu UNE fois
  // au début pour que l'event "model-used", la requête, et le tracking
  // de coût remontent tous le même nom.
  const model = options?.model || geminiChatModel()
  try {
    // Convert messages to Gemini format
    type GeminiPart = { text: string } | { fileData: { fileUri: string } }
    const contents: Array<{ role: string; parts: GeminiPart[] }> = messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }))

    const lastMessage = messages[messages.length - 1]?.content || ''

    // Vidéo YouTube : Gemini la lit nativement si on lui passe l'URL canonique
    // dans une part `fileData` (et non comme du texte + url_context, qui ne lit
    // que la page web, pas la vidéo). On normalise via extractYouTubeUrls
    // (watch?v=ID) et on injecte la/les part(s) vidéo sur le dernier message
    // user uniquement — la vidéo n'est facturée qu'au tour où elle est collée.
    const youtubeUrls = extractYouTubeUrls(lastMessage)
    const hasVideo = youtubeUrls.length > 0
    if (hasVideo) {
      const last = contents[contents.length - 1]
      if (last) {
        last.parts = [
          ...youtubeUrls.map((fileUri) => ({ fileData: { fileUri } })),
          ...last.parts,
        ]
      }
    }

    // google_maps et google_search sont mutuellement exclusifs dans une même
    // requête Gemini (BUG 5) — le choix se fait via le prédicat partagé
    // isMapToolQuery (router/intentPatterns.ts, étroit : exclut la météo).
    const isMapQuery = isMapToolQuery(lastMessage)

    // Le grounding (google_search/url_context/google_maps) n'est PAS supporté
    // avec une entrée multimodale (vidéo) → risque de rejet 400. Quand une
    // vidéo YouTube est présente, on n'envoie aucun outil : la vidéo se suffit.
    // `tools: undefined` est retiré du JSON par JSON.stringify.
    const tools = hasVideo
      ? undefined
      : isMapQuery
        ? [{ google_maps: {} }]
        : [{ google_search: {} }, { url_context: {} }]

    const locationContext = await buildLocationContext(lastMessage)
    const systemText = (options?.systemPrompt || GEMINI_SYSTEM) + locationContext

    const thinkingBudget = resolveGeminiThinkingBudget(lastMessage, isMapQuery, options?.reflectionLevel ?? 'auto')

    // Notifie l'UI du modèle exact appelé (ChatTopBar) + si la réflexion est
    // active. Seuil 2048 = palier « profond » de Gemini Flash (le 512/1024
    // par défaut est du micro-raisonnement, pas une réflexion à signaler).
    // NB : l'API Gemini ne renvoie pas le modèle servi dans ses chunks —
    // c'est le SEUL client dont l'event reste une déclaration d'intention
    // (pas de dispatch correctif possible, cf. audit visibilité F-2).
    dispatchModelUsed({
      model,
      provider: 'gemini',
      reflecting: thinkingBudget >= 2048,
      background: options?.background,
      conversationId: options?.conversationId,
      ...(options?.routeReason ? { reason: options.routeReason } : {}),
    })

    const requestBody = {
      model,
      stream: true,
      contents,
      systemInstruction: {
        parts: [{ text: systemText }],
      },
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 8192,
        thinkingConfig: { thinkingBudget },
      },
      tools,
    }

    // C9 : headers factorisés (BYOK Bearer + garde server-provided + google-token/trial).
    const headers = await buildAiHeaders({ byokKey: apiKey, auth: 'bearer' })

    const response = await fetchWithRetry(
      apiUrl('/api/ai/gemini-proxy'),
      { method: 'POST', headers, body: JSON.stringify(requestBody) },
      GEMINI_TIMEOUT_MS,
      controller.signal,
    )
    updateTrialFromResponse(response)

    if (!response.ok) {
      // P0.7 — cap premium mensuel : code structuré surfacé tel quel (la
      // modale de choix l'intercepte), au lieu du générique « Gemini error ».
      const errBody = await response.clone().text().catch(() => '')
      try {
        const parsed = JSON.parse(errBody) as { error?: string; bucket?: string; cap?: number }
        if (parsed?.error === 'premium_cap_reached') {
          const e = new Error('premium_cap_reached')
          Object.assign(e, { capBucket: parsed.bucket, capLimit: parsed.cap })
          throw e
        }
        // C-D / F-13 — le refus trial explicite du proxy devenait « Erreur
        // Gemini (403) » générique. Sentinel STABLE (pattern
        // premium_cap_reached) : la traduction se fait au point d'affichage
        // (useConversation.onErr), jamais dans le message d'erreur comparé.
        if (parsed?.error === 'trial_model_restricted') {
          throw new Error('trial_model_restricted')
        }
      } catch (e) {
        if ((e as Error).message === 'premium_cap_reached') throw e
        if ((e as Error).message === 'trial_model_restricted') throw e
        // body non-JSON → erreur générique ci-dessous
      }
      // 404 = modèle/endpoint introuvable (renommage Google), pas un problème
      // de clé — message dédié pour ne pas envoyer l'utilisateur vérifier sa clé.
      const key = response.status === 404 ? 'errors.geminiModelNotFound' : 'errors.geminiError'
      throw new Error(i18n.t(key, { status: response.status }))
    }

    // (Fix F-6, audit visibilité modèle) — le re-dispatch qui vivait ici
    // (H-AI-5) était REDONDANT avec celui d'avant le fetch (même `model`
    // calculé client) et, dispatché SANS le champ `reflecting`, il éteignait
    // l'indicateur « 🧠 réflexion approfondie » avant le premier token
    // (StreamingIndicator remet reflecting=false sur tout event sans le flag).

    const reader = response.body?.getReader()
    if (!reader) throw new Error('No response body')

    // H-AI-1 — releaseLock() en try/finally pour éviter le leak du lock
    // sur erreur (le reader reste lock-ed, le body n'est jamais GC).
    const decoder = new TextDecoder()
    let buffer = ''
    let promptTokens = 0
    let candidatesTokens = 0
    try {
      // Gemini n'a pas de sentinelle terminale ([DONE]/message_stop) : la fin
      // du flux EST la fermeture de connexion. Le watchdog d'inactivité
      // (aiHttp, durcissement 14 juillet 2026) est donc la seule protection
      // contre une connexion mobile half-open qui ne se ferme jamais.
      while (true) {
        const { done, value } = await readWithInactivityTimeout(reader)
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const jsonStr = line.slice(6).trim()
          if (!jsonStr || jsonStr === '[DONE]') continue

          try {
            const data = JSON.parse(jsonStr)
            const text = data.candidates?.[0]?.content?.parts?.[0]?.text
            if (text) {
              onToken(text)
            }
            // Gemini envoie usageMetadata sur chaque chunk avec un cumulé.
            // On garde la dernière valeur reçue.
            const usage = data.usageMetadata
            if (usage) {
              promptTokens = usage.promptTokenCount || promptTokens
              candidatesTokens = usage.candidatesTokenCount || candidatesTokens
            }
          } catch {
            // Skip malformed JSON chunks
          }
        }
      }
    } finally {
      // cancel() (et pas releaseLock() seul) : après un timeout du watchdog,
      // le read() d'origine reste pendant — cancel le résout et libère la
      // socket. No-op inoffensif sur une fin naturelle par `done`.
      try { await reader.cancel() } catch { /* stream déjà terminé ou aborté */ }
    }

    try {
      recordUsage(model, promptTokens, candidatesTokens)
    } catch {
      // Tracking ne doit pas casser la réponse
    }

    onDone()
  } catch (err) {
    // AbortError = Stop utilisateur : stopStreaming a déjà finalisé et démonté
    // le stream. TOUT le reste doit atteindre onError — un throw non-Error
    // avalé laisserait le stream fantôme (spinner éternel), même durcissement
    // que runWithTools côté Anthropic (14 juillet 2026).
    if (err instanceof Error && err.name === 'AbortError') return
    onError(err instanceof Error ? err : new Error(String(err)))
  }
}

// Non-streaming research call — used in hybrid mode
export async function geminiResearch(
  query: string,
  apiKeyOverride?: string,
  reflectionLevel?: ReflectionLevel
): Promise<string> {
  const apiKey = apiKeyOverride || getGeminiKey()

  const requestBody = {
    model: GEMINI_RESEARCH_MODEL,
    stream: false,
    contents: [{
      role: 'user',
      parts: [{ text: query }],
    }],
    systemInstruction: {
      parts: [{
        text: `Tu es un assistant de recherche. Cherche les informations demandées sur le web et retourne un résumé structuré avec les données clés, chiffres, sources et liens. Sois factuel et concis. Pas de blabla. Format: bullet points avec les données trouvées.`,
      }],
    },
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 4096,
      // Cohérence avec le niveau de réflexion (audit fonctionnel 12 juin) :
      // en « rapide », la recherche hybride ne doit pas brûler 4096 tokens de
      // pensée — on garde un budget réduit (la qualité de recherche reste
      // portée par google_search, pas par le raisonnement).
      thinkingConfig: { thinkingBudget: reflectionLevel === 'rapide' ? 1024 : 4096 },
    },
    tools: [
      { google_search: {} },
      { url_context: {} },
    ],
  }

  const headers = await buildAiHeaders({ byokKey: apiKey, auth: 'bearer' })

  try {
    const res = await fetchWithRetry(
      apiUrl('/api/ai/gemini-proxy'),
      { method: 'POST', headers, body: JSON.stringify(requestBody) },
      GEMINI_TIMEOUT_MS,
    )
    updateTrialFromResponse(res)

    if (!res.ok) return ''

    const data = await res.json()
    const parts = data.candidates?.[0]?.content?.parts || []
    return parts.map((p: { text?: string }) => p.text || '').join('\n')
  } catch {
    return ''
  }
}
