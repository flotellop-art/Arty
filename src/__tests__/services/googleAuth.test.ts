import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../services/apiBase', () => ({
  apiUrl: (path: string) => path,
}))
vi.mock('../../services/userSession', () => ({
  getActiveUserId: () => 'user-test',
}))

// Keep crypto real but controllable
import * as crypto from '../../services/crypto'
import * as scoped from '../../services/scopedStorage'
import * as googleAuth from '../../services/googleAuth'

function mockFetch(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  const response = {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    text: async () => JSON.stringify(body),
  } as unknown as Response
  global.fetch = vi.fn().mockResolvedValue(response) as unknown as typeof fetch
  return global.fetch as unknown as ReturnType<typeof vi.fn>
}

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  // Reset crypto cached key between tests so initCrypto re-derives
  vi.resetModules()
})

describe('googleAuth — storage paths', () => {
  it('storeTokens writes plain JSON when crypto not ready (sync reads stay functional)', async () => {
    const tokens = { access_token: 'a', refresh_token: 'r', expires_at: Date.now() + 3600_000 }
    await googleAuth.storeTokens(tokens)

    // Sync read via getStoredTokens should work
    const out = googleAuth.getStoredTokens()
    expect(out?.access_token).toBe('a')
  })

  it('storeTokens encrypts when crypto ready and removes plain copy', async () => {
    await crypto.initCrypto('sk-ant-test')
    const tokens = { access_token: 'a', refresh_token: 'r', expires_at: Date.now() + 3600_000 }
    await googleAuth.storeTokens(tokens)

    // Encrypted key should exist, plain should be gone
    const enc = scoped.getItem('google-tokens-enc')
    const plain = scoped.getItem('google-tokens')
    expect(enc).toBeTruthy()
    expect(plain).toBeNull()

    // Sync reader still returns tokens (served from memory cache)
    expect(googleAuth.getStoredTokens()?.access_token).toBe('a')
  })

  it('bootstrapGoogleStorage migrates legacy plain tokens to encrypted storage', async () => {
    // Arrange: legacy plain tokens written before crypto ready
    const tokens = { access_token: 'legacy', refresh_token: 'r', expires_at: Date.now() + 3600_000 }
    scoped.setJSON('google-tokens', tokens)

    // Act: init crypto then bootstrap
    await crypto.initCrypto('sk-ant-test')
    await googleAuth.bootstrapGoogleStorage()

    // Assert: plain removed, encrypted written
    expect(scoped.getItem('google-tokens')).toBeNull()
    expect(scoped.getItem('google-tokens-enc')).toBeTruthy()
    expect(googleAuth.getStoredTokens()?.access_token).toBe('legacy')
  })

  it('logout clears both plain and encrypted copies + memory cache', async () => {
    await crypto.initCrypto('sk-ant-test')
    await googleAuth.storeTokens({ access_token: 'x', refresh_token: 'y', expires_at: Date.now() + 3600_000 })

    googleAuth.logout()

    expect(scoped.getItem('google-tokens')).toBeNull()
    expect(scoped.getItem('google-tokens-enc')).toBeNull()
    expect(googleAuth.getStoredTokens()).toBeNull()
  })

  it('getValidAccessToken ignores placeholder "native" token', async () => {
    await googleAuth.storeTokens({ access_token: 'native', refresh_token: '', expires_at: Date.now() + 3600_000 })
    const token = await googleAuth.getValidAccessToken()
    expect(token).toBeNull()
  })

  it('getValidAccessToken returns stored token when valid', async () => {
    await googleAuth.storeTokens({ access_token: 'ok', refresh_token: 'r', expires_at: Date.now() + 3600_000 })
    const token = await googleAuth.getValidAccessToken()
    expect(token).toBe('ok')
  })

  it('exchangeCode posts to /api/auth/token and stores tokens', async () => {
    const fetchMock = mockFetch({ access_token: 'new', refresh_token: 'rr', expires_in: 3600 })
    const res = await googleAuth.exchangeCode('abc')
    expect(res.access_token).toBe('new')
    const call = fetchMock.mock.calls[0]
    expect(call?.[0]).toBe('/api/auth/token')
  })

  it('refreshAccessToken keeps tokens on 5xx (transient cold-start)', async () => {
    await googleAuth.storeTokens({ access_token: 'old', refresh_token: 'r', expires_at: Date.now() - 1000 })
    mockFetch({ error: 'Bad gateway' }, { ok: false, status: 502 })

    const result = await googleAuth.refreshAccessToken()
    expect(result).toBeNull()
    // CRITICAL: tokens MUST still be present
    expect(googleAuth.getStoredTokens()?.access_token).toBe('old')
    expect(googleAuth.getStoredTokens()?.refresh_token).toBe('r')
  })

  it('refreshAccessToken keeps tokens on network failure', async () => {
    await googleAuth.storeTokens({ access_token: 'old', refresh_token: 'r', expires_at: Date.now() - 1000 })
    global.fetch = vi.fn().mockRejectedValue(new Error('Network down')) as unknown as typeof fetch

    const result = await googleAuth.refreshAccessToken()
    expect(result).toBeNull()
    expect(googleAuth.getStoredTokens()?.refresh_token).toBe('r')
  })

  it('refreshAccessToken logs out only on definitive invalid_grant', async () => {
    await googleAuth.storeTokens({ access_token: 'old', refresh_token: 'r', expires_at: Date.now() - 1000 })
    mockFetch({ error: 'invalid_grant' }, { ok: false, status: 400 })

    const result = await googleAuth.refreshAccessToken()
    expect(result).toBeNull()
    // refresh_token revoked → tokens should be wiped
    expect(googleAuth.getStoredTokens()).toBeNull()
  })

  it('getValidAccessToken retries refresh on transient 5xx and succeeds on attempt 2', async () => {
    await googleAuth.storeTokens({ access_token: 'old', refresh_token: 'r', expires_at: Date.now() - 1000 })

    let calls = 0
    global.fetch = vi.fn().mockImplementation(async () => {
      calls++
      if (calls === 1) {
        return {
          ok: false,
          status: 502,
          text: async () => JSON.stringify({ error: 'Bad gateway' }),
        } as unknown as Response
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ access_token: 'fresh', expires_in: 3600 }),
      } as unknown as Response
    }) as unknown as typeof fetch

    const token = await googleAuth.getValidAccessToken()
    expect(token).toBe('fresh')
    expect(calls).toBe(2)
  }, 10_000)

  it('bootstrapGoogleStorage keeps ciphertext when key self-test fails', async () => {
    // Arrange: write encrypted blob with passphrase A
    await crypto.initCrypto('sk-ant-A')
    await googleAuth.storeTokens({ access_token: 'kept', refresh_token: 'r', expires_at: Date.now() + 3600_000 })
    const encBefore = scoped.getItem('google-tokens-enc')
    expect(encBefore).toBeTruthy()

    // Reset modules so memTokens cache is cleared and KEY_CHECK_KEY is overwritten
    vi.resetModules()
    const cryptoFresh = await import('../../services/crypto')
    const googleAuthFresh = await import('../../services/googleAuth')

    // Act: re-init crypto with WRONG passphrase B → KEY_CHECK_KEY now matches B,
    // but the existing google-tokens-enc was encrypted with A → decrypt fails.
    // selfTestCrypto() returns true (KEY_CHECK_KEY was rewritten with B) so the
    // blob is wiped. THIS test exercises the inverse: simulate the case where
    // KEY_CHECK_KEY was NOT rewritten (e.g. corrupted cache) → selfTest fails →
    // blob preserved.
    localStorage.removeItem('arty-crypto-check') // simulate corrupted check value
    await cryptoFresh.initCrypto('sk-ant-A')
    // Manually corrupt KEY_CHECK_KEY so selfTest fails
    localStorage.setItem('arty-crypto-check', 'GARBAGE')

    // Now corrupt the blob in a way that decrypt throws
    scoped.setItem('google-tokens-enc', 'INVALID_BASE64_!@#')
    await googleAuthFresh.bootstrapGoogleStorage()

    // Assert: blob preserved (because selfTest also failed → can't be sure key is right)
    expect(scoped.getItem('google-tokens-enc')).toBe('INVALID_BASE64_!@#')
  })
})
