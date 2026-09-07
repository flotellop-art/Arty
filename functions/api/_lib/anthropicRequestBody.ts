import { Tokenizer, TokenParser, TokenType, type ParsedTokenInfo } from '@streamparser/json-whatwg'
import { assertRequestContentLengthWithinLimit, limitReadableStream, RequestBodyTooLargeError } from './boundedRequestBody'

// Anthropic documents 32 MB, not 32 MiB. This is a transport limit, NOT a
// token/cost estimate or a guarantee about total concurrent isolate memory.
export const ANTHROPIC_BODY_MAX_BYTES = 32_000_000
export const ANTHROPIC_BODY_MAX_DEPTH = 64
export const ANTHROPIC_BODY_MAX_TOKENS = 50_000

class InvalidBody extends Error {}
class ComplexBody extends Error {}

/** Split even a hostile single large chunk before the tokenizer can enqueue
 * millions of tiny tokens ahead of its downstream structural guard. */
function smallChunks(source: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const reader = source.getReader()
  let pending: Uint8Array | undefined
  let offset = 0
  return new ReadableStream({
    async pull(controller) {
      while (!pending || offset === pending.byteLength) {
        pending = undefined
        const next = await reader.read()
        if (next.done) { controller.close(); return }
        pending = next.value; offset = 0
      }
      const end = Math.min(offset + 4096, pending.byteLength)
      controller.enqueue(pending.subarray(offset, end))
      offset = end
      if (offset === pending.byteLength) pending = undefined
    },
    cancel(reason) { pending = undefined; return reader.cancel(reason) },
  })
}

function structureGuard(): TransformStream<ParsedTokenInfo.ParsedTokenInfo, ParsedTokenInfo.ParsedTokenInfo> {
  const stack: Array<{ object: boolean; key: boolean; keys: Set<string> }> = []
  let tokens = 0
  let started = false
  return new TransformStream({
    transform(item, controller) {
      if (++tokens > ANTHROPIC_BODY_MAX_TOKENS) throw new ComplexBody()
      const token = item.token
      if (!started) {
        if (token !== TokenType.LEFT_BRACE) throw new InvalidBody()
        started = true
      } else if (stack.length === 0) throw new InvalidBody()
      const parent = stack.at(-1)
      if (token === TokenType.NUMBER && !Number.isFinite(item.value)) throw new InvalidBody()
      if (token === TokenType.STRING && parent?.object && parent.key) {
        const key = String(item.value)
        // The library assigns obj[key]. Refuse prototype setters and ambiguous
        // duplicates BEFORE materialization, including escaped spellings.
        if (key === '__proto__' || parent.keys.has(key)) throw new InvalidBody()
        parent.keys.add(key); parent.key = false
      }
      if (token === TokenType.COMMA && parent?.object) parent.key = true
      if (token === TokenType.LEFT_BRACE || token === TokenType.LEFT_BRACKET) {
        if (stack.length >= ANTHROPIC_BODY_MAX_DEPTH) throw new ComplexBody()
        stack.push({ object: token === TokenType.LEFT_BRACE, key: true, keys: new Set() })
      } else if (token === TokenType.RIGHT_BRACE || token === TokenType.RIGHT_BRACKET) stack.pop()
      controller.enqueue(item)
    },
  })
}

// The installed tokenizer does not preserve orphan escaped surrogates like
// JSON.parse. Refuse those before tokenization; valid pairs must stay adjacent.
function unicodeEscapeGuard(): TransformStream<string, string> {
  let inString = false, escaped = false, remaining = 0, digits = '', lowPhase = 0, pairedLow = false
  let scalarLength = 0
  return new TransformStream({
    transform(chunk, controller) {
      for (const character of chunk) {
        if (lowPhase) {
          if (character !== (lowPhase === 1 ? '\\' : 'u')) throw new InvalidBody()
          if (lowPhase === 1) lowPhase = 2
          else { lowPhase = 0; remaining = 4; digits = ''; pairedLow = true }
        } else if (remaining) {
          if (!/^[0-9a-fA-F]$/.test(character)) throw new InvalidBody()
          digits += character
          if (--remaining === 0) {
            const code = Number.parseInt(digits, 16)
            if (pairedLow) {
              if (code < 0xdc00 || code > 0xdfff) throw new InvalidBody()
              pairedLow = false
            } else if (code >= 0xd800 && code <= 0xdbff) lowPhase = 1
            else if (code >= 0xdc00 && code <= 0xdfff) throw new InvalidBody()
          }
        } else if (!inString) {
          if (character === '"') { inString = true; scalarLength = 0 }
          else if ('{}[],: \r\n\t'.includes(character)) scalarLength = 0
          // A finite 0.000...1 is still just one NUMBER token. Bound it before
          // the tokenizer's scalar buffer or Number conversion can grow.
          else if (++scalarLength > 128) throw new ComplexBody()
        } else if (escaped) {
          escaped = false
          if (character === 'u') { remaining = 4; digits = '' }
        } else if (character === '\\') escaped = true
        else if (character === '"') inString = false
      }
      controller.enqueue(chunk)
    },
    flush() { if (remaining || lowPhase || pairedLow) throw new InvalidBody() },
  })
}

export type AnthropicBodyRead = { ok: true; body: Record<string, unknown> } | { ok: false; response: Response }

/** One bounded DOM, no full raw JSON string and no tee. Parse syntax and shape
 * before ANY trial/wallet/quota debit. This does not validate Anthropic's full
 * request schema, binary attachments, model entitlement, or financial envelope. */
export async function readAnthropicRequestBody(request: Request): Promise<AnthropicBodyRead> {
  let reader: ReadableStreamDefaultReader | undefined
  const abort = () => { if (reader) void reader.cancel().catch(() => undefined) }
  try {
    if (request.signal.aborted) throw new InvalidBody()
    assertRequestContentLengthWithinLimit(request, ANTHROPIC_BODY_MAX_BYTES)
    if (!request.body) throw new InvalidBody()
    reader = smallChunks(limitReadableStream(request.body, ANTHROPIC_BODY_MAX_BYTES))
      .pipeThrough(new TextDecoderStream('utf-8', { fatal: true }))
      .pipeThrough(unicodeEscapeGuard())
      .pipeThrough(new Tokenizer({ stringBufferSize: 64 * 1024, numberBufferSize: 64 * 1024 }))
      .pipeThrough(structureGuard())
      // Do not terminate at the first root and silently ignore later chunks.
      // Root-only emission also avoids cloning parent DOMs in the wrapper.
      .pipeThrough(new TokenParser({ paths: ['$'], keepStack: true, separator: '' }))
      .getReader()
    request.signal.addEventListener('abort', abort, { once: true })
    let root: unknown
    let roots = 0
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      if (++roots !== 1) throw new InvalidBody()
      root = next.value.value
    }
    if (request.signal.aborted || roots !== 1 || !root || typeof root !== 'object' || Array.isArray(root)) {
      throw new InvalidBody()
    }
    return { ok: true, body: root as Record<string, unknown> }
  } catch (error) {
    abort()
    const large = error instanceof RequestBodyTooLargeError
    const complex = error instanceof ComplexBody
    return { ok: false, response: Response.json(
      large ? { error: 'payload_too_large', max_bytes: ANTHROPIC_BODY_MAX_BYTES }
        : { error: complex ? 'payload_too_complex' : 'invalid_request_body' },
      { status: large || complex ? 413 : 400, headers: { 'cache-control': 'no-store' } },
    ) }
  } finally {
    request.signal.removeEventListener('abort', abort)
  }
}
