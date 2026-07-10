import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Session = {
  userId: string
  authMethod: 'google' | 'email' | 'apikey' | 'demo'
  displayName: string
  email?: string
  createdAt: number
}

const deps = vi.hoisted(() => ({
  googleToken: vi.fn(),
  trialToken: vi.fn(),
  clearAllForActiveUser: vi.fn(),
  removeKnownSession: vi.fn(),
  clearActiveSession: vi.fn(),
  purgeLegacyGlobalReports: vi.fn(),
  wipeFileStorage: vi.fn(async () => {}),
  session: null as Session | null,
}))

vi.mock('../../services/googleAuth', () => ({ getValidAccessToken: deps.googleToken }))
vi.mock('../../services/emailTrialClient', () => ({ getTrialToken: deps.trialToken }))
vi.mock('../../services/apiBase', () => ({ apiUrl: (path: string) => path }))
vi.mock('../../services/scopedStorage', () => ({
  clearAllForActiveUser: deps.clearAllForActiveUser,
}))
vi.mock('../../services/userSession', () => ({
  getActiveSession: () => deps.session,
  getActiveUserId: () => deps.session?.userId ?? null,
  removeKnownSession: deps.removeKnownSession,
  clearActiveSession: deps.clearActiveSession,
  purgeLegacyGlobalReports: deps.purgeLegacyGlobalReports,
}))
vi.mock('../../services/secureFileStorage', () => ({
  wipeFileStorage: deps.wipeFileStorage,
}))

import {
  deleteAccount,
  deleteServerAccount,
  wipeLocalAccount,
} from '../../services/accountService'

const googleSession = (): Session => ({
  userId: 'google-user',
  authMethod: 'google',
  displayName: 'Google User',
  email: 'google@example.com',
  createdAt: 1,
})

const emailSession = (): Session => ({
  userId: 'email-user',
  authMethod: 'email',
  displayName: 'Email User',
  email: 'email@example.com',
  createdAt: 1,
})

describe('accountService — fail-closed account erasure', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    deps.session = googleSession()
    deps.googleToken.mockResolvedValue('google-token')
    deps.trialToken.mockReturnValue(null)
    deps.wipeFileStorage.mockResolvedValue(undefined)
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => vi.unstubAllGlobals())

  it('sends x-arty-trial-token for an authenticated email session', async () => {
    deps.session = emailSession()
    deps.trialToken.mockReturnValue('trial-session-token')

    await deleteServerAccount()

    expect(deps.googleToken).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledWith('/api/account/delete', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ 'x-arty-trial-token': 'trial-session-token' }),
    }))
  })

  it('uses only the Google credential for a Google session', async () => {
    deps.trialToken.mockReturnValue('stale-trial-token')

    await deleteServerAccount()

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(init.headers).toMatchObject({ 'x-google-token': 'google-token' })
    expect(init.headers).not.toHaveProperty('x-arty-trial-token')
  })

  it('fails closed when a Google session has no valid Google credential', async () => {
    deps.googleToken.mockResolvedValue(null)
    deps.trialToken.mockReturnValue('unrelated-trial-token')

    await expect(deleteServerAccount()).rejects.toThrow('Google credential unavailable')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fails closed when an email session has no trial credential', async () => {
    deps.session = emailSession()
    deps.googleToken.mockResolvedValue('unrelated-google-token')
    deps.trialToken.mockReturnValue(null)

    await expect(deleteServerAccount()).rejects.toThrow('Email credential unavailable')
    expect(deps.googleToken).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('keeps API-key and demo sessions local-only', async () => {
    deps.session = {
      userId: 'apikey-user',
      authMethod: 'apikey',
      displayName: 'Local User',
      createdAt: 1,
    }

    await deleteServerAccount()

    expect(deps.googleToken).not.toHaveBeenCalled()
    expect(deps.trialToken).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not wipe local data when server authentication is unavailable', async () => {
    deps.googleToken.mockResolvedValue(null)

    await expect(deleteAccount()).rejects.toThrow('Google credential unavailable')

    expect(deps.wipeFileStorage).not.toHaveBeenCalled()
    expect(deps.clearAllForActiveUser).not.toHaveBeenCalled()
    expect(deps.clearActiveSession).not.toHaveBeenCalled()
  })

  it('propagates IndexedDB deletion failures before clearing local state', async () => {
    deps.wipeFileStorage.mockRejectedValueOnce(new Error('IndexedDB unavailable'))

    await expect(wipeLocalAccount()).rejects.toThrow('IndexedDB unavailable')

    expect(deps.wipeFileStorage).toHaveBeenCalledWith('google-user')
    expect(deps.purgeLegacyGlobalReports).not.toHaveBeenCalled()
    expect(deps.clearAllForActiveUser).not.toHaveBeenCalled()
    expect(deps.removeKnownSession).not.toHaveBeenCalled()
    expect(deps.clearActiveSession).not.toHaveBeenCalled()
  })
})
