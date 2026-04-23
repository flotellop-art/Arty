import { getGeminiKey } from './activeApiKey'
import { apiUrl } from './apiBase'
import { getValidAccessToken } from './googleAuth'
import { getUserLocation } from './native/location'
import i18n from '../i18n'

const LOCATION_TRIGGERS = /google\s*maps|itinéraire|trajet|street\s*view|restaurant|horaires?|adresse|où\s+(se\s+trouve|est|aller|trouver)|coordonnées|GPS|plan\s+(de|du)|carte|météo|quel\s+temps|prévisions?|pleuvoir|pluie|température|près\s+de\s+moi|autour\s+de\s+moi|le\s+plus\s+proche|directions|route\s+(to|from)|weather|forecast|rain|temperature|near\s+me|nearby|closest/i

async function buildLocationContext(message: string): Promise<string> {
  if (!LOCATION_TRIGGERS.test(message)) return ''
  const pos = await getUserLocation()
  if (!pos) return ''
  return `\n\nPosition actuelle de l'utilisateur : latitude ${pos.latitude.toFixed(5)}, longitude ${pos.longitude.toFixed(5)} (précision ~${Math.round(pos.accuracy)}m). Utilise ces coordonnées pour toute recherche de proximité ("près de moi", restaurants, itinéraires, météo locale).`
}

// Gemini API client with streaming

const GEMINI_SYSTEM = `Tu es Arty, un assistant IA personnel.
Tu parles comme un pote compétent — direct, cash, pas de flatterie.
Tutoie l'utilisateur. Phrases courtes. Pas de "Excellente question !" ni de formules creuses.
Quand tu fais une recherche, cite tes sources avec les liens.
Tu es utilisé spécifiquement pour les tâches nécessitant l'accès à du contenu web (YouTube, Google Maps, actus temps réel).`

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
      model: 'gemini-3-flash-preview',
      stream: true,
      contents,
      systemInstruction: {
        parts: [{ text: systemText }],
      },
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 8192,
        thinkingConfig: { thinkingBudget: 4096 },
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

    if (!response.ok) {
      throw new Error(i18n.t('errors.geminiError', { status: response.status }))
    }

    const reader = response.body?.getReader()
    if (!reader) throw new Error('No response body')

    const decoder = new TextDecoder()
    let buffer = ''

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
        } catch {
          // Skip malformed JSON chunks
        }
      }
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
      thinkingConfig: { thinkingBudget: 2048 },
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

    if (!res.ok) return ''

    const data = await res.json()
    const parts = data.candidates?.[0]?.content?.parts || []
    return parts.map((p: { text?: string }) => p.text || '').join('\n')
  } catch {
    return ''
  }
}
