import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  token: 'token-a' as string | null,
  userId: 'user-a' as string | null,
  getValidAccessToken: vi.fn(async () => 'token-a' as string | null),
  fetchWalletBalance: vi.fn(),
  creditsCoverPremium: vi.fn(() => false),
}))

vi.mock('../../services/googleAuth', () => ({
  getValidAccessToken: mocks.getValidAccessToken,
}))
vi.mock('../../services/apiBase', () => ({ apiUrl: (path: string) => path }))
vi.mock('../../services/walletClient', () => ({
  fetchWalletBalance: mocks.fetchWalletBalance,
  creditsCoverPremium: mocks.creditsCoverPremium,
}))
vi.mock('../../services/userSession', () => ({
  getActiveUserId: () => mocks.userId,
}))

import { usePlanStatus } from '../../hooks/usePlanStatus'

const ALL_FAMILIES = [
  'claude-haiku', 'claude-sonnet', 'claude-opus', 'mistral-medium',
  'gemini-flash', 'gemini-pro', 'gpt-mini', 'gpt-full',
]

function status(plan: 'free' | 'subscription' | 'pro' | 'vip') {
  const paid = plan !== 'free'
  return {
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
  mocks.token = 'token-a'
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
})
