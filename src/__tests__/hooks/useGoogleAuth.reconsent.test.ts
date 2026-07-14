import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  tokens: null as null | { access_token: string },
  reconsent: true,
  storageReady: false,
  buildOAuthUrl: vi.fn(async () => 'https://accounts.google.com/oauth'),
  logout: vi.fn(),
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false, getPlatform: () => 'web' },
  registerPlugin: () => ({ signIn: vi.fn(), signOut: vi.fn() }),
}))

vi.mock('../../services/googleAuth', () => ({
  buildOAuthUrl: mocks.buildOAuthUrl,
  exchangeCode: vi.fn(),
  fetchGoogleUser: vi.fn(),
  getStoredTokens: () => mocks.tokens,
  getStoredUser: () => null,
  getValidAccessToken: vi.fn(async () => null),
  isGoogleOAuthReconsentRequired: () => mocks.reconsent,
  isGoogleStorageReady: () => mocks.storageReady,
  storeUser: vi.fn(),
  logout: mocks.logout,
}))

import { useGoogleAuth } from '../../hooks/useGoogleAuth'

beforeEach(() => {
  mocks.tokens = null
  mocks.reconsent = true
  mocks.storageReady = false
  mocks.buildOAuthUrl.mockClear()
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
})
