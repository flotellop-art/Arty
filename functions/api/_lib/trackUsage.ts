// Helpers pour capturer les tokens consommés par chaque provider IA sans
// bloquer le stream vers le client.
//
// Principe : on tee() le ReadableStream entrant, un côté part au client
// (forward immédiat), l'autre est parsé en tâche de fond via waitUntil().
// Quand le parser trouve le usage (à la fin du stream), on met à jour
// quota_model avec les tokens réels et le coût calculé.

import type { UsageTokens } from './pricing'

const EMPTY: UsageTokens = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  audioSeconds: 0,
}

/**
 * Tee le body d'une Response streaming. Retourne :
 * - `clientBody` : un ReadableStream à renvoyer au client (identique à l'upstream)
 * - `parsedUsage` : une Promise qui résout avec les tokens finaux quand
 *   le stream parsé est terminé. Ne jamais await côté handler principal —
 *   utiliser context.waitUntil(...) pour que la requête client ne soit pas
 *   bloquée par le parsing.
 */
export function teeForParsing(
  upstream: ReadableStream<Uint8Array>,
  parser: (chunk: string) => void,
  finalize: () => UsageTokens
): { clientBody: ReadableStream<Uint8Array>; parsedUsage: Promise<UsageTokens> } {
  const [clientSide, parseSide] = upstream.tee()

  const parsedUsage = (async () => {
    const decoder = new TextDecoder()
    const reader = parseSide.getReader()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (value) parser(decoder.decode(value, { stream: true }))
      }
      parser(decoder.decode()) // flush
    } catch {
      // best-effort — if parsing fails we just report zero tokens
    } finally {
      reader.releaseLock()
    }
    return finalize()
  })()

  return { clientBody: clientSide, parsedUsage }
}

/**
 * Parser pour Anthropic streaming. Extrait usage depuis `event: message_delta`
 * (le dernier chunk contient { usage: { input_tokens, output_tokens,
 * cache_read_input_tokens, cache_creation_input_tokens } }) et depuis
 * `event: message_start` (qui contient input_tokens).
 */
export function createAnthropicParser() {
  const usage = { ...EMPTY }
  let buffer = ''

  const feed = (chunk: string) => {
    buffer += chunk
    let idx: number
    while ((idx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, idx).trim()
      buffer = buffer.slice(idx + 1)
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (!payload || payload === '[DONE]') continue
      try {
        const data = JSON.parse(payload) as {
          type?: string
          message?: { usage?: Record<string, number> }
          usage?: Record<string, number>
        }
        // message_start contient l'input complet (avec cache_read/creation)
        const u = data.message?.usage ?? data.usage
        if (u) {
          if (typeof u.input_tokens === 'number') usage.inputTokens = Math.max(usage.inputTokens, u.input_tokens)
          if (typeof u.output_tokens === 'number') usage.outputTokens = Math.max(usage.outputTokens, u.output_tokens)
          if (typeof u.cache_read_input_tokens === 'number')
            usage.cacheReadTokens = Math.max(usage.cacheReadTokens, u.cache_read_input_tokens)
          if (typeof u.cache_creation_input_tokens === 'number')
            usage.cacheCreationTokens = Math.max(usage.cacheCreationTokens, u.cache_creation_input_tokens)
        }
      } catch {
        // skip unparseable
      }
    }
  }

  return { feed, finalize: () => usage }
}

/**
 * Parser pour Mistral streaming (OpenAI-compatible). Le dernier chunk avant
 * `data: [DONE]` contient `usage: { prompt_tokens, completion_tokens }`.
 */
export function createMistralParser() {
  const usage = { ...EMPTY }
  let buffer = ''

  const feed = (chunk: string) => {
    buffer += chunk
    let idx: number
    while ((idx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, idx).trim()
      buffer = buffer.slice(idx + 1)
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (!payload || payload === '[DONE]') continue
      try {
        const data = JSON.parse(payload) as { usage?: { prompt_tokens?: number; completion_tokens?: number } }
        if (data.usage) {
          if (typeof data.usage.prompt_tokens === 'number') usage.inputTokens = data.usage.prompt_tokens
          if (typeof data.usage.completion_tokens === 'number') usage.outputTokens = data.usage.completion_tokens
        }
      } catch {
        // skip
      }
    }
  }

  return { feed, finalize: () => usage }
}

// OpenAI Chat utilise le même format SSE que Mistral (prompt_tokens /
// completion_tokens dans le dernier chunk quand stream_options.include_usage
// est activé côté client). Alias exporté pour la clarté à l'import.
export const createOpenAIParser = createMistralParser

/**
 * Parser pour Gemini streaming SSE. Chaque chunk peut avoir `usageMetadata`,
 * on prend le dernier (cumul côté Google).
 */
export function createGeminiParser() {
  const usage = { ...EMPTY }
  let buffer = ''

  const feed = (chunk: string) => {
    buffer += chunk
    let idx: number
    while ((idx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, idx).trim()
      buffer = buffer.slice(idx + 1)
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (!payload) continue
      try {
        const data = JSON.parse(payload) as {
          usageMetadata?: {
            promptTokenCount?: number
            candidatesTokenCount?: number
            cachedContentTokenCount?: number
          }
        }
        if (data.usageMetadata) {
          const m = data.usageMetadata
          if (typeof m.promptTokenCount === 'number') usage.inputTokens = m.promptTokenCount
          if (typeof m.candidatesTokenCount === 'number') usage.outputTokens = m.candidatesTokenCount
          if (typeof m.cachedContentTokenCount === 'number') usage.cacheReadTokens = m.cachedContentTokenCount
        }
      } catch {
        // skip
      }
    }
  }

  return { feed, finalize: () => usage }
}

/**
 * Parser pour Whisper (non-streaming). On extrait `duration` du JSON retourné
 * si `response_format=verbose_json`. Sinon on ne sait pas combien de secondes.
 */
export function parseWhisperBody(raw: string): UsageTokens {
  const usage = { ...EMPTY }
  try {
    const data = JSON.parse(raw) as { duration?: number }
    if (typeof data.duration === 'number' && data.duration > 0) {
      usage.audioSeconds = data.duration
    }
  } catch {
    // skip
  }
  return usage
}
