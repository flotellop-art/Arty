import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { openDB } from 'idb'
import { webcrypto } from 'node:crypto'
import { Blob as NodeBlob } from 'node:buffer'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { seedIsolatedWorkspace } from '../helpers/isolatedWorkspace'
import { deferred } from '../helpers/workspaceLocks'
import { fixture, ids, code, guard as archiveGuard } from '../helpers/workspaceBackup'
import { workspaceDataKey, type IsolatedWorkspaceLayout } from '../../services/workspaceWriter/layout'
import { renderHook, act, cleanup } from '@testing-library/react'

vi.unmock('../../services/workspaceWriter/runtime')
const policy = vi.hoisted(() => ({ start: true }))
vi.mock('../../services/workspaceWriter/activation', () => ({ ISOLATED_WORKSPACE_ENABLED: true, get WORKSPACE_RESTORE_START_ENABLED() { return policy.start } }))
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false, getPlatform: () => 'web' }, registerPlugin: () => ({}) }))
let runtime: typeof import('../../services/workspaceWriter/runtime'), users: typeof import('../../services/userSession'), crypt: typeof import('../../services/crypto')
let history: typeof import('../../services/storage'), warm: typeof import('../../services/workspaceBackup/restorePublication'), cold: typeof import('../../services/workspaceWriter/restore')
let lock: ReturnType<typeof deferred>, layout: IsolatedWorkspaceLayout
const account = (userId: string) => ({ userId, displayName: userId, authMethod: 'apikey' as const, createdAt: 1 })
const receipt = { title: 'Fichiers restaurés', text: 'Copies locales restaurées ; aucun message envoyé.' }
const key = (slot: Parameters<typeof workspaceDataKey>[2], owner = 'a') => workspaceDataKey(layout, owner, slot)
const root = async () => { const db = await openDB('arty-workspace-control'); try { return await db.get('meta', 'workspace') } finally { db.close() } }
const journal = async () => { const db = await openDB('arty-workspace-control'); try { return await db.getAll('meta') } finally { db.close() } }
async function newDocument() {
  if (lock) { lock.resolve(); await Promise.resolve(); await Promise.resolve() }
  vi.resetModules(); lock = deferred()
  Object.defineProperty(navigator, 'locks', { configurable: true, value: {
    request(_name: string, _options: unknown, callback: (lock: unknown) => Promise<void>) { void callback({}); return lock.promise },
  } })
  runtime = await import('../../services/workspaceWriter/runtime')
  await runtime.documentWorkspace.acquire()
}
async function enter(owner = 'a') {
  users = await import('../../services/userSession'); crypt = await import('../../services/crypto'); history = await import('../../services/storage')
  users.setActiveSession(account(owner), { remember: false }); await crypt.initCrypto(`synthetic-${owner}`); users.rememberSession(account(owner)); await history.bootstrapConversationStorage()
}
async function makeArchive(mode: 'full' | 'files' | 'projects' = 'full', version: 1 | 2 | 3 = 1) {
  const f = await fixture(), png = new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0, 0])])
  const { sha256 } = await import('../../services/workspaceBackup/bytes')
  f.objects.set(ids.fileObj, png); f.snapshot.objects.find(o => o.id === ids.fileObj)!.sha256 = await sha256(new Uint8Array(await png.arrayBuffer()))
  if (mode !== 'full') f.snapshot.conversations = []
  if (mode === 'files') { f.snapshot.projects = []; f.snapshot.objects = f.snapshot.objects.filter(o => o.kind === 'file') }
  if (mode === 'projects') { f.snapshot.files = []; f.snapshot.objects = f.snapshot.objects.filter(o => o.kind !== 'file') }
  if (version >= 2) {
    f.snapshot.files.forEach(f => { f.recordedSize = f.size * 4 })
    f.snapshot.conversations.forEach(c => { c.messages.forEach(m => { m.files?.forEach(ref => { const f = fById(ref.id); ref.presentation = { name: f.name, type: '', size: 0 } }) }) })
  }
  function fById(id: string) { return f.snapshot.files.find(f => f.id === id)! }
  if (version === 3) f.snapshot.conversations[0]!.outputRestriction = 'client-reply-draft-v1'
  const objects = new Map([...f.objects].filter(([id]) => f.snapshot.objects.some(o => o.id === id)))
  const { sealWorkspaceBackup } = await import('../../services/workspaceBackup/archive')
  return { archive: await sealWorkspaceBackup(f.snapshot, objects, code, archiveGuard, version), source: f.snapshot, objects }
}
async function prepare(mode: 'full' | 'files' | 'projects' = 'full', version: 1 | 2 | 3 = 1) {
  const f = await makeArchive(mode, version)
  warm = await import('../../services/workspaceBackup/restorePublication')
  return { ...f, prepared: await warm.prepareRestorePublication(f.archive, code, receipt) }
}
async function recover() {
  await newDocument(); expect(await runtime.workspaceAdmission.admit()).toBe('restoring')
  cold = await import('../../services/workspaceWriter/restore'); return cold.createColdWorkspaceRestore()
}
async function ready() { await newDocument(); expect(await runtime.workspaceAdmission.admit()).toBe('ready'); await enter() }
beforeEach(async () => {
  vi.restoreAllMocks(); policy.start = true; localStorage.clear(); globalThis.indexedDB = new IDBFactory()
  vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('Blob', NodeBlob)
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('network forbidden') }))
  await newDocument(); layout = await seedIsolatedWorkspace(); expect(await runtime.workspaceAdmission.admit()).toBe('ready'); await enter()
  history.saveConversation({ id: 'existing-history', title: 'Mon travail', createdAt: 1, updatedAt: 2, messages: [{ id: 'kept', role: 'user', content: 'Existing private text', timestamp: 1 }], extraExisting: { untouched: true } } as never)
  await vi.waitFor(() => expect(localStorage.getItem(key('conversations'))).toBeNull())
})
afterEach(async () => { cleanup(); lock.resolve(); await Promise.resolve(); await Promise.resolve(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it.each(['same', 'token-account-change', 'response-account-change', 'body-account-change', 'database-fence-change', 'notification-account-change'] as const)('auto memory applies only to the captured live owner: %s', async cut => {
  const google = await import('../../services/googleAuth'), trial = await import('../../services/trialClient'), toast = await import('../../services/toast')
  const token = deferred<string | null>(), response = deferred<Response>(), body = deferred<unknown>()
  vi.spyOn(google, 'getValidAccessToken').mockReturnValue(token.promise); vi.spyOn(trial, 'getTrialRemaining').mockReturnValue(null)
  const notify = vi.spyOn(toast, 'toast').mockImplementation(() => {}), fetchMock = vi.fn(() => response.promise); vi.stubGlobal('fetch', fetchMock)
  const memory = await import('../../services/autoMemory'), facts = await import('../../services/localMemoryService'), work = await import('../../services/conversationWork')
  const conv = { id: 'synthetic-auto-memory', title: 'Synthetic', createdAt: 1, updatedAt: 2, messages: [1, 2, 3].map(n => ({ id: `m${n}`, role: 'user' as const, timestamp: n, content: 'Synthetic recurring preference for verifying cross-account response isolation. '.repeat(2) })) }
  const run = memory.maybeExtractMemory(conv); expect(work.hasActiveConversationWork()).toBe(true)
  // A duplicate invocation must not release the first invocation's busy lease.
  await memory.maybeExtractMemory(conv); expect(work.hasActiveConversationWork()).toBe(true)
  if (cut === 'token-account-change') await enter('b')
  token.resolve('synthetic-token')
  if (cut === 'token-account-change') { await run; expect(fetchMock).not.toHaveBeenCalled() }
  else {
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    if (cut === 'response-account-change') await enter('b')
    const json = vi.fn(() => body.promise); response.resolve({ ok: true, json } as unknown as Response)
    if (cut === 'response-account-change') { await run; expect(json).not.toHaveBeenCalled() }
    else {
      await vi.waitFor(() => expect(json).toHaveBeenCalledOnce())
      if (cut === 'body-account-change') await enter('b')
      if (cut === 'database-fence-change') {
        const db = await openDB(layout.projects.name); await db.put('meta', 'new-erasure-fence', 'erasure-fence'); db.close()
      }
      if (cut === 'notification-account-change') window.addEventListener('arty-local-memory-updated', () => users.setActiveSession(account('b'), { remember: false }), { once: true })
      body.resolve({ add: cut === 'notification-account-change' ? [{ fact: 'First A fact' }, { fact: 'Second A fact must not reach B' }] : [{ fact: 'Synthetic durable preference' }], replace: [] }); await run
      if (cut === 'notification-account-change') await enter('b')
    }
  }
  expect(work.hasActiveConversationWork()).toBe(false)
  const scoped = await import('../../services/scopedStorage')
  if (cut === 'same') {
    expect(facts.getAll().map(f => f.content)).toEqual(['Synthetic durable preference'])
    expect(scoped.getJSON('auto-memory-progress')).toEqual({ 'synthetic-auto-memory': 3 }); expect(notify).toHaveBeenCalledOnce()
  } else {
    expect(facts.getAll()).toEqual([]); expect(scoped.getJSON('auto-memory-progress')).toBeNull(); expect(notify).not.toHaveBeenCalled()
  }
})

it.each([1, 2, 3] as const)('real archive v%s → atomic adoption → no-key cold publication → usable copies', async version => {
  const existing = structuredClone(history.getConversations()), before = await root(), { prepared, source, objects } = await prepare('full', version)
  expect(prepared.preview.targetOwner).toBe('a'); expect(prepared.preview.receiptFiles).toBe(0)
  expect(await root()).toEqual(before); expect(await journal()).toHaveLength(1)
  await prepared.commit(); expect(runtime.documentWorkspace.getSnapshot()).toBe('lost')
  expect(() => history.saveConversation(existing[0]!)).toThrow(); await expect(prepared.commit()).rejects.toThrow()
  const job = (await journal()).find(v => typeof v === 'string') as string
  expect(job).not.toContain(code); expect(job).not.toContain('Existing private text'); expect(job).not.toContain('synthetic-a')
  const actor = await recover(), derive = vi.spyOn(crypto.subtle, 'deriveKey'), decrypt = vi.spyOn(crypto.subtle, 'decrypt')
  await actor.resume(); expect(derive).not.toHaveBeenCalled(); expect(decrypt).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled()
  expect(await journal()).toEqual([{ ...before, revision: before.revision + 2 }]); expect(runtime.workspaceAdmission.getSnapshot()).toBe('maintenance')
  await ready()
  const all = history.getConversations(), restored = all[0]!
  expect(all.slice(1)).toEqual(existing); expect(restored.title).toBe(source.conversations[0]!.title); expect(restored.id).not.toBe(ids.conv)
  expect(restored.messages.every(m => m.restoredArchive === true)).toBe(true); expect(restored.euOnly).toBe(true)
  if (version === 3) expect(restored.outputRestriction).toBe('client-reply-draft-v1')
  const store = await import('../../services/projects/store'), operation = await store.beginProjectOperation(), summary = await store.getProject(operation, restored.projectId!)
  expect(summary?.project?.revision).toBe(7); expect(summary?.project?.createdAt).toBe(1)
  expect(await store.readProjectDocumentText(operation, summary!.project!, summary!.project!.documents[0]!.id)).toBe(await objects.get(ids.textObj)!.text())
  const source64 = await store.readProjectDocumentSource(operation, summary!.project!, summary!.project!.documents[0]!.id)
  expect(Buffer.from(source64, 'base64')).toEqual(Buffer.from(await objects.get(ids.sourceObj)!.arrayBuffer()))
  const fileStore = await import('../../services/secureFileStorage'), file = await fileStore.getFile(restored.messages[0]!.files![0]!.id)
  expect(Buffer.from(file!.data!, 'base64')).toEqual(Buffer.from(await objects.get(ids.fileObj)!.arrayBuffer()))
  expect(file!.size).toBe(version === 1 ? 13 : 52)
})

it('files-only produces the announced durable inert receipt; projects-only leaves history exact', async () => {
  const { prepared } = await prepare('files'); expect(prepared.preview.receiptFiles).toBe(2)
  await prepared.commit(); await (await recover()).resume(); await ready()
  const receiptConversation = history.getConversations()[0]!
  expect(receiptConversation.title).toBe(receipt.title); expect(receiptConversation.messages[0]!.files).toHaveLength(2)
  expect(receiptConversation.messages[0]!.restoredArchive).toBe(true)
  const before = localStorage.getItem(key('conversations-enc')), projectOnly = await prepare('projects')
  await projectOnly.prepared.commit(); await (await recover()).resume()
  expect(localStorage.getItem(key('conversations-enc'))).toBe(before)
  const db = await openDB(layout.projects.name); expect((await db.get('usage', 'a')).projects).toBe(1); db.close()
})

it.each(['file', 'project', 'checkpoint', 'cipher', 'plain', 'final'] as const)('interrupted at %s: a new cold document rolls forward without duplicates', async at => {
  localStorage.setItem(key('conversations'), JSON.stringify(history.getConversations()))
  const { prepared } = await prepare(); await prepared.commit(); const actor = await recover()
  const originalAdd = IDBObjectStore.prototype.add, originalPut = IDBObjectStore.prototype.put, originalRemove = Storage.prototype.removeItem, originalSet = Storage.prototype.setItem
  let added = 0
  const add = vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (this: IDBObjectStore, value, key) {
    if (at === 'file' && this.name === 'files' && ++added === 2) throw new Error('cut')
    if (at === 'project' && this.name === 'documents') throw new Error('cut')
    return originalAdd.call(this, value, key)
  })
  const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
    if (at === 'checkpoint' && value.restore?.phase === 'publishing') throw new Error('cut')
    if (at === 'final' && value.version === 2 && this.name === 'meta') throw new Error('cut')
    return originalPut.call(this, value, key)
  })
  const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k, v) { originalSet.call(this, k, v); if (at === 'cipher' && k === key('conversations-enc')) throw new Error('cut') })
  const remove = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (this: Storage, k) { originalRemove.call(this, k); if (at === 'plain' && k === key('conversations')) throw new Error('cut') })
  await expect(actor.resume()).rejects.toThrow('cut'); add.mockRestore(); put.mockRestore(); set.mockRestore(); remove.mockRestore()
  expect((await root()).state).toBe('restoring'); expect(await journal()).toHaveLength(2)
  await (await recover()).resume(); await ready(); expect(history.getConversations()).toHaveLength(2)
  const db = await openDB(layout.projects.name); expect(await db.get('usage', 'a')).toEqual({ owner: 'a', projects: 1, documents: 1, sourceBytes: 6 }); db.close()
})

