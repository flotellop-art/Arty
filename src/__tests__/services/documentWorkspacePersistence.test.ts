import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { openDB } from 'idb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
afterEach(() => { vi.restoreAllMocks(); localStorage.clear() })

async function enter() { await runtime.documentWorkspace.acquire(); users.setActiveSession(session()); await c.initCrypto('synthetic-document-key') }
async function lose() {
  request.reject(new Error('exceptional loss'))
  await vi.waitFor(() => expect(runtime.documentWorkspaceSignal.aborted).toBe(true))
}
const conversation = { id: 'synthetic-conversation', title: 'Synthetic history', createdAt: 1, updatedAt: 1, messages: [] }

describe('real document boundary with real crypto and IDB transactions', () => {
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
    await runtime.documentWorkspace.acquire(); users.setActiveSession(session())
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
