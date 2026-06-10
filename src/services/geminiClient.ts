import { getGeminiKey } from './activeApiKey'
import { apiUrl } from './apiBase'
import { getValidAccessToken } from './googleAuth'
import { buildLocationContext } from './locationContext'
import { recordUsage } from './costTracker'
import { dispatchModelUsed } from './modelLabels'
import { extractYouTubeUrls } from './aiRouter'
import { updateTrialFromResponse } from './trialClient'
import i18n from '../i18n'

// Modèle Flash GA stable. `gemini-3-flash` (sans suffixe) renvoyait un 404 :
// ce nom n'existe pas côté API Google — pour cette génération seul
// `gemini-3-flash-preview` existait, et les "preview" sont dépréciées sans
// préavis. On pointe donc sur la GA `gemini-3.5-flash` (= ce que résout
// l'alias `gemini-flash-latest`). Si Google renomme encore, le 404 affiche
// désormais un message explicite (errors.geminiModelNotFound) au lieu
// d'envoyer l'utilisateur vérifier sa clé. Liste des noms valides :
// GET https://generativelanguage.googleapis.com/v1beta/models
const GEMINI_MODEL = 'gemini-3.5-flash'

// CRIT-5 — Sans timeout, un Cloudflare cold-start ou un réseau flaky peut
// laisser pendre une requête 60-90s. Force un cap explicite.
const GEMINI_TIMEOUT_MS = 60_000

// Compréhension vidéo (non-streaming) : l'échantillonnage frames + audio peut
// prendre nettement plus longtemps que du texte. Timeout plus large.
const GEMINI_VIDEO_TIMEOUT_MS = 120_000

// CRIT-6 — Retry transient errors (429, 5xx). Gemini preview model est
// particulièrement exposé aux ratelimits. Backoff exponentiel.
const RETRY_DELAYS_MS = [1000, 2000, 4000]
function shouldRetry(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600)
}

