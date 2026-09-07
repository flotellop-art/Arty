import type { IDBPDatabase } from 'idb'
import { decrypt } from '../crypto'
import { captureLocalReadScope } from '../projects/store'
import { captureHistoryForSyncCoverage } from '../storage'
import { hasActiveConversationWork } from '../conversationWork'
import { documentWorkspaceSignal, getDocumentStorageLayout } from '../workspaceWriter/runtime'
import { WORKSPACE_CONTROL_DB, WORKSPACE_CONTROL_KEY } from '../workspaceWriter/control'
import { CONTROL_SHAPE, FILE_SHAPE, PROJECT_SHAPE } from '../workspaceWriter/schema'
import { parseRestoreReady } from '../workspaceWriter/restoreProtocol'
import { controlProjectsVersion } from '../workspaceWriter/layout'
import { openRestoreDatabases, restoreTransaction as transact, restoreEqual as equal, restoreFail as fail,
  restoreLocalSnapshot, assertRestoreLocal } from '../workspaceWriter/restoreJournal'
import { rawEncoding } from '../workspaceWriter/migrationInventory'
import { canonicalSyncJSON } from './captureContent'
import type { SyncDispatchGuard } from './clientTransport'

// Bounds of this in-memory witness, NOT a promise of mobile capacity. Refuse a
// large source before decryption/encoding; never truncate it into an equal one.
const MAX_LOCAL_CHARS = 16 * 1024 * 1024, MAX_ROW_CHARS = 24 * 1024 * 1024, MAX_ROWS = 768
type Store = 'files' | 'projects' | 'documents'
type Presence = { present: false } | { present: true; value: unknown }
type Pin = { store: Store; key: IDBValidKey; before: Presence }
const canonicalLimits = { nodes: 1_000_000, chars: 32 * 1024 * 1024 }

/** Internal, actor-bound read witness. Decoders MUST consume the row returned
 * here, not re-read its address through a generic library. This is not a write
 * lock or a cross-database atomic snapshot. A publisher still needs its own
 * BEFORE/CAS journal and recovery protocol. No database or setting is created. */
