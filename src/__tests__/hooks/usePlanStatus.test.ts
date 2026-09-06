import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  token: 'token-a' as string | null,
  userId: 'user-a' as string | null,
  sessionEpoch: 1,
  authMethod: 'google' as 'google' | 'email' | 'apikey' | 'demo',
  storageReady: true,
  storedTokens: { access_token: 'token-a' } as object | null,
  getValidAccessToken: vi.fn(async () => 'token-a' as string | null),
  fetchWalletBalance: vi.fn(),
  creditsCoverPremium: vi.fn(() => false),
}))

vi.mock('../../services/googleAuth', () => ({
  getValidAccessToken: mocks.getValidAccessToken,
  getStoredTokens: () => mocks.storedTokens,
  isGoogleStorageReady: () => mocks.storageReady,
}))
vi.mock('../../services/apiBase', () => ({ apiUrl: (path: string) => path }))
vi.mock('../../services/walletClient', () => ({
  fetchWalletBalance: mocks.fetchWalletBalance,
  creditsCoverPremium: mocks.creditsCoverPremium,
}))
vi.mock('../../services/userSession', () => ({
  getActiveUserId: () => mocks.userId,
  getActiveSessionEpoch: () => mocks.sessionEpoch,
  getActiveSession: () => mocks.userId ? { userId: mocks.userId, authMethod: mocks.authMethod } : null,
}))

import { usePlanStatus } from '../../hooks/usePlanStatus'

const ALL_FAMILIES = [
  'claude-haiku', 'claude-sonnet', 'claude-opus', 'mistral-medium',
  'gemini-flash', 'gemini-pro', 'gpt-mini', 'gpt-full',
]

function status(plan: 'free' | 'subscription' | 'pro' | 'vip') {
  const paid = plan !== 'free'
  return {
    auth: 'ok' as const,
    plan,
    allowed_families: paid ? ALL_FAMILIES : ['claude-haiku'],
    locked_families: paid ? [] : ALL_FAMILIES.slice(1),
    daily_remaining: paid ? null : { 'claude-haiku': 10 },
    daily_limits: paid ? null : { 'claude-haiku': 10 },
  }
}

function response(data: ReturnType<typeof status>): Response {
  return { ok: true, json: async () => data } as Response
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  mocks.userId = 'user-a'
  mocks.sessionEpoch = 1
  mocks.token = 'token-a'
  mocks.authMethod = 'google'
  mocks.storageReady = true
  mocks.storedTokens = { access_token: 'token-a' }
  mocks.getValidAccessToken.mockImplementation(async () => mocks.token)
  mocks.fetchWalletBalance.mockResolvedValue({
    hasWallet: false,
    balanceMicro: 0,
    reservedMicro: 0,
    availableMicro: 0,
  })
  mocks.creditsCoverPremium.mockReturnValue(false)
})

