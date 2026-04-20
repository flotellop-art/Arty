import { SYSTEM_PROMPT } from '../constants/systemPrompt'
import { TOOLS } from './toolDefinitions'
import { addUsage } from './tokenTracker'
import { compressIfNeeded } from './conversationCompressor'
import { getAnthropicKey } from './activeApiKey'
import { apiUrl } from './apiBase'
import { getValidAccessToken } from './googleAuth'
import i18n from '../i18n'

// ── Types ────────────────────────────────────────────────────────────────────

type TextBlock = { type: 'text'; text: string }
type ToolUseBlock = { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
export type ContentBlock = TextBlock | ToolUseBlock

type ToolResultContent = string | Array<Record<string, unknown>>
type ToolResultBlock = { type: 'tool_result'; tool_use_id: string; content: ToolResultContent }

// Flexible message shape used in the multi-turn API loop
type ApiMessage = { role: string; content: string | ContentBlock[] | ToolResultBlock[] }

type SSEParseResult = {
  contentBlocks: ContentBlock[]
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
}

export type ToolHandler = (
  name: string,
  input: Record<string, unknown>
) => Promise<{ result: string; screenshot?: string; fileData?: { name: string; mimeType: string; base64: string } }>

interface StreamOptions {
  systemPrompt?: string
  onToolCall?: ToolHandler
}

// ── Public API ───────────────────────────────────────────────────────────────

export function streamMessage(
  messages: Array<{ role: string; content: string | Array<Record<string, unknown>> }>,
  onToken: (text: string) => void,
  onDone: () => void,
  onError: (error: Error) => void,
  options?: StreamOptions,
  apiKeyOverride?: string
): AbortController {
  const controller = new AbortController()

  const apiKey = apiKeyOverride || getAnthropicKey()
  if (!apiKey) {
    setTimeout(() => onError(new Error(i18n.t('errors.apiKeyMissing'))), 0)
    return controller
  }

  runWithTools(apiKey, messages, onToken, onDone, onError, options, controller)
  return controller
}

// ── Error formatting ─────────────────────────────────────────────────────────

function formatApiError(status: number, body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: string | { type?: string; message?: string } }
    const err = parsed?.error

    // Our Cloudflare Functions return { error: 'string' } — surface it
    // directly so users see e.g. "Authentication required — please sign
    // in with Google" instead of the generic "Clé API invalide".
    if (typeof err === 'string' && err) return err

    if (err && typeof err === 'object') {
      const errorType = err.type
      if (errorType === 'overloaded_error') return i18n.t('errors.apiOverloaded')
      if (errorType === 'rate_limit_error') return i18n.t('errors.apiRateLimit')
      if (errorType === 'authentication_error') return i18n.t('errors.apiKeyInvalid')
      if (errorType === 'invalid_request_error') {
        return i18n.t('errors.apiInvalidRequest', { message: err.message || '?' })
      }
      if (err.message) return err.message
    }
  } catch {
    // Not JSON — fall through to status-based messages
  }

  switch (status) {
    case 401: return i18n.t('errors.apiKeyInvalid')
    case 403: return i18n.t('errors.apiAccessDenied')
    case 429: return i18n.t('errors.apiRateLimit')
    case 500: return i18n.t('errors.apiServer')
    case 529: return i18n.t('errors.apiOverloaded')
    default: return i18n.t('errors.apiConnection', { status })
  }
}

// ── HTTP fetch with exponential-backoff retry ─────────────────────────────────

async function fetchWithRetry(
  requestBody: string,
  apiKey: string | null,
  controller: AbortController
): Promise<Response> {
  const maxRetries = 3
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'anthropic-version': '2023-06-01',
    'anthropic-beta': 'pdfs-2024-09-25,prompt-caching-2024-07-31',
  }
  if (apiKey && apiKey !== 'server-provided') {
    headers['x-api-key'] = apiKey
  }
  const googleToken = await getValidAccessToken()
  if (googleToken) {
    headers['x-google-token'] = googleToken
  }

  let response: Response | null = null
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    response = await fetch(apiUrl('/api/ai/proxy'), {
      method: 'POST',
      headers,
      body: requestBody,
      signal: controller.signal,
    })

    const isRetryable = response.status === 429 || response.status === 529 || response.status >= 500
    if (response.ok || !isRetryable || attempt === maxRetries) break

    // Exponential backoff: 2s, 4s, 8s
    await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt + 1) * 1000))
  }

  if (!response!.ok) {
    const body = await response!.text().catch(() => '')
    throw new Error(formatApiError(response!.status, body))
  }

  return response!
}

// ── SSE stream parser ─────────────────────────────────────────────────────────

