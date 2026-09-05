/** Cooperative exclusion for UPDATED clients sharing a storage origin/profile.
 * Not authentication, a restore journal, or protection from legacy/malicious
 * clients. No account IDs, storage, timers, broadcast or lock stealing here. */
export const DOCUMENT_WORKSPACE_LOCK = 'arty-workspace-document-v1'
export type DocumentLockPhase = 'idle' | 'acquiring' | 'held' | 'busy' | 'unsupported' | 'failed' | 'lost'
export interface WorkspaceLockSource {
  request(name: string, options: { mode: 'exclusive'; ifAvailable: true }, callback: (lock: unknown | null) => Promise<void>): Promise<unknown>
}
export class DocumentWorkspaceUnavailable extends Error {
  constructor() { super('workspace_document_unavailable'); this.name = 'DocumentWorkspaceUnavailable' }
}

/** One instance for the whole document, OUTSIDE React effects. The lock is
 * intentionally never released by application code, including logout, account
 * switch, key changes, backgrounding and React unmount/StrictMode. Destruction
 * of the document ends its writes and its lock. There is no in-document handover
 * which could revive an old asynchronous writer with a new lease.
 * A lost grant is terminal: only a NEW document may try again. */
export function createDocumentWorkspaceLock(getLocks: () => WorkspaceLockSource | undefined) {
  let phase: DocumentLockPhase = 'idle'
  let pending: Promise<DocumentLockPhase> | null = null
  const controller = new AbortController(), listeners = new Set<() => void>()
  const publish = (next: DocumentLockPhase) => {
    phase = next
    for (const listener of [...listeners]) { try { listener() } catch { /* independent observers */ } }
  }
  const lose = () => {
    phase = 'lost' // fail closed BEFORE synchronous abort/observer callbacks
    controller.abort()
    publish('lost')
  }
  const acquire = (): Promise<DocumentLockPhase> => {
    if (phase === 'held' || phase === 'lost') return Promise.resolve(phase)
    if (pending) return pending
    let resolve!: (value: DocumentLockPhase) => void
    const outcome = new Promise<DocumentLockPhase>(done => { resolve = done })
    pending = outcome // before notifying reentrant observers
    publish('acquiring')
    const settle = (next: DocumentLockPhase) => {
      publish(next) // reentrant Retry shares THIS result, never recurses
      resolve(next)
      pending = null
    }
    void (async () => {
      let granted = false
      try {
        const locks = getLocks()
        if (!locks) { settle('unsupported'); return }
        await locks.request(DOCUMENT_WORKSPACE_LOCK, { mode: 'exclusive', ifAvailable: true }, async lock => {
          if (!lock) return
          granted = true
          publish('held')
          resolve('held')
          // Never attach a pagehide/visibility/logout/React cleanup resolver.
          await new Promise<void>(() => {})
        })
        if (granted) lose() // an adapter MUST NOT finish while its callback lives
        else settle('busy')
      } catch {
        if (granted) lose()
        else settle('failed')
      }
    })()
    return outcome
  }
  return Object.freeze({
    acquire,
    getSnapshot: () => phase,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    signal: controller.signal,
    assertHeld() { if (phase !== 'held') throw new DocumentWorkspaceUnavailable() },
  })
}
