import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  active: null as null | {
    userId: string
    authMethod: 'google' | 'email' | 'apikey' | 'demo'
    displayName: string
    email?: string
    createdAt: number
  },
  epoch: 0,
  known: [] as Array<{
    userId: string
    authMethod: 'google' | 'email' | 'apikey' | 'demo'
    displayName: string
    email?: string
    createdAt: number
  }>,
  rememberSession: vi.fn(),
  initCrypto: vi.fn(async () => {}),
  bootstrapConversationStorage: vi.fn(async () => {}),
  bootstrapFileStorage: vi.fn(async () => {}),
  scoped: new Map<string, string>(),
  googleLogout: vi.fn(),
  resetGoogleMemCache: vi.fn(),
}))

vi.mock('../../services/userSession', () => ({
  getActiveSession: () => mocks.active,
  getActiveUserId: () => mocks.active?.userId ?? null,
  getActiveSessionEpoch: () => mocks.epoch,
  getKnownSessions: () => [...mocks.known],
  generateUserId: vi.fn(async () => 'google-user-a'),
  setActiveSession: vi.fn((session, options) => {
    mocks.epoch += 1
    mocks.active = session
    if (options?.remember !== false) mocks.known = [session]
  }),
  rememberSession: vi.fn((session) => {
    mocks.rememberSession(session)
    mocks.known = [session]
  }),
  clearActiveSession: vi.fn(() => {
    mocks.epoch += 1
    mocks.active = null
  }),
  removeKnownSession: vi.fn(),
  migrateExistingData: vi.fn(),
  purgeLegacyGlobalReports: vi.fn(),
}))
vi.mock('../../services/activeApiKey', () => ({ setActiveKeys: vi.fn(), clearActiveKeys: vi.fn() }))
vi.mock('../../services/crypto', () => ({ initCrypto: mocks.initCrypto }))
vi.mock('../../services/googleAuth', () => ({
  bootstrapGoogleStorage: vi.fn(async () => {}),
  logout: mocks.googleLogout,
  clearOAuthState: vi.fn(),
  resetGoogleMemCache: mocks.resetGoogleMemCache,
}))
vi.mock('../../services/secureFileStorage', () => ({
  bootstrapFileStorage: mocks.bootstrapFileStorage,
}))
vi.mock('../../services/storage', () => ({
  bootstrapConversationStorage: mocks.bootstrapConversationStorage,
  resetConversationMemCache: vi.fn(),
}))
vi.mock('../../services/scopedStorage', () => ({
  getJSON: vi.fn(() => null),
  getItem: vi.fn((key: string) => mocks.scoped.get(`${mocks.active?.userId}:${key}`) ?? null),
  setItem: vi.fn((key: string, value: string) => {
    mocks.scoped.set(`${mocks.active?.userId}:${key}`, value)
  }),
  removeItem: vi.fn((key: string) => {
    mocks.scoped.delete(`${mocks.active?.userId}:${key}`)
  }),
}))
vi.mock('../../services/emailTrialClient', () => ({ clearTrialToken: vi.fn() }))
vi.mock('../../services/walletClient', () => ({ clearWalletCache: vi.fn() }))
vi.mock('../../services/trialClient', () => ({
  adoptPendingTrialRemaining: vi.fn(),
  clearPendingTrialRemaining: vi.fn(),
}))
vi.mock('../../services/composerDrafts', () => ({ purgeComposerDraftsForActiveUser: vi.fn() }))
vi.mock('../../services/mailAccounts', () => ({ resetMailAccountsCache: vi.fn() }))
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false },
  registerPlugin: vi.fn(),
}))

import { useAuth } from '../../hooks/useAuth'

const credentials = {
  displayName: 'User A',
  email: 'user@example.com',
  anthropicKey: 'server-provided',
  identifier: 'user@example.com',
}

