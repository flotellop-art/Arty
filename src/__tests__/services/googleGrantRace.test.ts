import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const actor = vi.hoisted(() => ({ owner: 'grant-a', epoch: 1 }))
vi.mock('../../services/userSession', async original => ({
  ...await original<typeof import('../../services/userSession')>(),
  getActiveUserId: () => actor.owner, getActiveSessionEpoch: () => actor.epoch,
  getSessionProjectFence: () => 'initial',
}))
vi.mock('../../services/apiBase', () => ({ apiUrl: (path: string) => path }))
import * as auth from '../../services/googleAuth'
import * as cryptoModule from '../../services/crypto'
import { blockProjectOperations } from '../../services/projects/localErasureGuard'
const { initCrypto } = cryptoModule

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
const grant = (label: string) => ({ access_token: `synthetic-access-${label}`, refresh_token: `synthetic-refresh-${label}`,
  expires_at: Date.now() - 1000, oauth_profile: auth.CURRENT_GOOGLE_OAUTH_PROFILE, verified_email: `${label}@example.invalid` })
async function install(label: string) {
  await initCrypto('SYNTHETIC-NOT-A-CREDENTIAL')
  await auth.storeUser({ email: `${label}@example.invalid`, name: label, picture: '' })
  await auth.storeMailboxFreeGrant(grant(label), undefined, { verifiedEmail: `${label}@example.invalid` })
}
function snapshot() { return Object.fromEntries(Object.keys(localStorage).map(key => [key, localStorage.getItem(key)])) }
beforeEach(async () => {
  vi.useRealTimers(); localStorage.clear(); actor.owner = 'grant-a'; actor.epoch += 1
  auth.resetGoogleMemCache(); await install('a')
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('Google grant ownership — real crypto, synthetic session and HTTP', () => {
  for (const phase of ['fetch', 'json'] as const) for (const transition of ['B', 'ABA'] as const) {
    it.each([400, 403, 200])(`discards stale %s at ${phase} after ${transition}, without mutating current grant`, async status => {
      const gate = deferred<Response>(), body = deferred<string>()
      const payload = { error: 'invalid_scope_set', access_token: 'stale', expires_in: 3600, oauth_profile: 'wrong-profile' }
      const readBody = vi.fn(() => body.promise)
      const response = { ok: status === 200, status, text: readBody } as unknown as Response
      const fetcher = vi.fn(() => phase === 'fetch' ? gate.promise : Promise.resolve(response))
      vi.stubGlobal('fetch', fetcher)
      const pending = auth.refreshAccessToken()
      await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
      if (phase === 'json') await vi.waitFor(() => expect(readBody).toHaveBeenCalledTimes(1))
      actor.owner = 'grant-b'; actor.epoch += 1; auth.resetGoogleMemCache(); await install('b')
      if (transition === 'ABA') { actor.owner = 'grant-a'; actor.epoch += 1; auth.resetGoogleMemCache(); await install('new-a') }
      const before = snapshot(), current = auth.getStoredTokens(), ready = vi.fn()
      window.addEventListener('google-storage-ready', ready)
      try {
        body.resolve(JSON.stringify(payload)); gate.resolve(response)
        expect(await pending).toBeNull()
        expect(auth.getStoredTokens()).toEqual(current)
        expect(snapshot()).toEqual(before)
        expect(ready).not.toHaveBeenCalled()
      } finally { window.removeEventListener('google-storage-ready', ready) }
    })
  }

  it('does not retry with B credentials after the backoff for A', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ error: 'temporary' }, { status: 503 }))
      .mockResolvedValue(Response.json({ access_token: 'wrong-b', expires_in: 3600, oauth_profile: auth.CURRENT_GOOGLE_OAUTH_PROFILE }))
    vi.stubGlobal('fetch', fetcher)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const pending = auth.getValidAccessToken()
    await vi.advanceTimersByTimeAsync(1)
    expect(fetcher).toHaveBeenCalledTimes(1)
    actor.owner = 'grant-b'; actor.epoch += 1; auth.resetGoogleMemCache(); await install('b')
    const current = auth.getStoredTokens()
    await vi.advanceTimersByTimeAsync(5000)
    expect(await pending).toBeNull()
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(auth.getStoredTokens()).toEqual(current)
  })

  it('does not retain mutable aliases of credentials or users', async () => {
    const input = grant('a')
    await auth.storeTokens(input)
    input.refresh_token = 'mutated-input'
    const returned = auth.getStoredTokens()!
    returned.refresh_token = 'mutated-output'
    expect(auth.getStoredTokens()?.refresh_token).toBe('synthetic-refresh-a')
    const user = auth.getStoredUser()!
    user.email = 'other@example.invalid'
    expect(auth.getStoredUser()?.email).toBe('a@example.invalid')
  })

  it('revokes a lease on identical relink and closes admission between identity and grant', async () => {
    const lease = auth.captureGoogleGrant()!
    expect(lease.isCurrent()).toBe(true)
    await auth.storeUser({ email: 'a@example.invalid', name: 'a', picture: '' })
    expect(lease.isCurrent()).toBe(false)
    expect(auth.captureGoogleGrant()).toBeNull()
    await auth.storeMailboxFreeGrant(grant('a'), undefined, { verifiedEmail: 'a@example.invalid' })
    expect(auth.captureGoogleGrant()?.isCurrent()).toBe(true)
    expect(lease.isCurrent()).toBe(false)
    expect(await lease.getAccessToken()).toBeNull()
  })

  it('does not admit a provisional grant or retain the input alias during encryption', async () => {
    const lease = auth.captureGoogleGrant()!, input = grant('a'), expected = { ...input }
    const ciphertext = await cryptoModule.encrypt(JSON.stringify(input)), gate = deferred<string>()
    vi.spyOn(cryptoModule, 'encrypt').mockReturnValueOnce(gate.promise)
    const pending = auth.storeTokens(input)
    expect(auth.captureGoogleGrant()).toBeNull()
    expect(lease.isCurrent()).toBe(false)
    input.refresh_token = 'mutated-while-encrypting'; input.verified_email = 'mutated@example.invalid'
    gate.resolve(ciphertext)
    expect(await pending).toBe(true)
    expect(auth.getStoredTokens()).toEqual(expected)
    expect(auth.captureGoogleGrant()?.isCurrent()).toBe(true)
    expect(lease.isCurrent()).toBe(false)
  })

  it('does not resurrect an old lease after an installation quota failure', async () => {
    const lease = auth.captureGoogleGrant()!, before = snapshot(), original = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key.endsWith('google-tokens-enc') || key.endsWith('google-tokens')) throw new DOMException('quota', 'QuotaExceededError')
      original.call(this, key, value)
    })
    await expect(auth.storeTokens(grant('a'))).rejects.toThrow('quota')
    expect(lease.isCurrent()).toBe(false)
    expect(auth.captureGoogleGrant()).toBeNull()
    expect(snapshot()).toEqual(before)
  })

  it('waits for both encrypted bootstrap records before admitting a grant', async () => {
    const lease = auth.captureGoogleGrant()!, originalDecrypt = cryptoModule.decrypt, userGate = deferred<string>()
    const user = JSON.stringify(auth.getStoredUser())
    vi.spyOn(cryptoModule, 'decrypt').mockImplementationOnce(originalDecrypt).mockReturnValueOnce(userGate.promise)
    const boot = auth.bootstrapGoogleStorage()
    await vi.waitFor(() => expect(cryptoModule.decrypt).toHaveBeenCalledTimes(2))
    expect(auth.captureGoogleGrant()).toBeNull()
    expect(lease.isCurrent()).toBe(false)
    userGate.resolve(user); await boot
    expect(auth.captureGoogleGrant()?.isCurrent()).toBe(true)
    expect(lease.isCurrent()).toBe(false)
  })

  it('does not readmit cached credentials under a new crypto key before bootstrap', async () => {
    const lease = auth.captureGoogleGrant()!
    await initCrypto('OTHER-SYNTHETIC-NOT-A-CREDENTIAL')
    expect(lease.isCurrent()).toBe(false)
    expect(auth.captureGoogleGrant()).toBeNull()
  })

  it('preserves a grant across a shared refresh and returns only durable credentials', async () => {
    const lease = auth.captureGoogleGrant()!, gate = deferred<Response>()
    const fetcher = vi.fn(() => gate.promise)
    vi.stubGlobal('fetch', fetcher)
    const a = lease.getAccessToken(), b = auth.getValidAccessToken()
    gate.resolve(Response.json({ access_token: 'fresh-shared', expires_in: 3600, oauth_profile: auth.CURRENT_GOOGLE_OAUTH_PROFILE }))
    expect(await Promise.all([a, b])).toEqual(['fresh-shared', 'fresh-shared'])
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(lease.isCurrent()).toBe(true)
    const persisted = localStorage.getItem(`arty-${actor.owner}-google-tokens-enc`)!
    expect(JSON.parse(await cryptoModule.decrypt(persisted)).access_token).toBe('fresh-shared')
  })

  it('does not serve a refreshed token after both durable writes fail', async () => {
    const original = Storage.prototype.setItem, before = auth.getStoredTokens(), lease = auth.captureGoogleGrant()!
    const fetcher = vi.fn().mockResolvedValue(Response.json({ access_token: 'not-persisted', expires_in: 3600, oauth_profile: auth.CURRENT_GOOGLE_OAUTH_PROFILE }))
    vi.stubGlobal('fetch', fetcher)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key.endsWith('google-tokens-enc') || key.endsWith('google-tokens')) throw new DOMException('quota', 'QuotaExceededError')
      original.call(this, key, value)
    })
    expect(await auth.refreshAccessToken()).toBeNull()
    expect(auth.getStoredTokens()).toEqual(before)
    expect(lease.isCurrent()).toBe(true)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    fetcher.mockImplementation(() => Promise.resolve(Response.json({ error: 'temporary' }, { status: 503 })))
    const second = lease.getAccessToken()
    await vi.advanceTimersByTimeAsync(5000)
    expect(await second).toBeNull()
    expect(auth.getStoredTokens()).toEqual(before)
  })

  it.each([true, false])('joins a direct refresh until its durable write finishes (commit=%s)', async commits => {
    const before = auth.getStoredTokens(), lease = auth.captureGoogleGrant()!, gate = deferred<string>()
    const refreshed = { ...before!, access_token: 'direct-candidate', expires_at: Date.now() + 3600_000 }
    const ciphertext = await cryptoModule.encrypt(JSON.stringify(refreshed))
    vi.spyOn(cryptoModule, 'encrypt').mockReturnValueOnce(gate.promise)
    const fetcher = vi.fn(() => Promise.resolve(Response.json({ access_token: 'direct-candidate', expires_in: 3600, oauth_profile: auth.CURRENT_GOOGLE_OAUTH_PROFILE })))
    vi.stubGlobal('fetch', fetcher)
    const direct = auth.refreshAccessToken()
    await vi.waitFor(() => expect(cryptoModule.encrypt).toHaveBeenCalledOnce())
    let settled = false
    const reader = lease.getAccessToken().then(result => { settled = true; return result })
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    expect(settled).toBe(false)
    expect(auth.getStoredTokens()).toEqual(before)
    expect(fetcher).toHaveBeenCalledOnce()
    if (!commits) {
      const original = Storage.prototype.setItem
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
        if (key.endsWith('google-tokens-enc') || key.endsWith('google-tokens')) throw new DOMException('quota', 'QuotaExceededError')
        original.call(this, key, value)
      })
    }
    gate.resolve(ciphertext)
    expect((await direct)?.access_token ?? null).toBe(commits ? 'direct-candidate' : null)
    expect(await reader).toBe(commits ? 'direct-candidate' : null)
    expect(lease.isCurrent()).toBe(true)
  })

  it.each(['direct', 'getter'] as const)('shares each attempt but keeps retry policies when %s starts first', async first => {
    const gate = deferred<Response>()
    const fetcher = vi.fn().mockReturnValueOnce(gate.promise).mockImplementation(() => Promise.resolve(Response.json({
      access_token: 'retry-success', expires_in: 3600, oauth_profile: auth.CURRENT_GOOGLE_OAUTH_PROFILE,
    })))
    vi.stubGlobal('fetch', fetcher)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    let direct: ReturnType<typeof auth.refreshAccessToken>, getter: ReturnType<typeof auth.getValidAccessToken>
    if (first === 'direct') { direct = auth.refreshAccessToken(); getter = auth.getValidAccessToken() }
    else { getter = auth.getValidAccessToken(); direct = auth.refreshAccessToken() }
    let getterSettled = false
    void getter.then(() => { getterSettled = true })
    expect(fetcher).toHaveBeenCalledOnce()
    gate.resolve(Response.json({ error: 'temporary' }, { status: 503 }))
    expect(await direct).toBeNull()
    expect(getterSettled).toBe(false)
    await vi.advanceTimersByTimeAsync(1501)
    expect(await getter).toBe('retry-success')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('returns distinct defensive results to two direct refresh consumers', async () => {
    const gate = deferred<Response>(), fetcher = vi.fn(() => gate.promise)
    vi.stubGlobal('fetch', fetcher)
    const first = auth.refreshAccessToken(), second = auth.refreshAccessToken()
    gate.resolve(Response.json({ access_token: 'shared-direct', expires_in: 3600, oauth_profile: auth.CURRENT_GOOGLE_OAUTH_PROFILE }))
    const [a, b] = await Promise.all([first, second])
    expect(a).not.toBe(b); a!.access_token = 'mutated-consumer'
    expect(b?.access_token).toBe('shared-direct')
    expect(auth.getStoredTokens()?.access_token).toBe('shared-direct')
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('arms cleanup only at its own writer start, never by adopting the next grant epoch', async () => {
    const started = vi.fn(), user = { email: 'a@example.invalid', name: 'a', picture: '' }
    expect(await auth.storeUser(user, { userId: actor.owner, sessionEpoch: actor.epoch - 1 }, started)).toBe(false)
    await expect(auth.storeMailboxFreeGrant(grant('a'), undefined, { verifiedEmail: '', onWriteStarted: started })).rejects.toThrow('Verified Google email')
    expect(started).not.toHaveBeenCalled()
    let ownCurrent = () => false
    await auth.storeUser(user, undefined, current => { ownCurrent = current })
    expect(ownCurrent()).toBe(true)
    await expect(auth.storeMailboxFreeGrant(grant('a'), undefined, { verifiedEmail: '', onWriteStarted: started })).rejects.toThrow('Verified Google email')
    expect(ownCurrent()).toBe(true)
    const second = auth.storeUser(user)
    expect(ownCurrent()).toBe(false)
    expect(started).not.toHaveBeenCalled()
    await second
  })

  it('does not re-admit a hot cache when the durable credentials are absent', async () => {
    const lease = auth.captureGoogleGrant()!
    localStorage.removeItem(`arty-${actor.owner}-google-tokens-enc`)
    localStorage.removeItem(`arty-${actor.owner}-google-user-enc`)
    await auth.bootstrapGoogleStorage()
    expect(auth.captureGoogleGrant()).toBeNull()
    expect(auth.getStoredTokens()).toBeNull()
    expect(lease.isCurrent()).toBe(false)
  })

  it('does not admit an interrupted bootstrap whose raw token record changed', async () => {
    const before = auth.getStoredTokens(), gate = deferred<string>()
    vi.spyOn(cryptoModule, 'decrypt').mockReturnValueOnce(gate.promise)
    const pending = auth.bootstrapGoogleStorage()
    localStorage.setItem(`arty-${actor.owner}-google-tokens-enc`, 'replacement-raw')
    gate.resolve(JSON.stringify(before)); await pending
    expect(auth.captureGoogleGrant()).toBeNull()
    expect(await auth.getValidAccessToken()).toBeNull()
  })

  it('never rearms a plaintext lease after a failed crypto initialization', async () => {
    actor.owner = 'plaintext'; actor.epoch += 1; auth.resetGoogleMemCache()
    await auth.storeTokens(grant('plain'))
    const lease = auth.captureGoogleGrant()!
    expect(lease.isCurrent()).toBe(true)
    vi.spyOn(crypto.subtle, 'deriveKey').mockRejectedValueOnce(new Error('synthetic-derive-failure'))
    await expect(initCrypto('SYNTHETIC-NOT-A-CREDENTIAL')).rejects.toThrow('synthetic-derive-failure')
    expect(lease.isCurrent()).toBe(false)
    expect(auth.captureGoogleGrant()).toBeNull()
  })

  it('refuses a hot-cache transfer when durable credentials were replaced before capture', async () => {
    localStorage.setItem(`arty-${actor.owner}-google-tokens-enc`, await cryptoModule.encrypt(JSON.stringify(grant('replacement'))))
    const before = snapshot()
    await expect(auth.prepareGoogleKeyChange()).rejects.toThrow('Google credentials')
    expect(snapshot()).toEqual(before)
  })

  it.each([0, 1, 2])('reloads an interrupted key transfer after %s Google writes without re-admission or revocation', async writes => {
    const tokens = auth.getStoredTokens()!, user = auth.getStoredUser()!, oldLease = auth.captureGoogleGrant()!
    const change = (await auth.prepareGoogleKeyChange())!
    await initCrypto('NEXT-SYNTHETIC-KEY', { commit: change.begin })
    const encrypted = await Promise.all([cryptoModule.encrypt(JSON.stringify(tokens)), cryptoModule.encrypt(JSON.stringify(user))])
    const keys = ['google-tokens-enc', 'google-user-enc']
    for (let i = 0; i < writes; i++) localStorage.setItem(`arty-${actor.owner}-${keys[i]}`, encrypted[i]!)
    // Even with a healthy new key-check, an old blob is not declared corrupt.
    localStorage.setItem(`arty-${actor.owner}-crypto-check`, await cryptoModule.encrypt('arty-ok'))
    const before = snapshot(), fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    auth.resetGoogleMemCache(); await initCrypto('NEXT-SYNTHETIC-KEY')
    const afterInit = snapshot()
    await auth.bootstrapGoogleStorage()
    expect(auth.isGoogleStorageReady()).toBe(true)
    expect(auth.getStoredTokens()).toBeNull(); expect(auth.getStoredUser()).toBeNull()
    expect(auth.captureGoogleGrant()).toBeNull(); expect(oldLease.isCurrent()).toBe(false)
    expect(snapshot()).toEqual(afterInit)
    for (const key of keys) expect(localStorage.getItem(`arty-${actor.owner}-${key}`)).toBe(before[`arty-${actor.owner}-${key}`])
    expect(fetcher).not.toHaveBeenCalled()
  })

  it.each(['', 'malformed-pending'])('blocks every ordinary reader/writer under a present pending marker (%s)', async pending => {
    const tokens = auth.getStoredTokens(), user = auth.getStoredUser()
    localStorage.setItem(`arty-${actor.owner}-google-tokens`, JSON.stringify(tokens))
    localStorage.setItem(`arty-${actor.owner}-google-user`, JSON.stringify(user))
    localStorage.setItem(`arty-${actor.owner}-google-crypto-transfer-pending-v1`, pending)
    auth.resetGoogleMemCache()
    const before = snapshot(), fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    await auth.bootstrapGoogleStorage()
    expect(auth.getStoredTokens()).toBeNull(); expect(auth.getStoredUser()).toBeNull()
    expect(await auth.storeTokens(grant('a'))).toBe(false)
    expect(await auth.refreshAccessToken()).toBeNull()
    expect(await auth.getValidAccessToken()).toBeNull()
    expect(snapshot()).toEqual(before); expect(fetcher).not.toHaveBeenCalled()
  })

  it.each(['google-tokens-enc', 'google-user-enc', 'pending-removal'])('preserves old raws and durable closure after quota at %s', async failure => {
    const oldTokens = localStorage.getItem(`arty-${actor.owner}-google-tokens-enc`), oldUser = localStorage.getItem(`arty-${actor.owner}-google-user-enc`)
    const change = (await auth.prepareGoogleKeyChange())!
    await initCrypto('NEXT-SYNTHETIC-KEY', { commit: change.begin })
    const guard = cryptoModule.captureCryptoGenerationGuard(), originalSet = Storage.prototype.setItem, originalRemove = Storage.prototype.removeItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === `arty-${actor.owner}-${failure}`) throw new DOMException('quota', 'QuotaExceededError')
      originalSet.call(this, key, value)
    })
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (this: Storage, key) {
      if (failure === 'pending-removal' && key.endsWith('google-crypto-transfer-pending-v1')) throw new Error('remove unavailable')
      originalRemove.call(this, key)
    })
    expect(await change.finish(guard)).toBe(false)
    expect(auth.getStoredTokens()).toBeNull(); expect(auth.captureGoogleGrant()).toBeNull()
    expect(localStorage.getItem(`arty-${actor.owner}-google-tokens-enc`)).toBe(oldTokens)
    expect(localStorage.getItem(`arty-${actor.owner}-google-user-enc`)).toBe(oldUser)
    expect(localStorage.getItem(`arty-${actor.owner}-google-crypto-transfer-pending-v1`)).not.toBeNull()
  })

  it('recovers an interrupted transfer only through a freshly installed strict identity/grant pair', async () => {
    const change = (await auth.prepareGoogleKeyChange())!
    await initCrypto('NEXT-SYNTHETIC-KEY', { commit: change.begin })
    const guard = cryptoModule.captureCryptoGenerationGuard()
    auth.resetGoogleMemCache(); await auth.bootstrapGoogleStorage()
    expect(auth.getStoredTokens()).toBeNull()
    await auth.storeUser({ email: 'fresh@example.invalid', name: 'Fresh', picture: '' })
    await auth.storeMailboxFreeGrant(grant('fresh'), undefined, { verifiedEmail: 'fresh@example.invalid' })
    expect(localStorage.getItem(`arty-${actor.owner}-google-crypto-transfer-pending-v1`)).toBeNull()
    const before = snapshot()
    expect(await change.finish(guard)).toBe(false)
    expect(snapshot()).toEqual(before)
    auth.resetGoogleMemCache(); await auth.bootstrapGoogleStorage()
    expect(auth.getStoredTokens()?.refresh_token).toBe('synthetic-refresh-fresh')
    expect(auth.captureGoogleGrant()?.isCurrent()).toBe(true)
  })

  it.each(['erasure', 'ABA', 'relink', 'crypto-success', 'crypto-failure', 'raw-replacement'] as const)('cannot finish a transfer superseded during encryption by %s', async transition => {
    const change = (await auth.prepareGoogleKeyChange())!
    await initCrypto('NEXT-SYNTHETIC-KEY', { commit: change.begin })
    const guard = cryptoModule.captureCryptoGenerationGuard(), gate = deferred<string>()
    vi.spyOn(cryptoModule, 'encrypt').mockReturnValueOnce(gate.promise)
    const pending = change.finish(guard)
    await vi.waitFor(() => expect(cryptoModule.encrypt).toHaveBeenCalledTimes(2))
    if (transition === 'erasure') blockProjectOperations(actor.owner)()
    if (transition === 'ABA') { actor.owner = 'b'; actor.epoch++; actor.owner = 'grant-a'; actor.epoch++ }
    if (transition === 'crypto-success') await initCrypto('another-key')
    if (transition === 'crypto-failure') await expect(initCrypto('another-key', { commit: () => { throw new Error('synthetic-failure') } })).rejects.toThrow('synthetic-failure')
    if (transition === 'raw-replacement') localStorage.setItem(`arty-${actor.owner}-google-user-enc`, 'replacement-raw')
    if (transition === 'relink') {
      await auth.storeUser({ email: 'fresh@example.invalid', name: 'Fresh', picture: '' })
      await auth.storeMailboxFreeGrant(grant('fresh'), undefined, { verifiedEmail: 'fresh@example.invalid' })
    }
    const before = snapshot()
    gate.resolve('synthetic-stale-ciphertext')
    expect(await pending).toBe(false)
    expect(snapshot()).toEqual(before)
  })
})
