/** Bound an optional memory consumer without cancelling another shared read.
 * Mutation callers supply onTimeout to retire their own write capability.
 * Always observe the underlying promise, including after consumer cancellation.
 */
export function waitForLocalMemory<T>(work: Promise<T>, signal?: AbortSignal, timeoutMs = 5000, onTimeout: () => void = () => {}): Promise<T> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const cleanup = () => { if (timer !== undefined) clearTimeout(timer); signal?.removeEventListener('abort', abort) }
    const abort = () => { cleanup(); reject(new Error('local_memory_wait_cancelled')) }
    work.then(value => { cleanup(); resolve(value) }, error => { cleanup(); reject(error) })
    if (signal?.aborted) { abort(); return }
    signal?.addEventListener('abort', abort, { once: true })
    timer = setTimeout(() => { onTimeout(); abort() }, timeoutMs)
  })
}
