import type { IDBPTransaction } from 'idb'
import { openExistingDB } from '../readOnlyExistingDB'
import { parseAccountErasureRecord, type AccountErasureRecord } from '../accountErasureJournal'
import { assertDocumentWorkspace, getDocumentStorageLayout, guardDocumentTransaction } from '../workspaceWriter/runtime'
import { WORKSPACE_CONTROL_DB, WORKSPACE_CONTROL_KEY, validateWorkspaceControl } from '../workspaceWriter/control'
import { validErasureFence } from '../workspaceWriter/erasureProtocol'
import { LEGACY_WORKSPACE_LAYOUT } from '../workspaceWriter/layout'

const FENCE_KEY = 'arty-project-erasure-fence'
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const refuse = (): never => { throw new Error('erasure_cleanup_context_changed') }

/** Dedicated HOT capability: no creator connection, nonce takeover, crypto or
 * permissive historical confirmation. The caller supplies only the captured
 * owner/guard, never a receipt or server DTO to acknowledge. */
export async function captureProjectErasureCleanup(owner: string, guard: () => void, signal: AbortSignal) {
  const layout = getDocumentStorageLayout(), localFence = localStorage.getItem(FENCE_KEY)
  if (localFence !== null && !validErasureFence(localFence)) return refuse()
  const assertCurrent = () => {
    assertDocumentWorkspace(); guard()
    if (signal.aborted || !equal(layout, getDocumentStorageLayout()) || localStorage.getItem(FENCE_KEY) !== localFence) refuse()
  }
  assertCurrent()
  const root = async () => {
    const db = await openExistingDB(WORKSPACE_CONTROL_DB, 1, assertCurrent, signal)
    try {
      if (!db) { if (!equal(layout, LEGACY_WORKSPACE_LAYOUT)) return refuse(); return null }
      const tx = db.transaction('meta'), count = await tx.store.count(), value: unknown = await tx.store.get(WORKSPACE_CONTROL_KEY)
      await tx.done; assertCurrent()
      if (count !== 1 || !equal(validateWorkspaceControl(value), layout)) return refuse()
      return value
    } finally { db?.close() }
  }
  const transaction = async <T, M extends 'readonly' | 'readwrite'>(mode: M, work: (tx: IDBPTransaction<unknown, ['meta'], M>) => Promise<T>) => {
    assertCurrent()
    const db = await openExistingDB(layout.projects.name, layout.projects.version, assertCurrent, signal)
    if (!db) return refuse()
    const tx = guardDocumentTransaction(db.transaction('meta', mode)), abort = () => { try { tx.abort() } catch { /* settled */ } }
    signal.addEventListener('abort', abort, { once: true }); void tx.done.catch(() => {})
    try { assertCurrent(); const result = await work(tx); assertCurrent(); await tx.done; assertCurrent(); return result }
    catch (error) { abort(); await tx.done.catch(() => {}); throw error }
    finally { signal.removeEventListener('abort', abort); db.close() }
  }
  const metadata = async (tx: IDBPTransaction<unknown, ['meta'], 'readonly' | 'readwrite'>) => {
    const record = parseAccountErasureRecord(await tx.store.get(['erasing', owner]))
    const cursor = await tx.store.openCursor('erasure-fence')
    if (!record || record.owner !== owner || record.serverConfirmed || record.localOnly || record.remote?.state !== 'uncertain' || record.pending.length ||
      cursor && !validErasureFence(cursor.value)) return refuse()
    return { record, activeFence: cursor ? cursor.value as string : null }
  }
  const initialRoot = await root(), initial = await transaction('readonly', metadata)
  const attest = async () => {
    if (!equal(await root(), initialRoot) || !equal(await transaction('readonly', metadata), initial) || !equal(await root(), initialRoot)) refuse()
    assertCurrent()
  }
  await attest()
  const record = structuredClone(initial.record), intent = Object.freeze({ ...record.remote! })
  return Object.freeze({ operationId: record.operationId, intent, assertCurrent, attest,
    async confirm(): Promise<AccountErasureRecord> {
      await attest()
      const confirmed: AccountErasureRecord = { owner, operationId: record.operationId, nonce: record.nonce, serverConfirmed: true, pending: [] }
      await transaction('readwrite', async tx => {
        if (!equal(await metadata(tx), initial)) refuse()
        assertCurrent(); await tx.store.put(confirmed, ['erasing', owner])
      })
      if (!equal(await root(), initialRoot)) refuse()
      return confirmed
    },
  })
}