it.each(['before', 'after'] as const)('adoption %s commit failure retires document, journal absent or complete', async when => {
  const { prepared } = await prepare(), before = await root(), original = IDBObjectStore.prototype.put
  const cut = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
    if (value.version === 8) {
      if (when === 'before') throw new Error('quota')
      this.transaction.addEventListener('complete', () => runtime.documentWorkspace.retire(), { once: true })
    }
    return original.call(this, value, key)
  })
  await expect(prepared.commit()).rejects.toThrow(); cut.mockRestore(); expect(runtime.documentWorkspace.getSnapshot()).toBe('lost')
  if (when === 'before') { expect(await root()).toEqual(before); expect(await journal()).toHaveLength(1) }
  else { expect(await journal()).toHaveLength(2); await (await recover()).resume(); expect(await journal()).toHaveLength(1) }
})

it('durable aborting precedes deletion; interrupted abandonment cannot resume publication', async () => {
  const before = localStorage.getItem(key('conversations-enc')), { prepared } = await prepare(); await prepared.commit()
  const actor = await recover(), put = IDBObjectStore.prototype.put
  const cut = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
    if (value.restore?.phase === 'publishing') throw new Error('before history')
    return put.call(this, value, key)
  })
  await expect(actor.resume()).rejects.toThrow(); cut.mockRestore()
  const abandon = await recover(), originalDelete = IDBObjectStore.prototype.delete
  let count = 0
  const deletion = vi.spyOn(IDBObjectStore.prototype, 'delete').mockImplementation(function (this: IDBObjectStore, key) {
    if (this.name === 'files' && ++count === 2) throw new Error('cut cleanup')
    return originalDelete.call(this, key)
  })
  await expect(abandon.abort()).rejects.toThrow('cut cleanup'); deletion.mockRestore(); expect((await root()).restore.phase).toBe('aborting')
  await expect((await recover()).resume()).rejects.toThrow(); await (await recover()).abort()
  expect(localStorage.getItem(key('conversations-enc'))).toBe(before)
  const db = await openDB(layout.projects.name); expect(await db.count('projects')).toBe(0); expect(await db.count('documents')).toBe(0); expect(await db.get('usage', 'a')).toBeUndefined(); db.close()
  expect(await journal()).toHaveLength(1)
})

