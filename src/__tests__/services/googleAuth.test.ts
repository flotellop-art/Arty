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
})
