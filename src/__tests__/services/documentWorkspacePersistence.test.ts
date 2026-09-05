import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { openDB } from 'idb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { deferred } from '../helpers/workspaceLocks'

// This suite intentionally DOES NOT use the setup's admitted-document fixture.
vi.unmock('../../services/workspaceWriter/runtime')
vi.mock('../../services/apiBase', () => ({ apiUrl: (path: string) => path }))
const session = (userId = 'a') => ({ userId, authMethod: 'apikey' as const, displayName: userId, createdAt: 1 })
let runtime: typeof import('../../services/workspaceWriter/runtime')
let users: typeof import('../../services/userSession')
let c: typeof import('../../services/crypto')
let storage: typeof import('../../services/storage')
let files: typeof import('../../services/secureFileStorage')
let projects: typeof import('../../services/projects/store')
let request: ReturnType<typeof deferred>

beforeEach(async () => {
  vi.restoreAllMocks(); vi.resetModules(); localStorage.clear()
  globalThis.indexedDB = new IDBFactory(); request = deferred()
  Object.defineProperty(navigator, 'locks', { configurable: true, value: {
    request(_name: string, _options: unknown, callback: (lock: unknown) => Promise<void>) { void callback({}); return request.promise },
  } })
  runtime = await import('../../services/workspaceWriter/runtime')
  users = await import('../../services/userSession'); c = await import('../../services/crypto')
  storage = await import('../../services/storage'); files = await import('../../services/secureFileStorage')
  projects = await import('../../services/projects/store')
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear() })

async function admit() { await runtime.documentWorkspace.acquire(); expect(await runtime.workspaceAdmission.admit()).toBe('ready') }
async function enter() { await admit(); users.setActiveSession(session()); await c.initCrypto('synthetic-document-key') }
async function lose() {
  request.reject(new Error('exceptional loss'))
  await vi.waitFor(() => expect(runtime.documentWorkspaceSignal.aborted).toBe(true))
}
const conversation = { id: 'synthetic-conversation', title: 'Synthetic history', createdAt: 1, updatedAt: 1, messages: [] }

async function expectPrivateReadsRefused(message: string) {
  const scoped = await import('../../services/scopedStorage')
  const read = vi.spyOn(Storage.prototype, 'getItem'), write = vi.spyOn(Storage.prototype, 'setItem')
  const opening = vi.spyOn(indexedDB, 'open')
  for (const get of [users.getActiveSession, users.getKnownSessions, users.getActiveUserId,
    storage.getConversations, storage.isCacheReady, () => scoped.getItem('api-keys'),
    () => scoped.getJSON('api-keys'), () => scoped.getJSONForUser('a', 'api-keys'),
    () => runtime.documentStorageKey('a', 'api-keys'), runtime.getDocumentStorageLayout,
  ]) expect(get).toThrow(message)
  await expect(scoped.secureGetJSON('api-keys')).rejects.toThrow(message)
  await expect(c.secureGet('arty-a-conversations-enc')).rejects.toThrow(message)
  await expect(c.verifyCrypto('synthetic')).rejects.toThrow(message)
  await expect(files.getFile('synthetic')).rejects.toThrow(message)
  await expect(files.getFile('synthetic', 'a')).rejects.toThrow(message)
  await expect(projects.beginProjectOperation()).rejects.toThrow(message)
  expect(read).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled(); expect(opening).not.toHaveBeenCalled()
  read.mockRestore(); write.mockRestore(); opening.mockRestore()
}