it.each(['cache', 'key', 'fence', 'settings'] as const)('warm %s change invalidates preview with no adoption', async change => {
  const { prepared } = await prepare(), before = await root()
  if (change === 'cache') history.getConversations()[0]!.title = 'changed through alias'
  if (change === 'key') await crypt.initCrypto('different-synthetic-key')
  if (change === 'fence') localStorage.setItem('arty-project-erasure-fence', 'new')
  if (change === 'settings') localStorage.setItem('settings', 'new')
  await expect(prepared.commit()).rejects.toThrow(); expect(await root()).toEqual(before); expect(await journal()).toHaveLength(1)
})

it('cold fence change forbids publication; abort does not recreate erased usage/session/crypto', async () => {
  const { prepared } = await prepare(); await prepared.commit()
  localStorage.setItem('arty-project-erasure-fence', 'new')
  const db = await openDB(layout.projects.name); await db.put('meta', 'new', 'erasure-fence'); db.close()
  const before = Object.fromEntries(Object.keys(localStorage).map(k => [k, localStorage.getItem(k)]))
  await expect((await recover()).resume()).rejects.toThrow(); await (await recover()).abort()
  expect(Object.fromEntries(Object.keys(localStorage).map(k => [k, localStorage.getItem(k)]))).toEqual(before)
  const after = await openDB(layout.projects.name); expect(await after.get('usage', 'a')).toBeUndefined(); expect(await after.get('meta', 'erasure-fence')).toBe('new'); after.close()
})