/**
 * fetch + timeout via AbortController. Compose avec un controller externe
 * si fourni (pour permettre l'annulation côté caller).
 */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  externalSignal?: AbortSignal,
): Promise<Response> {
  const ctrl = new AbortController()
  const timeoutId = setTimeout(() => ctrl.abort(new DOMException('Timeout', 'AbortError')), timeoutMs)
  // Lien avec le signal externe si présent
  const onExternalAbort = () => ctrl.abort(externalSignal?.reason)
  if (externalSignal) {
    if (externalSignal.aborted) ctrl.abort(externalSignal.reason)
    else externalSignal.addEventListener('abort', onExternalAbort)
  }
  try {
    return await fetch(url, { ...init, signal: ctrl.signal })
  } finally {
    clearTimeout(timeoutId)
    if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort)
  }
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
  if (isMapQuery || /météo|quel\s+temps|température|horaires?|ouvert|fermé|itinéraire|trajet/i.test(message)) {
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

interface GeminiStreamOptions {
  systemPrompt?: string
  // Force un modèle précis (utilisé par le comparateur multi-modèles).
  // Si absent, fallback sur GEMINI_MODEL (défaut Arty).
  model?: string
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
  // GEMINI_MODEL (défaut Arty pour le chat normal). Résolu UNE fois
  // au début pour que l'event "model-used", la requête, et le tracking
  // de coût remontent tous le même nom.
  const model = options?.model || GEMINI_MODEL
  try {
    // Convert messages to Gemini format
    type GeminiPart = { text: string } | { fileData: { fileUri: string } }
    const contents: Array<{ role: string; parts: GeminiPart[] }> = messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }))

    // Detect if query is map/location related — google_maps and google_search
    // cannot be combined in the same Gemini request (cf. CLAUDE.md BUG 5).
    // Couvre les formulations naturelles FR/EN d'itinéraire et de distance:
    // "combien de temps pour aller à X", "temps qu'il faut pour aller",
    // "à quelle distance", "distance entre Y et X", "aller à X", etc.
    const lastMessage = messages[messages.length - 1]?.content || ''

    // Vidéo YouTube : Gemini la lit nativement via une part `fileData` (frames
    // 1/s + audio), pas comme du texte + url_context (qui ne lit que la page).
    // On prend la vidéo la PLUS RÉCENTE de la conversation — souvent collée
    // dans un message PRÉCÉDENT puis discutée sur plusieurs tours — et on
    // l'injecte dans SON message pour que Gemini la garde en contexte sur les
    // questions de suivi. Une seule vidéo (la plus récente) pour borner le
    // coût ; elle est ré-envoyée à chaque tour Gemini tant qu'on en parle.
    let hasVideo = false
    for (let i = contents.length - 1; i >= 0; i--) {
      // Ne scanner que les tours UTILISATEUR (review 10 juin) : le system
      // prompt impose à Gemini de citer ses sources → la réponse assistant
      // re-cite quasi toujours l'URL watch?v=. Sans ce filtre, le scan
      // partant de la fin trouvait l'URL dans la réponse et injectait le
      // fileData dans un tour role:'model' → requête rejetée au 2e tour.
      if (messages[i]?.role !== 'user') continue
      const urls = extractYouTubeUrls(messages[i]?.content || '')
      if (urls.length === 0) continue
      const turn = contents[i]
      if (turn) {
        turn.parts = [...urls.map((fileUri) => ({ fileData: { fileUri } })), ...turn.parts]
      }
      hasVideo = true
      break
    }

    const isMapQuery = /google\s*maps|itinéraire|trajet|street\s*view|restaurant|horaires?|adresse|où\s+(se\s+trouve|est|aller|trouver)|coordonnées|GPS|plan\s+(de|du)|carte|combien\s+(de\s+)?(temps|km|kilomètres?|minutes?|heures?)\s+(pour|jusqu|en\s+voiture|d['’]aller|de\s+route|de\s+trajet)|temps\s+(qu['’]il\s+)?(faut|pour)\s+(pour\s+)?aller|aller\s+(à|jusqu['’]?\s*à|en)|distance\s+(entre|jusqu|pour|de)|à\s+quelle\s+distance|how\s+(far|long)\s+(is|to|from)|driving\s+(time|distance)|directions?\s+(to|from)/i.test(lastMessage)

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

    // Notifie l'UI du modèle exact appelé pour qu'elle puisse l'afficher
    // sous le sélecteur (ChatTopBar > ModelDescriptor).
    try { window.dispatchEvent(new CustomEvent('arty-model-used', { detail: { model, provider: 'gemini' } })) } catch {}

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
        thinkingConfig: { thinkingBudget: getGeminiThinkingBudget(lastMessage, isMapQuery) },
      },
      tools,
    }

    // Build headers — send BYOK key if available, otherwise proxy uses server key
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`
    }
    // Send Google token so proxy can verify whitelist
    const googleToken = await getValidAccessToken()
    if (googleToken) {
      headers['x-google-token'] = googleToken
    }

    const response = await fetchWithRetry(
      apiUrl('/api/ai/gemini-proxy'),
      { method: 'POST', headers, body: JSON.stringify(requestBody) },
      GEMINI_TIMEOUT_MS,
      controller.signal,
    )
    updateTrialFromResponse(response)

    if (!response.ok) {
      // 404 = modèle/endpoint introuvable (renommage Google), pas un problème
      // de clé — message dédié pour ne pas envoyer l'utilisateur vérifier sa clé.
      const key = response.status === 404 ? 'errors.geminiModelNotFound' : 'errors.geminiError'
      throw new Error(i18n.t(key, { status: response.status }))
    }

    // H-AI-5 — notify UI que ce message est servi par Gemini (mêmes infos
    // que les autres clients pour cohérence des badges).
    dispatchModelUsed({ model, provider: 'gemini' })

    const reader = response.body?.getReader()
    if (!reader) throw new Error('No response body')

    // H-AI-1 — releaseLock() en try/finally pour éviter le leak du lock
    // sur erreur (le reader reste lock-ed, le body n'est jamais GC).
    const decoder = new TextDecoder()
    let buffer = ''
    let promptTokens = 0
    let candidatesTokens = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
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
      try { reader.releaseLock() } catch { /* already released */ }
    }

    try {
      recordUsage(model, promptTokens, candidatesTokens)
    } catch {
      // Tracking ne doit pas casser la réponse
    }

    onDone()
  } catch (err) {
    if (err instanceof Error && err.name !== 'AbortError') {
      onError(err)
    }
  }
}

// Non-streaming research call — used in hybrid mode
export async function geminiResearch(query: string, apiKeyOverride?: string): Promise<string> {
  const apiKey = apiKeyOverride || getGeminiKey()

  const requestBody = {
    model: GEMINI_MODEL,
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
      thinkingConfig: { thinkingBudget: 4096 },
    },
    tools: [
      { google_search: {} },
      { url_context: {} },
    ],
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`
  }
  const googleToken = await getValidAccessToken()
  if (googleToken) {
    headers['x-google-token'] = googleToken
  }

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

