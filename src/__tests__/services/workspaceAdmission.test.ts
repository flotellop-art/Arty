import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { openDB } from 'idb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createWorkspaceAdmission } from '../../services/workspaceWriter/admission'
import { readWorkspaceStorageLayout, validateWorkspaceControl, WORKSPACE_CONTROL_DB, WORKSPACE_CONTROL_KEY, WorkspaceAdmissionError } from '../../services/workspaceWriter/control'
import { LEGACY_WORKSPACE_LAYOUT } from '../../services/workspaceWriter/layout'
import { deferred } from '../helpers/workspaceLocks'

const control = () => ({ format: 'arty-workspace-control', version: 1, layout: 'legacy-v1', revision: 1, state: 'ready' })
const guard = (controller = new AbortController()) => ({ assertLock: vi.fn(), signal: controller.signal })
async function seed(value: unknown = control(), version = 1, key = WORKSPACE_CONTROL_KEY) {
  const db = await openDB(WORKSPACE_CONTROL_DB, version, { upgrade(db) { db.createObjectStore('meta') } })
  if (value !== undefined) await db.put('meta', value, key)
  return db
}
beforeEach(() => { vi.restoreAllMocks(); globalThis.indexedDB = new IDBFactory(); localStorage.clear() })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('cold storage admission: real readonly IndexedDB, no private module', () => {
  it('proves absence without leaving any database or reading/writing private localStorage/network', async () => {
    const local = vi.spyOn(Storage.prototype, 'getItem'), write = vi.spyOn(Storage.prototype, 'setItem'), fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const result = await readWorkspaceStorageLayout(guard())
    expect(result).toBe(LEGACY_WORKSPACE_LAYOUT)
    expect(Object.isFrozen(result.files)).toBe(true)
    expect(await indexedDB.databases()).toEqual([])
    expect(local).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled()
  })

  it('accepts only the explicit supported legacy layout and leaves the control record untouched', async () => {
    const db = await seed(), readGuard = guard()
    expect(await readWorkspaceStorageLayout(readGuard)).toBe(LEGACY_WORKSPACE_LAYOUT)
    expect(await db.get('meta', WORKSPACE_CONTROL_KEY)).toEqual(control())
    expect(await indexedDB.databases()).toEqual([{ name: WORKSPACE_CONTROL_DB, version: 1 }])
    expect(readGuard.assertLock.mock.calls.length).toBeGreaterThan(5)
    db.close()
  })

  it.each([null, false, 0, '', {}, { ...control(), state: 'unknown' }, { ...control(), revision: 0 }, { ...control(), extra: true }])('refuses malformed/falsy control %j without repair', async value => {
    const db = await seed(value)
    await expect(readWorkspaceStorageLayout(guard())).rejects.toMatchObject({ code: 'corrupt' })
    expect(await db.get('meta', WORKSPACE_CONTROL_KEY)).toEqual(value); db.close()
  })

  it.each(['empty', 'wrong-key', 'extra-key', 'wrong-store'] as const)('refuses an existing %s database, not a new installation', async kind => {
    if (kind === 'wrong-store') {
      const db = await openDB(WORKSPACE_CONTROL_DB, 1, { upgrade(db) { db.createObjectStore('unrecognized') } }); db.close()
    } else {
      const db = await seed(control(), 1, kind === 'wrong-key' ? 'foreign' : WORKSPACE_CONTROL_KEY)
      if (kind === 'empty') await db.delete('meta', WORKSPACE_CONTROL_KEY)
      if (kind === 'extra-key') await db.put('meta', 'extra', 'extra')
      db.close()
    }
    await expect(readWorkspaceStorageLayout(guard())).rejects.toMatchObject({ code: 'corrupt' })
    expect((await indexedDB.databases()).length).toBe(1)
  })

  it.each(['database', 'protocol', 'layout', 'maintenance'] as const)('refuses %s state without treating it as ready', async kind => {
    const db = await seed({ ...control(), ...(kind === 'protocol' ? { version: 2 } : kind === 'layout' ? { layout: 'isolated-v1' } : kind === 'maintenance' ? { state: 'maintenance' } : {}) }, kind === 'database' ? 2 : 1)
    db.close()
    await expect(readWorkspaceStorageLayout(guard())).rejects.toMatchObject({ code: kind === 'maintenance' ? 'maintenance' : 'incompatible' })
  })

  it.each(['arty-files', 'arty-projects'])('refuses future %s version even if control was removed', async name => {
    const db = await openDB(name, 2); db.close()
    await expect(readWorkspaceStorageLayout(guard())).rejects.toMatchObject({ code: 'incompatible' })
    expect(await indexedDB.databases()).toEqual([{ name, version: 2 }])
  })

  it.each(['arty-files', 'arty-projects'])('refuses a malformed legacy %s schema instead of bootstrapping it', async name => {
    const db = await openDB(name, 1); db.close()
    await expect(readWorkspaceStorageLayout(guard())).rejects.toMatchObject({ code: 'corrupt' })
    expect(await indexedDB.databases()).toEqual([{ name, version: 1 }])
  })

  it.each(['absent-api', 'denied'])('fails closed for %s, with no localStorage-based pristine shortcut', async mode => {
    if (mode === 'absent-api') vi.stubGlobal('indexedDB', undefined)
    else vi.spyOn(indexedDB, 'open').mockImplementation(() => { throw new DOMException('blocked storage', 'SecurityError') })
    await expect(readWorkspaceStorageLayout(guard())).rejects.toMatchObject({ code: 'unavailable' })
  })

  it('rejects control accessors and prototypes without invoking them', () => {
    const get = vi.fn(() => 'ready'), value = control()
    Object.defineProperty(value, 'state', { enumerable: true, get })
    expect(() => validateWorkspaceControl(value)).toThrow('workspace_admission_corrupt')
    expect(() => validateWorkspaceControl(Object.assign(Object.create({ inherited: true }), control()))).toThrow()
    expect(get).not.toHaveBeenCalled()
  })

  it('times out a genuinely queued readonly transaction; releasing the writer never grants a late layout', async () => {
    const db = await seed(), tx = db.transaction('meta', 'readwrite'), writerStarted = deferred()
    let keepAlive = true, reads = 0
    const pump = () => { void tx.store.get(WORKSPACE_CONTROL_KEY).then(() => { writerStarted.resolve(); if (keepAlive) pump() }) }
    pump(); await writerStarted.promise
    const realTransaction = db.transaction.bind(db)
    // Observe all connections, not only the seeding connection.
    const transaction = vi.spyOn(IDBDatabase.prototype, 'transaction')
    const realTimeout = setTimeout
    let expire!: () => void
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: TimerHandler, ms?: number, ...args: unknown[]) => {
      if (ms === 12_345) expire = fn as () => void
      return realTimeout(fn, ms, ...args)
    }) as typeof setTimeout)
    const checking = readWorkspaceStorageLayout(guard(), 12_345).then(value => { reads++; return value }, error => error)
    await vi.waitFor(() => expect(transaction.mock.calls.some(call => call[1] === 'readonly')).toBe(true))
    expire()
    expect(await checking).toMatchObject({ code: 'unavailable' })
    keepAlive = false; await tx.done
    expect(await realTransaction('meta').store.get(WORKSPACE_CONTROL_KEY)).toEqual(control())
    expect(reads).toBe(0); db.close()
  })

  it('retires an open queued behind a real blocked upgrade and closes/rejects its late result', async () => {
    const held = await seed(), blocked = deferred(), controller = new AbortController()
    const upgrade = openDB(WORKSPACE_CONTROL_DB, 2, { blocked() { blocked.resolve() } })
    await blocked.promise
    const checking = readWorkspaceStorageLayout(guard(controller)).catch(error => error)
    // This call waits behind the queued upgrade, not necessarily onblocked.
    controller.abort()
    expect(await checking).toMatchObject({ code: 'lost' })
    held.close(); const newer = await upgrade; newer.close()
    // No late connection may hold the next version hostage.
    const next = await openDB(WORKSPACE_CONTROL_DB, 3); next.close()
    expect(await indexedDB.databases()).toEqual([{ name: WORKSPACE_CONTROL_DB, version: 3 }])
  })
})

