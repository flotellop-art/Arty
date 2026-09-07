import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { openDB, deleteDB } from 'idb'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { isolatedControl, seedIsolatedWorkspace, GENERATION } from '../helpers/isolatedWorkspace'
import { deferred } from '../helpers/workspaceLocks'
import { parseWorkspaceUpgrade, completedWorkspaceUpgrade } from '../../services/workspaceWriter/upgradeProtocol'
import { parseRestoreReady } from '../../services/workspaceWriter/restoreProtocol'
import { validateWorkspaceControl } from '../../services/workspaceWriter/control'
import { isolatedWorkspaceLayout } from '../../services/workspaceWriter/layout'

vi.unmock('../../services/workspaceWriter/runtime')
const policy = vi.hoisted(() => ({ start: true, native: false }))
vi.mock('../../services/native/platform', () => ({ get isNative() { return policy.native } }))
vi.mock('../../services/workspaceWriter/activation', () => ({ ISOLATED_WORKSPACE_ENABLED: true, WORKSPACE_RESTORE_START_ENABLED: true,
  get WORKSPACE_UPGRADE_START_ENABLED() { return policy.start } }))
let runtime: typeof import('../../services/workspaceWriter/runtime'), lock: ReturnType<typeof deferred>
let upgrade: typeof import('../../services/workspaceWriter/upgrade')
const layout = isolatedWorkspaceLayout(GENERATION, ['a', 'a-b', 'a:b'])
const ticket = () => ({ format: 'arty-workspace-control', version: 9, layout: 'isolated-v1', state: 'upgrading', revision: 2,
  generation: GENERATION, requiredOwners: ['a', 'a-b', 'a:b'], base: isolatedControl(['a', 'a-b', 'a:b']),
  upgrade: { id: '76ba201a-547f-44a1-9000-222222222222', from: 1, to: 2, localFence: null, activeFence: null } })
