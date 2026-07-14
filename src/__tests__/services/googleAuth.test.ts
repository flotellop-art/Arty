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
  const responseBody = body && typeof body === 'object' && 'access_token' in body && !('oauth_profile' in body)
    ? { ...body, oauth_profile: 'calendar-events-v1' }
    : body
  const response = {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    text: async () => JSON.stringify(responseBody),
  } as unknown as Response
  global.fetch = vi.fn().mockResolvedValue(response) as unknown as typeof fetch
  return global.fetch as unknown as ReturnType<typeof vi.fn>
}

beforeEach(() => {
  googleAuth.logout()
  localStorage.clear()
  // Sauf test dédié, simule un compte déjà migré afin que les tests de
  // stockage n'effectuent pas la révocation one-shot.
  localStorage.setItem('arty-user-test-google-oauth-mailbox-free-v1', '1')
  vi.clearAllMocks()
  // Reset crypto cached key between tests so initCrypto re-derives
  vi.resetModules()
})

describe('googleAuth — storage paths', () => {
  it('purge et révoque une seule fois les anciens identifiants Google', async () => {
    localStorage.removeItem('arty-user-test-google-oauth-mailbox-free-v1')
    await googleAuth.storeTokens({
      access_token: 'legacy-access',
      refresh_token: 'legacy-refresh',
      expires_at: Date.now() + 3600_000,
    })
    const fetchMock = mockFetch({})

    expect(await googleAuth.migrateLegacyMailboxGrant()).toBe(true)
    expect(googleAuth.getStoredTokens()).toBeNull()
    expect(localStorage.getItem('arty-user-test-google-oauth-mailbox-free-v1')).toBe('1')
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/revoke',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ token: 'legacy-refresh' }),
      }),
    )
    expect(await googleAuth.migrateLegacyMailboxGrant()).toBe(false)
  })

  it('purge un grant Calendar large et conserve une notice de reconnexion', async () => {
    await googleAuth.storeTokens({
      access_token: 'legacy-calendar-access',
      refresh_token: 'legacy-calendar-refresh',
      expires_at: Date.now() + 3600_000,
    })
    const fetchMock = mockFetch({})

    expect(await googleAuth.migrateLegacyCalendarGrant()).toBe(true)
    expect(googleAuth.getStoredTokens()).toBeNull()
    expect(googleAuth.isGoogleOAuthReconsentRequired()).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/revoke',
      expect.objectContaining({ body: JSON.stringify({ token: 'legacy-calendar-refresh' }) }),
    )
    expect(await googleAuth.migrateLegacyCalendarGrant()).toBe(false)
  })

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
    const tokens = {
      access_token: 'legacy',
      refresh_token: 'r',
      expires_at: Date.now() + 3600_000,
      oauth_profile: 'calendar-events-v1' as const,
    }
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

  it('peut différer la persistance jusqu’à l’activation du scope utilisateur', async () => {
    googleAuth.logout()
    localStorage.removeItem('arty-user-test-google-oauth-mailbox-free-v1')
    mockFetch({ access_token: 'fresh-web-access', refresh_token: 'fresh-web-refresh', expires_in: 3600 })

    const tokens = await googleAuth.exchangeCode('first-web-login', undefined, false)

    expect(tokens.refresh_token).toBe('fresh-web-refresh')
    expect(googleAuth.getStoredTokens()).toBeNull()
    expect(localStorage.getItem('arty-user-test-google-oauth-mailbox-free-v1')).toBeNull()

    await googleAuth.storeMailboxFreeGrant(tokens)
    expect(googleAuth.getStoredTokens()?.access_token).toBe('fresh-web-access')
    expect(localStorage.getItem('arty-user-test-google-oauth-mailbox-free-v1')).toBe('1')
    expect(googleAuth.getStoredTokens()?.oauth_profile).toBe('calendar-events-v1')
    expect(googleAuth.isGoogleOAuthReconsentRequired()).toBe(false)
  })

  it('exchangeCode ne recycle jamais un ancien refresh token pré-epoch', async () => {
    localStorage.removeItem('arty-user-test-google-oauth-mailbox-free-v1')
    await googleAuth.storeTokens({
      access_token: 'legacy-gmail-access',
      refresh_token: 'legacy-gmail-refresh',
      expires_at: Date.now() + 3600_000,
    })
    mockFetch({ access_token: 'mailbox-free-access', expires_in: 3600 })

    const tokens = await googleAuth.exchangeCode('fresh-code')

    expect(tokens.refresh_token).toBe('')
    expect(googleAuth.getStoredTokens()?.refresh_token).toBe('')
    expect(localStorage.getItem('arty-user-test-google-oauth-mailbox-free-v1')).toBe('1')
  })

  it('un grant natif frais marque l’epoch et survit au bootstrap suivant', async () => {
    localStorage.removeItem('arty-user-test-google-oauth-mailbox-free-v1')
    await crypto.initCrypto('sk-ant-native-fresh')
    const fetchSpy = vi.fn()
    global.fetch = fetchSpy as unknown as typeof fetch

    await googleAuth.storeMailboxFreeGrant({
      access_token: 'native-mailbox-free-access',
      refresh_token: 'native-mailbox-free-refresh',
      expires_at: Date.now() + 3600_000,
    })
    googleAuth.resetGoogleMemCache()
    await googleAuth.bootstrapGoogleStorage()

    expect(localStorage.getItem('arty-user-test-google-oauth-mailbox-free-v1')).toBe('1')
    expect(googleAuth.getStoredTokens()?.refresh_token).toBe('native-mailbox-free-refresh')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('ne marque pas l’epoch si la persistance du nouveau grant échoue', async () => {
    localStorage.removeItem('arty-user-test-google-oauth-mailbox-free-v1')
    const originalSetItem = Storage.prototype.setItem
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
      if (key.includes('google-tokens')) throw new Error('quota exceeded')
      return originalSetItem.call(this, key, value)
    })

    try {
      await expect(googleAuth.storeMailboxFreeGrant({
        access_token: 'fresh-access',
        refresh_token: 'fresh-refresh',
        expires_at: Date.now() + 3600_000,
      })).rejects.toThrow('quota exceeded')

      expect(localStorage.getItem('arty-user-test-google-oauth-mailbox-free-v1')).toBeNull()
    } finally {
      setItemSpy.mockRestore()
    }
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
        text: async () => JSON.stringify({
          access_token: 'fresh',
          expires_in: 3600,
          oauth_profile: 'calendar-events-v1',
        }),
      } as unknown as Response
    }) as unknown as typeof fetch

    const token = await googleAuth.getValidAccessToken()
    expect(token).toBe('fresh')
    expect(calls).toBe(2)
  }, 10_000)

  it('refreshAccessToken conserve le profil dans le blob courant', async () => {
    await googleAuth.storeMailboxFreeGrant({
      access_token: 'old',
      refresh_token: 'r',
      expires_at: Date.now() - 1000,
    })
    mockFetch({ access_token: 'fresh', expires_in: 3600 })

    const refreshed = await googleAuth.refreshAccessToken()

    expect(refreshed?.oauth_profile).toBe('calendar-events-v1')
    expect(await googleAuth.migrateLegacyCalendarGrant()).toBe(false)
  })

  it('exchangeCode refuse un profil serveur legacy ou absent', async () => {
    const response = {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        access_token: 'legacy',
        refresh_token: 'legacy-refresh',
        expires_in: 3600,
        oauth_profile: 'legacy-calendar-v1',
      }),
    } as unknown as Response
    global.fetch = vi.fn().mockResolvedValue(response) as unknown as typeof fetch

    await expect(googleAuth.exchangeCode('legacy-code')).rejects.toThrow(/profile/i)
    expect(googleAuth.getStoredTokens()).toBeNull()
  })

  it('un refresh tardif ne ressuscite pas les tokens après logout', async () => {
    await googleAuth.storeMailboxFreeGrant({
      access_token: 'old',
      refresh_token: 'r',
      expires_at: Date.now() - 1000,
    })
    let resolveResponse!: (response: Response) => void
    global.fetch = vi.fn(() => new Promise<Response>((resolve) => {
      resolveResponse = resolve
    })) as unknown as typeof fetch

    const pending = googleAuth.refreshAccessToken()
    googleAuth.logout()
    resolveResponse(new Response(JSON.stringify({
      access_token: 'late',
      expires_in: 3600,
      oauth_profile: 'calendar-events-v1',
    }), { status: 200 }))

    expect(await pending).toBeNull()
    expect(googleAuth.getStoredTokens()).toBeNull()
  })

  it('invalid_scope_set pose la notice avant de purger le grant', async () => {
    await googleAuth.storeMailboxFreeGrant({
      access_token: 'old',
      refresh_token: 'r',
      expires_at: Date.now() - 1000,
    })
    mockFetch({ error: 'invalid_scope_set' }, { ok: false, status: 403 })

    expect(await googleAuth.refreshAccessToken()).toBeNull()
    expect(googleAuth.getStoredTokens()).toBeNull()
    expect(googleAuth.isGoogleOAuthReconsentRequired()).toBe(true)
  })

  it('bootstrapGoogleStorage keeps ciphertext when key self-test fails', async () => {
    // Arrange: write encrypted blob with passphrase A
    await crypto.initCrypto('sk-ant-A')
    await googleAuth.storeTokens({
      access_token: 'kept',
      refresh_token: 'r',
      expires_at: Date.now() + 3600_000,
      oauth_profile: 'calendar-events-v1',
    })
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
