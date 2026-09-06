import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../services/apiBase', () => ({ apiUrl: (path: string) => path }))
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false, getPlatform: () => 'web' },
  registerPlugin: () => ({ signIn: vi.fn(), signOut: vi.fn() }),
}))
let google: typeof import('../../services/googleAuth')
let c: typeof import('../../services/crypto')
let useGoogleAuth: typeof import('../../hooks/useGoogleAuth')['useGoogleAuth']
const user = { email: 'initial@example.invalid', name: 'Initial', picture: '' }
function snapshot() { return Object.fromEntries(Object.keys(localStorage).map(key => [key, localStorage.getItem(key)])) }
function gate() {
  let release!: () => void
  const promise = new Promise<void>(resolve => { release = resolve })
  return { promise, release }
}
async function loadModules() {
  c = await import('../../services/crypto'); google = await import('../../services/googleAuth')
  useGoogleAuth = (await import('../../hooks/useGoogleAuth')).useGoogleAuth
}
function http() {
  const fetcher = vi.fn(async (url: string, init: RequestInit) => {
    if (url === '/api/auth/token') {
      const { code } = JSON.parse(String(init.body))
      return Response.json({ access_token: `access-${code}`, refresh_token: `refresh-${code}`, expires_in: 3600,
        oauth_profile: google.CURRENT_GOOGLE_OAUTH_PROFILE })
    }
    expect(url).toBe('https://www.googleapis.com/oauth2/v2/userinfo')
    const label = new Headers(init.headers).get('Authorization')!.replace('Bearer access-', '')
    return Response.json({ email: `${label}@example.invalid`, name: label, picture: '' })
  })
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}
beforeEach(async () => {
  vi.restoreAllMocks(); vi.resetModules(); localStorage.clear(); sessionStorage.clear()
  const users = await import('../../services/userSession')
  users.setActiveSession({ userId: 'a', authMethod: 'apikey', displayName: 'A', createdAt: 1 })
  await loadModules(); await c.initCrypto('old-synthetic-key')
  localStorage.setItem('arty-a-api-keys', JSON.stringify({ anthropic: 'old-synthetic-key' }))
  await google.storeUser(user)
  await google.storeMailboxFreeGrant({ access_token: 'initial-access', refresh_token: 'initial-refresh', expires_at: Date.now() + 3600_000 }, undefined, { verifiedEmail: user.email })
  await google.bootstrapGoogleStorage()
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('real Google reconnect hook, crypto and storage; synthetic HTTP only', () => {
  it.each(['preparation', 'identity-committed', 'grant-committed'] as const)('does not adopt a winner while R1 is paused after %s', async phase => {
    const hold = gate()
    let blocked = false
    if (phase === 'preparation') {
      const actual = google.fetchGoogleUser
      vi.spyOn(google, 'fetchGoogleUser').mockImplementationOnce(async (...args) => {
        const result = await actual(...args); blocked = true; await hold.promise; return result
      })
    } else if (phase === 'identity-committed') {
      const actual = google.storeUser
      vi.spyOn(google, 'storeUser').mockImplementationOnce(async (...args) => {
        const result = await actual(...args); expect(result).toBe(true); blocked = true; await hold.promise; return result
      })
    } else {
      const actual = google.storeMailboxFreeGrant
      vi.spyOn(google, 'storeMailboxFreeGrant').mockImplementationOnce(async (...args) => {
        const result = await actual(...args); blocked = true; await hold.promise; return result
      })
    }
    const fetcher = http(), first = renderHook(() => useGoogleAuth()), second = renderHook(() => useGoogleAuth())
    let pending!: Promise<void>
    act(() => { pending = first.result.current.handleCallback('r1') })
    await waitFor(() => expect(blocked).toBe(true))
    await act(async () => { await second.result.current.handleCallback('r2') })
    const before = snapshot()
    await act(async () => { hold.release(); await pending })
    expect(google.getStoredTokens()?.access_token).toBe('access-r2')
    expect(first.result.current.error).toBeNull()
    expect(snapshot()).toEqual(before)
    expect(fetcher).toHaveBeenCalledTimes(4)
  })
  it.each(['identity', 'strict-pair'] as const)('a superseded reconnect cannot purge the winner after %s encryption', async phase => {
    if (phase === 'strict-pair') {
      const change = (await google.prepareGoogleKeyChange())!
      await c.initCrypto('new-synthetic-key', { commit: change.begin })
      await google.bootstrapGoogleStorage()
    }
    const hold = gate(), actual = c.encrypt
    let blocked = false
    vi.spyOn(c, 'encrypt').mockImplementation(async input => {
      const encoded = await actual(input), data = JSON.parse(input)
      if (!blocked && (phase === 'identity' ? data.email === 'r1@example.invalid' : data.access_token === 'access-r1')) {
        blocked = true; await hold.promise
      }
      return encoded
    })
    const fetcher = http()
    const first = renderHook(() => useGoogleAuth()), second = renderHook(() => useGoogleAuth())
    let pending!: Promise<void>
    act(() => { pending = first.result.current.handleCallback('r1') })
    await waitFor(() => expect(blocked).toBe(true))
    await act(async () => { await second.result.current.handleCallback('r2') })
    expect(second.result.current.isConnected).toBe(true)
    const before = snapshot()
    await act(async () => { hold.release(); await pending })
    expect(google.getStoredTokens()?.access_token).toBe('access-r2')
    expect(google.getStoredUser()?.email).toBe('r2@example.invalid')
    expect(first.result.current.error).toBeNull()
    expect(snapshot()).toEqual(before)
    expect(fetcher).toHaveBeenCalledTimes(4)
  })

  it.each([0, 1, 2])('boots new modules after a cut at %s pair writes, then reconnects through the actual hook', async writes => {
    const tokens = google.getStoredTokens()!, initialUser = google.getStoredUser()!
    const change = (await google.prepareGoogleKeyChange())!
    await c.initCrypto('new-synthetic-key', { commit: () => {
      change.begin(); localStorage.setItem('arty-a-api-keys', JSON.stringify({ anthropic: 'new-synthetic-key' }))
    } })
    const values = await Promise.all([c.encrypt(JSON.stringify(tokens)), c.encrypt(JSON.stringify(initialUser))])
    for (let i = 0; i < writes; i++) localStorage.setItem(`arty-a-${['google-tokens-enc', 'google-user-enc'][i]}`, values[i]!)
    // No old cache, lease, crypto context or transfer actor is used after this.
    vi.resetModules(); await loadModules(); await c.initCrypto('new-synthetic-key')
    const before = snapshot(), fetcher = http()
    await google.bootstrapGoogleStorage()
    expect(snapshot()).toEqual(before); expect(fetcher).not.toHaveBeenCalled()
    expect(google.getStoredTokens()).toBeNull(); expect(google.getStoredUser()).toBeNull()
    const hook = renderHook(() => useGoogleAuth())
    expect(hook.result.current.isInitializing).toBe(false)
    expect(hook.result.current.isConnected).toBe(false)
    await act(async () => { await hook.result.current.handleCallback('fresh') })
    expect(hook.result.current.error).toBeNull()
    expect(hook.result.current.isConnected).toBe(true)
    expect(google.getStoredTokens()?.access_token).toBe('access-fresh')
    expect(localStorage.getItem('arty-a-google-crypto-transfer-pending-v1')).toBeNull()
    cleanup(); vi.resetModules(); await loadModules(); await c.initCrypto('new-synthetic-key'); await google.bootstrapGoogleStorage()
    expect(await google.getValidAccessToken()).toBe('access-fresh')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('still cleans up its own failed identity write without deleting another grant', async () => {
    const actual = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === 'arty-a-google-user-enc' || key === 'arty-a-google-user') throw new DOMException('quota', 'QuotaExceededError')
      actual.call(this, key, value)
    })
    http()
    const hook = renderHook(() => useGoogleAuth())
    await act(async () => { await hook.result.current.handleCallback('failed') })
    expect(hook.result.current.error).not.toBeNull()
    expect(hook.result.current.isConnected).toBe(false)
    expect(google.getStoredTokens()).toBeNull()
  })
})