describe('one immutable admission per document', () => {
  it('coalesces StrictMode/reentrant calls and never rereads or changes layout after readiness', async () => {
    const next = deferred<typeof LEGACY_WORKSPACE_LAYOUT>(), read = vi.fn(() => next.promise), admission = createWorkspaceAdmission(guard(), read)
    let reentrant: Promise<string> | undefined
    admission.subscribe(() => { if (admission.getSnapshot() === 'checking') reentrant = admission.admit() })
    const first = admission.admit()
    expect(admission.admit()).toBe(first); expect(reentrant).toBe(first)
    expect(() => admission.getLayout()).toThrow()
    next.resolve(LEGACY_WORKSPACE_LAYOUT)
    expect(await first).toBe('ready'); expect(admission.getLayout()).toBe(LEGACY_WORKSPACE_LAYOUT)
    expect(await admission.admit()).toBe('ready'); expect(read).toHaveBeenCalledOnce()
  })
  it('never retries a failed control in the same document', async () => {
    const read = vi.fn(async () => { throw new WorkspaceAdmissionError('corrupt') }), admission = createWorkspaceAdmission(guard(), read)
    expect(await admission.admit()).toBe('corrupt'); expect(await admission.admit()).toBe('corrupt')
    expect(read).toHaveBeenCalledOnce(); expect(() => admission.assertReady()).toThrow()
  })
  it.each(['during', 'after'] as const)('lock loss %s reading is terminal before any observer can access data', async when => {
    const controller = new AbortController(), next = deferred<typeof LEGACY_WORKSPACE_LAYOUT>()
    const admission = createWorkspaceAdmission(guard(controller), () => next.promise), checking = admission.admit()
    if (when === 'after') { next.resolve(LEGACY_WORKSPACE_LAYOUT); await checking }
    const onLost = vi.fn(() => { if (admission.getSnapshot() === 'lost') expect(() => admission.getLayout()).toThrow() })
    admission.subscribe(onLost); controller.abort(); next.resolve(LEGACY_WORKSPACE_LAYOUT); await checking
    expect(admission.getSnapshot()).toBe('lost'); expect(await admission.admit()).toBe('lost')
    expect(onLost).toHaveBeenCalled(); expect(() => admission.getLayout()).toThrow()
  })
})