it.each(['usage-equation', 'document-pair', 'foreign-owner', 'locked-history', 'orphan-files', 'duplicate-id'] as const)('strict cold payload rejects rehashed malformed %s before publishing any row', async change => {
  await (await prepare()).prepared.commit(); const header = await root(), db = await openDB('arty-workspace-control'), jobKey = `restore:${header.restore.id}`
  const p = JSON.parse(await db.get('meta', jobKey) as string)
  if (change === 'usage-equation') p.usageAfter.projects++
  if (change === 'document-pair') p.documents.pop()
  if (change === 'foreign-owner') p.files[0].ownerKey = 'arty-b'
  if (change === 'locked-history') p.baseline.history[2] = { length: 1, hash: 'a'.repeat(64) }
  if (change === 'orphan-files') p.historyCipher = null
  if (change === 'duplicate-id') p.files[1].fileId = p.files[0].fileId
  const raw = JSON.stringify(p), { digestText } = await import('../../services/workspaceWriter/migrationInventory')
  header.restore.bytes = new TextEncoder().encode(raw).length; header.restore.hash = await digestText(raw)
  const tx = db.transaction('meta', 'readwrite'); await tx.store.put(raw, jobKey); await tx.store.put(header, 'workspace'); await tx.done; db.close()
  await expect((await recover()).resume()).rejects.toMatchObject({ code: 'format' })
  const files = await openDB(layout.files.name), projects = await openDB(layout.projects.name)
  expect(await files.count('files')).toBe(0); expect(await projects.count('projects')).toBe(0); expect(await projects.count('documents')).toBe(0)
  files.close(); projects.close(); expect((await root()).restore.phase).toBe('copies')
})