// Compréhension vidéo non-streaming — utilisée par le mode hybride vidéo.
// Gemini regarde la/les vidéo(s) YouTube (parts fileData) et produit une
// MATIÈRE BRUTE (transcription + visuels + citations), PAS un résumé : c'est
// Claude qui rédige ensuite à partir de cette matière. Aucun outil de
// grounding (incompatible avec une entrée multimodale → 400). Retourne ''
// en cas d'échec (vidéo privée/indispo/timeout) → le handler hybride bascule
// alors sur un message d'erreur clair.
export async function geminiVideoUnderstand(youtubeUrls: string[], query: string): Promise<string> {
  if (youtubeUrls.length === 0) return ''
  const apiKey = getGeminiKey()

  const requestBody = {
    model: GEMINI_MODEL,
    stream: false,
    contents: [{
      role: 'user',
      parts: [
        ...youtubeUrls.map((fileUri) => ({ fileData: { fileUri } })),
        { text: `Documente le contenu de cette vidéo de façon FACTUELLE et EXHAUSTIVE, sans résumer ni interpréter :
- Transcription des propos importants avec timestamps approximatifs (mm:ss).
- Description séquentielle de ce qui est montré à l'écran (visuels clés, environ toutes les 30 s).
- Citations directes marquantes.
- Texte / chiffres / noms affichés à l'écran.
Ne tire AUCUNE conclusion, ne reformule pas, ne donne pas ton avis : tu produis la matière première qu'un autre assistant utilisera pour répondre à : "${query}"` },
      ],
    }],
    systemInstruction: {
      parts: [{
        text: `Tu observes et transcris des vidéos fidèlement. Tu ne synthétises pas, tu ne conclus pas. Si un détail n'est pas visible/audible, ne l'invente pas — écris "non visible" plutôt que de deviner.`,
      }],
    },
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 8192,
      thinkingConfig: { thinkingBudget: 2048 },
    },
    // PAS d'outils : entrée multimodale (vidéo) incompatible avec le grounding.
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`
  }
  const googleToken = await getValidAccessToken()
  if (googleToken) {
    headers['x-google-token'] = googleToken
  }

  // PAS de retry sur le chemin vidéo (review 10 juin) : avec fetchWithRetry,
  // un timeout interne (AbortError non-utilisateur) relançait jusqu'à 4
  // tentatives de 120 s chacune — ~8 min de requêtes vidéo fantômes
  // facturées. Un seul essai borné ; l'échec bascule proprement sur la note
  // système côté Claude.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), GEMINI_VIDEO_TIMEOUT_MS)
  try {
    const res = await fetch(apiUrl('/api/ai/gemini-proxy'), {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    })

    updateTrialFromResponse(res)

    if (!res.ok) return ''

    const data = await res.json()
    const parts = data.candidates?.[0]?.content?.parts || []
    return parts.map((p: { text?: string }) => p.text || '').join('\n')
  } catch {
    return ''
  } finally {
    clearTimeout(timer)
  }
}
