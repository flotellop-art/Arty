import { SYSTEM_PROMPT } from '../constants/systemPrompt'

interface ApiMessage {
  role: 'user' | 'assistant'
  content: string
}

export function streamMessage(
  messages: ApiMessage[],
  onToken: (text: string) => void,
  onDone: () => void,
  onError: (error: Error) => void
): AbortController {
  const controller = new AbortController()

  const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY
  if (!apiKey) {
    setTimeout(() => onError(new Error('Clé API Anthropic manquante. Configurez VITE_ANTHROPIC_API_KEY dans .env')), 0)
    return controller
  }

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
      system: SYSTEM_PROMPT,
      messages,
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
