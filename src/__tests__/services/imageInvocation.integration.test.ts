import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { openDB } from 'idb'
import { waitFor } from '@testing-library/react'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ token: vi.fn(), fetch: vi.fn() }))
vi.mock('../../services/googleAuth', () => ({ getValidAccessToken: mocks.token }))
vi.mock('../../services/activeApiKey', () => ({ getOpenAIKey: () => 'synthetic-key' }))
vi.mock('../../services/apiBase', () => ({ apiUrl: (path: string) => path }))
const session = (userId: string) => ({ userId, authMethod: 'google' as const, displayName: userId, createdAt: 1 })
function deferred<T>() { let resolve!: (value: T) => void; return { promise: new Promise<T>(r => { resolve = r }), resolve: (value: T) => resolve(value) } }
let users: typeof import('../../services/userSession'), cryptoService: typeof import('../../services/crypto')
let handler: ReturnType<typeof import('../../services/tools/imageTools')['createImageHandlers']>['generate_image']
beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks(); localStorage.clear(); globalThis.indexedDB = new IDBFactory()
  vi.stubGlobal('fetch', mocks.fetch)
  users = await import('../../services/userSession'); users.setActiveSession(session('a'))
  cryptoService = await import('../../services/crypto'); await cryptoService.initCrypto('synthetic-key')
  handler = (await import('../../services/tools/imageTools')).createImageHandlers().generate_image
  mocks.fetch.mockResolvedValue({ ok: false, status: 503 })
})
afterEach(() => vi.unstubAllGlobals())
describe('image invocation — real owner/epoch/crypto and durable erasure fence', () => {
  it.each(['A-B', 'A-B-A', 'epoch', 'crypto', 'local-fence', 'durable-fence'] as const)('invalidates during auth: %s, before any billable request', async change => {
    const gate = deferred<string | null>(); mocks.token.mockReturnValue(gate.promise)
    const request = handler({ prompt: 'photo paysage' }, { imageGeneration: { signal: new AbortController().signal, assertCurrent() {} } }).catch(error => error)
    await waitFor(() => expect(mocks.token).toHaveBeenCalledOnce())
    if (change === 'A-B' || change === 'A-B-A') users.setActiveSession(session('b'))
    if (change === 'A-B-A') users.setActiveSession(session('a'))
    if (change === 'epoch') users.invalidateActiveSessionWork()
    if (change === 'crypto') await cryptoService.initCrypto('replacement-key')
    if (change === 'local-fence') localStorage.setItem(users.PROJECT_ERASURE_FENCE_KEY, 'erased')
    if (change === 'durable-fence') {
      const db = await openDB('arty-projects', 1); await db.put('meta', 'erased', 'erasure-fence'); db.close()
    }
    gate.resolve('token-a')
    expect(await request).toMatchObject({ code: 'cancelled' })
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
})
