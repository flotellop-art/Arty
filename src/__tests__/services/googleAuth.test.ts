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

  it('refreshAccessToken logs out on 400 with proxy-rewritten error description', async () => {
    // BUG 48 — the proxy at /api/auth/refresh replaces Google's
    // `error: "invalid_grant"` with `error_description` ("Token has
    // been expired or revoked."), so we must detect by status, not
    // by body content.
    await googleAuth.storeTokens({ access_token: 'old', refresh_token: 'r', expires_at: Date.now() - 1000 })
    mockFetch({ error: 'Token has been expired or revoked.' }, { ok: false, status: 400 })

    const result = await googleAuth.refreshAccessToken()
    expect(result).toBeNull()
    expect(googleAuth.getStoredTokens()).toBeNull()
  })

  it('refreshAccessToken logs out on 401 (any 4xx is definitive)', async () => {
    await googleAuth.storeTokens({ access_token: 'old', refresh_token: 'r', expires_at: Date.now() - 1000 })
    mockFetch({ error: 'unauthorized' }, { ok: false, status: 401 })

    const result = await googleAuth.refreshAccessToken()
    expect(result).toBeNull()
    expect(googleAuth.getStoredTokens()).toBeNull()
  })

  it('refreshAccessToken logs out when refresh_token is missing in storage', async () => {
    // BUG 48 — Google sometimes does not re-issue a refresh_token on a
    // re-auth where the user has already consented recently. Stored as
    // empty string. Without this fix, getValidAccessToken returned null
    // forever without flipping isConnected → AGENDA stuck on error.
    await googleAuth.storeTokens({ access_token: 'old', refresh_token: '', expires_at: Date.now() - 1000 })

    const result = await googleAuth.refreshAccessToken()
    expect(result).toBeNull()
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
    localStorage.removeItem('arty-user-test-crypto-check') // simulate corrupted scoped check
    await cryptoFresh.initCrypto('sk-ant-A')
    // Manually corrupt KEY_CHECK_KEY so selfTest fails
    localStorage.setItem('arty-user-test-crypto-check', 'GARBAGE')

    // Now corrupt the blob in a way that decrypt throws
    scoped.setItem('google-tokens-enc', 'INVALID_BASE64_!@#')
    await googleAuthFresh.bootstrapGoogleStorage()

    // Assert: blob preserved (because selfTest also failed → can't be sure key is right)
    expect(scoped.getItem('google-tokens-enc')).toBe('INVALID_BASE64_!@#')
  })
})

// ─────────────────────────────────────────────────────────────
// PKCE (C5 / F-11) — le flow OAuth web doit émettre un code_challenge S256
// dérivé d'un code_verifier persisté (sessionStorage), consommé UNE seule fois
// à l'échange. Le flow natif (serverAuthCode, redirect_uri '') n'utilise PAS PKCE.
// ─────────────────────────────────────────────────────────────
function b64url(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
async function expectedChallenge(verifier: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return b64url(new Uint8Array(digest))
}

describe('googleAuth — PKCE (C5/F-11)', () => {
  beforeEach(() => {
    sessionStorage.clear()
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client.apps.googleusercontent.com')
  })

  it("buildOAuthUrl émet code_challenge_method=S256 et un challenge = SHA-256(verifier) persisté", async () => {
    const url = await googleAuth.buildOAuthUrl()
    const params = new URL(url).searchParams
    expect(params.get('code_challenge_method')).toBe('S256')

    const verifier = sessionStorage.getItem('arty-oauth-verifier')
    expect(verifier).toBeTruthy()
    expect(verifier!.length).toBeGreaterThanOrEqual(43) // borne RFC 7636
    expect(params.get('code_challenge')).toBe(await expectedChallenge(verifier!))
    // le state reste présent (non régressé)
    expect(params.get('state')).toBeTruthy()
  })

  it('exchangeCode (web) joint le code_verifier et le consomme (single-use)', async () => {
    sessionStorage.setItem('arty-oauth-verifier', 'VERIF-123')
    const fetchMock = mockFetch({ access_token: 'a', refresh_token: 'r', expires_in: 3600 })

    await googleAuth.exchangeCode('code-web')
    const body1 = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)
    expect(body1.code_verifier).toBe('VERIF-123')
    // consommé → retiré du sessionStorage
    expect(sessionStorage.getItem('arty-oauth-verifier')).toBeNull()

    // 2e échange : plus de verifier renvoyé (single-use)
    const fetchMock2 = mockFetch({ access_token: 'a2', refresh_token: 'r', expires_in: 3600 })
    await googleAuth.exchangeCode('code-web-2')
    const body2 = JSON.parse(fetchMock2.mock.calls[0]![1]!.body as string)
    expect('code_verifier' in body2).toBe(false)
  })

  it('exchangeCode (natif, redirect_uri "") N’envoie PAS de code_verifier (BUG 2)', async () => {
    sessionStorage.setItem('arty-oauth-verifier', 'STALE') // même si présent
    const fetchMock = mockFetch({ access_token: 'n', refresh_token: 'r', expires_in: 3600 })

    await googleAuth.exchangeCode('server-auth-code', '')
    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)
    expect(body.redirect_uri).toBe('') // chemin natif préservé
    expect('code_verifier' in body).toBe(false)
  })

  it('clearOAuthState purge aussi le verifier PKCE', async () => {
    sessionStorage.setItem('arty-oauth-verifier', 'X')
    googleAuth.clearOAuthState()
    expect(sessionStorage.getItem('arty-oauth-verifier')).toBeNull()
  })
})
