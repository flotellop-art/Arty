import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { deleteDB, openDB } from 'idb'
import { File as NodeFile } from 'node:buffer'
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { seedIsolatedWorkspace } from '../helpers/isolatedWorkspace'
import { deferred } from '../helpers/workspaceLocks'
import { HISTORY_SLOTS, workspaceDataKey, type IsolatedWorkspaceLayout } from '../../services/workspaceWriter/layout'

// Only the final release policy is enabled in this suite. Real lock controller,
// parser, schema probes, runtime admission, sessions, KDF, CRUD and erasure run.
vi.unmock('../../services/workspaceWriter/runtime')
vi.mock('../../services/workspaceWriter/activation', () => ({ ISOLATED_WORKSPACE_ENABLED: true }))
vi.mock('../../services/apiBase', () => ({ apiUrl: (path: string) => path }))
let runtime: typeof import('../../services/workspaceWriter/runtime')
let users: typeof import('../../services/userSession')
let crypt: typeof import('../../services/crypto')
let history: typeof import('../../services/storage')
let files: typeof import('../../services/secureFileStorage')
let projects: typeof import('../../services/projects/store')
let layout: IsolatedWorkspaceLayout
let lock: ReturnType<typeof deferred>
const account = (userId = 'a') => ({ userId, displayName: userId, authMethod: 'apikey' as const, createdAt: 1 })
const key = (owner: string, slot: Parameters<typeof workspaceDataKey>[2]) => workspaceDataKey(layout, owner, slot)
const localBytes = () => Object.fromEntries(Object.keys(localStorage).sort().map(k => [k, localStorage.getItem(k)]))

