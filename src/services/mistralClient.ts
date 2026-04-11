import { getMistralKey } from './activeApiKey'
import { addUsage } from './tokenTracker'
import { apiUrl } from './apiBase'

const MISTRAL_SYSTEM = `Tu es Arty, un assistant IA personnel.
Tu parles comme un pote compétent — direct, cash, pas de flatterie.
Tutoie l'utilisateur. Phrases courtes. Pas de "Excellente question !" ni de formules creuses.
Si l'utilisateur a tort, dis-le clairement. Sois cash mais respectueux.
Adapte ton vocabulaire au métier de l'utilisateur si tu le connais.`

interface MistralStreamOptions {
  systemPrompt?: string
}

export function streamMistralMessage(
  messages: Array<{ role: string; content: string }>,
  onToken: (text: string) => void,
  onDone: () => void,
  onError: (error: Error) => void,
  options?: MistralStreamOptions,
  apiKeyOverride?: string
): AbortController {
  const controller = new AbortController()

  const apiKey = apiKeyOverride || getMistralKey()

  runMistralStream(apiKey, messages, onToken, onDone, onError, options, controller)
  return controller
}

async function runMistralStream(
  apiKey: string | null,
  messages: Array<{ role: string; content: string }>,
  onToken: (text: string) => void,
  onDone: () => void,
  onError: (error: Error) => void,
  options: MistralStreamOptions | undefined,
  controller: AbortController
) {
  try {
    const systemPrompt = options?.systemPrompt || MISTRAL_SYSTEM

    // Build messages in OpenAI format
    const apiMessages = [
      { role: 'system', content: systemPrompt },
      ...messages.map(m => ({ role: m.role, content: m.content })),
    ]

    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`
    }

    const response = await fetch(apiUrl('/api/ai/mistral-proxy'), {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: 'mistral-large-latest',
        messages: apiMessages,
        stream: true,
        max_tokens: 8192,
        temperature: 0.7,
      }),
      signal: controller.signal,
    })

    if (!response.ok) {
      const err = await response.text().catch(() => 'Unknown error')
      if (response.status === 401) {
        onError(new Error('Clé API Mistral invalide ou expirée'))
      } else if (response.status === 429) {
        onError(new Error('Limite de requêtes Mistral atteinte — réessaie dans quelques secondes'))
      } else {
        onError(new Error(`Erreur Mistral (${response.status}): ${err}`))
      }
      return
    }

    // Parse SSE stream (OpenAI format)
    if (!response.body) {
      onError(new Error('Mistral: réponse vide (pas de body)'))
      return
    }
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let totalContent = ''
    let inputTokens = 0
    let outputTokens = 0
    let usageTracked = false

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const data = line.slice(6).trim()
        if (data === '[DONE]') {
          if (!usageTracked) {
            addUsage(inputTokens, outputTokens)
            usageTracked = true
          }
          onDone()
          return
        }

        try {
          const parsed = JSON.parse(data)

          // Extract token
          const delta = parsed.choices?.[0]?.delta
          if (delta?.content) {
            totalContent += delta.content
            onToken(delta.content)
          }

          // Extract usage if available
          if (parsed.usage) {
            inputTokens = parsed.usage.prompt_tokens || 0
            outputTokens = parsed.usage.completion_tokens || 0
          }
        } catch {
          continue
        }
      }
    }

    // Fallback: stream ended without [DONE] — estimate tokens if needed
    if (!usageTracked) {
      if (outputTokens === 0) {
        outputTokens = Math.ceil(totalContent.length / 4)
        inputTokens = Math.ceil(JSON.stringify(messages).length / 4)
      }
      addUsage(inputTokens, outputTokens)
    }
    onDone()
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      onDone()
      return
    }
    onError(err instanceof Error ? err : new Error('Mistral streaming failed'))
  }
}