describe('usePlanStatus — cache effectif et courses', () => {
  it('an unopened comparator makes no auth/status call, activation reads and completion refreshes server counters', async () => {
    let remaining = 10
    const fetch = vi.fn(async () => response({ ...status('free'), daily_remaining: { 'claude-haiku': remaining } }))
    vi.stubGlobal('fetch', fetch)
    const hook = renderHook(({ active }) => usePlanStatus(active), { initialProps: { active: false } })
    act(() => { hook.result.current.refresh(); window.dispatchEvent(new Event('arty-message-sent')) })
    expect(mocks.getValidAccessToken).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled()
    hook.rerender({ active: true })
    await waitFor(() => expect(hook.result.current.dailyRemaining?.['claude-haiku']).toBe(10))
    remaining = 8
    act(() => window.dispatchEvent(new Event('arty-message-sent')))
    await waitFor(() => expect(hook.result.current.dailyRemaining?.['claude-haiku']).toBe(8))
    expect(fetch).toHaveBeenCalledTimes(2); hook.unmount()
  })
  it('notifie le composer seulement après avoir commité plan et familles', async () => {
    const snapshots: Array<{ plan: string | null; families: string | null }> = []
    const listener = () => snapshots.push({
      plan: localStorage.getItem('arty-plan-cache'),
      families: localStorage.getItem('arty-allowed-families'),
    })
    window.addEventListener('arty-plan-status-changed', listener)
    vi.stubGlobal('fetch', vi.fn(async () => response(status('subscription'))))

    const { result, unmount } = renderHook(() => usePlanStatus())
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(snapshots).toEqual([{
      plan: 'subscription',
      families: JSON.stringify(ALL_FAMILIES),
    }])
    unmount()
    window.removeEventListener('arty-plan-status-changed', listener)
  })

  it('cache les familles débloquées seulement après un fetch wallet réussi', async () => {
    mocks.creditsCoverPremium.mockReturnValue(true)
    vi.stubGlobal('fetch', vi.fn(async () => response(status('free'))))

    const { result } = renderHook(() => usePlanStatus())
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(mocks.fetchWalletBalance).toHaveBeenCalledOnce()
    expect(result.current.allowedFamilies).toEqual(ALL_FAMILIES)
    expect(JSON.parse(localStorage.getItem('arty-allowed-families') ?? '[]')).toEqual(ALL_FAMILIES)
    expect(localStorage.getItem('arty-plan-cache')).toBe('free')
  })

  it('échoue fermé si le wallet courant ne peut pas être vérifié', async () => {
    mocks.fetchWalletBalance.mockResolvedValue(null)
    mocks.creditsCoverPremium.mockReturnValue(true) // ancien cache local trompeur
    vi.stubGlobal('fetch', vi.fn(async () => response(status('free'))))

    const { result } = renderHook(() => usePlanStatus())
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.allowedFamilies).toEqual(['claude-haiku'])
    expect(JSON.parse(localStorage.getItem('arty-allowed-families') ?? '[]')).toEqual(['claude-haiku'])
  })

  it('une réponse lente de l’ancien compte ne peut pas écraser le nouveau', async () => {
    let resolveOld!: (value: Response) => void
    const oldResponse = new Promise<Response>((resolve) => { resolveOld = resolve })
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => oldResponse)
      .mockResolvedValueOnce(response(status('subscription')))
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => usePlanStatus())
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    mocks.userId = 'user-b'
    mocks.sessionEpoch += 1
    mocks.token = 'token-b'
    await act(async () => {
      await result.current.refresh()
    })
    expect(result.current.plan).toBe('subscription')
    expect(localStorage.getItem('arty-plan-cache')).toBe('subscription')

    await act(async () => {
      resolveOld(response(status('free')))
      await oldResponse
    })

    expect(result.current.plan).toBe('subscription')
    expect(localStorage.getItem('arty-plan-cache')).toBe('subscription')
    expect(JSON.parse(localStorage.getItem('arty-allowed-families') ?? '[]')).toEqual(ALL_FAMILIES)
  })

  it('une réponse lente d’une ancienne session du même compte est ignorée', async () => {
    let resolveOld!: (value: Response) => void
    const oldResponse = new Promise<Response>((resolve) => { resolveOld = resolve })
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => oldResponse)
      .mockResolvedValueOnce(response(status('vip')))
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => usePlanStatus())
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    mocks.sessionEpoch += 1
    mocks.token = 'token-fresh'
    await act(async () => { await result.current.refresh() })
    expect(result.current.plan).toBe('vip')

    await act(async () => {
      resolveOld(response(status('free')))
      await oldResponse
    })
    expect(result.current.plan).toBe('vip')
    expect(localStorage.getItem('arty-plan-cache')).toBe('vip')
  })

  it('n’affiche pas Free quand une session Google a perdu son grant', async () => {
    mocks.token = null
    mocks.storedTokens = null
    localStorage.setItem('arty-plan-cache', 'vip')
    localStorage.setItem('arty-allowed-families', JSON.stringify(ALL_FAMILIES))
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => usePlanStatus())
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.authRequired).toBe(true)
    expect(result.current.authRejected).toBe(false)
    expect(result.current.statusUnavailable).toBe(false)
    expect(localStorage.getItem('arty-plan-cache')).toBeNull()
    expect(localStorage.getItem('arty-allowed-families')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('attend la fin du bootstrap chiffré avant de conclure que Google manque', async () => {
    mocks.token = null
    mocks.storedTokens = null
    mocks.storageReady = false
    vi.stubGlobal('fetch', vi.fn(async () => response(status('vip'))))

    const { result } = renderHook(() => usePlanStatus())
    await waitFor(() => expect(mocks.getValidAccessToken).toHaveBeenCalledOnce())
    expect(result.current.loading).toBe(true)
    expect(result.current.authRequired).toBe(false)

    mocks.storageReady = true
    mocks.token = 'token-restored'
    mocks.storedTokens = { access_token: 'token-restored' }
    act(() => window.dispatchEvent(new CustomEvent('google-storage-ready')))
    await waitFor(() => expect(result.current.plan).toBe('vip'))

    expect(result.current.authRequired).toBe(false)
    expect(result.current.loading).toBe(false)
  })

  it('ne transforme pas une session email sans token en VIP', async () => {
    mocks.authMethod = 'email'
    mocks.token = null
    mocks.storedTokens = null
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => usePlanStatus())
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.plan).toBe('free')
    expect(result.current.authRequired).toBe(false)
    expect(result.current.statusUnavailable).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('retombe sur Free après un passage d’un compte Google VIP à une session email', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(status('vip'))))

    const { result } = renderHook(() => usePlanStatus())
    await waitFor(() => expect(result.current.plan).toBe('vip'))

    mocks.userId = 'user-email'
    mocks.sessionEpoch += 1
    mocks.authMethod = 'email'
    mocks.token = null
    mocks.storedTokens = null
    await act(async () => {
      await result.current.refresh()
    })

    expect(result.current.plan).toBe('free')
    expect(result.current.allowedFamilies).toEqual(['claude-haiku'])
    expect(localStorage.getItem('arty-plan-cache')).toBe('free')
    expect(JSON.parse(localStorage.getItem('arty-allowed-families') ?? '[]')).toEqual(['claude-haiku'])
  })

  it('distingue un token refusé et purge les droits premium périmés', async () => {
    localStorage.setItem('arty-plan-cache', 'vip')
    localStorage.setItem('arty-allowed-families', JSON.stringify(ALL_FAMILIES))
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ ...status('free'), auth: 'token_rejected' }),
    } as Response)))

    const { result } = renderHook(() => usePlanStatus())
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.authRejected).toBe(true)
    expect(result.current.allowedFamilies).toEqual(['claude-haiku'])
    expect(localStorage.getItem('arty-plan-cache')).toBeNull()
  })

  it('marque le plan indisponible sur erreur HTTP et réessaie au retour réseau', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false } as Response)
      .mockResolvedValueOnce(response(status('vip')))
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => usePlanStatus())
    await waitFor(() => expect(result.current.statusUnavailable).toBe(true))

    act(() => window.dispatchEvent(new Event('online')))
    await waitFor(() => expect(result.current.plan).toBe('vip'))
    expect(result.current.statusUnavailable).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('mutualise une rafale de reprise entre plusieurs instances du hook', async () => {
    const fetchMock = vi.fn(async () => response(status('vip')))
    vi.stubGlobal('fetch', fetchMock)

    const first = renderHook(() => usePlanStatus())
    const second = renderHook(() => usePlanStatus())
    await waitFor(() => {
      expect(first.result.current.plan).toBe('vip')
      expect(second.result.current.plan).toBe('vip')
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(mocks.getValidAccessToken).toHaveBeenCalledTimes(1)
    fetchMock.mockClear()
    mocks.getValidAccessToken.mockClear()

    act(() => {
      window.dispatchEvent(new Event('focus'))
      window.dispatchEvent(new Event('pageshow'))
      window.dispatchEvent(new Event('online'))
    })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(mocks.getValidAccessToken).toHaveBeenCalledTimes(1)

    first.unmount()
    second.unmount()
  })
})
