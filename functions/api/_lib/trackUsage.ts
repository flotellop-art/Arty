// Capture provider usage without blocking the response sent to the client.
// Streaming responses are tee'd: one branch is forwarded, the other parsed.

import type { UsageTokens } from './pricing'

export type UsageResponseFormat = 'json' | 'sse'

/**
 * A successful completion can legitimately contain zero output tokens. The
 * explicit flag distinguishes that case from missing/truncated usage data.
 */
export type MeasuredUsage = UsageTokens & { measured: boolean }

const emptyMeasuredUsage = (): MeasuredUsage => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  audioSeconds: 0,
  measured: false,
})

const EMPTY: UsageTokens = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  audioSeconds: 0,
}

interface UsageParser {
  feed: (chunk: string) => void
  finalize: () => MeasuredUsage
}

/**
 * JSON and SSE are distinct wire formats. SSE is parsed incrementally to keep
 * memory bounded. JSON is accumulated until EOF so multi-line JSON cannot be
 * mistaken for a sequence of SSE records.
 */
function createWireParser(
  format: UsageResponseFormat,
  consumePayload: (payload: unknown) => void,
  usage: MeasuredUsage,
): UsageParser {
  let buffer = ''

  const consumeJson = (raw: string) => {
    if (!raw.trim()) return
    try {
      const payload = JSON.parse(raw) as unknown
      if (Array.isArray(payload)) {
        for (const item of payload) consumePayload(item)
      } else {
        consumePayload(payload)
      }
    } catch {
      // Keep measured=false. Wallet settlement then uses its reservation.
    }
  }

  const consumeSseLine = (rawLine: string) => {
    const line = rawLine.trim()
    if (!line.startsWith('data:')) return
    const payload = line.slice(5).trim()
    if (!payload || payload === '[DONE]') return
    consumeJson(payload)
  }

  const feed = (chunk: string) => {
    buffer += chunk
    if (format === 'json') return

    let newline: number
    while ((newline = buffer.indexOf('\n')) !== -1) {
      consumeSseLine(buffer.slice(0, newline))
      buffer = buffer.slice(newline + 1)
    }
  }

  const finalize = () => {
    if (format === 'json') consumeJson(buffer)
    else if (buffer.trim()) consumeSseLine(buffer)
    buffer = ''
    return usage
  }

  return { feed, finalize }
}

export function responseUsageFormat(contentType: string | null): UsageResponseFormat {
  return contentType?.toLowerCase().includes('application/json') ? 'json' : 'sse'
}

/** Force OpenAI-compatible streamed responses to include the final usage chunk. */
export function enforceStreamUsage(body: string): string {
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>
    if (parsed.stream !== true) return body
    const existing = parsed.stream_options
    parsed.stream_options = {
      ...(existing && typeof existing === 'object' ? existing as Record<string, unknown> : {}),
      include_usage: true,
    }
    return JSON.stringify(parsed)
  } catch {
    return body
  }
}

export function teeForParsing(
  upstream: ReadableStream<Uint8Array>,
  parser: (chunk: string) => void,
  finalize: () => MeasuredUsage,
  onActivity?: () => void,
): { clientBody: ReadableStream<Uint8Array>; parsedUsage: Promise<MeasuredUsage> } {
  const [clientSide, parseSide] = upstream.tee()

  const parsedUsage = (async () => {
    const decoder = new TextDecoder()
    const reader = parseSide.getReader()
    let completedNormally = false
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (value) {
          parser(decoder.decode(value, { stream: true }))
          if (onActivity) {
            try { onActivity() } catch { /* heartbeat is best-effort */ }
          }
        }
      }
      parser(decoder.decode())
      completedNormally = true
    } catch {
      // A parser may already have seen a plausible partial usage event. A read
      // failure means the completion is truncated regardless of that snapshot,
      // so billing must fall back to the full reservation.
    } finally {
      reader.releaseLock()
    }
    const usage = finalize()
    return completedNormally ? usage : { ...usage, measured: false }
  })()

  return { clientBody: clientSide, parsedUsage }
}