it.each(['valid', 'malformed'] as const)('abandonment after copies/usage and erasure %s never resurrects deleted authority', async mode => {
  await (await prepare()).prepared.commit(); const actor = await recover(), originalPut = IDBObjectStore.prototype.put
  const cut = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
    if (this.name === 'meta' && value?.version === 8 && value.restore.phase === 'publishing') throw new Error('before publishing')
    return originalPut.call(this, value, key)
  })
  await expect(actor.resume()).rejects.toThrow('before publishing'); cut.mockRestore()
  const db = await openDB(layout.projects.name); expect((await db.get('usage', 'a')).projects).toBe(1)
  const receipt = mode === 'valid' ? { owner: 'a', operationId: crypto.randomUUID(), nonce: crypto.randomUUID(), serverConfirmed: false, pending: [], localOnly: true } : { owner: 'a' }
  await db.put('meta', receipt, ['erasing', 'a']); await db.put('meta', 'erased-fence', 'erasure-fence')
  if (mode === 'valid') {
    await db.clear('projects'); await db.clear('documents'); await db.delete('usage', 'a')
    localStorage.setItem('arty-project-erasure-fence', 'erased-fence')
    for (const slot of ['crypto-salt', 'crypto-check', 'crypto-version'] as const) localStorage.removeItem(workspaceDataKey(layout, 'a', slot))
    localStorage.removeItem('arty-active-session'); localStorage.removeItem('arty-known-sessions')
  }
  const before = Object.fromEntries(Object.keys(localStorage).map(k => [k, localStorage.getItem(k)]))
  const next = await recover()
  if (mode === 'valid') { await next.abort(); expect(await db.get('usage', 'a')).toBeUndefined(); expect(await journal()).toHaveLength(1) }
  else { await expect(next.abort()).rejects.toMatchObject({ code: 'format' }); expect(await db.count('projects')).toBe(1); expect((await db.get('usage', 'a')).projects).toBe(1); expect((await root()).restore.phase).toBe('aborting') }
  expect(await db.get('meta', ['erasing', 'a'])).toEqual(receipt); expect(await db.get('meta', 'erasure-fence')).toBe('erased-fence'); db.close()
  expect(Object.fromEntries(Object.keys(localStorage).map(k => [k, localStorage.getItem(k)]))).toEqual(before)
})

it('partial database open failure closes prior handles and never creates the missing database', async () => {
  const { openRestoreDatabases } = await import('../../services/workspaceWriter/restoreJournal'), { CONTROL_SHAPE, FILE_SHAPE } = await import('../../services/workspaceWriter/schema')
  const close = vi.spyOn(IDBDatabase.prototype, 'close'), guard = { assertCurrent() {}, signal: new AbortController().signal }
  await expect(openRestoreDatabases([{ descriptor: { name: 'arty-workspace-control', version: 1 }, shape: CONTROL_SHAPE }, { descriptor: { name: 'missing-synthetic-db', version: 1 }, shape: FILE_SHAPE }], guard)).rejects.toThrow()
  expect(close.mock.contexts.some(db => db.name === 'arty-workspace-control')).toBe(true)
  expect((await indexedDB.databases()).some(db => db.name === 'missing-synthetic-db')).toBe(false)
})

