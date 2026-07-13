import { Phase0Error, isRecord } from './types'

const DEFAULT_REQUEST_LIMIT_BYTES = 64 * 1024
const DEFAULT_RESPONSE_LIMIT_BYTES = 1024 * 1024

async function readBoundedBytes(
  body: ReadableStream<Uint8Array> | null,
  contentLength: string | null,
  maxBytes: number,
  tooLargeCode: string,
): Promise<Uint8Array> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new Phase0Error('invalid_json_limit', { status: 500 })
  }

  if (contentLength !== null) {
    if (!/^\d+$/.test(contentLength)) {
      throw new Phase0Error('invalid_content_length', { status: 400 })
    }
    const declaredLength = Number(contentLength)
    if (!Number.isSafeInteger(declaredLength) || declaredLength > maxBytes) {
      throw new Phase0Error(tooLargeCode, { status: 413 })
    }
  }

  if (body === null) throw new Phase0Error('json_body_missing', { status: 400 })

  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel(tooLargeCode).catch(() => undefined)
        throw new Phase0Error(tooLargeCode, { status: 413 })
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  if (total === 0) throw new Phase0Error('json_body_missing', { status: 400 })

  const joined = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    joined.set(chunk, offset)
    offset += chunk.byteLength
  }
  return joined
}

function parseJsonObject(bytes: Uint8Array, invalidCode: string): Record<string, unknown> {
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes)
  } catch {
    throw new Phase0Error('json_encoding_invalid', { status: 400 })
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Phase0Error(invalidCode, { status: 400 })
  }
  if (!isRecord(parsed)) throw new Phase0Error(invalidCode, { status: 400 })
  return parsed
}

export async function readBoundedJson(
  request: Request,
  maxBytes = DEFAULT_REQUEST_LIMIT_BYTES,
): Promise<Record<string, unknown>> {
  const contentType = request.headers.get('content-type')?.toLowerCase() ?? ''
  const mediaType = contentType.split(';', 1)[0]?.trim()
  if (mediaType !== 'application/json') {
    throw new Phase0Error('content_type_invalid', { status: 415 })
  }
  const bytes = await readBoundedBytes(
    request.body,
    request.headers.get('content-length'),
    maxBytes,
    'request_body_too_large',
  )
  return parseJsonObject(bytes, 'request_json_invalid')
}

export async function readBoundedResponseJson(
  response: Response,
  maxBytes = DEFAULT_RESPONSE_LIMIT_BYTES,
): Promise<Record<string, unknown>> {
  const bytes = await readBoundedBytes(
    response.body,
    response.headers.get('content-length'),
    maxBytes,
    'upstream_body_too_large',
  )
  return parseJsonObject(bytes, 'upstream_json_invalid')
}

export function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers)
  headers.set('Cache-Control', 'no-store')
  headers.set('Content-Type', 'application/json; charset=utf-8')
  headers.set('X-Content-Type-Options', 'nosniff')
  return new Response(JSON.stringify(body), { ...init, headers })
}
