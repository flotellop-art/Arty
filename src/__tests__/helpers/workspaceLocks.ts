import type { WorkspaceLockSource } from '../../services/workspaceWriter/documentLock'

export function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

/** Minimal faithful exclusion, not a polyfill. Callbacks are ASYNCHRONOUS and
 * a physical lock lives until the callback's promise settles. */
export function sharedWorkspaceLocks() {
  const held = new Set<string>()
  const requested: { name: string; options: { mode: 'exclusive'; ifAvailable: true } }[] = []
  const source: WorkspaceLockSource = {
    async request(name, options, callback) {
      requested.push({ name, options })
      await Promise.resolve()
      if (held.has(name)) { await callback(null); return }
      held.add(name)
      try { await callback({ name, mode: 'exclusive' }) }
      finally { held.delete(name) }
    },
  }
  return { source, held, requested }
}