async function endDocument() {
  if (runtime?.documentWorkspace.getSnapshot() === 'held') { lock.resolve(); await vi.waitFor(() => expect(runtime.documentWorkspaceSignal.aborted).toBe(true)) }
}
async function newDocument() {
  await endDocument(); vi.resetModules(); lock = deferred()
  Object.defineProperty(navigator, 'locks', { configurable: true, value: {
    request(_n: unknown, _o: unknown, callback: (v: unknown) => Promise<void>) { void callback({}); return lock.promise },
  } })
  runtime = await import('../../services/workspaceWriter/runtime'); upgrade = await import('../../services/workspaceWriter/upgrade')
  await runtime.documentWorkspace.acquire()
}
async function root(value?: unknown) {
  const db = await openDB('arty-workspace-control', 1)
  try { if (value !== undefined) await db.put('meta', value, 'workspace'); return await db.get('meta', 'workspace') } finally { db.close() }
}
async function snapshot() {
  const result: Record<string, unknown> = { local: Object.fromEntries(Object.keys(localStorage).sort().map(k => [k, localStorage.getItem(k)])) }
  for (const { name } of await indexedDB.databases()) {
    if (!name || name === 'arty-workspace-control') continue
    const db = await openDB(name)
    try {
      for (const store of db.objectStoreNames) result[`${name}/${store}`] = [await db.getAllKeys(store), await db.getAll(store)]
    } finally { db.close() }
  }
  return result
}
async function seed() {
  await seedIsolatedWorkspace(['a', 'a-b', 'a:b'])
  const db = await openDB(layout.projects.name, 1)
  for (const owner of ['a', 'a-b', 'a:b']) {
    await db.put('projects', { key: [owner, 'p'], owner, id: 'p', extra: undefined, cipher: 'opaque\ud800', state: 'live' })
    await db.put('documents', { key: [owner, 'p', 'd', 'text'], owner, cipher: '', state: 'deleted' })
    await db.put('usage', { owner, projects: 0, documents: 0, sourceBytes: -0 })
    localStorage.setItem(`arty-${owner}-conversations`, `exact-${owner}-\ud800`)
  }
  db.close(); localStorage.setItem('unrelated', 'keep')
}
beforeEach(async () => {
  vi.restoreAllMocks(); globalThis.indexedDB = new IDBFactory(); localStorage.clear(); policy.start = true; policy.native = false
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('network forbidden') })); await newDocument()
})
afterEach(async () => { await endDocument(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('upgrades the actual declared DB, preserves every raw row/LS value, and only a NEW document is admitted', async () => {
  await seed(); const before = await snapshot(), base = await root()
  const write = vi.spyOn(Storage.prototype, 'setItem'), actor = upgrade.createColdWorkspaceUpgrade('start')
  await actor.run()
  expect(await root()).toEqual({ ...base, projectsVersion: 2, revision: 3 })
  expect(await snapshot()).toEqual(before); expect(write).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled()
  expect(runtime.workspaceAdmission.getSnapshot()).toBe('maintenance'); expect(() => runtime.assertDocumentWorkspace()).toThrow()
  expect(await runtime.workspaceAdmission.admit()).toBe('maintenance')
  await expect(openDB(layout.projects.name, 1)).rejects.toMatchObject({ name: 'VersionError' })
  await newDocument(); expect(await runtime.workspaceAdmission.admit()).toBe('ready')
  expect(runtime.getDocumentStorageLayout().projects.version).toBe(2)
  expect(runtime.getDocumentStorageLayout().files.version).toBe(1)
  expect(() => upgrade.createColdWorkspaceUpgrade('start')).toThrow()
})

it.each(['available', 'provisioning', 'consumed'])('preserves the complete reset v7 %s registry', async phase => {
  await seed(); const base = { ...await root(), version: 7, resets: [{ owner: 'a', operationId: GENERATION, resetId: ticket().upgrade.id, phase,
    ...(phase === 'provisioning' ? { bundle: { salt: JSON.stringify(Array(16).fill(1)), check: 'v2:' + 'A'.repeat(47) + '=', version: 'v2' } } : {}) }] }
  await root(base); await upgrade.createColdWorkspaceUpgrade('start').run()
  const final = await root(); expect(final).toEqual({ ...base, projectsVersion: 2, revision: 3 }); expect(parseRestoreReady(final)).toEqual(final)
})

it.each(['before-ticket', 'after-ticket', 'during-versionchange', 'before-final'])('cold restart after %s completes the SAME physical transition', async point => {
  await seed(); const before = await snapshot(), originalPut = IDBObjectStore.prototype.put, originalOpen = indexedDB.open.bind(indexedDB)
  const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
    if (this.transaction.db.name === 'arty-workspace-control') {
      if (point === 'before-ticket' && value.version === 9 || point === 'before-final' && value.projectsVersion === 2) throw new Error('cut')
      if (point === 'after-ticket' && value.version === 9) this.transaction.addEventListener('complete', () => runtime.documentWorkspace.retire(), { once: true })
    }
    return originalPut.call(this, value, key)
  })
  const opening = vi.spyOn(indexedDB, 'open').mockImplementation((name, version) => {
    const request = originalOpen(name, version)
    if (point === 'during-versionchange' && name === layout.projects.name && version === 2) request.addEventListener('upgradeneeded', () => request.transaction!.abort(), { once: true })
    return request
  })
  await expect(upgrade.createColdWorkspaceUpgrade('start').run()).rejects.toThrow()
  put.mockRestore(); opening.mockRestore()
  const interrupted = await root(), physical = (await indexedDB.databases()).find(d => d.name === layout.projects.name)!.version
  expect(physical).toBe(point === 'before-final' ? 2 : 1)
  expect(interrupted.version).toBe(point === 'before-ticket' ? 2 : 9)
  await newDocument()
  if (point !== 'before-ticket') { policy.start = false; expect(await runtime.workspaceAdmission.admit()).toBe('upgrading') }
  await upgrade.createColdWorkspaceUpgrade(point === 'before-ticket' ? 'start' : 'resume').run()
  expect(await root()).toEqual({ ...ticket().base, projectsVersion: 2, revision: 3 })
  expect(await snapshot()).toEqual(before)
})

it('uncertain final commit is rediscovered only by the actor that staged that exact final', async () => {
  await seed(); let expire!: () => void
  const realTimeout = setTimeout, originalPut = IDBObjectStore.prototype.put
  vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: TimerHandler, ms?: number, ...args: unknown[]) => {
    if (ms === 12_345) expire = fn as () => void
    return realTimeout(fn, ms, ...args)
  }) as typeof setTimeout)
  const fault = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
    if (this.transaction.db.name === 'arty-workspace-control' && value.projectsVersion === 2) this.transaction.addEventListener('complete', () => expire(), { once: true })
    return originalPut.call(this, value, key)
  })
  const actor = upgrade.createColdWorkspaceUpgrade('start')
  await expect(actor.run(12_345)).rejects.toThrow(); fault.mockRestore()
  const final = await root(); expect(final.projectsVersion).toBe(2)
  await actor.run(); expect(await root()).toEqual(final)
  await newDocument(); await expect(upgrade.createColdWorkspaceUpgrade('resume').run()).rejects.toThrow()
  expect(await root()).toEqual(final)
})

