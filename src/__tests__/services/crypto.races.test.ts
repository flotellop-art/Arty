import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../services/apiBase', () => ({ apiUrl: (path: string) => path }))
const session = (userId: string) => ({ userId, authMethod: 'apikey' as const, displayName: userId, createdAt: 1 })
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r }); return { promise, resolve } }
let c: typeof import('../../services/crypto')
let users: typeof import('../../services/userSession')
beforeEach(async () => {
  vi.restoreAllMocks(); vi.resetModules(); localStorage.clear()
  users = await import('../../services/userSession'); users.setActiveSession(session('a'))
  c = await import('../../services/crypto')
})
afterEach(() => vi.restoreAllMocks())

/** Gate actual Web Crypto output, never substitute a fake key/ciphertext. */
function holdDerivation() {
  const gate = deferred(), actual = crypto.subtle.deriveKey.bind(crypto.subtle)
  const spy = vi.spyOn(crypto.subtle, 'deriveKey').mockImplementationOnce(async (...args) => {
    const result = await actual(...args); await gate.promise; return result
  })
  return { release: gate.resolve, entered: () => vi.waitFor(() => expect(spy).toHaveBeenCalled()) }
}
function holdEncryption() {
  const gate = deferred(), actual = crypto.subtle.encrypt.bind(crypto.subtle)
  vi.spyOn(crypto.subtle, 'encrypt').mockImplementationOnce(async (...args) => {
    const result = await actual(...args); await gate.promise; return result
  })
  return gate.resolve
}
function holdDecryption() {
  const gate = deferred(), actual = crypto.subtle.decrypt.bind(crypto.subtle)
  vi.spyOn(crypto.subtle, 'decrypt').mockImplementationOnce(async (...args) => {
    const result = await actual(...args); await gate.promise; return result
  })
  return gate.resolve
}