/** Anthropic Messages usage, for both JSON and message_start/message_delta SSE. */
export function createAnthropicParser(format: UsageResponseFormat = 'sse'): UsageParser {
  const usage = emptyMeasuredUsage()
  let sawInput = false
  let sawOutput = false

  return createWireParser(format, (payload) => {
    const data = payload as {
      message?: { usage?: Record<string, number> }
      usage?: Record<string, number>
    } | null
    const messageStartUsage = data?.message?.usage
    const terminalUsage = data?.usage
    const u = messageStartUsage ?? terminalUsage
    if (!u) return

    if (typeof u.input_tokens === 'number' && u.input_tokens >= 0) {
      usage.inputTokens = Math.max(usage.inputTokens, u.input_tokens)
      sawInput = true
    }
    // In SSE, message_start may expose an initial output_tokens snapshot
    // (often 1) before generation completes. Only the top-level usage carried
    // by message_delta is final. A non-streamed JSON response is final as-is.
    const outputIsFinal = format === 'json' || !!terminalUsage
    if (outputIsFinal && typeof u.output_tokens === 'number' && u.output_tokens >= 0) {
      usage.outputTokens = Math.max(usage.outputTokens, u.output_tokens)
      sawOutput = true
    }
    if (typeof u.cache_read_input_tokens === 'number' && u.cache_read_input_tokens >= 0) {
      usage.cacheReadTokens = Math.max(usage.cacheReadTokens, u.cache_read_input_tokens)
    }
    if (typeof u.cache_creation_input_tokens === 'number' && u.cache_creation_input_tokens >= 0) {
      usage.cacheCreationTokens = Math.max(usage.cacheCreationTokens, u.cache_creation_input_tokens)
    }
    usage.measured = sawInput && sawOutput
  }, usage)
}

/** OpenAI-compatible usage used by OpenAI Chat Completions and Mistral. */
export function createMistralParser(format: UsageResponseFormat = 'sse'): UsageParser {
  const usage = emptyMeasuredUsage()

  return createWireParser(format, (payload) => {
    const u = (payload as {
      usage?: { prompt_tokens?: number; completion_tokens?: number }
    } | null)?.usage
    if (!u) return

    const hasInput = typeof u.prompt_tokens === 'number' && u.prompt_tokens >= 0
    const hasOutput = typeof u.completion_tokens === 'number' && u.completion_tokens >= 0
    if (hasInput) usage.inputTokens = u.prompt_tokens as number
    if (hasOutput) usage.outputTokens = u.completion_tokens as number
    usage.measured = hasInput && hasOutput
  }, usage)
}

export const createOpenAIParser = createMistralParser

export type GeminiGroundingTool = 'search' | 'maps'

interface GeminiGroundingEvidence {
  grounded: boolean
  tool: GeminiGroundingTool
  queries: string[]
}

/** Extrait une preuve de grounding et les unités tarifaires Gemini 3. Un
 * groundingMetadata vide ne compte pas. Les requêtes vides sont ignorées et
 * les chunks Maps permettent de classifier les appels directs sans contexte. */
function candidateGroundingEvidence(
  candidate: unknown,
  requestedTool?: GeminiGroundingTool,
): GeminiGroundingEvidence | null {
  const g = (candidate as {
    groundingMetadata?: {
      webSearchQueries?: unknown
      groundingChunks?: unknown
      searchEntryPoint?: unknown
    }
  } | null)?.groundingMetadata
  if (!g || typeof g !== 'object') return null

  const queries = Array.isArray(g.webSearchQueries)
    ? g.webSearchQueries
        .filter((q): q is string => typeof q === 'string')
        .map((q) => q.trim())
        .filter(Boolean)
    : []
  const chunks = Array.isArray(g.groundingChunks) ? g.groundingChunks : []
  const hasMapsChunk = chunks.some(
    (chunk) => Boolean(chunk && typeof chunk === 'object' && 'maps' in chunk),
  )
  const hasWebChunk = chunks.some(
    (chunk) => Boolean(chunk && typeof chunk === 'object' && 'web' in chunk),
  )
  const grounded = queries.length > 0 || chunks.length > 0 || g.searchEntryPoint != null
  if (!grounded) return null

  const tool = requestedTool ?? (hasMapsChunk && !hasWebChunk ? 'maps' : 'search')
  return { grounded, tool, queries }
}

