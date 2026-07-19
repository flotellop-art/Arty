export const OPENAI_CHAT_BODY_MAX_BYTES = 40 * 1024 * 1024
export const OPENAI_TEXT_BODY_MAX_BYTES = 10 * 1024 * 1024

export class RequestBodyTooLargeError extends Error {
  constructor(readonly maxBytes: number) {
    super('request_body_too_large')
    this.name = 'RequestBodyTooLargeError'
  }
}

/**
 * Lit un body texte en comptant les octets réellement reçus. Content-Length
 * permet un refus précoce, mais n'est jamais considéré comme fiable : un flux
 * absent, sous-déclaré ou décompressé reste borné pendant la lecture.
 */
export function assertRequestContentLengthWithinLimit(request: Request, maxBytes: number): void {
  const rawLength = request.headers.get('content-length')
  if (rawLength && /^\d+$/.test(rawLength)) {
    const announced = Number(rawLength)
    if (!Number.isFinite(announced) || announced > maxBytes) {
      throw new RequestBodyTooLargeError(maxBytes)
    }
  }
}

export function limitReadableStream(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
  onBytes?: (received: number) => void,
): ReadableStream<Uint8Array> {
  const reader = stream.getReader()
  let received = 0
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read()
        if (done) {
          controller.close()
          return
        }
        received += value.byteLength
        if (received > maxBytes) {
          await reader.cancel().catch(() => undefined)
          controller.error(new RequestBodyTooLargeError(maxBytes))
          return
        }
        onBytes?.(received)
        controller.enqueue(value)
      } catch (err) {
        controller.error(err)
      }
    },
    cancel(reason) {
      return reader.cancel(reason)
    },
  })
}

export async function readRequestTextWithLimit(request: Request, maxBytes: number): Promise<string> {
  assertRequestContentLengthWithinLimit(request, maxBytes)

  if (!request.body) return ''

  // Le décodage natif évite de conserver un tableau JS de chunks texte puis
  // une seconde copie lors d'un join à la borne.
  return new Response(limitReadableStream(request.body, maxBytes)).text()
}

export function requestBodyTooLargeResponse(maxBytes: number): Response {
  return Response.json(
    { error: 'payload_too_large', max_bytes: maxBytes },
    { status: 413 },
  )
}