describe('crypto session leases with real Web Crypto', () => {
  it('late A initialization cannot publish keys or metadata into ready B', async () => {
    const gate = holdDerivation()
    const pendingA = c.initCrypto('secret-a').catch(e => e)
    await gate.entered(); users.setActiveSession(session('b'))
    await c.initCrypto('secret-b')
    const checkB = localStorage.getItem('arty-b-crypto-check'), payload = await c.encrypt('belongs to B')
    gate.release(); expect(await pendingA).toBeInstanceOf(c.CryptoContextChanged)
    expect(localStorage.getItem('arty-a-crypto-check')).toBeNull()
    expect(localStorage.getItem('arty-b-crypto-check')).toBe(checkB)
    expect(await c.decrypt(payload)).toBe('belongs to B')
  })
  it.each(['logout', 'a-b-a'])('%s invalidates readiness and a pending derivation', async mode => {
    await c.initCrypto('secret-a')
    const gate = holdDerivation(), pending = c.initCrypto('candidate').catch(e => e)
    await gate.entered()
    if (mode === 'logout') users.clearActiveSession()
    else { users.setActiveSession(session('b')); users.setActiveSession(session('a')) }
    expect(c.isCryptoReady()).toBe(false)
    gate.release(); expect(await pending).toBeInstanceOf(c.CryptoContextChanged)
    expect(c.isCryptoReady()).toBe(false)
  })
  it('a failed latest candidate restores the last committed key through overlapping init', async () => {
    await c.initCrypto('old'); const payload = await c.encrypt('old payload')
    const oldCheck = localStorage.getItem('arty-a-crypto-check')
    const gate = holdDerivation(), first = c.initCrypto('candidate-one').catch(e => e)
    await gate.entered()
    await expect(c.initCrypto('candidate-two', { commit: () => { throw new Error('quota') } })).rejects.toThrow('quota')
    expect(c.isCryptoReady()).toBe(true)
    expect(await c.decrypt(payload)).toBe('old payload')
    expect(localStorage.getItem('arty-a-crypto-check')).toBe(oldCheck)
    gate.release(); expect(await first).toBeInstanceOf(c.CryptoContextChanged)
    expect(await c.decrypt(payload)).toBe('old payload')
  })
  it('cancelled BYOK initialization never publishes a candidate or calls commit', async () => {
    await c.initCrypto('old'); const payload = await c.encrypt('old payload'), commit = vi.fn()
    let open = true; const gate = holdDerivation()
    const pending = c.initCrypto('new', { assertCurrent: () => { if (!open) throw new c.CryptoContextChanged() }, commit }).catch(e => e)
    await gate.entered(); open = false; gate.release()
    expect(await pending).toBeInstanceOf(c.CryptoContextChanged)
    expect(commit).not.toHaveBeenCalled(); expect(await c.decrypt(payload)).toBe('old payload')
  })
  it('metadata read failure restores the committed key', async () => {
    await c.initCrypto('old'); const payload = await c.encrypt('old payload')
    const get = Storage.prototype.getItem
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key) {
      if (key === 'arty-a-crypto-check') throw new DOMException('unavailable', 'SecurityError')
      return get.call(this, key)
    })
    await expect(c.initCrypto('new')).rejects.toThrow('unavailable')
    spy.mockRestore(); expect(c.isCryptoInitializing()).toBe(false)
    expect(await c.decrypt(payload)).toBe('old payload')
  })
  it('a quota commit failure restores markers that were actually rewritten with the same credential', async () => {
    localStorage.setItem('arty-crypto-v2-disabled', '1'); await c.initCrypto('old')
    const check = localStorage.getItem('arty-a-crypto-check'), payload = await c.encrypt('v1 data')
    localStorage.removeItem('arty-crypto-v2-disabled')
    await expect(c.initCrypto('old', { commit: () => { throw new Error('quota') } })).rejects.toThrow('quota')
    expect(localStorage.getItem('arty-a-crypto-check')).toBe(check)
    expect(localStorage.getItem('arty-a-crypto-version')).toBe('v1')
    expect(await c.decrypt(payload)).toBe('v1 data')
    expect(await c.encrypt('again')).toMatch(/^v1:/)
  })
  it('wrong credential preserves markers and ciphertext, and the old key recovers them', async () => {
    await c.initCrypto('old'); const payload = await c.encrypt('old payload')
    const check = localStorage.getItem('arty-a-crypto-check')
    await c.initCrypto('wrong')
    expect(c.isCryptoReady()).toBe(true); expect(await c.selfTestCrypto()).toBe(false)
    expect(localStorage.getItem('arty-a-crypto-check')).toBe(check)
    await expect(c.decrypt(payload)).rejects.toThrow()
    await c.initCrypto('old'); expect(await c.decrypt(payload)).toBe('old payload')
  })
  it('verifyCrypto never replaces active keys during its await', async () => {
    await c.initCrypto('old')
    const gate = holdDerivation(), checking = c.verifyCrypto('wrong')
    await gate.entered(); const payload = await c.encrypt('still old')
    gate.release(); expect(await checking).toBe(false)
    expect(await c.decrypt(payload)).toBe('still old')
  })
  it('a pending encryption and its version cannot cross a re-init', async () => {
    localStorage.setItem('arty-crypto-v2-disabled', '1'); await c.initCrypto('old')
    const release = holdEncryption(), pending = c.encrypt('stale').catch(e => e)
    localStorage.removeItem('arty-crypto-v2-disabled'); await c.initCrypto('old')
    release(); expect(await pending).toBeInstanceOf(c.CryptoContextChanged)
    const fresh = await c.encrypt('new'); expect(fresh).toMatch(/^v2:/); expect(await c.decrypt(fresh)).toBe('new')
  })
  it('secureSet cannot commit after re-init nor silently use plain while init is pending', async () => {
    await c.initCrypto('old')
    const release = holdEncryption(), saving = c.secureSet('arty-a-report', 'private').catch(e => e)
    const gate = holdDerivation(), initializing = c.initCrypto('old')
    await gate.entered(); await expect(c.secureSet('arty-a-new', 'private')).rejects.toBeInstanceOf(c.CryptoContextChanged)
    gate.release(); await initializing; release()
    expect(await saving).toBeInstanceOf(c.CryptoContextChanged)
    expect(localStorage.getItem('arty-a-report')).toBeNull(); expect(localStorage.getItem('arty-a-new')).toBeNull()
  })
  it.each(['tokens', 'user'])('Google %s writer abandons stale encryption without a plain fallback', async kind => {
    await c.initCrypto('old')
    const google = await import('../../services/googleAuth'), release = holdEncryption()
    const saving = kind === 'tokens'
      ? google.storeTokens({ access_token: 'token', refresh_token: 'refresh', expires_at: 123 })
      : google.storeUser({ email: 'a@example.com', name: 'A', picture: '' })
    await c.initCrypto('old'); release()
    expect(await saving).toBe(false)
    expect(localStorage.getItem(`arty-a-google-${kind}`)).toBeNull()
    expect(localStorage.getItem(`arty-a-google-${kind}-enc`)).toBeNull()
  })
  it.each(['same-session', 'switch'])('a cancelled refresh restores old tokens only in the %s case', async mode => {
    await c.initCrypto('old')
    const google = await import('../../services/googleAuth')
    const old = { access_token: 'old', refresh_token: 'old-refresh', expires_at: 123 }
    await google.storeTokens(old)
    const cipher = localStorage.getItem('arty-a-google-tokens-enc')
    const release = holdEncryption(), saving = google.storeTokens({ ...old, access_token: 'new' })
    if (mode === 'switch') users.setActiveSession(session('b'))
    await c.initCrypto('old'); release()
    expect(await saving).toBe(false)
    expect(google.getStoredTokens()).toEqual(mode === 'same-session' ? old : null)
    expect(localStorage.getItem('arty-a-google-tokens-enc')).toBe(cipher)
    expect(localStorage.getItem('arty-a-google-tokens')).toBeNull()
  })
  it.each(['google', 'conversations'])('%s bootstrap cancellation preserves the valid ciphertext', async kind => {
    await c.initCrypto('old')
    const key = kind === 'google' ? 'arty-a-google-tokens-enc' : 'arty-a-conversations-enc'
    const cipher = await c.encrypt(kind === 'google' ? JSON.stringify({ access_token: 'token' }) : '[]')
    localStorage.setItem(key, cipher)
    const release = holdDecryption()
    const google = await import('../../services/googleAuth'), storage = await import('../../services/storage')
    const pending = kind === 'google' ? google.bootstrapGoogleStorage() : storage.bootstrapConversationStorage()
    await c.initCrypto('old'); release(); await pending
    expect(localStorage.getItem(key)).toBe(cipher)
    expect(localStorage.getItem('arty-a-conversations-enc-locked')).toBeNull()
    if (kind === 'conversations') { await storage.bootstrapConversationStorage(); expect(storage.isCacheReady()).toBe(true) }
  })
})