it('oversize archive is refused before any read, KDF, encryption or adoption', async () => {
  const { RESTORE_ARCHIVE_BYTES } = await import('../../services/workspaceBackup/restoreLimits'), before = await root()
  const blob = new Blob([new Uint8Array(RESTORE_ARCHIVE_BYTES + 1)]), read = vi.spyOn(blob, 'arrayBuffer'), slice = vi.spyOn(blob, 'slice')
  const derive = vi.spyOn(crypto.subtle, 'deriveKey'), encrypt = vi.spyOn(crypt, 'encrypt')
  const { prepareRestorePublication } = await import('../../services/workspaceBackup/restorePublication')
  await expect(prepareRestorePublication(blob, code, receipt)).rejects.toMatchObject({ code: 'limit' })
  expect(read).not.toHaveBeenCalled(); expect(slice).not.toHaveBeenCalled(); expect(derive).not.toHaveBeenCalled(); expect(encrypt).not.toHaveBeenCalled()
  expect(await root()).toEqual(before); expect(await journal()).toHaveLength(1); expect(runtime.documentWorkspace.getSnapshot()).toBe('held')
})

it('incremental journal budget rejects before encrypting another row or adopting anything', async () => {
  const archive = await makeArchive(), before = await root()
  vi.doMock('../../services/workspaceBackup/restoreLimits', () => ({ RESTORE_ARCHIVE_BYTES: 16 * 1024 * 1024, RESTORE_ADOPTION_BYTES: 256 * 1024 + 80 }))
  try {
    const { prepareRestorePublication } = await import('../../services/workspaceBackup/restorePublication'), encrypt = vi.spyOn(crypt, 'encrypt')
    await expect(prepareRestorePublication(archive.archive, code, receipt)).rejects.toMatchObject({ code: 'limit' })
    expect(encrypt).toHaveBeenCalledTimes(1); expect(await root()).toEqual(before); expect(await journal()).toHaveLength(1)
  } finally { vi.doUnmock('../../services/workspaceBackup/restoreLimits') }
})

it('native start is intrinsically refused but existing isolated storage remains admissible', async () => {
  vi.doMock('../../services/native/platform', () => ({ isNative: true }))
  try {
    const archive = await makeArchive(), warm = await import('../../services/workspaceBackup/restorePublication'), before = await root()
    await expect(warm.prepareRestorePublication(archive.archive, code, receipt)).rejects.toMatchObject({ code: 'unavailable' })
    expect(await root()).toEqual(before); expect(runtime.workspaceAdmission.getSnapshot()).toBe('ready')
    await newDocument(); const migration = await import('../../services/workspaceWriter/migration')
    await expect(migration.createColdWorkspaceMigration().start()).rejects.toMatchObject({ code: 'disabled' }); expect(await root()).toEqual(before)
  } finally { vi.doUnmock('../../services/native/platform') }
})

it('permanent quota at first cipher allows abandonment with both A and B still readable and writable', async () => {
  await enter('b'); history.saveConversation({ id: 'b-work', title: 'B', messages: [], createdAt: 1, updatedAt: 1 })
  await vi.waitFor(() => expect(localStorage.getItem(key('conversations', 'b'))).toBeNull())
  const bCipher = localStorage.getItem(key('conversations-enc', 'b'))
  await enter('a'); const { prepared } = await prepare(); await prepared.commit()
  const actor = await recover(), original = Storage.prototype.setItem
  const quota = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k, v) {
    if (k === key('conversations-enc')) throw new DOMException('fixed quota', 'QuotaExceededError')
    original.call(this, k, v)
  })
  await expect(actor.resume()).rejects.toThrow('fixed quota'); expect((await root()).restore.phase).toBe('publishing')
  // Keep the quota fault throughout abandonment; no illicit spare-capacity assumption.
  await (await recover()).abort(); expect(await journal()).toHaveLength(1)
  expect(localStorage.getItem(key('conversations-enc', 'b'))).toBe(bCipher)
  quota.mockRestore(); await ready(); expect(history.getConversations()[0]!.id).toBe('existing-history')
  for (const owner of ['a', 'b']) {
    await enter(owner); const c = history.getConversations()[0]!; history.saveConversation({ ...c, title: `written-${owner}` })
    await vi.waitFor(() => expect(localStorage.getItem(key('conversations', owner))).toBeNull())
  }
  await ready(); expect(history.getConversations()[0]!.title).toBe('written-a'); await enter('b'); expect(history.getConversations()[0]!.title).toBe('written-b')
})