it('START OFF refuses before claiming or opening; adopted v9 still resumes', async () => {
  await seed(); policy.start = false
  const opening = vi.spyOn(indexedDB, 'open')
  expect(() => upgrade.createColdWorkspaceUpgrade('start')).toThrow('workspace_upgrade_disabled')
  expect(opening).not.toHaveBeenCalled(); expect(runtime.workspaceAdmission.getSnapshot()).toBe('idle'); opening.mockRestore()
  await root(ticket()); expect(await runtime.workspaceAdmission.admit()).toBe('upgrading')
  await upgrade.createColdWorkspaceUpgrade('resume').run()
  await newDocument(); expect(await runtime.workspaceAdmission.admit()).toBe('ready')
})

it('native START refuses intrinsically before claim/open but native recovery remains supported', async () => {
  await seed(); policy.native = true
  const opening = vi.spyOn(indexedDB, 'open')
  expect(() => upgrade.createColdWorkspaceUpgrade('start')).toThrow('workspace_upgrade_disabled')
  expect(opening).not.toHaveBeenCalled(); expect(runtime.workspaceAdmission.getSnapshot()).toBe('idle'); opening.mockRestore()
  await root(ticket()); expect(await runtime.workspaceAdmission.admit()).toBe('upgrading')
  await upgrade.createColdWorkspaceUpgrade('resume').run()
  expect((await root()).projectsVersion).toBe(2)
})

it('a blocked physical open is retired; closing the held DB cannot cause a late upgrade', async () => {
  await seed(); const held = await openDB(layout.projects.name, 1)
  await expect(upgrade.createColdWorkspaceUpgrade('start').run()).rejects.toThrow()
  const reserved = await root(); expect(reserved.version).toBe(9)
  held.close()
  const unchanged = await openDB(layout.projects.name); expect(unchanged.version).toBe(1); unchanged.close()
  expect(await root()).toEqual(reserved)
  await newDocument(); await upgrade.createColdWorkspaceUpgrade('resume').run()
  expect((await root()).projectsVersion).toBe(2)
})

it.each(['missing', 'already-two', 'future', 'wrong-schema', 'foreign-meta', 'receipt-falsy', 'fence-falsy', 'fence-mismatch'])('refuses %s before reservation without repairing data', async kind => {
  await seed()
  if (kind === 'missing') await deleteDB(layout.projects.name)
  else if (kind === 'already-two' || kind === 'future') { const db = await openDB(layout.projects.name, kind === 'future' ? 3 : 2); db.close() }
  else if (kind === 'wrong-schema') {
    await deleteDB(layout.projects.name); const db = await openDB(layout.projects.name, 1, { upgrade(db) { db.createObjectStore('meta') } }); db.close()
  } else {
    const db = await openDB(layout.projects.name, 1)
    await db.put('meta', kind === 'fence-mismatch' ? 'different' : false, kind === 'receipt-falsy' ? ['erasing', 'a'] : kind.startsWith('fence') ? 'erasure-fence' : 'unknown'); db.close()
  }
  const before = await snapshot(), databases = await indexedDB.databases(), initial = await root()
  await expect(upgrade.createColdWorkspaceUpgrade('start').run()).rejects.toThrow()
  expect(await root()).toEqual(initial); expect(await snapshot()).toEqual(before); expect(await indexedDB.databases()).toEqual(databases)
})

