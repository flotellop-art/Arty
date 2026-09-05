import { createDocumentWorkspaceLock } from './documentLock'

/** No private application module is imported until this singleton is held. */
export const documentWorkspace = createDocumentWorkspaceLock(() => navigator.locks)
export const assertDocumentWorkspace = () => documentWorkspace.assertHeld()
export const documentWorkspaceSignal = documentWorkspace.signal

/** Defence for an exceptional loss (normal application code never releases).
 * Already committed transactions cannot be undone by this guard. */
export function guardDocumentTransaction<T extends { abort(): void; done: Promise<unknown> }>(tx: T): T {
  const abort = () => { try { tx.abort() } catch { /* already settled */ } }
  try { assertDocumentWorkspace() } catch (error) { abort(); void tx.done.catch(() => {}); throw error }
  documentWorkspaceSignal.addEventListener('abort', abort, { once: true })
  void tx.done.then(
    () => documentWorkspaceSignal.removeEventListener('abort', abort),
    () => documentWorkspaceSignal.removeEventListener('abort', abort),
  )
  return tx
}
