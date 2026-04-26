import { getGeminiKey } from './activeApiKey'
import { apiUrl } from './apiBase'
import { getValidAccessToken } from './googleAuth'
import { buildLocationContext } from './locationContext'
import { recordUsage } from './costTracker'
import i18n from '../i18n'

const GEMINI_MODEL = 'gemini-3-flash-preview'

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
  try {
    // Convert messages to Gemini format
    const contents = messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }))

    // Detect if query is map/location related — google_maps and google_search
    // cannot be combined in the same Gemini request
    const lastMessage = messages[messages.length - 1]?.content || ''
    const isMapQuery = /google\s*maps|itinéraire|trajet|street\s*view|restaurant|horaires?|adresse|où\s+(se\s+trouve|est|aller|trouver)|coordonnées|GPS|plan\s+(de|du)|carte/i.test(lastMessage)

    const tools = isMapQuery
      ? [{ google_maps: {} }]
      : [{ google_search: {} }, { url_context: {} }]

    const locationContext = await buildLocationContext(lastMessage)
    const systemText = (options?.systemPrompt || GEMINI_SYSTEM) + locationContext

    const requestBody = {
      model: GEMINI_MODEL,
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

    const response = await fetch(apiUrl('/api/ai/gemini-proxy'), {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    })

    const { updateTrialFromResponse } = await import('./trialClient')
    updateTrialFromResponse(response)

    if (!response.ok) {
      throw new Error(i18n.t('errors.geminiError', { status: response.status }))
    }

    const reader = response.body?.getReader()
    if (!reader) throw new Error('No response body')

    const decoder = new TextDecoder()
    let buffer = ''
    let promptTokens = 0
    let candidatesTokens = 0

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

    try {
      recordUsage(GEMINI_MODEL, promptTokens, candidatesTokens)
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
    model: 'gemini-3-flash-preview',
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
    const res = await fetch(apiUrl('/api/ai/gemini-proxy'), {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
    })

    const { updateTrialFromResponse } = await import('./trialClient')
    updateTrialFromResponse(res)

    if (!res.ok) return ''

    const data = await res.json()
    const parts = data.candidates?.[0]?.content?.parts || []
    return parts.map((p: { text?: string }) => p.text || '').join('\n')
  } catch {
    return ''
  }
}