it('cipher write committed before exception cannot be abandoned even with the old plaintext still present', async () => {
  localStorage.setItem(key('conversations'), JSON.stringify(history.getConversations()))
  const { prepared } = await prepare(); await prepared.commit(); const actor = await recover(), original = Storage.prototype.setItem
  const cut = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k, v) { original.call(this, k, v); if (k === key('conversations-enc')) throw new Error('after cipher') })
  await expect(actor.resume()).rejects.toThrow(); cut.mockRestore()
  await expect((await recover()).abort()).rejects.toThrow(); expect((await root()).restore.phase).toBe('publishing')
  await (await recover()).resume(); await ready(); expect(history.getConversations()).toHaveLength(2)
})

it.each(['preview', 'commit'] as const)('a live real stream without a first token refuses %s without adoption or retirement', async where => {
  const { useStreaming } = await import('../../hooks/useStreaming'), { hasActiveConversationWork } = await import('../../services/conversationWork')
  const stream = renderHook(() => useStreaming({ refreshConversations() {} }))
  const archive = await makeArchive(); warm = await import('../../services/workspaceBackup/restorePublication')
  const prepared = where === 'commit' ? await warm.prepareRestorePublication(archive.archive, code, receipt) : undefined
  act(() => { expect(stream.result.current.startStream('waiting-provider')).toBe(true) })
  expect(hasActiveConversationWork()).toBe(true)
  if (prepared) await expect(prepared.commit()).rejects.toThrow('backup_busy')
  else await expect(warm.prepareRestorePublication(archive.archive, code, receipt)).rejects.toThrow('backup_busy')
  expect(runtime.documentWorkspace.getSnapshot()).toBe('held'); expect(await journal()).toHaveLength(1)
  act(() => stream.result.current.stopStreaming('waiting-provider')); expect(hasActiveConversationWork()).toBe(false)
})

it('external stream lease release/unmount cannot clear a replacement ticket', async () => {
  const { useStreaming } = await import('../../hooks/useStreaming'), { hasActiveConversationWork } = await import('../../services/conversationWork')
  const hook = renderHook(() => useStreaming({ refreshConversations() {} })), entry = { id: 'compare', assertCurrent() {}, lifecycle: { flush: () => true, cancel() {} } }
  let old!: { release(): void }
  act(() => { old = hook.result.current.reserveExternalStreams([entry])![0]! })
  expect(hasActiveConversationWork()).toBe(true); act(() => old.release()); expect(hasActiveConversationWork()).toBe(false)
  act(() => { hook.result.current.reserveExternalStreams([entry]); old.release() }); expect(hasActiveConversationWork()).toBe(true)
  hook.unmount(); expect(hasActiveConversationWork()).toBe(false)
})

it.each(['consumed', 'provisioning'] as const)('preserves the exact v7 reset bundle/required owners for B (%s)', async phase => {
  const current = await root(), base = { ...current, version: 7, requiredOwners: ['b'], resets: [{ owner: 'b', operationId: crypto.randomUUID(), resetId: crypto.randomUUID(), phase,
    ...(phase === 'provisioning' ? { bundle: { version: 'v2', salt: JSON.stringify(Array(16).fill(3)), check: 'v2:' + 'A'.repeat(47) + '=' } } : {}) }] }
  const control = await openDB('arty-workspace-control'); await control.put('meta', base, 'workspace'); control.close()
  await ready(); const { prepared } = await prepare(); await prepared.commit(); await (await recover()).resume()
  expect(await root()).toEqual({ ...base, revision: base.revision + 2 })
})

it.each([2, 7] as const)('START rollback keeps v%s ready readable/writable and v8 copies/publishing/aborting recoverable', async version => {
  if (version === 7) {
    const base = { ...await root(), version: 7, requiredOwners: ['b'], resets: [{ owner: 'b', operationId: crypto.randomUUID(), resetId: crypto.randomUUID(), phase: 'consumed' }] }
    const db = await openDB('arty-workspace-control'); await db.put('meta', base, 'workspace'); db.close(); await ready()
  }
  for (const phase of ['copies', 'publishing', 'aborting'] as const) {
    policy.start = true; const before = await root(); await (await prepare()).prepared.commit()
    if (phase === 'publishing') {
      const actor = await recover(), original = Storage.prototype.setItem
      const fault = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function(this: Storage, k, v) { if (k === key('conversations-enc')) throw new Error('quota before cipher'); original.call(this, k, v) })
      await expect(actor.resume()).rejects.toThrow(); fault.mockRestore()
    } else if (phase === 'aborting') {
      const actor = await recover(), original = IDBObjectStore.prototype.put
      const fault = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function(this: IDBObjectStore, value, k) { if (this.name === 'meta' && value?.version === version && value.state === 'ready') throw new Error('after deletes before ready'); return original.call(this, value, k) })
      await expect(actor.abort()).rejects.toThrow(); fault.mockRestore()
    }
    expect((await root()).restore.phase).toBe(phase)
    // New document with new release policy. No archive/code/key is supplied to cold actor.
    policy.start = false; const actor = await recover()
    if (phase === 'aborting') await actor.abort(); else await actor.resume()
    expect(await root()).toEqual({ ...before, revision: before.revision + 2 }); await ready()
    const kept = history.getConversations().find(c => c.id === 'existing-history')!
    history.saveConversation({ ...kept, title: `written with START off ${phase}` })
    await vi.waitFor(() => expect(localStorage.getItem(key('conversations'))).toBeNull())
    const archive = await makeArchive(), next = await root(), publisher = await import('../../services/workspaceBackup/restorePublication')
    await expect(publisher.prepareRestorePublication(archive.archive, code, receipt)).rejects.toMatchObject({ code: 'unavailable' })
    expect(await root()).toEqual(next); expect(await journal()).toHaveLength(1)
  }
})

