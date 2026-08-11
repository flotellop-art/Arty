import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  tokens: null as null | { access_token: string },
  reconsent: true,
  storageReady: false,
  activeSession: null as null | {
    userId: string
    authMethod: 'google' | 'email'
    displayName: string
    email?: string
    createdAt: number
  },
  epoch: 0,
  buildOAuthUrl: vi.fn(async () => 'https://accounts.google.com/oauth'),
  exchangeCode: vi.fn(),
  fetchGoogleUser: vi.fn(),
  storeMailboxFreeGrant: vi.fn(),
  storeUser: vi.fn(),
  logout: vi.fn(),
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false, getPlatform: () => 'web' },
  registerPlugin: () => ({ signIn: vi.fn(), signOut: vi.fn() }),
}))

vi.mock('../../services/googleAuth', () => ({
  buildOAuthUrl: mocks.buildOAuthUrl,
  exchangeCode: mocks.exchangeCode,
  fetchGoogleUser: mocks.fetchGoogleUser,
  getStoredTokens: () => mocks.tokens,
  getStoredUser: () => null,
  getValidAccessToken: vi.fn(async () => null),
  isGoogleOAuthReconsentRequired: () => mocks.reconsent,
  isGoogleStorageReady: () => mocks.storageReady,
  storeMailboxFreeGrant: mocks.storeMailboxFreeGrant,
  storeUser: mocks.storeUser,
  logout: mocks.logout,
}))
vi.mock('../../services/userSession', () => ({
  getActiveSession: () => mocks.activeSession,
  getActiveUserId: () => mocks.activeSession?.userId ?? null,
  getActiveSessionEpoch: () => mocks.epoch,
  generateUserId: vi.fn(async (_method: string, email: string) => `google:${email.toLowerCase()}`),
}))

import { useGoogleAuth } from '../../hooks/useGoogleAuth'

beforeEach(() => {
  mocks.tokens = null
  mocks.reconsent = true
  mocks.storageReady = false
  mocks.activeSession = null
  mocks.epoch = 0
  mocks.buildOAuthUrl.mockClear()
  mocks.exchangeCode.mockReset()
  mocks.fetchGoogleUser.mockReset()
  mocks.storeMailboxFreeGrant.mockReset()
  mocks.storeMailboxFreeGrant.mockResolvedValue(undefined)
  mocks.storeUser.mockReset()
  mocks.storeUser.mockResolvedValue(true)
  mocks.logout.mockClear()
})

