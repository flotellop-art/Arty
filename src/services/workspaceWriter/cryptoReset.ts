import { readResetControl, advanceResetControl } from './resetStore'
import { type ResetBundle, type ResetRecord, validResetBundle } from './resetProtocol'
import { workspaceDataKey, type IsolatedWorkspaceLayout } from './layout'
import { erasureLocalSnapshot, equalErasure, projectErasurePlan } from './erasureInventory'
import { localPairs, RAW_STORES, scanRawStore, observeRawOwner } from './migrationInventory'
import { openExistingDB } from '../readOnlyExistingDB'
import { FILE_SHAPE, PROJECT_SHAPE, MIGRATION_JOURNAL_SHAPE, assertDatabaseShape, type StoreShape } from './schema'
import { migrationDatabaseName } from './migrationProtocol'
import { assertDocumentWorkspace, documentWorkspaceSignal, getDocumentStorageLayout } from './runtime'
import { getActiveUserId, getActiveSessionEpoch, getSessionProjectFence, PROJECT_ERASURE_FENCE_KEY } from '../userSession'
import { captureOwnerErasureGuard } from '../projects/localErasureGuard'
import { LocalCryptoRecoveryRequired } from './cryptoProvisioning'

const refuse = (): never => { throw new LocalCryptoRecoveryRequired() }
/** A private login-only protocol, not an allowReset boolean on initCrypto.
 * The durable bundle is the sole allocation. A consumed tombstone remains even
 * if all three materialized markers later disappear. No remote receipt/secret
 * is carried into this fresh-key authority. */
export async function readCryptoReset(layout: IsolatedWorkspaceLayout, owner: string | null, caller: () => void, explicitLogin: boolean) {
  const epoch = getActiveSessionEpoch(), fence = getSessionProjectFence(), erasure = captureOwnerErasureGuard(owner)
  const assert = () => {
    assertDocumentWorkspace(); caller(); erasure()
    if (layout !== getDocumentStorageLayout() || owner !== getActiveUserId() || epoch !== getActiveSessionEpoch() ||
      fence === null || fence !== (localStorage.getItem(PROJECT_ERASURE_FENCE_KEY) ?? 'initial')) refuse()
  }
  assert()
  let control = await readResetControl(assert)
  let record = control?.resets.find(r => r.owner === owner)
  if (!record) return null
  const key = (slot: 'crypto-salt' | 'crypto-check' | 'crypto-version') => workspaceDataKey(layout, owner, slot)
  if (record.phase === 'consumed') {
    if (!validResetBundle({ salt: localStorage.getItem(key('crypto-salt')), check: localStorage.getItem(key('crypto-check')), version: localStorage.getItem(key('crypto-version')) })) refuse()
    return null
  }
  if (!explicitLogin || !owner || !control) return refuse()
  if (control.revision > Number.MAX_SAFE_INTEGER - (record.phase === 'available' ? 2 : 1)) return refuse()
  const resetOwner = owner
  const current = async () => {
    assert()
    if (!equalErasure(await readResetControl(assert), control)) refuse()
    assert()
  }
  const assertMarkers = (bundle?: ResetBundle, requireAll = false) => {
    assert()
    for (const [slot, expected] of [['crypto-salt', bundle?.salt], ['crypto-check', bundle?.check], ['crypto-version', bundle?.version]] as const) {
      const raw = localStorage.getItem(key(slot))
      if (raw !== null ? raw !== expected : requireAll) refuse()
    }
  }
  const empty = async () => {
    await current()
    const bundle = record!.phase === 'provisioning' ? record!.bundle : undefined
    assertMarkers(bundle)
    const local = await erasureLocalSnapshot(layout.generation, resetOwner, 6)
    const allowed = new Set(bundle ? [key('crypto-salt'), key('crypto-check'), key('crypto-version')] : [])
    if (local.changes.some(([k]) => !allowed.has(k))) refuse()
    await inspectEmptyCopies(layout, resetOwner, fence!, assert)
    await current()
    assertMarkers(bundle)
    // These checks protect cooperative updated clients, not arbitrary rollback
    // of the whole local database by an attacker or a broken old application.
    const final = await erasureLocalSnapshot(layout.generation, resetOwner, 6)
    if (final.changes.some(([k]) => !allowed.has(k)) || !equalErasure(final.pairs, localPairs())) refuse()
    assertMarkers(bundle)
    return final.pairs
  }
  const transition = async (nextRecord: ResetRecord, pairs: [string, string][]) => {
    assert()
    const attestLocal = () => { assert(); if (!equalErasure(pairs, localPairs())) refuse() }
    const next = await advanceResetControl(control!, nextRecord, assert, attestLocal)
    control = next; record = nextRecord
    await current(); attestLocal()
  }
  await empty()
  return Object.freeze({
    get bundle(): ResetBundle | undefined { return record!.phase === 'provisioning' ? { ...record!.bundle } : undefined },
    async allocate(bundle: ResetBundle) {
      const candidate = structuredClone(bundle)
      if (record!.phase !== 'available' || !validResetBundle(candidate)) refuse()
      const pairs = await empty()
      await transition({ ...record!, phase: 'provisioning', bundle: candidate }, pairs)
    },
    async commit() {
      const allocated = record!
      if (allocated.phase !== 'provisioning') return refuse()
      await empty()
      const bundle = allocated.bundle
      // CAS allocated the whole bundle BEFORE the first localStorage write.
      // No rollback removes these markers: retry uses the same allocation.
      for (const [slot, value] of [['crypto-salt', bundle.salt], ['crypto-check', bundle.check], ['crypto-version', bundle.version]] as const) {
        assertMarkers(bundle)
        if (localStorage.getItem(key(slot)) === null) localStorage.setItem(key(slot), value)
      }
      assertMarkers(bundle, true)
      await (await import('../native/coldMailErasure')).reopenColdMailScope(resetOwner, allocated.resetId)
      const pairs = await empty(); assertMarkers(bundle, true)
      await transition({ owner: resetOwner, operationId: allocated.operationId, resetId: allocated.resetId, phase: 'consumed' }, pairs)
      assertMarkers(bundle, true)
    },
  })
}