it('START rollback also revokes a displayed warm preview before any adoption attempt', async () => {
  const { prepared } = await prepare(), before = await root(); policy.start = false
  await expect(prepared.commit()).rejects.toMatchObject({ code: 'unavailable' })
  expect(await root()).toEqual(before); expect(await journal()).toHaveLength(1); expect(runtime.documentWorkspace.getSnapshot()).toBe('held')
})

it('a late ordinary project matching a missing historical remap is rejected before preview/adoption', async () => {
  const f = await makeArchive()
  f.source.conversations[0]!.projectId = ids.old
  const { sealWorkspaceBackup } = await import('../../services/workspaceBackup/archive')
  f.archive = await sealWorkspaceBackup(f.source, f.objects, code, archiveGuard)
  // Deterministic new IDs let the independent writer target the otherwise
  // missing project reference without learning internal publisher state.
  const random = crypto.randomUUID.bind(crypto), mapped = 'abababab-cdcd-4efe-8aaa-bbbbbbbbbbbb'
  const originalEncrypt = crypto.subtle.encrypt.bind(crypto.subtle)
  let injected = false
  let generated = 0
  vi.spyOn(crypto, 'randomUUID').mockImplementation(() => ++generated === 6 ? mapped : random())
  const foreign = { key: ['a', mapped], owner: 'a', id: mapped, revision: 1, state: 'deleted', euOnly: false, createdAt: 1, updatedAt: 1, cipher: null }
  const encrypt = vi.spyOn(crypto.subtle, 'encrypt').mockImplementation(async (...args) => {
    if (!injected) { injected = true; const db = await openDB(layout.projects.name); await db.put('projects', foreign); db.close() }
    return originalEncrypt(...args)
  })
  warm = await import('../../services/workspaceBackup/restorePublication')
  await expect(warm.prepareRestorePublication(f.archive, code, receipt)).rejects.toThrow(); encrypt.mockRestore()
  expect(await journal()).toHaveLength(1); expect(runtime.documentWorkspace.getSnapshot()).toBe('held')
  expect(injected).toBe(true)
})

it.each(['normal', 'file-changed', 'fence-after-last-file-read'] as const)('restored file download %s revalidates exact bytes and durable authority before the click', async mode => {
  const { prepared, objects } = await prepare('files'); await prepared.commit(); await (await recover()).resume(); await ready()
  const id = history.getConversations()[0]!.messages[0]!.files![0]!.id
  const createURL = vi.fn(() => 'blob:synthetic-download'), revoke = vi.fn()
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createURL }); Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revoke })
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  const fileStore = await import('../../services/secureFileStorage'), original = fileStore.readOwnedFileSnapshot
  let reads = 0
  vi.spyOn(fileStore, 'readOwnedFileSnapshot').mockImplementation(async (...args) => {
    const result = await original(...args)
    if (++reads === 1 && mode === 'file-changed') {
      const db = await openDB(layout.files.name), row = await db.get('files', id); await db.put('files', { ...row, name: 'changed' }); db.close()
    }
    if (reads === 2 && mode === 'fence-after-last-file-read') { const db = await openDB(layout.projects.name); await db.put('meta', 'new-fence', 'erasure-fence'); db.close() }
    return result
  })
  const { downloadRestoredFile } = await import('../../services/workspaceBackup/downloadRestoredFile')
  if (mode === 'normal') {
    await downloadRestoredFile(id, new AbortController().signal)
    expect(click).toHaveBeenCalledOnce(); expect(await createURL.mock.calls[0]![0].arrayBuffer()).toEqual(await objects.get(ids.fileObj)!.arrayBuffer())
  } else { await expect(downloadRestoredFile(id, new AbortController().signal)).rejects.toThrow(); expect(click).not.toHaveBeenCalled(); expect(createURL).not.toHaveBeenCalled() }
})
