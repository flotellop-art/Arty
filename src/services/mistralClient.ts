import { getMistralKey } from './activeApiKey'
import { apiUrl } from './apiBase'
import { getValidAccessToken } from './googleAuth'
import { TOOLS } from './toolDefinitions'
import { convertToolsToOpenAI } from './tools/openaiFormat'
import { buildLocationContext } from './locationContext'
import { recordUsage } from './costTracker'
import i18n from '../i18n'

/**
 * Mistral large pour les requêtes longues ou les tâches qui demandent
 * une vraie capacité (rédaction, analyse, code, traduction). Mistral
 * small pour les échanges courts → moins cher + plus rapide.
 */
export function selectMistralModel(message: string): 'mistral-large-latest' | 'mistral-small-latest' {
  if (message.length > 200) return 'mistral-large-latest'
  if (/rédige|explique\s+en\s+détail|analyse|code|script|programme|traduis\s+(ce|le|la)/i.test(message)) {
    return 'mistral-large-latest'
  }
  return 'mistral-small-latest'
}

const MISTRAL_SYSTEM = `Tu es Arty, un assistant IA personnel.
Tu parles comme un pote compétent — direct, cash, pas de flatterie.
Tutoie l'utilisateur. Phrases courtes. Pas de "Excellente question !" ni de formules creuses.
Si l'utilisateur a tort, dis-le clairement. Sois cash mais respectueux.
Adapte ton vocabulaire au métier de l'utilisateur si tu le connais.`

type ToolHandler = (name: string, input: Record<string, unknown>) => Promise<{ result: string; screenshot?: string }>

interface MistralStreamOptions {
  systemPrompt?: string
  onToolCall?: ToolHandler
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

// OpenAI-format message types for the tool loop
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ApiMessage = { role: string; content?: string | null; tool_calls?: any[]; tool_call_id?: string; name?: string }

interface ToolCall {
  id: string
  function: { name: string; arguments: string }
}

async function runMistralStream(
  apiKey: string | null,
  originalMessages: Array<{ role: string; content: string }>,
  onToken: (text: string) => void,
  onDone: () => void,
  onError: (error: Error) => void,
  options: MistralStreamOptions | undefined,
  controller: AbortController
) {
  try {
    const basePrompt = options?.systemPrompt || MISTRAL_SYSTEM
    const lastUserText = [...originalMessages].reverse().find(m => m.role === 'user')?.content || ''
    const locationContext = await buildLocationContext(lastUserText)
    const systemPrompt = basePrompt + locationContext
    const model = selectMistralModel(lastUserText)

    // Build messages in OpenAI format
    const apiMessages: ApiMessage[] = [
      { role: 'system', content: systemPrompt },
      ...originalMessages.map(m => ({ role: m.role, content: m.content })),
    ]

    // Convert tools to OpenAI format
    const openaiTools = options?.onToolCall ? convertToolsToOpenAI(TOOLS) : []

    let maxIterations = 20

    while (maxIterations > 0) {
      maxIterations--

      const { content, toolCalls, inputTokens, outputTokens } = await streamOnce(
        apiKey, apiMessages, openaiTools, onToken, controller, model
      )

      try {
        recordUsage(model, inputTokens, outputTokens)
      } catch {
        // Ne casse pas la réponse si le tracking échoue
      }

      // No tool calls — we're done
      if (!toolCalls || toolCalls.length === 0 || !options?.onToolCall) {
        onDone()
        return
      }

      // Add assistant message with tool_calls
      apiMessages.push({
        role: 'assistant',
        content: content || null,
        tool_calls: toolCalls.map(tc => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.function.name, arguments: tc.function.arguments },
        })),
      })

      // Execute each tool call and add results
      for (const tc of toolCalls) {
        try {
          const args = JSON.parse(tc.function.arguments)
          const result = await options.onToolCall(tc.function.name, args)
          apiMessages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: result.result,
          })
        } catch (err) {
          apiMessages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: `Erreur: ${err instanceof Error ? err.message : 'outil échoué'}`,
          })
        }
      }
    }

    // Max iterations reached
    onDone()
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      onDone()
      return
    }
    onError(err instanceof Error ? err : new Error('Mistral streaming failed'))
  }
}

/**
 * Single streaming request to Mistral API.
 * Returns the accumulated content, any tool_calls, and token usage.
 */
async function streamOnce(
  apiKey: string | null,
  messages: ApiMessage[],
  tools: ReturnType<typeof convertToolsToOpenAI>,
  onToken: (text: string) => void,
  controller: AbortController,
  model: string
): Promise<{
  content: string
  toolCalls: ToolCall[]
  inputTokens: number
  outputTokens: number
}> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`
  }
  // Get a valid (refreshed if needed) Google token for whitelist verification
  const googleToken = await getValidAccessToken()
  if (googleToken) {
    headers['x-google-token'] = googleToken
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body: Record<string, any> = {
    model,
    messages,
    stream: true,
    max_tokens: 8192,
    temperature: 0.7,
  }

  // Only include tools if we have some
  if (tools.length > 0) {
    body.tools = tools
    body.tool_choice = 'auto'
  }

  const response = await fetch(apiUrl('/api/ai/mistral-proxy'), {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: controller.signal,
  })

  const { updateTrialFromResponse } = await import('./trialClient')
  updateTrialFromResponse(response)

  if (!response.ok) {
    const err = await response.text().catch(() => '')
    if (response.status === 401) {
      throw new Error(i18n.t('errors.mistralKeyInvalid'))
    } else if (response.status === 429) {
      throw new Error(i18n.t('errors.mistralRateLimit'))
    } else {
      throw new Error(i18n.t('errors.mistralError', { status: response.status, message: err.slice(0, 100) }))
    }
  }

  if (!response.body) {
    throw new Error('Mistral: réponse vide (pas de body)')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let content = ''
  let inputTokens = 0
  let outputTokens = 0
  const toolCalls: ToolCall[] = []
  // Accumulate partial tool calls by index
  const partialToolCalls = new Map<number, { id: string; name: string; args: string }>()

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const data = line.slice(6).trim()
      if (data === '[DONE]') break

      try {
        const parsed = JSON.parse(data)
        const delta = parsed.choices?.[0]?.delta

        // Text content
        if (delta?.content) {
          content += delta.content
          onToken(delta.content)
        }

        // Tool calls (streamed incrementally)
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0
            if (tc.id) {
              // New tool call starting
              partialToolCalls.set(idx, {
                id: tc.id,
                name: tc.function?.name || '',
                args: tc.function?.arguments || '',
              })
            } else {
              // Continue accumulating arguments
              const existing = partialToolCalls.get(idx)
              if (existing) {
                if (tc.function?.name) existing.name += tc.function.name
                if (tc.function?.arguments) existing.args += tc.function.arguments
              }
            }
          }
        }

        // Usage
        if (parsed.usage) {
          inputTokens = parsed.usage.prompt_tokens || 0
          outputTokens = parsed.usage.completion_tokens || 0
        }
      } catch {
        continue
      }
    }
  }

  // Finalize tool calls
  for (const [, tc] of partialToolCalls) {
    toolCalls.push({
      id: tc.id,
      function: { name: tc.name, arguments: tc.args },
    })
  }

  // Estimate tokens if not provided
  if (outputTokens === 0 && (content || toolCalls.length > 0)) {
    outputTokens = Math.ceil(content.length / 4)
    inputTokens = Math.ceil(JSON.stringify(messages).length / 4)
  }

  return { content, toolCalls, inputTokens, outputTokens }
}