async function inspectEmptyCopies(layout: IsolatedWorkspaceLayout, owner: string, fence: string, assert: () => void) {
  const retired = new AbortController(), stop = () => retired.abort()
  const timer = setTimeout(stop, 8_000)
  documentWorkspaceSignal.addEventListener('abort', stop, { once: true })
  const guard = () => { assert(); if (retired.signal.aborted || documentWorkspaceSignal.aborted) refuse() }
  const inspect = async (name: string, version: number, shape: readonly StoreShape[], active = false, journal = false) => {
    const db = await openExistingDB(name, version, guard, retired.signal)
    try {
      guard(); if (!db || db.version !== version) return refuse()
      const tx = db.transaction(shape.map(s => s[0]), 'readonly')
      const abort = () => { try { tx.abort() } catch { /* settled */ } }
      retired.signal.addEventListener('abort', abort, { once: true }); void tx.done.catch(() => {})
      try {
        assertDatabaseShape(db, shape, tx)
        if (journal) {
          const store = tx.objectStore('journal'), plan = await store.get('plan')
          if (!equalErasure(await store.getAllKeys(), ['identity', 'plan']) || !equalErasure(await store.get('identity'), { format: 'arty-workspace-migration', version: 1, generation: layout.generation }) ||
            !equalErasure(plan, projectErasurePlan(plan, layout.generation, owner))) refuse()
        }
        if (active && db.objectStoreNames.contains('meta')) {
          const cursor = await tx.objectStore('meta').openCursor('erasure-fence')
          if (!cursor || cursor.value !== fence) refuse()
        }
        await tx.done; guard()
      } catch (e) { abort(); await tx.done.catch(() => {}); throw e }
      finally { retired.signal.removeEventListener('abort', abort) }
      for (const store of RAW_STORES.filter(s => db.objectStoreNames.contains(s))) {
        await scanRawStore(db, store, guard, retired.signal, async rows => {
          for (const row of rows) {
            if (store === 'meta') {
              if (row.key !== 'erasure-fence' || typeof row.value !== 'string' || !row.value.length) refuse()
            } else {
              const owners = new Set<string | null>(); observeRawOwner(store, row, owners, 'initial')
              if (owners.size !== 1 || owners.has(owner)) refuse()
            }
            guard()
          }
        })
      }
    } finally { db?.close() }
  }
  try {
    await inspect('arty-files', 2, FILE_SHAPE); await inspect('arty-projects', 2, PROJECT_SHAPE)
    await inspect(layout.files.name, 1, FILE_SHAPE, true); await inspect(layout.projects.name, 1, PROJECT_SHAPE, true)
    await inspect(migrationDatabaseName(layout.generation), 1, MIGRATION_JOURNAL_SHAPE, false, true)
  } finally { clearTimeout(timer); documentWorkspaceSignal.removeEventListener('abort', stop); retired.abort() }
}
