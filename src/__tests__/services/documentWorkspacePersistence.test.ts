import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { openDB } from 'idb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
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
  it('Upgrade does not publish or reject a pending credit action after real document loss before unmount', async () => {
    await enter()
    const google = await import('../../services/googleAuth'), checkout = await import('../../services/checkout')
    const { UpgradeScreen } = await import('../../screens/upgrade'), { MemoryRouter } = await import('react-router-dom')
    const { createElement } = await import('react'), { default: i18n } = await import('../../i18n')
    await google.storeUser({ email: 'synthetic@example.invalid', name: 'Synthetic', picture: '' })
    await google.storeMailboxFreeGrant({ access_token: 'synthetic-access', refresh_token: 'synthetic-refresh', expires_at: Date.now() + 3600_000 },
      undefined, { verifiedEmail: 'synthetic@example.invalid' })
    const value = { hasWallet: true, availableMicro: 900000, balanceMicro: 900000, reservedMicro: 0 }
    const fetch = vi.fn(async (url: string) => Response.json(url === '/api/wallet/balance' ? value : {
      auth: 'ok', plan: 'vip', allowed_families: ['claude-haiku'], locked_families: [], daily_remaining: null, daily_limits: null,
    })); vi.stubGlobal('fetch', fetch)
    const opened = vi.spyOn(checkout, 'openCreemCheckout'), gate = deferred<Response>()
    const mounted = render(createElement(MemoryRouter, null, createElement(UpgradeScreen, { currentPlan: 'unknown', onBack() {} })))
    await vi.waitFor(() => expect(screen.getByTestId('verified-offer-access')).toBeInTheDocument())
    fetch.mockImplementationOnce(() => gate.promise)
    fireEvent.click(screen.getByRole('button', { name: i18n.t('upgrade.creditsCta') }))
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3))
    await lose()
    const read = vi.spyOn(Storage.prototype, 'getItem'), write = vi.spyOn(Storage.prototype, 'setItem')
    await act(async () => { gate.resolve(Response.json(value)); await gate.promise })
    expect(opened).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled()
    mounted.unmount()
  })
  it.each(['http', 'json'])('billing fails closed on actual document loss during wallet %s, without late storage access', async phase => {
    await enter()
    const google = await import('../../services/googleAuth'), billing = await import('../../services/billingContext')
    const wallet = await import('../../services/walletClient')
    await google.storeUser({ email: 'synthetic@example.invalid', name: 'Synthetic', picture: '' })
    await google.storeMailboxFreeGrant({ access_token: 'synthetic-access', refresh_token: 'synthetic-refresh', expires_at: Date.now() + 3600_000 },
      undefined, { verifiedEmail: 'synthetic@example.invalid' })
    const context = billing.captureBillingContext(), response = deferred<Response>(), body = deferred<unknown>()
    const json = vi.fn(() => body.promise), fetch = vi.fn(() => phase === 'http' ? response.promise : Promise.resolve({ ok: true, json } as unknown as Response))
    vi.stubGlobal('fetch', fetch)
    const pending = wallet.fetchWalletBalance()
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    if (phase === 'json') await vi.waitFor(() => expect(json).toHaveBeenCalledOnce())
    await lose()
    const read = vi.spyOn(Storage.prototype, 'getItem'), write = vi.spyOn(Storage.prototype, 'setItem')
    const value = { hasWallet: true, availableMicro: 900000, balanceMicro: 900000, reservedMicro: 0 }
    response.resolve(Response.json(value)); body.resolve(value)
    await expect(pending).resolves.toBeNull()
    expect(context.isCurrent()).toBe(false)
    expect(billing.captureBillingContext().isCurrent()).toBe(false)
    await expect(context.getAccessToken()).resolves.toBeNull()
    await expect(wallet.fetchWalletBalance()).resolves.toBeNull()
    expect(read).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled(); expect(fetch).toHaveBeenCalledOnce()
  })
  it.each(['before', 'after'])('fences Calendar on real document loss %s dispatch', async phase => {
    await enter()
    const google = await import('../../services/googleAuth'), calendar = await import('../../services/calendarClient')
    await google.storeUser({ email: 'synthetic@example.invalid', name: 'Synthetic', picture: '' })
    await google.storeMailboxFreeGrant({ access_token: 'synthetic-access', refresh_token: 'synthetic-refresh', expires_at: Date.now() + 3600_000 }, undefined, { verifiedEmail: 'synthetic@example.invalid' })
    const prepared = calendar.prepareCalendarMutation(calendar.captureCalendarContext(), 'delete', {}, 'synthetic-event')
    const response = deferred<Response>(), fetcher = vi.fn(() => response.promise); vi.stubGlobal('fetch', fetcher)
    if (phase === 'before') {
      await lose()
      const read = vi.spyOn(Storage.prototype, 'getItem')
      await expect(prepared.execute()).rejects.toMatchObject({ outcome: 'not-sent' })
      expect(fetcher).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled()
    } else {
      const outcome = prepared.execute().catch(error => error)
      await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce())
      await lose()
      expect((await outcome).outcome).toBe('unknown')
      response.resolve(Response.json({ success: true }))
      await expect(prepared.execute()).rejects.toMatchObject({ outcome: 'unknown' })
      expect(fetcher).toHaveBeenCalledOnce()
    }
  })

  it('refreshes an expired Google grant after erasure admission and completes the authorized synthetic erasure', async () => {
    await admit()
    users.setActiveSession({ ...session(), authMethod: 'google', email: 'synthetic@example.invalid' })
    await c.initCrypto('synthetic-document-key')
    const google = await import('../../services/googleAuth'), account = await import('../../services/accountService')
    await google.storeUser({ email: 'synthetic@example.invalid', name: 'Synthetic', picture: '' })
    await google.storeMailboxFreeGrant({ access_token: 'expired-synthetic', refresh_token: 'synthetic-refresh', expires_at: Date.now() - 1 },
      undefined, { verifiedEmail: 'synthetic@example.invalid' })
    const fetch = vi.fn(async (url: string, init: RequestInit) => {
      if (url === '/api/auth/refresh') {
        expect(await account.getAccountErasureState()).toBe('not-sent')
        return Response.json({ access_token: 'refreshed-synthetic', expires_in: 3600, oauth_profile: google.CURRENT_GOOGLE_OAUTH_PROFILE })
      }
      expect(url).toBe('/api/account/erasure-v1')
      const headers = new Headers(init.headers)
      expect(headers.get('x-google-token')).toBe('refreshed-synthetic')
      return Response.json({ protocol: 1, status: 'confirmed', operationId: headers.get('x-arty-erasure-operation'),
        subjectHash: headers.get('x-arty-erasure-subject') })
    })
    vi.stubGlobal('fetch', fetch)
    await expect(account.deleteAccount()).resolves.toBe('complete')
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(users.getActiveUserId()).toBeNull()
    expect(google.captureGoogleGrant()).toBeNull()
  })

  it('returns null for Google authentication after losing the actual document, without private reads', async () => {
    await enter()
    const google = await import('../../services/googleAuth')
    await google.storeUser({ email: 'synthetic@example.invalid', name: 'Synthetic', picture: '' })
    await google.storeMailboxFreeGrant({ access_token: 'synthetic-access', refresh_token: 'synthetic-refresh', expires_at: Date.now() + 3600_000 },
      undefined, { verifiedEmail: 'synthetic@example.invalid' })
    const lease = google.captureGoogleGrant()!
    expect(lease.isCurrent()).toBe(true)
    await lose()
    const read = vi.spyOn(Storage.prototype, 'getItem'), fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
    expect(lease.isCurrent()).toBe(false)
    expect(google.captureGoogleGrant()).toBeNull()
    await expect(google.getValidAccessToken()).resolves.toBeNull()
    await expect(lease.getAccessToken()).resolves.toBeNull()
    expect(read).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled()
  })

  it('terminates a Google key transfer after real document loss without reads, writes or late notification', async () => {
    await enter()
    const google = await import('../../services/googleAuth')
    await google.storeUser({ email: 'synthetic@example.invalid', name: 'Synthetic', picture: '' })
    await google.storeMailboxFreeGrant({ access_token: 'synthetic-access', refresh_token: 'synthetic-refresh', expires_at: Date.now() + 3600_000 },
      undefined, { verifiedEmail: 'synthetic@example.invalid' })
    const change = (await google.prepareGoogleKeyChange())!
    await c.initCrypto('next-synthetic-key', { commit: change.begin })
    const generation = c.captureCryptoGenerationGuard(), gate = deferred<string>()
    vi.spyOn(c, 'encrypt').mockReturnValueOnce(gate.promise)
    const pending = change.finish(generation)
    await vi.waitFor(() => expect(c.encrypt).toHaveBeenCalledTimes(2))
    await lose()
    const read = vi.spyOn(Storage.prototype, 'getItem'), write = vi.spyOn(Storage.prototype, 'setItem'), notify = vi.fn()
    window.addEventListener('google-storage-ready', notify)
    try {
      gate.resolve('stale-synthetic-ciphertext')
      await expect(pending).resolves.toBe(false)
      expect(read).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled(); expect(notify).not.toHaveBeenCalled()
    } finally { window.removeEventListener('google-storage-ready', notify) }
  })

  it('a valid isolated fixture does not permit direct provisioning before storage admission', async () => {
    const { seedIsolatedWorkspace } = await import('../helpers/isolatedWorkspace')
    const layout = await seedIsolatedWorkspace()
    await runtime.documentWorkspace.acquire()
    const { provisionIsolatedSalt } = await import('../../services/workspaceWriter/cryptoProvisioning')
    const write = vi.spyOn(Storage.prototype, 'setItem')
    await expect(provisionIsolatedSalt(layout, 'a', { assertCurrent() {}, fence: 'initial', signal: new AbortController().signal })).rejects.toThrow('workspace_admission_unavailable')
    expect(write).not.toHaveBeenCalled()
    expect(await runtime.workspaceAdmission.admit()).toBe('ready')
  })
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