it('refuses deletion between preflight and versionchange and never recreates the missing DB', async () => {
  await seed(); await root(ticket())
  const originalOpen = indexedDB.open.bind(indexedDB)
  const fault = vi.spyOn(indexedDB, 'open').mockImplementation((name, version) => {
    if (name === layout.projects.name && version === 2) indexedDB.deleteDatabase(name)
    return originalOpen(name, version)
  })
  await expect(upgrade.createColdWorkspaceUpgrade('resume').run()).rejects.toThrow(); fault.mockRestore()
  expect((await indexedDB.databases()).some(db => db.name === layout.projects.name)).toBe(false)
  expect(await root()).toEqual(ticket())
})

it.each(['after-admission', 'between-attempts'])('refuses a different valid ticket %s', async when => {
  await seed(); await root(ticket()); expect(await runtime.workspaceAdmission.admit()).toBe('upgrading')
  const actor = upgrade.createColdWorkspaceUpgrade('resume')
  if (when === 'between-attempts') {
    const held = await openDB(layout.projects.name, 1)
    await expect(actor.run()).rejects.toThrow(); held.close()
    const db = await openDB(layout.projects.name); expect(db.version).toBe(1); db.close()
  }
  const replacement = { ...ticket(), upgrade: { ...ticket().upgrade, id: GENERATION } }
  await root(replacement); await expect(actor.run()).rejects.toThrow()
  expect(await root()).toEqual(replacement)
  expect((await indexedDB.databases()).find(db => db.name === layout.projects.name)?.version).toBe(1)
})

it.each(['reservation', 'final'])('a changed LS fence inside the %s CAS aborts that transition', async when => {
  await seed(); const originalGet = IDBObjectStore.prototype.get
  let casReads = 0
  const fault = vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementation(function (this: IDBObjectStore, key) {
    const request = originalGet.call(this, key)
    if (this.transaction.db.name === 'arty-workspace-control' && this.transaction.mode === 'readwrite' && key === 'workspace') {
      casReads++
      if (casReads === (when === 'reservation' ? 1 : 2)) request.addEventListener('success', () => localStorage.setItem('arty-project-erasure-fence', 'changed'), { once: true })
    }
    return request
  })
  await expect(upgrade.createColdWorkspaceUpgrade('start').run()).rejects.toThrow(); fault.mockRestore()
  expect((await root()).version).toBe(when === 'reservation' ? 2 : 9)
  expect((await indexedDB.databases()).find(db => db.name === layout.projects.name)?.version).toBe(when === 'reservation' ? 1 : 2)
})

it.each([1, undefined, null, 3, '2', false])('ready controls refuse present noncanonical projectsVersion %s', projectsVersion => {
  for (const value of [{ ...ticket().base, projectsVersion }, { ...ticket().base, version: 7, resets: [], projectsVersion }]) {
    expect(parseRestoreReady(value)).toBeNull(); expect(() => validateWorkspaceControl(value)).toThrow()
  }
})
it('strict v9 validates base, monotone revision, fences, immutable input and getters', () => {
  const value = ticket(), parsed = parseWorkspaceUpgrade(value)!
  expect(parsed).toEqual(value); value.requiredOwners.push('later'); expect(parsed.requiredOwners).not.toContain('later')
  expect(completedWorkspaceUpgrade(parsed)).toEqual({ ...ticket().base, revision: 3, projectsVersion: 2 })
  const getter = vi.fn(() => 2), hostile = { ...ticket().base }
  Object.defineProperty(hostile, 'projectsVersion', { enumerable: true, get: getter })
  expect(parseRestoreReady(hostile)).toBeNull(); expect(getter).not.toHaveBeenCalled()
  for (const invalid of [{ ...ticket(), extra: true }, { ...ticket(), projectsVersion: 2 }, { ...ticket(), revision: 3 },
    { ...ticket(), base: { ...ticket().base, projectsVersion: 2 } }, { ...ticket(), upgrade: { ...ticket().upgrade, from: 0 } },
    { ...ticket(), base: { ...ticket().base, revision: Number.MAX_SAFE_INTEGER - 1 }, revision: Number.MAX_SAFE_INTEGER },
    { ...ticket(), upgrade: { ...ticket().upgrade, activeFence: '' } }, { ...ticket(), upgrade: { ...ticket().upgrade, localFence: 'other' } }]) expect(parseWorkspaceUpgrade(invalid)).toBeNull()
})
