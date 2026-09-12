/** A common deadline for connection/fallback, then a per-read inactivity limit.
 * Accepting headers must not leave a wall-clock abort attached to an active SSE body. */
export function createStreamBudget(headerMs: number, idleMs: number, parent?: AbortSignal) {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined = setTimeout(
    () => controller.abort(new DOMException('Upstream headers timed out', 'TimeoutError')), headerMs)
  let transferred = false
  const abort = () => controller.abort(parent?.reason)
  if (parent?.aborted) abort()
  else parent?.addEventListener('abort', abort, { once: true })
  const clearTimer = () => { if (timer !== undefined) clearTimeout(timer); timer = undefined }
  const cleanup = () => { clearTimer(); parent?.removeEventListener('abort', abort) }
  return {
    signal: controller.signal,
    accept(response: Response): Response {
      clearTimer()
      if (!response.body) { cleanup(); return response }
      transferred = true
      const reader = response.body.getReader()
      let ended = false
      let cancelled = false
      const finish = () => { if (!ended) { ended = true; cleanup(); reader.releaseLock() } }
      const body = new ReadableStream<Uint8Array>({
        async pull(output) {
          let onAbort: (() => void) | undefined
          try {
            controller.signal.throwIfAborted()
            // Promise.race also bounds streams whose implementation ignores abort.
            const expired = new Promise<never>((_, reject) => {
              onAbort = () => reject(controller.signal.reason)
              controller.signal.addEventListener('abort', onAbort, { once: true })
            })
            timer = setTimeout(() => {
              const error = new DOMException('Upstream stream stalled', 'TimeoutError')
              controller.abort(error)
            }, idleMs)
            const part = await Promise.race([reader.read(), expired])
            clearTimer()
            if (cancelled) return
            if (part.done) { finish(); output.close() }
            else output.enqueue(part.value)
          } catch (error) {
            if (cancelled) return
            // Cancel before releasing the lock; don't wait for a broken upstream.
            void reader.cancel(error).catch(() => {})
            finish()
            output.error(error)
          } finally {
            if (onAbort) controller.signal.removeEventListener('abort', onAbort)
          }
        },
        async cancel(reason) {
          cancelled = true
          controller.abort(reason)
          try { await reader.cancel(reason) } finally { finish() }
        },
      })
      return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers })
    },
    dispose() { if (!transferred) cleanup() },
  }
}