beforeEach(async () => {
  vi.restoreAllMocks(); vi.resetModules(); localStorage.clear(); globalThis.indexedDB = new IDBFactory()
  lock = deferred()
  Object.defineProperty(navigator, 'locks', { configurable: true, value: {
    request(_name: string, _options: unknown, callback: (lock: unknown) => Promise<void>) { void callback({}); return lock.promise },
  } })
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No network in local fixture') }))
  runtime = await import('../../services/workspaceWriter/runtime')
  users = await import('../../services/userSession'); crypt = await import('../../services/crypto')
  history = await import('../../services/storage'); files = await import('../../services/secureFileStorage')
  projects = await import('../../services/projects/store')
})
async function endDocument() {
  cleanup()
  if (runtime.documentWorkspace.getSnapshot() === 'held') {
    lock.resolve()
    await vi.waitFor(() => expect(runtime.documentWorkspaceSignal.aborted).toBe(true))
  }
}
afterEach(async () => { await endDocument(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
async function admit(requiredOwners: string[] = []) {
  layout = await seedIsolatedWorkspace(requiredOwners)
  await runtime.documentWorkspace.acquire()
  expect(await runtime.workspaceAdmission.admit()).toBe('ready')
}
async function enter(owner = 'a') {
  users.setActiveSession(account(owner), { remember: false })
  expect(users.getKnownSessions().some(s => s.userId === owner)).toBe(false)
  await crypt.initCrypto(`synthetic-${owner}`)
  users.rememberSession(account(owner))
  await history.bootstrapConversationStorage()
}

describe('candidate isolated runtime, deliberately disabled in production', () => {
  it('the low-level salt writer intrinsically refuses pre-admission, foreign layout and foreign owner even with a noop caller guard', async () => {
    layout = await seedIsolatedWorkspace()
    const { provisionIsolatedSalt } = await import('../../services/workspaceWriter/cryptoProvisioning')
    const guard = { assertCurrent() {}, fence: 'initial', signal: new AbortController().signal }
    await expect(provisionIsolatedSalt(layout, 'a', guard)).rejects.toThrow('workspace_document_unavailable')
    await runtime.documentWorkspace.acquire()
    await expect(provisionIsolatedSalt(layout, 'a', guard)).rejects.toThrow('workspace_admission_unavailable')
    expect(await runtime.workspaceAdmission.admit()).toBe('ready')
    users.setActiveSession(account('a'), { remember: false })
    await expect(provisionIsolatedSalt(layout, 'a', guard)).rejects.toMatchObject({ name: 'LocalCryptoRecoveryRequired' })
    await expect(provisionIsolatedSalt(runtime.getDocumentStorageLayout() as IsolatedWorkspaceLayout, 'b', guard)).rejects.toMatchObject({ name: 'LocalCryptoRecoveryRequired' })
    expect(localStorage.getItem(key('a', 'crypto-salt'))).toBeNull()
    expect(localStorage.getItem(key('b', 'crypto-salt'))).toBeNull()
  })
  it.each(['google', 'email', 'apikey'] as const)('real fresh %s login provisions before trial/credentials and never writes legacy crypto/history', async method => {
    await admit()
    localStorage.setItem('arty-trial-remaining', '30')
    const { useAuth } = await import('../../hooks/useAuth'), hook = renderHook(() => useAuth())
    const finalizer = vi.fn(async (session: import('../../services/userSession').UserSession) => {
      expect(users.getKnownSessions()).toEqual([])
      expect(localStorage.getItem(key(session.userId, 'crypto-salt'))).not.toBeNull()
      expect(await crypt.selfTestCrypto()).toBe(true)
    })
    await act(async () => { await hook.result.current.login(method, {
      displayName: 'Synthetic', identifier: 'fresh@example.invalid', anthropicKey: 'synthetic',
    }, finalizer) })
    expect(finalizer).toHaveBeenCalledOnce()
    const owner = users.getActiveUserId()!
    expect(localStorage.getItem(`arty-${owner}-api-keys`)).not.toBeNull()
    expect(localStorage.getItem(`arty-${owner}-trial-remaining`)).toBe('30')
    expect(localStorage.getItem('arty-trial-remaining')).toBeNull()
    expect(Object.keys(localStorage).filter(k => /^arty-.*-(crypto-(salt|check|version)|conversations.*)$/.test(k))).toEqual([])
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each(['memory', 'custom-instructions', 'streak', 'reports', 'api-keys', 'google-tokens-enc', 'any-setting'])('a legacy %s key, even empty, refuses a new salt without mutation', async slot => {
    await admit(); users.setActiveSession(account('a'), { remember: false })
    localStorage.setItem(`arty-a-${slot}`, '')
    const before = localBytes()
    await expect(crypt.initCrypto('synthetic')).rejects.toMatchObject({ name: 'LocalCryptoRecoveryRequired' })
    expect(localBytes()).toEqual(before); expect(crypt.isCryptoReady()).toBe(false)
  })
  it.each([...HISTORY_SLOTS, 'crypto-check', 'crypto-version'] as const)('a remaining %s slot refuses a new salt without mutation', async slot => {
    await admit(); users.setActiveSession(account('a'), { remember: false })
    localStorage.setItem(key('a', slot), 'retained-bytes')
    const before = localBytes()
    await expect(crypt.initCrypto('synthetic')).rejects.toMatchObject({ name: 'LocalCryptoRecoveryRequired' })
    expect(localBytes()).toEqual(before)
  })
  it.each(['file', 'project', 'orphan-document', 'tombstone', 'usage', 'erasure'] as const)('a %s record alone is not a fresh account', async kind => {
    await admit(); users.setActiveSession(account('a'), { remember: false })
    const db = await openDB(kind === 'file' ? layout.files.name : layout.projects.name, 1)
    if (kind === 'file') await db.put('files', { fileId: 'f', ownerKey: 'arty-a', encryptedData: 'retained' })
    else if (kind === 'project') await db.put('projects', { key: ['a', 'p'], owner: 'a', state: 'deleted' })
    else if (kind === 'usage') await db.put('usage', { owner: 'a', projects: 0, documents: 0, sourceBytes: 0 })
    else if (kind === 'erasure') await db.put('meta', { serverConfirmed: true }, ['erasing', 'a'])
    else await db.put('documents', { key: ['a', 'p', 'd', kind], owner: 'a', state: kind === 'tombstone' ? 'deleted' : 'live' })
    db.close()
    const before = localBytes()
    await expect(crypt.initCrypto('synthetic')).rejects.toMatchObject({ name: 'LocalCryptoRecoveryRequired' })
    expect(localBytes()).toEqual(before)
  })
  it('an inventoried owner is never silently reprovisioned, including after incomplete erase', async () => {
    await admit(['a']); users.setActiveSession(account('a'), { remember: false })
    await expect(crypt.initCrypto('synthetic')).rejects.toMatchObject({ name: 'LocalCryptoRecoveryRequired' })
    expect(localStorage.getItem(key('a', 'crypto-salt'))).toBeNull()
  })
  it.each(['file', 'document', 'usage', 'erasure'])('a legacy-only %s with an incomplete source inventory cannot acquire a fresh key', async kind => {
    await admit(); users.setActiveSession(account('a'), { remember: false })
    const db = await openDB(kind === 'file' ? 'arty-files' : 'arty-projects', 2)
    if (kind === 'file') await db.put('files', { fileId: 'f', ownerKey: 'arty-a' })
    else if (kind === 'document') await db.put('documents', { key: ['a', 'p', 'd', 'tombstone'], owner: 'a', state: 'deleted' })
    else if (kind === 'usage') await db.put('usage', { owner: 'a', projects: 0, documents: 0, sourceBytes: 0 })
    else await db.put('meta', { serverConfirmed: true }, ['erasing', 'a'])
    db.close()
    await expect(crypt.initCrypto('synthetic')).rejects.toMatchObject({ name: 'LocalCryptoRecoveryRequired' })
    expect(localStorage.getItem(key('a', 'crypto-salt'))).toBeNull()
  })
  it('a real Google login refused before crypto preserves all old grants/profile bytes and does not adopt trial state', async () => {
    await admit()
    localStorage.setItem('arty-trial-remaining', '30')
    const owner = await users.generateUserId('google', 'existing@example.invalid')
    for (const slot of ['google-tokens', 'google-tokens-enc', 'google-user', 'google-user-enc']) localStorage.setItem(`arty-${owner}-${slot}`, `old-${slot}`)
    const before = localBytes(), { useAuth } = await import('../../hooks/useAuth'), hook = renderHook(() => useAuth())
    await act(async () => { await expect(hook.result.current.login('google', {
      displayName: 'Existing', identifier: 'existing@example.invalid', anthropicKey: 'synthetic',
    })).rejects.toMatchObject({ name: 'LocalCryptoRecoveryRequired' }) })
    expect(localBytes()).toEqual(before); expect(users.getActiveSession()).toBeNull(); expect(fetch).not.toHaveBeenCalled()
  })
  it('reuses an isolated salt without borrowing global salt/check/version, preserving missing check as unverified', async () => {
    await admit(['a']); users.setActiveSession(account('a'), { remember: false })
    localStorage.setItem(key('a', 'crypto-salt'), JSON.stringify(Array(16).fill(7)))
    localStorage.setItem('arty-crypto-salt', JSON.stringify(Array(16).fill(8)))
    localStorage.setItem('arty-crypto-check', 'global-marker'); localStorage.setItem('arty-crypto-version', 'v2')
    localStorage.setItem('arty-a-google-tokens-enc', 'unreadable-existing-grant')
    const before = localBytes()
    await crypt.initCrypto('synthetic')
    expect(await crypt.selfTestCrypto()).toBe(false)
    const { bootstrapGoogleStorage } = await import('../../services/googleAuth')
    await bootstrapGoogleStorage()
    expect(localBytes()).toEqual(before)
  })
  it('cold useAuth refusal leaves legacy global reports and the stored identity untouched', async () => {
    await admit(['a']); users.setActiveSession(account('a'))
    localStorage.setItem('arty-trial-remaining', '30')
    localStorage.setItem('arty-a-api-keys', JSON.stringify({ anthropic: 'synthetic' }))
    localStorage.setItem('arty-report-legacy123', 'private-legacy-report')
    const before = localBytes(), error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { useAuth } = await import('../../hooks/useAuth')
    renderHook(() => useAuth())
    await vi.waitFor(() => expect(error).toHaveBeenCalled())
    expect(localBytes()).toEqual(before); expect(fetch).not.toHaveBeenCalled()
  })
  it('real useAuth A-B-A and logout/relogin preserve A history and its salt without giving it to B', async () => {
    await admit()
    const { useAuth } = await import('../../hooks/useAuth'), hook = renderHook(() => useAuth())
    const credentials = { displayName: 'A', identifier: 'synthetic-a', anthropicKey: 'synthetic-a' }
    await act(async () => { await hook.result.current.login('apikey', credentials) })
    const a = users.getActiveUserId()!, salt = localStorage.getItem(key(a, 'crypto-salt'))
    const conversation = { id: 'c', title: 'A', messages: [], createdAt: 1, updatedAt: 1 }
    history.saveConversation(conversation)
    await vi.waitFor(() => expect(localStorage.getItem(key(a, 'conversations'))).toBeNull())
    await enter('b')
    localStorage.setItem('arty-b-api-keys', JSON.stringify({ anthropic: 'synthetic-b' }))
    users.setActiveSession(account(a)); await crypt.initCrypto('synthetic-a')
    await act(async () => { await hook.result.current.switchAccount('b') })
    expect(history.getConversations()).toEqual([])
    await act(async () => { await hook.result.current.switchAccount(a) })
    expect(history.getConversation('c')).toEqual(conversation)
    act(() => { hook.result.current.logout() })
    expect(localStorage.getItem(`arty-${a}-api-keys`)).toBeNull()
    expect(localStorage.getItem(key(a, 'crypto-salt'))).toBe(salt)
    await act(async () => { await hook.result.current.login('apikey', credentials) })
    expect(history.getConversation('c')).toEqual(conversation)
    expect(localStorage.getItem(key(a, 'crypto-salt'))).toBe(salt)
  })
  it('a failed commit retains the sole salt, and retry reuses it without fabricating a historical check', async () => {
    await admit(); users.setActiveSession(account('a'), { remember: false })
    await expect(crypt.initCrypto('synthetic', { commit() { throw new Error('quota') } })).rejects.toThrow('quota')
    const salt = localStorage.getItem(key('a', 'crypto-salt'))
    expect(salt).not.toBeNull(); expect(localStorage.getItem(key('a', 'crypto-check'))).toBeNull()
    await crypt.initCrypto('synthetic')
    expect(localStorage.getItem(key('a', 'crypto-salt'))).toBe(salt)
    expect(await crypt.selfTestCrypto()).toBe(false)
  })

  it.each(['files', 'projects'] as const)('never recreates a declared %s DB deleted after admission or after cached use', async family => {
    await admit(); await enter()
    if (family === 'files') await files.putFile({ id: 'f', name: 'a.txt', type: 'text/plain', data: 'QQ==' })
    else await projects.createProject(await projects.beginProjectOperation(), 'A')
    await deleteDB(layout[family].name)
    if (family === 'files') await expect(files.getFile('f')).rejects.toThrow('workspace_declared_database_missing')
    else await expect(projects.beginProjectOperation()).rejects.toThrow('workspace_declared_database_missing')
    expect((await indexedDB.databases()).some(d => d.name === layout[family].name)).toBe(false)
  })

  it.each(['local-write', 'switch', 'loss', 'fence', 'erasure', 'timeout'] as const)('retires a real queued provisioning probe on %s with zero late salt writes', async reason => {
    await admit(); users.setActiveSession(account('a'), { remember: false })
    const db = await openDB(layout.projects.name, 1), tx = db.transaction(['projects', 'documents', 'usage', 'meta'], 'readwrite')
    const started = deferred(); let keepAlive = true
    const pump = () => { void tx.objectStore('meta').get('hold').then(() => { started.resolve(); if (keepAlive) pump() }) }
    pump(); await started.promise
    const transaction = vi.spyOn(IDBDatabase.prototype, 'transaction')
    const realTimeout = setTimeout; let expire!: () => void
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((callback: TimerHandler, ms?: number, ...args: unknown[]) => {
      if (ms === 8_000) expire = callback as () => void
      return realTimeout(callback, ms, ...args)
    }) as typeof setTimeout)
    const pending = crypt.initCrypto('synthetic').catch(error => error)
    await vi.waitFor(() => expect(transaction.mock.calls.some(call => call[1] === 'readonly' && Array.isArray(call[0]) && call[0].includes('projects'))).toBe(true))
    if (reason === 'local-write') localStorage.setItem('arty-a-memory', 'new-settings-during-probe')
    if (reason === 'switch') users.setActiveSession(account('b'), { remember: false })
    if (reason === 'loss') { lock.reject(new Error('lost')); await vi.waitFor(() => expect(runtime.documentWorkspaceSignal.aborted).toBe(true)) }
    if (reason === 'fence') localStorage.setItem('arty-project-erasure-fence', 'changed')
    if (reason === 'erasure') await tx.objectStore('meta').put({ serverConfirmed: true }, ['erasing', 'a'])
    if (reason === 'timeout') { expire(); expect(await pending).toBeInstanceOf(Error) }
    keepAlive = false; await tx.done
    expect(await pending).toBeInstanceOf(Error)
    expect(localStorage.getItem(key('a', 'crypto-salt'))).toBeNull()
    expect(localStorage.getItem(key('b', 'crypto-salt'))).toBeNull()
    db.close()
  })

  it.each(['missing-files', 'missing-projects', 'denied', 'bad-fence'] as const)('a %s probe is not an empty owner', async reason => {
    await admit(); users.setActiveSession(account('a'), { remember: false })
    if (reason === 'missing-files') await deleteDB(layout.files.name)
    if (reason === 'missing-projects') await deleteDB(layout.projects.name)
    if (reason === 'denied') vi.spyOn(indexedDB, 'open').mockImplementation(() => { throw new DOMException('denied', 'SecurityError') })
    if (reason === 'bad-fence') { const db = await openDB(layout.projects.name, 1); await db.put('meta', null, 'erasure-fence'); db.close() }
    await expect(crypt.initCrypto('synthetic')).rejects.toHaveProperty('name')
    expect(localStorage.getItem(key('a', 'crypto-salt'))).toBeNull()
  })

  it('erasure starting after the last readonly transaction invalidates the proof even if its RAM block is already released', async () => {
    await admit(); users.setActiveSession(account('a'), { remember: false })
    const realClose = IDBDatabase.prototype.close; let erased = false
    vi.spyOn(IDBDatabase.prototype, 'close').mockImplementation(function() {
      realClose.call(this)
      if (this.name === layout.projects.name && !erased) {
        erased = true; const release = projects.blockProjectOperations('a'); release()
      }
    })
    await expect(crypt.initCrypto('synthetic')).rejects.toMatchObject({ code: 'cancelled' })
    expect(erased).toBe(true); expect(localStorage.getItem(key('a', 'crypto-salt'))).toBeNull()
  })
  it('erasure during derivation permits no check/version/credential publication from the older attempt', async () => {
    await admit(); users.setActiveSession(account('a'), { remember: false })
    const real = crypto.subtle.deriveKey.bind(crypto.subtle), commit = vi.fn(); let erased = false
    vi.spyOn(crypto.subtle, 'deriveKey').mockImplementation(async (...args) => {
      const result = await real(...args)
      if (!erased) { erased = true; projects.blockProjectOperations('a')() }
      return result
    })
    await expect(crypt.initCrypto('synthetic', { commit })).rejects.toMatchObject({ code: 'cancelled' })
    expect(commit).not.toHaveBeenCalled(); expect(crypt.isCryptoReady()).toBe(false)
    expect(localStorage.getItem(key('a', 'crypto-check'))).toBeNull()
    expect(localStorage.getItem(key('a', 'crypto-version'))).toBeNull()
  })
  it('an already-held erasure block refuses initialization before mutating the existing crypto context', async () => {
    await admit(); await enter()
    const current = crypt.captureCryptoGuard(), before = localBytes(), commit = vi.fn()
    const release = projects.blockProjectOperations('a')
    await expect(crypt.initCrypto('replacement', { commit })).rejects.toMatchObject({ code: 'unavailable' })
    expect(current()).toBe(true); expect(crypt.isCryptoReady()).toBe(true)
    expect(localBytes()).toEqual(before); expect(commit).not.toHaveBeenCalled()
    release(); expect(current()).toBe(true)
  })
  it('a refused post-open handoff closes its already-open connection', async () => {
    await admit()
    const { openDeclaredDatabase } = await import('../../services/workspaceWriter/declaredDatabase')
    const actual = runtime.assertDocumentWorkspace; let checks = 0
    const spy = vi.spyOn(runtime, 'assertDocumentWorkspace').mockImplementation(() => {
      actual(); if (++checks === 4) throw new Error('handoff refused')
    })
    const close = vi.spyOn(IDBDatabase.prototype, 'close')
    await expect(openDeclaredDatabase(layout.files, () => {})).rejects.toThrow('handoff refused')
    expect(close).toHaveBeenCalledOnce(); spy.mockRestore()
    await deleteDB(layout.files.name)
  })

  it('active-generation account erasure removes A, preserves B, and allows a never-inventoried A to log in again', async () => {
    await admit(); await enter('b')
    await files.putFile({ id: 'b-file', name: 'b.txt', type: 'text/plain', data: 'Qg==' })
    await projects.createProject(await projects.beginProjectOperation(), 'B')
    const bSalt = localStorage.getItem(key('b', 'crypto-salt'))
    await enter('a')
    await files.putFile({ id: 'a-file', name: 'a.txt', type: 'text/plain', data: 'QQ==' })
    await projects.createProject(await projects.beginProjectOperation(), 'A')
    for (const slot of HISTORY_SLOTS) localStorage.setItem(key('a', slot), 'a-bytes')
    const { wipeLocalAccount } = await import('../../services/accountService')
    await wipeLocalAccount()
    for (const slot of [...HISTORY_SLOTS, 'crypto-salt', 'crypto-check', 'crypto-version'] as const) expect(localStorage.getItem(key('a', slot))).toBeNull()
    expect(localStorage.getItem(key('b', 'crypto-salt'))).toBe(bSalt)
    const db = await openDB(layout.projects.name, 1), fdb = await openDB(layout.files.name, 1)
    expect(await db.countFromIndex('projects', 'owner', 'a')).toBe(0)
    expect(await db.countFromIndex('projects', 'owner', 'b')).toBe(1)
    expect(await db.get('meta', ['erasing', 'a'])).toBeUndefined()
    expect(await fdb.get('files', 'a-file')).toBeUndefined(); expect(await fdb.get('files', 'b-file')).toBeDefined()
    db.close(); fdb.close()
    await enter('a'); expect(await crypt.selfTestCrypto()).toBe(true)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('real CRUD/capture, A-B-A, cold reload and BYOK recovery use only isolated workspace slots', async () => {
    await admit(); await enter('a')
    const old = await openDB('arty-files', 2)
    await old.put('files', { fileId: 'legacy', ownerKey: 'arty-a', encryptedData: 'old-bytes' }); old.close()
    localStorage.setItem('arty-a-conversations-enc', 'untouched-old-history')
    await files.putFile({ id: 'f', name: 'saved.txt', type: 'text/plain', size: 1, data: 'QQ==' })
    const op = await projects.beginProjectOperation(), { prepareProjectDocument } = await import('../../services/projects/documentImport')
    let p = await projects.createProject(op, 'Isolated project')
    p = await projects.addProjectDocument(op, p, await prepareProjectDocument(op, new NodeFile(['Exact source'], 'a.txt', { type: 'text/plain' }) as unknown as File))
    const source = { id: 'c', title: 'Isolated history', createdAt: 1, updatedAt: 1, projectId: p.id, hasProjectContext: true,
      messages: [{ id: 'm', role: 'user' as const, content: 'Hello', timestamp: 1, files: [{ id: 'f', name: 'saved.txt', type: 'text/plain', size: 1 }] }] }
    history.saveConversation(source)
    await vi.waitFor(() => expect(localStorage.getItem(key('a', 'conversations'))).toBeNull())
    const { prepareConversationArchive } = await import('../../services/workspaceBackup/capture')
    const prepared = await prepareConversationArchive('c', { includeProject: true, isBusy: () => false, signal: new AbortController().signal })
    expect(prepared.report).toMatchObject({ conversations: 1, files: 1, projects: 1, documents: 1 })
    expect((await prepared.verify(prepared.archive, prepared.recoveryCode)).fingerprint).toBe(prepared.report.fingerprint)
    prepared.dispose()
    await enter('b'); expect(history.getConversations()).toEqual([]); expect(await files.getFile('f')).toBeNull()
    users.setActiveSession(account('a')); await crypt.initCrypto('synthetic-a'); await history.bootstrapConversationStorage()
    expect(history.getConversation('c')).toEqual(source); expect((await files.getFile('f'))?.data).toBe('QQ==')
    await crypt.initCrypto('wrong-key'); expect(await crypt.selfTestCrypto()).toBe(false)
    await history.bootstrapConversationStorage()
    expect(localStorage.getItem(key('a', 'conversations-enc-locked'))).not.toBeNull()
    await crypt.initCrypto('synthetic-a'); await history.bootstrapConversationStorage()
    expect(history.getConversation('c')).toEqual(source)
    expect(localStorage.getItem('arty-a-conversations-enc')).toBe('untouched-old-history')
    // A fresh document, not just a reset history cache. Real persisted fixture.
    await endDocument(); lock = deferred(); vi.resetModules()
    runtime = await import('../../services/workspaceWriter/runtime')
    await runtime.documentWorkspace.acquire(); expect(await runtime.workspaceAdmission.admit()).toBe('ready')
    users = await import('../../services/userSession'); crypt = await import('../../services/crypto')
    history = await import('../../services/storage'); files = await import('../../services/secureFileStorage')
    await crypt.initCrypto('synthetic-a'); await history.bootstrapConversationStorage()
    expect(history.getConversation('c')).toEqual(source); expect((await files.getFile('f'))?.data).toBe('QQ==')
    history.deleteConversation('c'); expect(history.getConversations()).toEqual([])
    await vi.waitFor(() => expect(localStorage.getItem(key('a', 'conversations'))).toBeNull())
    expect(localStorage.getItem('arty-a-conversations-enc')).toBe('untouched-old-history')
    expect(fetch).not.toHaveBeenCalled()
  })
})
