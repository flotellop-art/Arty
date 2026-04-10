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

  const apiKey = apiKeyOverride || import.meta.env.VITE_GEMINI_API_KEY
  if (!apiKey) {
    setTimeout(() => onError(new Error('Clé API Gemini manquante')), 0)
    return controller
  }

  runGeminiStream(apiKey, messages, onToken, onDone, onError, options, controller)
  return controller
}

async function runGeminiStream(
  apiKey: string,
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

    const body = {
      contents,
      systemInstruction: {
        parts: [{ text: options?.systemPrompt || GEMINI_SYSTEM }],
      },
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 8192,
      },
      tools: [
        { google_search: {} },
        { url_context: {} },
        { google_maps: {} },
      ],
    }

    const model = 'gemini-3-flash-preview'
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    if (!response.ok) {
      const errText = await response.text()
      throw new Error(`Gemini API error ${response.status}: ${errText.slice(0, 200)}`)
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
  const apiKey = apiKeyOverride || import.meta.env.VITE_GEMINI_API_KEY
  if (!apiKey) return ''

  const model = 'gemini-3-flash-preview'
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`

  const body = {
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
    },
    tools: [
      { google_search: {} },
      { url_context: {} },
    ],
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!res.ok) return ''

    const data = await res.json()
    const parts = data.candidates?.[0]?.content?.parts || []
    return parts.map((p: { text?: string }) => p.text || '').join('\n')
  } catch {
    return ''
  }
}
