import { SYSTEM_PROMPT } from '../constants/systemPrompt'
import { TOOLS } from './toolDefinitions'
import { addUsage } from './tokenTracker'
import { compressIfNeeded } from './conversationCompressor'

type ToolHandler = (name: string, input: Record<string, unknown>) => Promise<{ result: string; screenshot?: string; fileData?: { name: string; mimeType: string; base64: string } }>

interface StreamOptions {
  systemPrompt?: string
  onToolCall?: ToolHandler
}

export function streamMessage(
  messages: Array<{ role: string; content: string | Array<Record<string, unknown>> }>,
  onToken: (text: string) => void,
  onDone: () => void,
  onError: (error: Error) => void,
  options?: StreamOptions
): AbortController {
  const controller = new AbortController()

  const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY
  if (!apiKey) {
    setTimeout(() => onError(new Error('Clé API manquante')), 0)
    return controller
  }

  runWithTools(apiKey, messages, onToken, onDone, onError, options, controller)
  return controller
}

function formatApiError(status: number, body: string): string {
  // Try to extract a clean message from the JSON error body
  try {
    const parsed = JSON.parse(body)
    const errorType = parsed?.error?.type
    if (errorType === 'overloaded_error') {
      return 'Le serveur IA est temporairement surchargé. Réessai automatique...'
    }
    if (errorType === 'rate_limit_error') {
      return 'Trop de requêtes envoyées. Patiente quelques secondes...'
    }
    if (errorType === 'authentication_error') {
      return 'Clé API invalide ou expirée. Vérifie ta configuration.'
    }
    if (errorType === 'invalid_request_error') {
      return `Requête invalide : ${parsed?.error?.message || 'vérifie le format du message.'}`
    }
    if (parsed?.error?.message) {
      return parsed.error.message
    }
  } catch {
    // Not JSON, use status-based message
  }

  switch (status) {
    case 401: return 'Clé API invalide. Vérifie ta configuration.'
    case 403: return 'Accès refusé à l\'API.'
    case 429: return 'Trop de requêtes. Patiente quelques secondes...'
    case 500: return 'Erreur serveur chez Anthropic. Réessaie dans un instant.'
    case 529: return 'Le serveur IA est temporairement surchargé. Réessai automatique...'
    default: return `Erreur de connexion (${status}). Vérifie ta connexion internet.`
  }
}

async function fetchWithRetry(
  requestBody: string,
  apiKey: string,
  controller: AbortController
): Promise<Response> {
  let response: Response | null = null
  const maxRetries = 3
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'pdfs-2024-09-25,prompt-caching-2024-07-31',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: requestBody,
      signal: controller.signal,
    })

    const isRetryable = response.status === 429 || response.status === 529 || response.status >= 500
    if (response.ok || !isRetryable || attempt === maxRetries) {
      break
    }

    // Exponential backoff: 2s, 4s, 8s
    const delay = Math.pow(2, attempt + 1) * 1000
    await new Promise((resolve) => setTimeout(resolve, delay))
  }

  if (!response!.ok) {
    const body = await response!.text().catch(() => '')
    throw new Error(formatApiError(response!.status, body))
  }

  return response!
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function parseSSEStream(
  response: Response,
  onToken: (text: string) => void,
  _controller: AbortController
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<{ contentBlocks: any[]; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreationTokens: number }> {
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const contentBlocks: any[] = []
  let currentToolInput = ''
  let currentBlockType = ''
  let currentTextContent = ''
  let inputTokens = 0
  let outputTokens = 0
  let cacheReadTokens = 0
  let cacheCreationTokens = 0
  let buffer = ''
  let eventType = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          eventType = line.slice(7).trim()
          continue
        }

        if (!line.startsWith('data: ')) continue
        const jsonStr = line.slice(6)
        if (jsonStr === '[DONE]') continue

        let data
        try {
          data = JSON.parse(jsonStr)
        } catch {
          continue
        }

        switch (eventType) {
          case 'message_start':
            if (data.message?.usage) {
              inputTokens = data.message.usage.input_tokens || 0
              cacheReadTokens = data.message.usage.cache_read_input_tokens || 0
              cacheCreationTokens = data.message.usage.cache_creation_input_tokens || 0
            }
            break

          case 'content_block_start':
            if (data.content_block?.type === 'text') {
              currentBlockType = 'text'
              currentTextContent = ''
            } else if (data.content_block?.type === 'tool_use') {
              currentBlockType = 'tool_use'
              currentToolInput = ''
              contentBlocks.push({
                type: 'tool_use',
                id: data.content_block.id,
                name: data.content_block.name,
                input: {},
              })
            } else if (data.content_block?.type === 'server_tool_use') {
              // Server-side tool (web_search, web_fetch, code_execution) — handled by Anthropic
              currentBlockType = 'server_tool_use'
            } else if (data.content_block?.type === 'web_search_tool_result' ||
                       data.content_block?.type === 'web_fetch_tool_result' ||
                       data.content_block?.type === 'code_execution_tool_result') {
              // Server tool results — Claude uses them internally, skip in stream
              currentBlockType = 'server_tool_result'
            }
            break

          case 'content_block_delta':
            if (data.delta?.type === 'text_delta' && data.delta.text) {
              onToken(data.delta.text)
              currentTextContent += data.delta.text
            } else if (data.delta?.type === 'input_json_delta' && data.delta.partial_json) {
              currentToolInput += data.delta.partial_json
            }
            break

          case 'content_block_stop':
            if (currentBlockType === 'text' && currentTextContent) {
              contentBlocks.push({ type: 'text', text: currentTextContent })
            } else if (currentBlockType === 'tool_use' && currentToolInput) {
              const lastTool = contentBlocks[contentBlocks.length - 1]
              if (lastTool?.type === 'tool_use') {
                try {
                  lastTool.input = JSON.parse(currentToolInput)
                } catch {
                  lastTool.input = {}
                }
              }
            }
            currentBlockType = ''
            break

          case 'message_delta':
            if (data.usage) {
              outputTokens = data.usage.output_tokens || 0
            }
            break

          case 'error':
            throw new Error(data.error?.message || 'Erreur streaming')
        }
      }
    }
  } finally {
    reader.releaseLock()
  }

  return { contentBlocks, inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens }
}

