import 'fake-indexeddb/auto'
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as google from '../../services/googleAuth'
import { initCrypto } from '../../services/crypto'
import { getActiveSessionEpoch, setActiveSession } from '../../services/userSession'
import { usePlanStatus } from '../../hooks/usePlanStatus'
import { clearWalletCache, fetchWalletBalance } from '../../services/walletClient'
import { WalletBadge } from '../../components/layout/WalletBadge'
import i18n from '../../i18n'
import { captureBillingContext } from '../../services/billingContext'
import { openCreemCheckout } from '../../services/checkout'

vi.mock('../../services/apiBase', () => ({ apiUrl: (path: string) => path }))
const families = ['claude-haiku', 'claude-sonnet', 'claude-opus', 'mistral-medium', 'gemini-flash', 'gemini-pro', 'gpt-mini', 'gpt-full']
const dto = (plan: string) => ({ auth: 'ok', status: plan === 'free' ? 'inactive' : 'active', plan,
  allowed_families: plan === 'free' ? ['claude-haiku'] : families,
  locked_families: plan === 'free' ? families.slice(1) : [], daily_remaining: null, daily_limits: null })
const wallet = (n = 0) => Response.json({ hasWallet: n > 0, availableMicro: n, balanceMicro: n, reservedMicro: 0 })
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r }); return { promise, resolve } }
let serial = 0
async function relink(token = 'G2') {
  await google.storeMailboxFreeGrant({ access_token: token, refresh_token: 'SYNTHETIC-REFRESH', expires_at: Date.now() + 3600_000 }, undefined, { verifiedEmail: 'synthetic@example.invalid' })
}
beforeEach(async () => {
  vi.restoreAllMocks(); localStorage.clear(); google.resetGoogleMemCache(); clearWalletCache()
  setActiveSession({ userId: `plan-grant-${++serial}`, authMethod: 'google', displayName: 'Synthetic', createdAt: 1 })
  await initCrypto(`synthetic-plan-key-${serial}`)
  await google.storeUser({ email: 'synthetic@example.invalid', name: 'Synthetic', picture: '' })
  await relink('G1'); await google.bootstrapGoogleStorage()
  await i18n.changeLanguage('fr')
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('plan and wallet with real encrypted Google grant lifecycle (HTTP synthetic)', () => {
  it.each(['wallet-first', 'plan-first'])('keeps the actual badge and plan coherent when concurrent consumers refresh (%s)', async order => {
    const http = vi.fn(async (url: string) => url === '/api/wallet/balance' ? wallet(900000) : Response.json(dto('vip')))
    vi.stubGlobal('fetch', http); render(<WalletBadge />); const hook = renderHook(() => usePlanStatus())
    await waitFor(() => { expect(hook.result.current.plan).toBe('vip'); expect(screen.getByLabelText(i18n.t('wallet.badgeAria'))).toHaveTextContent('90') })
    const gate = deferred<Response>(); http.mockClear()
    http.mockImplementation(async url => url === '/api/wallet/balance' ? gate.promise : Response.json(dto('vip')))
    let refresh!: ReturnType<typeof hook.result.current.refresh>
    if (order === 'wallet-first') {
      act(() => window.dispatchEvent(new Event('cost-updated')))
      await waitFor(() => expect(http).toHaveBeenCalledOnce())
      act(() => { refresh = hook.result.current.refresh() })
    } else {
      act(() => { refresh = hook.result.current.refresh() })
      await waitFor(() => expect(http).toHaveBeenCalledTimes(2))
      act(() => window.dispatchEvent(new Event('cost-updated')))
    }
    await waitFor(() => expect(http).toHaveBeenCalledTimes(2))
    await act(async () => { gate.resolve(wallet(50000)); await refresh })
    expect(screen.getByLabelText(i18n.t('wallet.badgeAria'))).toHaveTextContent('5')
    expect(hook.result.current.plan).toBe('vip')
    expect(http.mock.calls.filter(([url]) => url === '/api/wallet/balance')).toHaveLength(1)
  })
  it('retires a no-grant context when an already-started installation admits its grant', async () => {
    let during!: ReturnType<typeof captureBillingContext>
    const epoch = getActiveSessionEpoch()
    await google.storeMailboxFreeGrant({ access_token: 'G2', refresh_token: 'SYNTHETIC-REFRESH', expires_at: Date.now() + 3600_000 }, undefined, {
      verifiedEmail: 'synthetic@example.invalid', onWriteStarted: () => {
        expect(google.captureGoogleGrant()).toBeNull()
        during = captureBillingContext(); expect(during.isCurrent()).toBe(true)
      },
    })
    expect(getActiveSessionEpoch()).toBe(epoch)
    expect(during.isCurrent()).toBe(false); expect(await during.getAccessToken()).toBeNull()
    expect(await captureBillingContext().getAccessToken()).toBe('G2')
  })
  it('clears warm VIP/family/wallet caches after real Google refresh retries fail transiently', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/wallet/balance' ? wallet(900000) : Response.json(dto('vip'))))
    const hook = renderHook(() => usePlanStatus())
    await waitFor(() => expect(hook.result.current.plan).toBe('vip'))
    const expired = Date.now() + 7200_000; vi.spyOn(Date, 'now').mockReturnValue(expired)
    const http = vi.fn(async () => Response.json({ error: 'synthetic temporary failure' }, { status: 503 })); vi.stubGlobal('fetch', http)
    vi.useFakeTimers()
    try {
      await act(async () => { const result = hook.result.current.refresh(); await vi.runAllTimersAsync(); await result })
      expect(http).toHaveBeenCalledTimes(3)
      expect(hook.result.current.statusUnavailable).toBe(true)
      expect(google.getStoredTokens()).not.toBeNull()
      for (const key of ['arty-plan-cache', 'arty-allowed-families', 'arty-wallet-available']) expect(localStorage.getItem(key)).toBeNull()
    } finally { vi.useRealTimers() }
  })
  it.each(['http', 'json', 'ui-retired'])('real Creem checkout discards a late %s result without navigation', async phase => {
    const response = deferred<Response>(), body = deferred<{ url: string }>()
    const parsed = vi.fn(() => body.promise), stillMounted = { value: true }
    const navigate = vi.fn(), realWindow = window
    const http = vi.fn((_url: string, _init?: RequestInit) => phase === 'http' ? response.promise : Promise.resolve({ ok: true, json: parsed } as unknown as Response))
    vi.stubGlobal('fetch', http)
    const outcome = openCreemCheckout('credits_10', { isCurrent: () => stillMounted.value })
    await waitFor(() => expect(http).toHaveBeenCalledOnce())
    if (phase !== 'http') await waitFor(() => expect(parsed).toHaveBeenCalledOnce())
    if (phase === 'ui-retired') stillMounted.value = false
    else await relink()
    // Location is non-configurable in jsdom. Replace only the global window
    // for the settled continuation, retaining every other real Window API.
    vi.stubGlobal('window', new Proxy(realWindow, { get: (target, key) => key === 'location' ? { assign: navigate } : Reflect.get(target, key) }))
    try {
      response.resolve(Response.json({ url: 'https://checkout.example.invalid/synthetic' }))
      body.resolve({ url: 'https://checkout.example.invalid/synthetic' })
      expect(await outcome).toBe(false); expect(navigate).not.toHaveBeenCalled()
      expect(new Headers(http.mock.calls[0]?.[1]?.headers).get('x-google-token')).toBe('G1')
    } finally { vi.stubGlobal('window', realWindow) }
  })
  it('never posts a checkout after its initiating grant retires during token refresh', async () => {
    const old = deferred<Response>(), expired = Date.now() + 7200_000
    vi.spyOn(Date, 'now').mockReturnValue(expired)
    const http = vi.fn((_url: string) => old.promise); vi.stubGlobal('fetch', http)
    const outcome = openCreemCheckout('credits_10')
    await waitFor(() => expect(http).toHaveBeenCalledOnce())
    expect(http.mock.calls[0][0]).toBe('/api/auth/refresh')
    await relink()
    old.resolve(Response.json({ access_token: 'late-G1', expires_in: 3600, oauth_profile: google.CURRENT_GOOGLE_OAUTH_PROFILE }))
    expect(await outcome).toBe(false); expect(http).toHaveBeenCalledOnce()
  })
  it('removes the real wallet badge on local revocation, does no invalidation fetch, and later reads G2', async () => {
    const http = vi.fn(async () => wallet(900000)); vi.stubGlobal('fetch', http)
    render(<WalletBadge />)
    await waitFor(() => expect(screen.getByLabelText(i18n.t('wallet.badgeAria'))).toHaveTextContent('90'))
    act(() => google.resetGoogleMemCache())
    expect(screen.queryByLabelText(i18n.t('wallet.badgeAria'))).not.toBeInTheDocument()
    await act(async () => { await Promise.resolve() }); expect(http).toHaveBeenCalledOnce()
    http.mockResolvedValue(wallet(50000))
    await act(async () => { await google.bootstrapGoogleStorage() })
    await waitFor(() => expect(screen.getByLabelText(i18n.t('wallet.badgeAria'))).toHaveTextContent('5'))
    expect(screen.getByLabelText(i18n.t('wallet.badgeAria'))).not.toHaveTextContent('90')
  })
  it('clears the displayed wallet rather than retaining a previous balance on a failed read', async () => {
    const http = vi.fn(async () => wallet(900000)); vi.stubGlobal('fetch', http); render(<WalletBadge />)
    await waitFor(() => expect(screen.getByLabelText(i18n.t('wallet.badgeAria'))).toBeInTheDocument())
    http.mockResolvedValue(new Response(null, { status: 503 }))
    act(() => window.dispatchEvent(new Event('wallet-updated')))
    await waitFor(() => expect(screen.queryByLabelText(i18n.t('wallet.badgeAria'))).not.toBeInTheDocument())
  })
  it('does not join an old status after a same-owner/same-epoch relink', async () => {
    const old = deferred<Response>(), epoch = getActiveSessionEpoch()
    const http = vi.fn(async (url: string, options?: RequestInit) => {
      if (url === '/api/wallet/balance') return wallet()
      return new Headers(options?.headers).get('Authorization') === 'Bearer G1' ? old.promise : Response.json(dto('free'))
    }); vi.stubGlobal('fetch', http)
    const hook = renderHook(() => usePlanStatus())
    await waitFor(() => expect(http).toHaveBeenCalledTimes(1))
    await act(async () => { await relink() })
    expect(getActiveSessionEpoch()).toBe(epoch)
    await waitFor(() => expect(hook.result.current.loading).toBe(false))
    expect(hook.result.current.plan).toBe('free')
    await act(async () => { old.resolve(Response.json(dto('vip'))); await old.promise })
    expect(hook.result.current.plan).toBe('free'); expect(localStorage.getItem('arty-plan-cache')).toBe('free')
    expect(http.mock.calls.filter(([url]) => url === '/api/subscription/status')).toHaveLength(2)
  })
  it('invalidates a visible VIP and cached wallet immediately on local grant revocation, with no refresh in the notification', async () => {
    const http = vi.fn(async (url: string) => url === '/api/wallet/balance' ? wallet(50000) : Response.json(dto('vip')))
    vi.stubGlobal('fetch', http); const hook = renderHook(() => usePlanStatus())
    await waitFor(() => expect(hook.result.current.plan).toBe('vip'))
    const before = http.mock.calls.length
    act(() => google.resetGoogleMemCache())
    expect(hook.result.current.plan).not.toBe('vip')
    expect(localStorage.getItem('arty-plan-cache')).toBeNull()
    expect(localStorage.getItem('arty-wallet-available')).toBeNull()
    await act(async () => { await Promise.resolve() })
    expect(http).toHaveBeenCalledTimes(before)
  })
  it('does not combine a G1 status with the G2 wallet', async () => {
    const oldWallet = deferred<Response>()
    const http = vi.fn(async (url: string, options?: RequestInit) => {
      const h = new Headers(options?.headers)
      if (url === '/api/wallet/balance') return h.get('x-google-token') === 'G1' ? oldWallet.promise : wallet()
      return Response.json(dto(h.get('Authorization') === 'Bearer G1' ? 'vip' : 'free'))
    }); vi.stubGlobal('fetch', http); const hook = renderHook(() => usePlanStatus())
    await waitFor(() => expect(http.mock.calls.some(([url]) => url === '/api/wallet/balance')).toBe(true))
    await act(async () => { await relink() })
    await waitFor(() => expect(localStorage.getItem('arty-plan-cache')).toBe('free'))
    await act(async () => { oldWallet.resolve(wallet(900000)); await oldWallet.promise })
    expect(hook.result.current.plan).toBe('free'); expect(localStorage.getItem('arty-wallet-available')).toBe('0')
  })
  it('a standalone wallet request cannot repopulate cache after a relink without a new fetch', async () => {
    const old = deferred<Response>(); vi.stubGlobal('fetch', vi.fn(() => old.promise))
    const result = fetchWalletBalance(); await waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    await relink(); old.resolve(wallet(900000))
    expect(await result).toBeNull(); expect(localStorage.getItem('arty-wallet-available')).toBeNull()
  })
  it('keeps deduplication for two hooks and focus/pageshow within the same grant', async () => {
    const http = vi.fn(async (url: string) => url === '/api/wallet/balance' ? wallet() : Response.json(dto('vip')))
    vi.stubGlobal('fetch', http)
    const a = renderHook(() => usePlanStatus()), b = renderHook(() => usePlanStatus())
    await waitFor(() => { expect(a.result.current.plan).toBe('vip'); expect(b.result.current.plan).toBe('vip') })
    expect(http.mock.calls.filter(([url]) => url === '/api/subscription/status')).toHaveLength(1)
    act(() => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('pageshow')) })
    await waitFor(() => expect(http.mock.calls.filter(([url]) => url === '/api/subscription/status')).toHaveLength(2))
    await waitFor(() => expect(http).toHaveBeenCalledTimes(4))
  })
  it('never treats unavailable auth in a 200 response as a confirmed VIP', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ...dto('vip'), auth: 'unavailable' })))
    const hook = renderHook(() => usePlanStatus())
    await waitFor(() => expect(hook.result.current.loading).toBe(false))
    expect(hook.result.current.statusUnavailable).toBe(true); expect(localStorage.getItem('arty-plan-cache')).toBeNull()
  })
})
