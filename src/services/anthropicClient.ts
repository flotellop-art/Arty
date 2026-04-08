import { SYSTEM_PROMPT } from '../constants/systemPrompt'

type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }

interface ApiMessage {
  role: 'user' | 'assistant'
  content: string | ContentBlock[]
}

interface StreamOptions {
  systemPrompt?: string
  image?: string // base64 data URI (data:image/png;base64,...)
}

export function streamMessage(
  messages: ApiMessage[],
  onToken: (text: string) => void,
  onDone: () => void,
  onError: (error: Error) => void,
  options?: StreamOptions
): AbortController {
  const controller = new AbortController()

  const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY
  if (!apiKey) {
    setTimeout(() => onError(new Error('Clé API Anthropic manquante. Configurez VITE_ANTHROPIC_API_KEY dans .env')), 0)
    return controller
  }

  // Build messages, injecting image into last user message if provided
  const apiMessages = messages.map((m, i) => {
    if (options?.image && i === messages.length - 1 && m.role === 'user') {
      const base64Data = options.image.replace(/^data:image\/\w+;base64,/, '')
      return {
        role: m.role,
        content: [
          { type: 'image' as const, source: { type: 'base64' as const, media_type: 'image/png', data: base64Data } },
          { type: 'text' as const, text: typeof m.content === 'string' ? m.content : '' },
        ],
      }
    }
    return { role: m.role, content: m.content }
  })

  fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      stream: true,
      system: options?.systemPrompt || SYSTEM_PROMPT,
      messages: apiMessages,
    }),
    signal: controller.signal,
  })
    .then(async (response) => {
      if (!response.ok) {
        const body = await response.text().catch(() => '')
        throw new Error(`Erreur API (${response.status}): ${body}`)
      }

      const reader = response.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop()!

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6)
          if (data === '[DONE]') continue

          try {
            const parsed = JSON.parse(data)
            if (
              parsed.type === 'content_block_delta' &&
              parsed.delta?.type === 'text_delta' &&
              parsed.delta.text
            ) {
              onToken(parsed.delta.text)
            }
            if (parsed.type === 'message_stop') {
              onDone()
              return
            }
            if (parsed.type === 'error') {
              throw new Error(parsed.error?.message ?? 'Erreur streaming')
            }
          } catch (e) {
            if (e instanceof SyntaxError) continue
            throw e
          }
        }
      }

      onDone()
    })
    .catch((err: Error) => {
      if (err.name !== 'AbortError') {
        onError(err)
      }
    })

  return controller
}