async function runWithTools(
  apiKey: string,
  originalMessages: Array<{ role: string; content: string | Array<Record<string, unknown>> }>,
  onToken: (text: string) => void,
  onDone: () => void,
  onError: (error: Error) => void,
  options: StreamOptions | undefined,
  controller: AbortController
) {
  try {
    // Compress old messages if conversation is too long
    const compressed = await compressIfNeeded(
      originalMessages.map((m) => ({ role: m.role, content: m.content })),
      options?.systemPrompt,
      apiKey
    )

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const apiMessages: any[] = compressed

    let maxIterations = 200
    while (maxIterations > 0) {
      maxIterations--

      // Build system prompt with cache_control for prompt caching
      const systemText = options?.systemPrompt || SYSTEM_PROMPT
      const systemBlocks = [
        { type: 'text', text: systemText, cache_control: { type: 'ephemeral' } },
      ]

      // Add cache_control to last tool for tool definitions caching
      const cachedTools = TOOLS.map((t, i) =>
        i === TOOLS.length - 1 ? { ...t, cache_control: { type: 'ephemeral' } } : t
      )

      const requestBody = JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 65536,
        temperature: 0.7,
        stream: true,
        system: systemBlocks,
        tools: cachedTools,
        messages: apiMessages,
      })

      const response = await fetchWithRetry(requestBody, apiKey, controller)
      const { contentBlocks, inputTokens, outputTokens } = await parseSSEStream(
        response,
        onToken,
        controller
      )

      // Track token usage
      addUsage(inputTokens, outputTokens)

      const hasToolUse = contentBlocks.some((b) => b.type === 'tool_use')

      if (!hasToolUse || !options?.onToolCall) {
        onDone()
        return
      }

      // Execute tool calls
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const toolResults: any[] = []
      for (const block of contentBlocks) {
        if (block.type === 'tool_use') {
          const toolResult = await options.onToolCall(block.name, block.input)

          // If tool returned a file (e.g. PDF from Drive), send it as a document block
          // so Claude can read the file natively
          if (toolResult.fileData) {
            const contentBlocks: Array<Record<string, unknown>> = [
              { type: 'text', text: toolResult.result },
            ]
            const mime = toolResult.fileData.mimeType
            if (mime === 'application/pdf') {
              contentBlocks.push({
                type: 'document',
                source: { type: 'base64', media_type: 'application/pdf', data: toolResult.fileData.base64 },
              })
            } else if (mime?.startsWith('image/')) {
              contentBlocks.push({
                type: 'image',
                source: { type: 'base64', media_type: mime, data: toolResult.fileData.base64 },
              })
            }
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: contentBlocks,
            })
          } else {
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: toolResult.result,
            })
          }
        }
      }

      apiMessages.push({ role: 'assistant', content: contentBlocks })
      apiMessages.push({ role: 'user', content: toolResults })
    }

    onDone()
  } catch (err) {
    if (err instanceof Error && err.name !== 'AbortError') {
      onError(err)
    }
  }
}
