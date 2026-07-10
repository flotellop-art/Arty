import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const session = {
    userId: 'user-a',
    authMethod: 'apikey' as const,
    displayName: 'User A',
    createdAt: 1,
  }
  return {
    session,
    clearActiveSession: vi.fn(),
    removeKnownSession: vi.fn(),
    wipeFileStorage: vi.fn(async () => {}),
    googleLogout: vi.fn(),
    clearActiveKeys: vi.fn(),
    resetConversationMemCache: vi.fn(),
  }
})

vi.mock('../../services/userSession', () => ({
  getActiveSession: () => mocks.session,
  getActiveUserId: () => mocks.session.userId,
  getKnownSessions: () => [mocks.session],
  clearActiveSession: mocks.clearActiveSession,
  removeKnownSession: mocks.removeKnownSession,
  setActiveSession: vi.fn(),
  generateUserId: vi.fn(async () => mocks.session.userId),
  migrateExistingData: vi.fn(),
  purgeLegacyGlobalReports: vi.fn(),
}))
vi.mock('../../services/activeApiKey', () => ({
  setActiveKeys: vi.fn(),
  clearActiveKeys: mocks.clearActiveKeys,
}))
vi.mock('../../services/crypto', () => ({ initCrypto: vi.fn(async () => {}) }))
vi.mock('../../services/googleAuth', () => ({
  bootstrapGoogleStorage: vi.fn(async () => {}),
  logout: mocks.googleLogout,
  clearOAuthState: vi.fn(),
  resetGoogleMemCache: vi.fn(),
}))
vi.mock('../../services/secureFileStorage', () => ({
  bootstrapFileStorage: vi.fn(async () => {}),
  wipeFileStorage: mocks.wipeFileStorage,
}))
vi.mock('../../services/storage', () => ({
  bootstrapConversationStorage: vi.fn(async () => {}),
  resetConversationMemCache: mocks.resetConversationMemCache,
}))
vi.mock('../../services/scopedStorage', () => ({
  getJSON: vi.fn(() => null),
  setJSON: vi.fn(),
  removeItem: vi.fn(),
}))
vi.mock('../../services/emailTrialClient', () => ({ clearTrialToken: vi.fn() }))
vi.mock('../../services/reportGenerator', () => ({ purgeLegacyGlobalReports: vi.fn() }))
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false },
  registerPlugin: vi.fn(),
}))

import { useAuth } from '../../hooks/useAuth'

describe('useAuth logout retention', () => {
  beforeEach(() => vi.clearAllMocks())

  it('keeps encrypted attachments on a simple logout', () => {
    const { result } = renderHook(() => useAuth())

    act(() => result.current.logout())

    expect(mocks.wipeFileStorage).not.toHaveBeenCalled()
    expect(mocks.clearActiveKeys).toHaveBeenCalledOnce()
    expect(mocks.googleLogout).toHaveBeenCalledOnce()
    expect(mocks.clearActiveSession).toHaveBeenCalledOnce()
    expect(mocks.removeKnownSession).toHaveBeenCalledWith('user-a')
    expect(mocks.resetConversationMemCache).toHaveBeenCalledOnce()
    expect(result.current.currentUser).toBeNull()
  })
})
