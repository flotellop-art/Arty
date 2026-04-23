import i18n from '../i18n'

// OpenAI client — direct API calls with user-provided key (BYOK).
// Uses gpt-4o by default, falls back to gpt-4o-mini on failure if requested.
// Supports streaming via SSE and non-streaming.
// Never stores the key — it must come from secureGet/secureSet (AES-256).

const OPENAI_ENDPOINT = 'https://api.openai.com/v1/chat/completions'
const DEFAULT_MODEL = 'gpt-4o'
const FALLBACK_MODEL = 'gpt-4o-mini'

const OPENAI_SYSTEM = `Tu es Arty, un assistant IA personnel.
Tu parles comme un pote compétent — direct, cash, pas de flatterie.
Tutoie l'utilisateur. Phrases courtes. Pas de "Excellente question !" ni de formules creuses.
Si l'utilisateur a tort, dis-le clairement. Sois cash mais respectueux.`

export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface OpenAIOptions {
  systemPrompt?: string
  model?: string
}

// ─── Error formatting ───

function formatError(status: number): Error {
  if (status === 401) return new Error(i18n.t('errors.openaiKeyInvalid'))
  if (status === 429) return new Error(i18n.t('errors.openaiRateLimit'))
  if (status >= 500) return new Error(i18n.t('errors.openaiServer'))
  return new Error(i18n.t('errors.openaiError', { status }))
}

// ─── Build request ───

function buildMessages(
  messages: OpenAIMessage[],
  systemPrompt: string
): OpenAIMessage[] {
  // Ensure a single system message at the top
  const withoutSystem = messages.filter((m) => m.role !== 'system')
  return [{ role: 'system', content: systemPrompt }, ...withoutSystem]
}

async function openaiFetch(
  apiKey: string,
  body: Record<string, unknown>,
  signal?: AbortSignal
): Promise<Response> {
  return fetch(OPENAI_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  })
}

// ─── Streaming ───

/**
 * Streaming message to OpenAI using SSE.
 * Returns an AbortController that can be used to cancel the request.
 */
export function sendMessageStream(
  messages: OpenAIMessage[],
  apiKey: string,
  onChunk: (text: string) => void,
  onDone: () => void,
  onError: (err: Error) => void,
  options?: OpenAIOptions
): AbortController {
  const controller = new AbortController()

  const run = async () => {
    try {
      if (!apiKey) {
        throw new Error(i18n.t('errors.apiKeyMissing'))
      }

      const systemPrompt = options?.systemPrompt || OPENAI_SYSTEM
      const model = options?.model || DEFAULT_MODEL
      const payload = {
        model,
        messages: buildMessages(messages, systemPrompt),
        stream: true,
        temperature: 0.7,
        max_tokens: 4096,
        stream_options: { include_usage: true },
      }

      const response = await openaiFetch(apiKey, payload, controller.signal)

      if (!response.ok) throw formatError(response.status)
      if (!response.body) throw new Error('OpenAI: réponse vide')

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let content = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6).trim()
          if (!data || data === '[DONE]') continue

          try {
            const parsed = JSON.parse(data) as {
              choices?: Array<{ delta?: { content?: string } }>
            }
            const delta = parsed.choices?.[0]?.delta?.content
            if (delta) {
              content += delta
              onChunk(delta)
            }
          } catch {
            // Skip malformed chunks
          }
        }
      }

      onDone()
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        onDone()
        return
      }
      onError(err instanceof Error ? err : new Error('OpenAI streaming failed'))
    }
  }

  run()
  return controller
}

// ─── Non-streaming ───

/**
 * Non-streaming call to OpenAI. Returns the assistant's response text.
 */
export async function sendMessage(
  messages: OpenAIMessage[],
  apiKey: string,
  options?: OpenAIOptions
): Promise<string> {
  if (!apiKey) throw new Error(i18n.t('errors.apiKeyMissing'))

  const systemPrompt = options?.systemPrompt || OPENAI_SYSTEM
  const model = options?.model || DEFAULT_MODEL

  const response = await openaiFetch(apiKey, {
    model,
    messages: buildMessages(messages, systemPrompt),
    temperature: 0.7,
    max_tokens: 4096,
  })

  if (!response.ok) throw formatError(response.status)

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  return data.choices?.[0]?.message?.content || ''
}

/**
 * Validate that an OpenAI key is accepted by the API.
 * Sends a minimal request to avoid consuming quota.
 */
export async function testApiKey(apiKey: string): Promise<boolean> {
  if (!apiKey) return false
  try {
    const response = await openaiFetch(apiKey, {
      model: FALLBACK_MODEL,
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 1,
    })
    return response.ok
  } catch {
    return false
  }
}
