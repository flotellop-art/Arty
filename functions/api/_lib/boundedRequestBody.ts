export const OPENAI_CHAT_BODY_MAX_BYTES = 24 * 1024 * 1024
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
  onLimitExceeded?: (error: RequestBodyTooLargeError) => void,
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
          const error = new RequestBodyTooLargeError(maxBytes)
          // Le sibling d'un tee doit être annulé AVANT la propagation de
          // l'erreur dans la chaîne pipeThrough, dont le cleanup peut attendre
          // l'annulation complète de cette branche.
          onLimitExceeded?.(error)
          // Ne pas attendre ici : sur une branche issue de `tee()`, cancel()
          // peut rester pending jusqu'à l'annulation du sibling. Propager le
          // 413 permet au proxy d'annuler aussitôt l'autre branche et de fermer
          // les deux côtés sans interblocage.
          void reader.cancel().catch(() => undefined)
          controller.error(error)
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

export interface ObservedReadableStream {
  stream: ReadableStream<Uint8Array>
  completed: Promise<void>
  cancel: (reason?: unknown) => Promise<void>
}

/**
 * Relaye un body sans le bufferiser et signale sa consommation réelle.
 * `fetch()` peut résoudre dès les headers de réponse : ce signal permet au
 * proxy de garder son permis mémoire jusqu'à EOF, erreur ou annulation du body.
 */
export function observeReadableStreamCompletion(
  source: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): ObservedReadableStream {
  const reader = source.getReader()
  let streamController: ReadableStreamDefaultController<Uint8Array> | undefined
  let resolveCompleted!: () => void
  let settled = false
  let cancellationStarted = false
  const completed = new Promise<void>((resolve) => { resolveCompleted = resolve })

  const finish = () => {
    if (settled) return
    settled = true
    signal?.removeEventListener('abort', onAbort)
    resolveCompleted()
  }
  const cancel = (reason?: unknown): Promise<void> => {
    if (settled) return Promise.resolve()
    if (!cancellationStarted) {
      cancellationStarted = true
      // Le runtime peut accuser réception de cancel tardivement, voire jamais.
      // La demande d'annulation suffit pour ne plus considérer ce body actif :
      // ne jamais laisser son acknowledgement retenir le permis de l'isolate.
      try { void reader.cancel(reason).catch(() => undefined) } catch { /* already released */ }
      try { streamController?.error(reason) } catch { /* stream already closed */ }
      finish()
    }
    return Promise.resolve()
  }
  const onAbort = () => { void cancel(signal?.reason) }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller
      if (signal?.aborted) void cancel(signal.reason)
      else signal?.addEventListener('abort', onAbort, { once: true })
    },
    async pull(controller) {
      try {
        const { done, value } = await reader.read()
        if (done) {
          controller.close()
          finish()
        } else {
          controller.enqueue(value)
        }
      } catch (error) {
        try { controller.error(error) } finally { finish() }
      }
    },
    cancel,
  })

  return { stream, completed, cancel }
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
