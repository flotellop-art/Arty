import { readWorkspaceStorageLayout, WorkspaceAdmissionError, WorkspaceRecoveryAvailable, type AdmissionFailure, type AdmissionGuard } from './control'
import type { MigrationHeader } from './migrationProtocol'
import type { WorkspaceStorageLayout } from './layout'

export type WorkspaceAdmissionPhase = 'idle' | 'checking' | 'ready' | AdmissionFailure

/** One terminal decision for the document, not a re-acquirable migration lease.
 * Account switches may use this fixed layout, never select a new generation. */
export function createWorkspaceAdmission(guard: AdmissionGuard, read = readWorkspaceStorageLayout) {
  let phase: WorkspaceAdmissionPhase = guard.signal.aborted ? 'lost' : 'idle', layout: WorkspaceStorageLayout | undefined
  let pending: Promise<WorkspaceAdmissionPhase> | undefined
  let recovery: Readonly<MigrationHeader> | undefined, claimed = false
  const listeners = new Set<() => void>()
  const lost = () => guard.signal.aborted || phase === 'lost'
  const publish = (next: WorkspaceAdmissionPhase) => {
    phase = next
    for (const listener of [...listeners]) { try { listener() } catch { /* independent observers */ } }
  }
  guard.signal.addEventListener('abort', () => { layout = undefined; publish('lost') }, { once: true })
  const assertReady = () => {
    guard.assertLock()
    if (phase !== 'ready' || !layout || guard.signal.aborted) throw new WorkspaceAdmissionError(phase === 'lost' ? 'lost' : 'unavailable')
  }
  return Object.freeze({
    /** Irreversible cold choice. An admission already checking cannot be stolen.
     * Even cancellation requires a new document before any private App import. */
    claimMaintenance(): AdmissionGuard {
      guard.assertLock()
      if (lost() || claimed || (phase !== 'idle' && phase !== 'recoverable')) throw new WorkspaceAdmissionError(lost() ? 'lost' : 'unavailable')
      claimed = true
      publish('maintenance')
      return Object.freeze({ signal: guard.signal, assertLock() {
        guard.assertLock()
        if (guard.signal.aborted || phase !== 'maintenance' || !claimed) throw new WorkspaceAdmissionError('lost')
      } })
    },
    getRecovery() { guard.assertLock(); return recovery },
    admit(): Promise<WorkspaceAdmissionPhase> {
      if (phase === 'lost') return Promise.resolve(phase)
      if (pending) return pending
      if (phase !== 'idle') return Promise.resolve(phase)
      guard.assertLock() // before state/read; a busy lock is NOT an admission failure
      if (guard.signal.aborted) { publish('lost'); return Promise.resolve(phase) }
      let settle!: (value: WorkspaceAdmissionPhase) => void
      pending = new Promise(done => { settle = done }) // before reentrant observers
      publish('checking')
      void (async () => {
        try {
          const result = await read(guard)
          guard.assertLock()
          if (lost()) throw new WorkspaceAdmissionError('lost')
          layout = result
          publish('ready')
        } catch (error) {
          layout = undefined
          if (error instanceof WorkspaceRecoveryAvailable && !lost()) recovery = error.header
          publish(lost() ? 'lost' : error instanceof WorkspaceAdmissionError ? error.code : 'unavailable')
        }
        settle(phase)
      })()
      return pending
    },
    assertReady,
    getLayout() { assertReady(); return layout! },
    getSnapshot: () => phase,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
  })
}