describe('real document boundary with real crypto and IDB transactions', () => {
  it('held lock alone does not permit private reads or crypto initialization before storage admission', async () => {
    await runtime.documentWorkspace.acquire()
    await expectPrivateReadsRefused('workspace_admission_unavailable')
    expect(() => c.initCrypto('must-not-create-salt')).toThrow('workspace_admission_unavailable')
    expect(localStorage.length).toBe(0); expect(await indexedDB.databases()).toEqual([])
  })

  it('corrupt control stays closed even if a caller directly mounts useAuth, before allSettled bootstraps', async () => {
    const db = await openDB('arty-workspace-control', 1, { upgrade(db) { db.createObjectStore('meta') } }); db.close()
    await runtime.documentWorkspace.acquire()
    expect(await runtime.workspaceAdmission.admit()).toBe('corrupt')
    await expectPrivateReadsRefused('workspace_admission_unavailable')
    const { useAuth } = await import('../../hooks/useAuth')
    const read = vi.spyOn(Storage.prototype, 'getItem'), write = vi.spyOn(Storage.prototype, 'setItem')
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => renderHook(() => useAuth())).toThrow('workspace_admission_unavailable')
    expect(read).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled()
    expect(await runtime.workspaceAdmission.admit()).toBe('corrupt')
    expect(await indexedDB.databases()).toEqual([{ name: 'arty-workspace-control', version: 1 }])
  })

  it('admits schemas created by the real file/project writers without reading their account records', async () => {
    await enter()
    await files.putFile({ name: 'note.txt', type: 'text/plain', size: 1, data: 'YQ==' })
    await projects.createProject(await projects.beginProjectOperation(), 'Synthetic project')
    const { readWorkspaceStorageLayout } = await import('../../services/workspaceWriter/control')
    const read = vi.spyOn(IDBObjectStore.prototype, 'get'), all = vi.spyOn(IDBObjectStore.prototype, 'getAll')
    expect(await readWorkspaceStorageLayout({ assertLock: () => runtime.documentWorkspace.assertHeld(), signal: runtime.documentWorkspaceSignal })).toEqual(runtime.getDocumentStorageLayout())
    expect(read).not.toHaveBeenCalled(); expect(all).not.toHaveBeenCalled()
  })

  it('real provisional login, A-B-A switch and BYOK resume keep one admitted layout and existing data', async () => {
    await admit()
    const layout = runtime.getDocumentStorageLayout(), { useAuth } = await import('../../hooks/useAuth')
    const scoped = await import('../../services/scopedStorage'), { resumePendingLocalStorage } = await import('../../services/resumeLocalStorage')
    const { getAnthropicKey, setActiveKeys } = await import('../../services/activeApiKey')
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
    const view = renderHook(() => useAuth())
    const credentials = { displayName: 'Synthetic A', anthropicKey: 'synthetic-a', identifier: 'synthetic-a' }
    const finalizer = vi.fn(async (account: import('../../services/userSession').UserSession) => {
      expect(users.getActiveUserId()).toBe(account.userId)
      expect(users.getKnownSessions()).toEqual([])
      expect(localStorage.getItem('arty-active-session')).toBeNull()
      runtime.assertDocumentWorkspace()
    })
    await act(async () => { await view.result.current.login('apikey', credentials, finalizer) })
    expect(finalizer).toHaveBeenCalledOnce()
    const owner = view.result.current.currentUser!.userId
    storage.saveConversation(conversation)
    const fileId = await files.putFile({ name: 'note.txt', type: 'text/plain', size: 1, data: 'YQ==' })
    // A remembered second identity, with its own synthetic credentials.
    users.rememberSession(session('b')); localStorage.setItem('arty-b-api-keys', JSON.stringify({ anthropic: 'synthetic-b' }))
    await act(async () => { await view.result.current.switchAccount('b') })
    expect(storage.getConversation(conversation.id)).toBeNull(); expect(await files.getFile(fileId)).toBeNull()
    await act(async () => { await view.result.current.switchAccount(owner) })
    expect(storage.getConversation(conversation.id)?.title).toBe(conversation.title)
    expect((await files.getFile(fileId))?.data).toBe('YQ==')
    // Same commit + resume path as ApiKeysModal, with a real KDF and stores.
    await c.initCrypto('synthetic-new-key', { commit: () => {
      scoped.setJSON('api-keys', { anthropic: 'synthetic-new-key' }); setActiveKeys('synthetic-new-key')
    } })
    expect(await resumePendingLocalStorage()).toBe(true)
    expect(getAnthropicKey()).toBe('synthetic-new-key')
    expect(scoped.getJSON('api-keys')).toEqual({ anthropic: 'synthetic-new-key' })
    expect(runtime.getDocumentStorageLayout()).toBe(layout)
    expect(fetch).not.toHaveBeenCalled()
    view.unmount()
  })

  it('before acquisition cannot initialize identity, crypto, history or file/project stores', async () => {
    expect(() => users.setActiveSession(session())).toThrow('workspace_document_unavailable')
    expect(() => c.initCrypto('no-salt-created')).toThrow('workspace_document_unavailable')
    expect(() => storage.saveConversation(conversation)).toThrow('workspace_document_unavailable')
    await expect(files.bootstrapFileStorage()).rejects.toThrow('workspace_document_unavailable')
    await expect(files.deleteOwnedFiles(['anything'], 'a')).rejects.toThrow('workspace_document_unavailable')
    await expect(projects.beginProjectErasure('a', () => {})).rejects.toThrow('workspace_document_unavailable')
    expect(localStorage.length).toBe(0)
    expect(await indexedDB.databases()).toEqual([])
  })

  it('held document supports history, files, projects and account/key changes without giving up the lock', async () => {
    await enter(); await storage.bootstrapConversationStorage(); storage.saveConversation(conversation)
    expect(storage.getConversation(conversation.id)?.title).toBe(conversation.title)
    const id = await files.putFile({ name: 'note.txt', type: 'text/plain', size: 1, data: 'YQ==' })
    expect((await files.getFile(id))?.data).toBe('YQ==')
    const operation = await projects.beginProjectOperation(), project = await projects.createProject(operation, 'Synthetic project')
    expect((await projects.getProject(operation, project.id))?.status).toBe('ready')
    users.setActiveSession(session('b')); await c.initCrypto('synthetic-b')
    users.clearActiveSession(); users.setActiveSession(session('a')); await c.initCrypto('synthetic-document-key')
    runtime.assertDocumentWorkspace(); expect((await files.getFile(id))?.data).toBe('YQ==')
  })

  it('lost token prevents scoped credentials, migrations, history and destructive APIs', async () => {
    await enter(); await storage.bootstrapConversationStorage(); storage.saveConversation(conversation)
    const before = { ...localStorage }
    await lose()
    await expectPrivateReadsRefused('workspace_document_unavailable')
    const scoped = await import('../../services/scopedStorage')
    for (const mutation of [
      () => storage.saveConversation({ ...conversation, title: 'late' }), () => storage.deleteConversation(conversation.id),
      () => users.migrateExistingData('a'), () => users.clearActiveSession(),
      () => scoped.setItem('api-keys', 'late'), () => scoped.clearAllForActiveUser(),
    ]) expect(mutation).toThrow('workspace_document_unavailable')
    await expect(files.wipeFileStorage('a')).rejects.toThrow('workspace_document_unavailable')
    await expect(projects.beginProjectErasure('a', () => {})).rejects.toThrow('workspace_document_unavailable')
    expect({ ...localStorage }).toEqual(before)
    expect(await runtime.documentWorkspace.acquire()).toBe('lost')
  })

  it('late real encryption cannot publish its ciphertext or discard the plain safety net after loss', async () => {
    await enter(); await storage.bootstrapConversationStorage()
    const gate = deferred(), completed = deferred(), real = crypto.subtle.encrypt.bind(crypto.subtle)
    const encrypt = vi.spyOn(crypto.subtle, 'encrypt').mockImplementationOnce(async (...args) => { const result = await real(...args); await gate.promise; completed.resolve(); return result })
    storage.saveConversation(conversation)
    await vi.waitFor(() => expect(encrypt).toHaveBeenCalled())
    const plain = localStorage.getItem('arty-a-conversations')
    await lose(); gate.resolve()
    await completed.promise
    // Allow encrypt()'s post-await guard and persistEncrypted()'s catch to run.
    for (let i = 0; i < 5; i++) await Promise.resolve()
    expect(localStorage.getItem('arty-a-conversations')).toBe(plain)
    expect(localStorage.getItem('arty-a-conversations-enc')).toBeNull()
  })

  it('real pending derivation cannot publish crypto markers or execute a credential commit after loss', async () => {
    await admit(); users.setActiveSession(session())
    const gate = deferred(), real = crypto.subtle.deriveKey.bind(crypto.subtle), commit = vi.fn()
    const derive = vi.spyOn(crypto.subtle, 'deriveKey').mockImplementationOnce(async (...args) => { const key = await real(...args); await gate.promise; return key })
    const initializing = c.initCrypto('synthetic', { commit }).catch(error => error)
    await vi.waitFor(() => expect(derive).toHaveBeenCalled()); await lose(); gate.resolve()
    expect(await initializing).toBeInstanceOf(c.CryptoContextChanged)
    expect(commit).not.toHaveBeenCalled(); expect(c.isCryptoReady()).toBe(false)
    expect(localStorage.getItem('arty-a-crypto-check')).toBeNull()
  })

  it('abort signal rolls back an admitted IDB transaction rather than leaving its queued put live', async () => {
    await enter()
    const db = await openDB('synthetic-transaction', 1, { upgrade(database) { database.createObjectStore('records') } })
    const tx = runtime.guardDocumentTransaction(db.transaction('records', 'readwrite'))
    const writing = tx.store.put('must-not-commit', 'key').catch(error => error)
    const done = tx.done.catch(error => error)
    request.reject(new Error('lost'))
    await done; await writing
    expect(runtime.documentWorkspaceSignal.aborted).toBe(true)
    expect(await db.get('records', 'key')).toBeUndefined(); db.close()
  })

  it('account-erasure sequence keeps authority despite intentional epoch and known-session removal', async () => {
    await enter()
    await files.putFile({ id: 'synthetic-erased-file', name: 'erase.txt', type: 'text/plain', size: 1, data: 'YQ==' })
    const owner = 'a', erasure = await projects.beginProjectErasure(owner, () => {}, true)
    users.invalidateActiveSessionWork(); users.removeKnownSession(owner)
    await projects.purgeProjectsForAccount(owner, () => {}); await files.wipeFileStorage(owner)
    await projects.finishProjectErasure(erasure); users.clearActiveSession()
    runtime.assertDocumentWorkspace()
    const db = await openDB('arty-files', 1)
    expect(await db.getAll('files')).toEqual([]); db.close()
  })
})