describe('useGoogleAuth — reconsentement Calendar', () => {
  it('bloque OAuth tant que le stockage chiffré n’est pas prêt', async () => {
    const { result } = renderHook(() => useGoogleAuth())

    expect(result.current.isConnected).toBe(false)
    expect(result.current.reconsentRequired).toBe(true)
    expect(result.current.isInitializing).toBe(true)
    await act(async () => result.current.login())
    expect(mocks.buildOAuthUrl).not.toHaveBeenCalled()
  })

  it('resynchronise la notice après un grant courant réussi', async () => {
    const { result } = renderHook(() => useGoogleAuth())

    mocks.tokens = { access_token: 'current' }
    mocks.reconsent = false
    mocks.storageReady = true
    act(() => window.dispatchEvent(new CustomEvent('google-storage-ready')))

    await waitFor(() => {
      expect(result.current.isConnected).toBe(true)
      expect(result.current.reconsentRequired).toBe(false)
      expect(result.current.isInitializing).toBe(false)
    })
  })

  it('reconnexion web : valide le même compte puis commit sous owner+epoch', async () => {
    mocks.activeSession = {
      userId: 'google:user@example.com',
      authMethod: 'google',
      displayName: 'User',
      email: 'user@example.com',
      createdAt: 1,
    }
    mocks.epoch = 7
    mocks.storageReady = true
    mocks.exchangeCode.mockResolvedValue({
      access_token: 'fresh-token',
      refresh_token: 'fresh-refresh',
      expires_at: Date.now() + 3600_000,
    })
    mocks.fetchGoogleUser.mockResolvedValue({
      email: 'user@example.com',
      name: 'User',
      picture: '',
    })
    const { result } = renderHook(() => useGoogleAuth())

    await act(async () => result.current.handleCallback('oauth-code'))

    expect(mocks.exchangeCode).toHaveBeenCalledWith('oauth-code', undefined, false)
    expect(mocks.fetchGoogleUser).toHaveBeenCalledWith('fresh-token', false)
    expect(mocks.storeUser).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'user@example.com' }),
      { userId: 'google:user@example.com', sessionEpoch: 7 },
    )
    expect(mocks.storeMailboxFreeGrant).toHaveBeenCalledWith(
      expect.objectContaining({ access_token: 'fresh-token' }),
      { userId: 'google:user@example.com', sessionEpoch: 7 },
      { preserveExistingRefreshToken: true, verifiedEmail: 'user@example.com' },
    )
    expect(mocks.storeUser.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.storeMailboxFreeGrant.mock.invocationCallOrder[0],
    )
    expect(result.current.isConnected).toBe(true)
  })

  it('reconnexion web : refuse un autre compte avant toute persistance', async () => {
    mocks.activeSession = {
      userId: 'google:user@example.com',
      authMethod: 'google',
      displayName: 'User',
      email: 'user@example.com',
      createdAt: 1,
    }
    mocks.epoch = 2
    mocks.storageReady = true
    mocks.exchangeCode.mockResolvedValue({ access_token: 'other-token' })
    mocks.fetchGoogleUser.mockResolvedValue({
      email: 'other@example.com',
      name: 'Other',
      picture: '',
    })
    const { result } = renderHook(() => useGoogleAuth())

    await act(async () => result.current.handleCallback('oauth-code'))

    expect(result.current.error).toMatch(/même compte Google/i)
    expect(mocks.storeUser).not.toHaveBeenCalled()
    expect(mocks.storeMailboxFreeGrant).not.toHaveBeenCalled()
  })

  it('purge fail-closed si le commit utilisateur échoue avant le grant', async () => {
    mocks.activeSession = {
      userId: 'google:user@example.com',
      authMethod: 'google',
      displayName: 'User',
      email: 'user@example.com',
      createdAt: 1,
    }
    mocks.epoch = 7
    mocks.exchangeCode.mockResolvedValue({ access_token: 'fresh-token', refresh_token: '', expires_at: 2 })
    mocks.fetchGoogleUser.mockResolvedValue({ email: 'user@example.com', name: 'User', picture: '' })
    mocks.storeUser.mockResolvedValue(false)
    const { result } = renderHook(() => useGoogleAuth())

    await act(async () => result.current.handleCallback('oauth-code'))

    expect(mocks.storeMailboxFreeGrant).not.toHaveBeenCalled()
    expect(mocks.logout).toHaveBeenCalledOnce()
    expect(result.current.isConnected).toBe(false)
  })

  it('purge fail-closed si le grant échoue après le commit utilisateur', async () => {
    mocks.activeSession = {
      userId: 'google:user@example.com',
      authMethod: 'google',
      displayName: 'User',
      email: 'user@example.com',
      createdAt: 1,
    }
    mocks.epoch = 7
    mocks.exchangeCode.mockResolvedValue({ access_token: 'fresh-token', refresh_token: '', expires_at: 2 })
    mocks.fetchGoogleUser.mockResolvedValue({ email: 'user@example.com', name: 'User', picture: '' })
    mocks.storeMailboxFreeGrant.mockRejectedValue(new Error('quota exceeded'))
    const { result } = renderHook(() => useGoogleAuth())

    await act(async () => result.current.handleCallback('oauth-code'))

    expect(mocks.storeUser).toHaveBeenCalledOnce()
    expect(mocks.logout).toHaveBeenCalledOnce()
    expect(result.current.isConnected).toBe(false)
  })

  it('un compte Arty email peut lier un compte Google distinct pour Agenda', async () => {
    mocks.activeSession = {
      userId: 'email:local@example.com',
      authMethod: 'email',
      displayName: 'Local User',
      email: 'local@example.com',
      createdAt: 1,
    }
    mocks.epoch = 4
    mocks.storageReady = true
    mocks.exchangeCode.mockResolvedValue({ access_token: 'calendar-token' })
    mocks.fetchGoogleUser.mockResolvedValue({
      email: 'calendar@example.com',
      name: 'Calendar Account',
      picture: '',
    })
    const { result } = renderHook(() => useGoogleAuth())

    await act(async () => result.current.handleCallback('oauth-code'))

    expect(mocks.storeUser).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'calendar@example.com' }),
      { userId: 'email:local@example.com', sessionEpoch: 4 },
    )
    expect(mocks.storeMailboxFreeGrant).toHaveBeenCalledWith(
      expect.objectContaining({ access_token: 'calendar-token' }),
      { userId: 'email:local@example.com', sessionEpoch: 4 },
      { preserveExistingRefreshToken: true, verifiedEmail: 'calendar@example.com' },
    )
    expect(result.current.error).toBeNull()
    expect(result.current.isConnected).toBe(true)
  })

  it('reconnexion web : un changement d’époque pendant le callback annule le commit', async () => {
    mocks.activeSession = {
      userId: 'google:user@example.com',
      authMethod: 'google',
      displayName: 'User',
      email: 'user@example.com',
      createdAt: 1,
    }
    mocks.epoch = 3
    mocks.storageReady = true
    mocks.exchangeCode.mockResolvedValue({ access_token: 'fresh-token' })
    let resolveUser!: (user: { email: string; name: string; picture: string }) => void
    mocks.fetchGoogleUser.mockReturnValue(new Promise((resolve) => { resolveUser = resolve }))
    const { result } = renderHook(() => useGoogleAuth())

    let pending!: Promise<void>
    act(() => { pending = result.current.handleCallback('oauth-code') })
    await waitFor(() => expect(mocks.fetchGoogleUser).toHaveBeenCalledOnce())
    mocks.epoch += 1
    resolveUser({ email: 'user@example.com', name: 'User', picture: '' })
    await act(async () => { await pending })

    expect(result.current.error).toMatch(/session active a changé/i)
    expect(mocks.storeUser).not.toHaveBeenCalled()
    expect(mocks.storeMailboxFreeGrant).not.toHaveBeenCalled()
  })
})