export async function captureMaterializedRows(authority: SyncDispatchGuard) {
  const lifetime = new AbortController(), signals = [documentWorkspaceSignal, authority.signal]
  let disposed = false, history: ReturnType<typeof captureHistoryForSyncCoverage> | undefined
  let local: ReturnType<typeof restoreLocalSnapshot> | undefined
  let base: unknown, initialFence: Presence | undefined, rowChars = 0
  const pins = new Map<string, Pin>()
  const dispose = () => {
    disposed = true; lifetime.abort(); history = undefined; local = undefined; base = undefined; initialFence = undefined; pins.clear()
    for (const signal of signals) signal?.removeEventListener('abort', dispose)
  }
  for (const signal of signals) signal?.addEventListener('abort', dispose, { once: true })
  if (signals.some(s => s?.aborted)) dispose()
  try {
    const scope = captureLocalReadScope(lifetime.signal), layout = getDocumentStorageLayout()
    if (layout.kind !== 'isolated-v1' || layout.projects.version !== 2 || scope.owner === 'anon') return fail('unavailable')
    const assertCurrent = () => {
      try {
        if (disposed) return fail('cancelled')
        authority.assertCurrent(); scope.assertCurrent(); history?.assertUnchanged()
        if (hasActiveConversationWork()) return fail('busy')
      } catch (error) { dispose(); throw error }
    }
    const guard = { signal: lifetime.signal, assertCurrent }
    const boundLocal = () => {
      assertCurrent(); let chars = 0
      if (localStorage.length > 10_000) return fail('limit')
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (key === null) return fail()
        chars += key.length + (localStorage.getItem(key)?.length ?? 0)
        if (chars > MAX_LOCAL_CHARS) return fail('limit')
      }
    }
    const assertLocal = () => {
      boundLocal(); if (!local || !history) return fail('cancelled')
      history.assertSnapshot(); assertRestoreLocal(local, guard); assertCurrent()
    }
    const open = () => openRestoreDatabases([
      { descriptor: { name: WORKSPACE_CONTROL_DB, version: 1 }, shape: CONTROL_SHAPE },
      { descriptor: layout.files, shape: FILE_SHAPE }, { descriptor: layout.projects, shape: PROJECT_SHAPE },
    ], guard)
    const root = (db: IDBPDatabase) => transact(db, ['meta'], 'readonly', guard, async tx => {
      const meta = tx.objectStore('meta')
      if (await meta.count() !== 1 || await meta.getKey(WORKSPACE_CONTROL_KEY) === undefined) return fail()
      const value: unknown = await meta.get(WORKSPACE_CONTROL_KEY), parsed = parseRestoreReady(value)
      if (!parsed || parsed.generation !== layout.generation || controlProjectsVersion(parsed) !== 2 || !equal(parsed.requiredOwners, layout.requiredOwners)) return fail()
      return value
    })
    const fence = async (db: IDBPDatabase) => transact(db, ['meta'], 'readonly', guard, async tx => {
      const meta = tx.objectStore('meta')
      const [key, value, erasing] = await Promise.all([meta.getKey('erasure-fence'), meta.get('erasure-fence'), meta.getKey(['erasing', scope.owner])])
      if (erasing !== undefined || (key === undefined ? 'initial' : value) !== scope.fence) return fail('cancelled')
      const witness: Presence = key === undefined ? { present: false } : { present: true, value }
      if (initialFence === undefined) initialFence = witness
      else if (!equal(witness, initialFence)) return fail()
    })
    const read = async (db: IDBPDatabase, store: Store, key: IDBValidKey): Promise<Presence> => transact(db, [store], 'readonly', guard, async tx => {
      const s = tx.objectStore(store), found = await s.getKey(key)
      return found === undefined ? { present: false } : { present: true, value: await s.get(key) }
    })
    const boundRow = (row: Presence) => {
      if (row.present && row.value !== undefined) canonicalSyncJSON(row.value, { nodes: 100_000, chars: MAX_ROW_CHARS })
    }
    assertCurrent()
    const dbs = await open()
    try {
      base = await root(dbs[0]!); await fence(dbs[2]!)
      await authority.validateReadOnly(); assertCurrent()
      // Admission precedes reading or decrypting any private history content.
      boundLocal(); local = restoreLocalSnapshot({ generation: layout.generation, owner: scope.owner })
      if (local.history[2] !== null || local.history[3] !== null) return fail('unavailable')
      history = captureHistoryForSyncCoverage()
      const text = local.history[0] ?? (local.history[1] === null ? '[]' : await decrypt(local.history[1]!))
      assertCurrent()
      if (canonicalSyncJSON(JSON.parse(text), canonicalLimits) !== history.json) throw new Error('history-not-durable')
      assertLocal()
    } finally { dbs.forEach(db => db.close()) }
    const validateFresh = async () => {
      try {
        assertLocal(); await authority.validateReadOnly(); assertCurrent()
        const dbs = await open()
        try {
          if (!equal(await root(dbs[0]!), base)) return fail()
          await fence(dbs[2]!)
          for (const pin of pins.values()) {
            const now = await read(dbs[pin.store === 'files' ? 1 : 2]!, pin.store, pin.key)
            boundRow(now)
            if (!equal(now, pin.before)) return fail()
          }
          await authority.validateReadOnly(); await fence(dbs[2]!)
          if (!equal(await root(dbs[0]!), base)) return fail()
          // Last-await canary: memory, all four slots, grant/key/owner/document.
          assertLocal()
        } finally { dbs.forEach(db => db.close()) }
      } catch (error) { dispose(); throw error }
    }
    return Object.freeze({ owner: scope.owner, signal: lifetime.signal, assertCurrent, validateFresh, dispose,
      conversations(localId: string) { assertCurrent(); if (!history) return fail('cancelled'); return structuredClone(history.snapshot.filter(c => c.id === localId)) },
      async read(store: Store, key: IDBValidKey): Promise<Presence> {
        try {
          assertCurrent()
          const address = rawEncoding([store, key]), pinned = pins.get(address)
          if (pinned) return structuredClone(pinned.before)
          if (pins.size >= MAX_ROWS) return fail('limit')
          const opened = await open()
          try {
            if (!equal(await root(opened[0]!), base)) return fail()
            await fence(opened[2]!); await authority.validateReadOnly(); assertCurrent()
            const before = await read(opened[store === 'files' ? 1 : 2]!, store, key)
            // Descriptor-safe, bounded preflight before raw equality encoding.
            // Undefined is a valid IDB value, never an absent-key fallback.
            boundRow(before)
            rowChars += rawEncoding(before).length
            if (rowChars > MAX_ROW_CHARS) return fail('limit')
            pins.set(address, { store, key: structuredClone(key), before }); assertCurrent()
            return structuredClone(before)
          } finally { opened.forEach(db => db.close()) }
        } catch (error) { dispose(); throw error }
      },
    })
  } catch (error) { dispose(); throw error }
}