/** Gemini usageMetadata, for both generateContent JSON and SSE streaming.
 * `groundedPrompts` suit l'allocation gratuite ; searchQueries/mapsQueries
 * comptent les requêtes uniques non vides facturables après ce palier. */
export function createGeminiParser(
  format: UsageResponseFormat = 'sse',
  requestedTool?: GeminiGroundingTool,
): UsageParser {
  const usage = emptyMeasuredUsage()
  usage.groundedPrompts = 0
  usage.searchGroundedPrompts = 0
  usage.mapsGroundedPrompts = 0
  usage.searchQueries = 0
  usage.mapsQueries = 0
  const searchQueries = new Set<string>()
  const mapsQueries = new Set<string>()
  let promptTokens: number | null = null
  let candidatesTokens: number | null = null
  let thoughtsTokens = 0
  let cachedTokens = 0
  let sawInput = false
  let sawOutput = false

  return createWireParser(format, (payload) => {
    const data = payload as {
      candidates?: unknown[]
      usageMetadata?: {
        promptTokenCount?: number
        candidatesTokenCount?: number
        thoughtsTokenCount?: number
        cachedContentTokenCount?: number
      }
    } | null

    if (Array.isArray(data?.candidates)) {
      for (const candidate of data.candidates) {
        const evidence = candidateGroundingEvidence(candidate, requestedTool)
        if (!evidence?.grounded) continue
        usage.groundedPrompts = 1
        if (evidence.tool === 'maps') {
          usage.mapsGroundedPrompts = 1
          for (const query of evidence.queries) mapsQueries.add(query)
        } else {
          usage.searchGroundedPrompts = 1
          for (const query of evidence.queries) searchQueries.add(query)
        }
      }
      usage.searchQueries = searchQueries.size
      usage.mapsQueries = mapsQueries.size
    }

    const metadata = data?.usageMetadata
    if (!metadata) return

    if (typeof metadata.promptTokenCount === 'number' && metadata.promptTokenCount >= 0) {
      promptTokens = metadata.promptTokenCount
      sawInput = true
    }
    if (typeof metadata.candidatesTokenCount === 'number' && metadata.candidatesTokenCount >= 0) {
      candidatesTokens = metadata.candidatesTokenCount
      sawOutput = true
    }
    if (typeof metadata.thoughtsTokenCount === 'number' && metadata.thoughtsTokenCount >= 0) {
      thoughtsTokens = metadata.thoughtsTokenCount
    }
    if (
      typeof metadata.cachedContentTokenCount === 'number' &&
      metadata.cachedContentTokenCount >= 0
    ) {
      cachedTokens = metadata.cachedContentTokenCount
    }
    // Gemini inclut le cache dans promptTokenCount. Le soustraire évite de le
    // facturer une fois au prix input puis une seconde au prix cache-read.
    if (promptTokens != null) usage.inputTokens = Math.max(0, promptTokens - cachedTokens)
    usage.cacheReadTokens = cachedTokens
    if (candidatesTokens != null) usage.outputTokens = candidatesTokens + thoughtsTokens
    usage.measured = sawInput && sawOutput
  }, usage)
}

/** Whisper non-streaming duration (verbose_json). */
export function parseWhisperBody(raw: string): UsageTokens {
  const usage = { ...EMPTY }
  try {
    const data = JSON.parse(raw) as { duration?: number }
    if (typeof data.duration === 'number' && data.duration > 0) {
      usage.audioSeconds = data.duration
    }
  } catch {
    // Caller applies its own non-streaming fallback policy.
  }
  return usage
}

/** Voxtral non-streaming audio duration. */
export function parseVoxtralBody(raw: string): UsageTokens {
  const usage = { ...EMPTY }
  try {
    const data = JSON.parse(raw) as { usage?: { prompt_audio_seconds?: number } }
    const seconds = data.usage?.prompt_audio_seconds
    if (typeof seconds === 'number' && seconds > 0) {
      usage.audioSeconds = seconds
    }
  } catch {
    // Caller applies its own non-streaming fallback policy.
  }
  return usage
}
