import { openExistingDB } from '../readOnlyExistingDB'
import type { IDBPDatabase } from 'idb'
import { assertDocumentWorkspace, documentWorkspaceSignal } from './runtime'

/** A declared generation is never a bootstrap target. A deleted/blocked store
 * fails, including when a cached connection was closed by versionchange. */
export async function openDeclaredDatabase(database: { name: string; version: number }, onClosed: () => void) {
  const lifetime = new AbortController()
  const stop = () => lifetime.abort()
  const timer = setTimeout(stop, 8_000)
  let opened: IDBPDatabase | null = null
  documentWorkspaceSignal.addEventListener('abort', stop, { once: true })
  try {
    assertDocumentWorkspace()
    opened = await openExistingDB(database.name, database.version, assertDocumentWorkspace, lifetime.signal, onClosed)
    assertDocumentWorkspace()
    if (!opened) throw new Error('workspace_declared_database_missing')
    return opened
  } catch (error) {
    opened?.close()
    throw error
  } finally {
    clearTimeout(timer)
    documentWorkspaceSignal.removeEventListener('abort', stop)
    lifetime.abort()
  }
}