describe('useAuth login transaction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.active = null
    mocks.epoch = 0
    mocks.known = []
    mocks.scoped.clear()
    mocks.initCrypto.mockReset()
    mocks.initCrypto.mockResolvedValue(undefined)
    mocks.bootstrapConversationStorage.mockReset()
    mocks.bootstrapConversationStorage.mockResolvedValue(undefined)
    mocks.bootstrapFileStorage.mockReset()
    mocks.bootstrapFileStorage.mockResolvedValue(undefined)
  })

  it('ne publie pas currentUser avant que le grant soit durable', async () => {
    let finish!: () => void
    const finalizer = vi.fn(() => new Promise<void>((resolve) => { finish = resolve }))
    const { result } = renderHook(() => useAuth())

    let pending!: Promise<unknown>
    act(() => {
      pending = result.current.login('google', credentials, finalizer)
    })
    await waitFor(() => expect(finalizer).toHaveBeenCalledOnce())

    expect(result.current.currentUser).toBeNull()
    expect(mocks.known).toEqual([])
    expect(mocks.rememberSession).not.toHaveBeenCalled()

    finish()
    await act(async () => { await pending })
    expect(result.current.currentUser?.userId).toBe('google-user-a')
    expect(mocks.known).toHaveLength(1)
    expect(mocks.rememberSession).toHaveBeenCalledOnce()
  })

  it('rollback la session provisoire si la persistance du grant échoue', async () => {
    const { result } = renderHook(() => useAuth())

    await act(async () => {
      await expect(result.current.login('google', credentials, async () => {
        throw new Error('storage failed')
      })).rejects.toThrow('storage failed')
    })

    expect(result.current.currentUser).toBeNull()
    expect(mocks.active).toBeNull()
    expect(mocks.known).toEqual([])
    expect(mocks.googleLogout).toHaveBeenCalledWith({ notify: false })
    expect(mocks.resetGoogleMemCache).toHaveBeenCalledOnce()
  })

  it('restaure les clés BYOK préexistantes après un échec de reconnexion', async () => {
    mocks.scoped.set('google-user-a:api-keys', JSON.stringify({ anthropic: 'existing-byok' }))
    const { result } = renderHook(() => useAuth())

    await act(async () => {
      await expect(result.current.login('google', credentials, async () => {
        throw new Error('grant failed')
      })).rejects.toThrow('grant failed')
    })

    expect(mocks.scoped.get('google-user-a:api-keys')).toBe(
      JSON.stringify({ anthropic: 'existing-byok' }),
    )
  })

  it('refuse une nouvelle transaction si une session publiée est déjà active', async () => {
    const previous = {
      userId: 'google-previous',
      authMethod: 'google' as const,
      displayName: 'Previous',
      email: 'previous@example.com',
      createdAt: 1,
    }
    mocks.active = previous
    mocks.known = [previous]
    const { result } = renderHook(() => useAuth())

    const finalizer = vi.fn()
    await act(async () => {
      await expect(result.current.login('google', credentials, finalizer))
        .rejects.toThrow(/sign out/i)
    })

    expect(mocks.active).toEqual(previous)
    expect(result.current.currentUser).toEqual(previous)
    expect(finalizer).not.toHaveBeenCalled()
    expect(mocks.googleLogout).not.toHaveBeenCalled()
    expect(mocks.initCrypto).not.toHaveBeenCalled()
  })

  it('ne bloque pas la connexion si les stockages optionnels sont indisponibles', async () => {
    mocks.bootstrapConversationStorage.mockRejectedValueOnce(new Error('conversation idb unavailable'))
    mocks.bootstrapFileStorage.mockRejectedValueOnce(new Error('file idb unavailable'))
    const { result } = renderHook(() => useAuth())

    await act(async () => {
      await expect(result.current.login('google', credentials)).resolves.toMatchObject({
        userId: 'google-user-a',
      })
    })

    expect(result.current.currentUser?.userId).toBe('google-user-a')
    expect(mocks.rememberSession).toHaveBeenCalledOnce()
  })

  it('ne fait aucune écriture sous B si A est remplacé pendant initCrypto', async () => {
    let finishCrypto!: () => void
    mocks.initCrypto.mockReturnValueOnce(new Promise<void>((resolve) => { finishCrypto = resolve }))
    const { result } = renderHook(() => useAuth())

    let pending!: Promise<unknown>
    act(() => {
      pending = result.current.login('google', credentials)
    })
    await waitFor(() => expect(mocks.initCrypto).toHaveBeenCalledOnce())

    mocks.active = {
      userId: 'google-user-b',
      authMethod: 'google',
      displayName: 'User B',
      email: 'b@example.com',
      createdAt: 2,
    }
    mocks.epoch += 1
    finishCrypto()

    await act(async () => {
      await expect(pending).rejects.toThrow(/superseded/i)
    })
    expect(mocks.scoped.has('google-user-b:api-keys')).toBe(false)
    expect(mocks.googleLogout).not.toHaveBeenCalled()
  })

  it('ne rollback jamais un autre compte qui gagne pendant le finaliseur', async () => {
    let finish!: () => void
    const finalizer = vi.fn(() => new Promise<void>((resolve) => { finish = resolve }))
    const { result } = renderHook(() => useAuth())

    let pending!: Promise<unknown>
    act(() => {
      pending = result.current.login('google', credentials, finalizer)
    })
    await waitFor(() => expect(finalizer).toHaveBeenCalledOnce())

    mocks.active = {
      userId: 'google-user-b',
      authMethod: 'google',
      displayName: 'User B',
      email: 'b@example.com',
      createdAt: 2,
    }
    mocks.epoch += 1
    finish()

    await act(async () => {
      await expect(pending).rejects.toThrow(/superseded/i)
    })
    expect(mocks.active?.userId).toBe('google-user-b')
    expect(mocks.googleLogout).not.toHaveBeenCalled()
    expect(mocks.resetGoogleMemCache).not.toHaveBeenCalled()
  })
})
