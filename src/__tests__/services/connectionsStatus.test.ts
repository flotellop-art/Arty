import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { openDB } from 'idb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const platform = vi.hoisted(() => ({ name: 'web', plugins: new Set<string>(), list: vi.fn() }))
vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => platform.name !== 'web', getPlatform: () => platform.name,
    isPluginAvailable: (name: string) => platform.plugins.has(name),
  },
  registerPlugin: (name: string) => name === 'MailImap' ? { listAccounts: platform.list } : {},
}))
let users: typeof import('../../services/userSession')
let cryptoService: typeof import('../../services/crypto')
let google: typeof import('../../services/googleAuth')
let keys: typeof import('../../services/activeApiKey')
let mail: typeof import('../../services/mailAccounts')
let store: typeof import('../../services/projects/store')
let read: typeof import('../../services/connectionsStatus')['readConnectionsSnapshot']
const account = { id: 'synthetic-mail', provider: 'imap', label: 'Synthetic', email: 'private@example.test', host: 'example.test' }
const session = (userId: string) => ({ userId, authMethod: 'apikey' as const, displayName: 'Synthetic', createdAt: 1 })
const snapshot = () => read(new AbortController().signal)

beforeEach(async () => {
  vi.restoreAllMocks(); vi.resetModules(); localStorage.clear(); globalThis.indexedDB = new IDBFactory()
  platform.name = 'web'; platform.plugins.clear(); platform.list.mockReset()
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Unexpected network in local status') }))
  users = await import('../../services/userSession'); users.setActiveSession(session('connections-a'))
  cryptoService = await import('../../services/crypto'); await cryptoService.initCrypto('synthetic-local-key')
  google = await import('../../services/googleAuth'); await google.bootstrapGoogleStorage()
  keys = await import('../../services/activeApiKey'); keys.clearActiveKeys()
  mail = await import('../../services/mailAccounts'); mail.resetMailAccountsCache()
  store = await import('../../services/projects/store')
  read = (await import('../../services/connectionsStatus')).readConnectionsSnapshot
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

async function installGoogle(expiresAt = Date.now() + 3_600_000) {
  await google.storeUser({ email: 'private@example.test', name: 'Synthetic', picture: '' })
  await google.storeMailboxFreeGrant({ access_token: 'private-access', refresh_token: 'private-refresh', expires_at: expiresAt },
    undefined, { verifiedEmail: 'private@example.test' })
  await google.bootstrapGoogleStorage()
}

describe('Connections readonly owner-bound snapshot', () => {
  it('does not create a database, read the native bridge or issue HTTP', async () => {
    const before = await indexedDB.databases()
    const { snapshot: value } = await snapshot()
    expect(value).toMatchObject({ platform: 'web', session: 'apikey', demo: false, google: 'not-configured', mail: 'not-supported', mailCount: 0 })
    expect(value.keys.map(key => key.state)).toEqual(['unknown', 'unknown', 'unknown', 'unknown'])
    expect(await indexedDB.databases()).toEqual(before)
    expect(fetch).not.toHaveBeenCalled(); expect(platform.list).not.toHaveBeenCalled()
  })

  it('distinguishes a personal key from whitespace and server placeholders without exposing values', async () => {
    keys.setActiveKeys('private-anthropic', 'server-provided', '  ', 'private-openai')
    const { snapshot: value } = await snapshot()
    expect(value.keys).toEqual([
      { provider: 'anthropic', state: 'configured' }, { provider: 'openai', state: 'configured' },
      { provider: 'gemini', state: 'not-configured' }, { provider: 'mistral', state: 'not-configured' },
    ])
    expect(JSON.stringify(value)).not.toMatch(/private-|connections-a|synthetic-local-key/)
  })

  it.each([false, true])('invalidates an old key receipt even when initially ready=%s', async ready => {
    if (ready) keys.setActiveKeys('old-key')
    const receipt = await snapshot()
    keys.setActiveKeys('new-key')
    expect(receipt.assertCurrent).toThrow()
  })

  it.each(['owner', 'aba', 'crypto', 'fence', 'abort'] as const)('refuses a replaced %s scope', async change => {
    const controller = new AbortController(), receipt = await read(controller.signal)
    if (change === 'owner' || change === 'aba') users.setActiveSession(session('connections-b'))
    if (change === 'aba') users.setActiveSession(session('connections-a'))
    if (change === 'crypto') await cryptoService.initCrypto('replacement-key')
    if (change === 'fence') localStorage.setItem(users.PROJECT_ERASURE_FENCE_KEY, 'replacement-fence')
    if (change === 'abort') controller.abort()
    expect(receipt.assertCurrent).toThrow()
  })

  it('checks the durable erasure fence instead of trusting the local badge', async () => {
    await store.beginProjectOperation()
    const db = await openDB('arty-projects')
    await db.put('meta', 'changed-durable-fence', 'erasure-fence'); db.close()
    await expect(snapshot()).rejects.toThrow()
  })

  it('will not publish keys replaced while durable validation was pending', async () => {
    let release!: () => void
    const held = new Promise<void>(resolve => { release = resolve })
    const actual = store.captureLocalReadScope
    vi.spyOn(store, 'captureLocalReadScope').mockImplementation(signal => {
      const scope = actual(signal)
      return { ...scope, async validateReadOnly() { await held; await scope.validateReadOnly() } }
    })
    const pending = snapshot(), rejected = expect(pending).rejects.toThrow()
    keys.setActiveKeys('installed-during-read'); release(); await rejected
  })

  it.each([Date.now() + 3_600_000, 1])('describes local Google configuration, not expiry/remote health (%s)', async expiry => {
    await installGoogle(expiry)
    const receipt = await snapshot()
    expect(receipt.snapshot.google).toBe('configured')
    expect(JSON.stringify(receipt.snapshot)).not.toMatch(/private|refresh|access_token|verified_email/)
    expect(fetch).not.toHaveBeenCalled()
    await installGoogle(expiry)
    expect(receipt.assertCurrent).toThrow()
  })

  it('distinguishes pending bootstrap from missing and unreadable credentials', async () => {
    google.resetGoogleMemCache()
    expect((await snapshot()).snapshot.google).toBe('loading')
    await google.bootstrapGoogleStorage()
    expect((await snapshot()).snapshot.google).toBe('not-configured')
    localStorage.setItem('arty-connections-a-google-tokens-enc', 'unreadable-synthetic-blob')
    expect((await snapshot()).snapshot.google).toBe('unavailable')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('refuses a legacy Google profile and distinguishes explicit reconnect', async () => {
    await installGoogle()
    await google.storeTokens({ access_token: 'legacy-access', refresh_token: 'legacy-refresh', expires_at: Date.now() + 1000,
      oauth_profile: 'legacy-profile', verified_email: 'private@example.test' })
    expect((await snapshot()).snapshot.google).toBe('unavailable')
    localStorage.setItem('arty-connections-a-google-oauth-reconsent-required', 'calendar-events-owned-v2')
    expect((await snapshot()).snapshot.google).toBe('reconnect')
  })

  it.each(['web', 'android', 'ios', 'other'])('requires actual plugin capacity on %s', async name => {
    platform.name = name
    let value = (await snapshot()).snapshot
    expect(value.google).toBe(name === 'web' ? 'not-configured' : 'not-supported')
    expect(value.mail).toBe('not-supported')
    platform.plugins.add('GoogleSignInNative'); platform.plugins.add('MailImap')
    value = (await snapshot()).snapshot
    expect(value.google).toBe(name === 'web' || name === 'android' ? 'not-configured' : 'not-supported')
    expect(value.mail).toBe(name === 'android' ? 'unknown' : 'not-supported')
    expect(platform.list).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled()
  })

  it('keeps unknown, loading, known-empty and failed mail inventories distinct', async () => {
    platform.name = 'android'; platform.plugins.add('MailImap')
    expect((await snapshot()).snapshot.mail).toBe('unknown')
    let release!: (value: { accounts: typeof account[] }) => void
    platform.list.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    const loading = mail.refreshMailAccounts()
    const old = await snapshot()
    expect(old.snapshot.mail).toBe('loading')
    release({ accounts: [] }); await loading
    expect(old.assertCurrent).toThrow()
    expect((await snapshot()).snapshot.mail).toBe('not-configured')
    platform.list.mockRejectedValueOnce(new Error('synthetic bridge unavailable'))
    await mail.refreshMailAccounts()
    expect((await snapshot()).snapshot.mail).toBe('unavailable')
    platform.list.mockResolvedValueOnce({ accounts: [account] })
    await mail.refreshMailAccounts()
    const value = (await snapshot()).snapshot
    expect(value).toMatchObject({ mail: 'configured', mailCount: 1 })
    expect(JSON.stringify(value)).not.toContain('private@example.test')
    expect(platform.list).toHaveBeenCalledTimes(3); expect(fetch).not.toHaveBeenCalled()
  })

  it('cannot assign a former mail cache to the new account during loading', async () => {
    platform.name = 'android'; platform.plugins.add('MailImap')
    platform.list.mockResolvedValueOnce({ accounts: [account] })
    await mail.refreshMailAccounts()
    users.setActiveSession(session('connections-b'))
    let release!: (value: { accounts: never[] }) => void
    platform.list.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    const pending = mail.refreshMailAccounts()
    expect(mail.getCachedMailAccounts()).toEqual([])
    await vi.waitFor(() => expect(platform.list).toHaveBeenCalledTimes(2))
    release({ accounts: [] }); await pending
  })

  it('does not call the bridge if a synchronous inventory listener changes account', async () => {
    platform.name = 'android'; platform.plugins.add('MailImap')
    const switchAccount = () => users.setActiveSession(session('connections-b'))
    window.addEventListener('mail-accounts-updated', switchAccount, { once: true })
    expect(await mail.refreshMailAccounts()).toEqual([])
    expect(platform.list).not.toHaveBeenCalled()
  })
})
