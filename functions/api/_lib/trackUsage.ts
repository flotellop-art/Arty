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

/** Preuve qu'un candidat Gemini a réellement groundé (C11). Un
 * `groundingMetadata` VIDE peut apparaître quand les tools sont déclarés mais
 * qu'aucune recherche n'a été émise — on exige au moins une requête, un chunk
 * de source, ou un searchEntryPoint pour compter le prompt comme groundé. */
function candidateDidGround(candidate: unknown): boolean {
  const g = (candidate as {
    groundingMetadata?: {
      webSearchQueries?: unknown
      groundingChunks?: unknown
      searchEntryPoint?: unknown
    }
  } | null)?.groundingMetadata
  if (!g || typeof g !== 'object') return false
  return (
    (Array.isArray(g.webSearchQueries) && g.webSearchQueries.length > 0) ||
    (Array.isArray(g.groundingChunks) && g.groundingChunks.length > 0) ||
    g.searchEntryPoint != null
  )
}

/** Gemini usageMetadata, for both generateContent JSON and SSE streaming.
 * Détecte aussi le grounding Google Search (C11) : `groundedPrompts` vaut 1 si
 * AU MOINS un chunk/candidat porte une preuve de recherche — plafonné à 1 par
 * réponse, car Google facture PAR PROMPT groundé ($14/1000 famille 3.x), pas
 * par requête de recherche ni par chunk SSE. */
export function createGeminiParser(format: UsageResponseFormat = 'sse'): UsageParser {
  const usage = emptyMeasuredUsage()
  usage.groundedPrompts = 0

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

    if (Array.isArray(data?.candidates) && data.candidates.some(candidateDidGround)) {
      usage.groundedPrompts = 1
    }

    const metadata = data?.usageMetadata
    if (!metadata) return

    const hasInput =
      typeof metadata.promptTokenCount === 'number' && metadata.promptTokenCount >= 0
    const hasOutput =
      typeof metadata.candidatesTokenCount === 'number' && metadata.candidatesTokenCount >= 0

    if (hasInput) usage.inputTokens = metadata.promptTokenCount as number
    if (hasOutput) {
      const thoughts =
        typeof metadata.thoughtsTokenCount === 'number' && metadata.thoughtsTokenCount > 0
          ? metadata.thoughtsTokenCount
          : 0
      usage.outputTokens = (metadata.candidatesTokenCount as number) + thoughts
    }
    if (
      typeof metadata.cachedContentTokenCount === 'number' &&
      metadata.cachedContentTokenCount >= 0
    ) {
      usage.cacheReadTokens = metadata.cachedContentTokenCount
    }
    usage.measured = hasInput && hasOutput
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