async function parseSSEStream(
  response: Response,
  onToken: (text: string) => void
): Promise<SSEParseResult> {
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()

  const contentBlocks: ContentBlock[] = []
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

        let data: Record<string, unknown>
        try {
          data = JSON.parse(jsonStr) as Record<string, unknown>
        } catch {
          continue
        }

        switch (eventType) {
          case 'message_start': {
            const usage = (data.message as { usage?: { input_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } } | undefined)?.usage
            if (usage) {
              inputTokens = usage.input_tokens || 0
              cacheReadTokens = usage.cache_read_input_tokens || 0
              cacheCreationTokens = usage.cache_creation_input_tokens || 0
            }
            break
          }
          case 'content_block_start': {
            const block = data.content_block as { type?: string; id?: string; name?: string } | undefined
            if (block?.type === 'text') {
              currentBlockType = 'text'
              currentTextContent = ''
            } else if (block?.type === 'tool_use') {
              currentBlockType = 'tool_use'
              currentToolInput = ''
              contentBlocks.push({ type: 'tool_use', id: block.id || '', name: block.name || '', input: {} })
            } else if (
              block?.type === 'server_tool_use' ||
              block?.type === 'web_search_tool_result' ||
              block?.type === 'web_fetch_tool_result' ||
              block?.type === 'code_execution_tool_result'
            ) {
              // Server-side tools — handled by Anthropic, skip
              currentBlockType = 'server_tool'
            }
            break
          }
          case 'content_block_delta': {
            const delta = data.delta as { type?: string; text?: string; partial_json?: string } | undefined
            if (delta?.type === 'text_delta' && delta.text) {
              onToken(delta.text)
              currentTextContent += delta.text
            } else if (delta?.type === 'input_json_delta' && delta.partial_json) {
              currentToolInput += delta.partial_json
            }
            break
          }
          case 'content_block_stop':
            if (currentBlockType === 'text' && currentTextContent) {
              contentBlocks.push({ type: 'text', text: currentTextContent })
            } else if (currentBlockType === 'tool_use' && currentToolInput) {
              const lastTool = contentBlocks[contentBlocks.length - 1]
              if (lastTool?.type === 'tool_use') {
                try {
                  lastTool.input = JSON.parse(currentToolInput) as Record<string, unknown>
                } catch {
                  lastTool.input = {}
                }
              }
            }
            currentBlockType = ''
            break

          case 'message_delta': {
            const usage = (data as { usage?: { output_tokens?: number } }).usage
            if (usage) outputTokens = usage.output_tokens || 0
            break
          }
          case 'error': {
            const err = (data as { error?: { message?: string } }).error
            throw new Error(err?.message || 'Streaming error')
          }
        }
      }
    }
  } finally {
    reader.releaseLock()
  }

  return { contentBlocks, inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens }
}

// ── Tool execution ────────────────────────────────────────────────────────────

async function executeToolCalls(
  contentBlocks: ContentBlock[],
  onToolCall: ToolHandler
): Promise<ToolResultBlock[]> {
  const toolResults: ToolResultBlock[] = []

  for (const block of contentBlocks) {
    if (block.type !== 'tool_use') continue

    const toolResult = await onToolCall(block.name, block.input)

    if (toolResult.fileData) {
      // Tool returned a file — send it as a native document/image block
      const fileBlocks: Array<Record<string, unknown>> = [{ type: 'text', text: toolResult.result }]
      const mime = toolResult.fileData.mimeType
      if (mime === 'application/pdf') {
        fileBlocks.push({
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: toolResult.fileData.base64 },
        })
      } else if (mime?.startsWith('image/')) {
        fileBlocks.push({
          type: 'image',
          source: { type: 'base64', media_type: mime, data: toolResult.fileData.base64 },
        })
      }
      toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: fileBlocks })
    } else {
      toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: toolResult.result })
    }
  }

  return toolResults
}

// ── Main streaming loop with tool use ────────────────────────────────────────

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
    const compressed = await compressIfNeeded(
      originalMessages.map((m) => ({ role: m.role, content: m.content })),
      options?.systemPrompt,
      apiKey
    )

    const apiMessages: ApiMessage[] = compressed as ApiMessage[]
    const systemText = options?.systemPrompt || SYSTEM_PROMPT
    const systemBlocks = [{ type: 'text', text: systemText, cache_control: { type: 'ephemeral' } }]
    // Add prompt-caching hint to last tool definition
    const cachedTools = TOOLS.map((t, i) =>
      i === TOOLS.length - 1 ? { ...t, cache_control: { type: 'ephemeral' } } : t
    )

    let maxIterations = 200
    while (maxIterations-- > 0) {
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
      const { contentBlocks, inputTokens, outputTokens } = await parseSSEStream(response, onToken)
      addUsage(inputTokens, outputTokens)

      const hasToolUse = contentBlocks.some((b) => b.type === 'tool_use')
      if (!hasToolUse || !options?.onToolCall) {
        onDone()
        return
      }

      const toolResults = await executeToolCalls(contentBlocks, options.onToolCall)
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
