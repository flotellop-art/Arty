import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  owner: 'account-a',
  resolveDecrypt: null as null | ((value: string) => void),
  delayEncrypt: false,
  resolveEncrypt: null as null | ((value: string) => void),
}))

vi.mock('../../services/apiBase', () => ({ apiUrl: (path: string) => path }))
vi.mock('../../services/userSession', () => ({ getActiveUserId: () => state.owner }))
vi.mock('../../services/crypto', () => ({
  isCryptoReady: () => true,
  decrypt: vi.fn(() => new Promise<string>((resolve) => { state.resolveDecrypt = resolve })),
  encrypt: vi.fn((value: string) => state.delayEncrypt
    ? new Promise<string>((resolve) => { state.resolveEncrypt = resolve })
    : Promise.resolve(`encrypted:${value}`)),
  selfTestCrypto: vi.fn(async () => true),
}))

import * as googleAuth from '../../services/googleAuth'

beforeEach(() => {
  localStorage.clear()
  state.owner = 'account-a'
  state.resolveDecrypt = null
  state.delayEncrypt = false
  state.resolveEncrypt = null
  googleAuth.resetGoogleMemCache()
})

describe('googleAuth — bootstrap et changement de compte', () => {
  it('ignore un déchiffrement du compte A terminé après activation du compte B', async () => {
    localStorage.setItem('arty-account-a-google-tokens-enc', 'ciphertext-a')
    const bootstrapA = googleAuth.bootstrapGoogleStorage()

    await vi.waitFor(() => expect(state.resolveDecrypt).not.toBeNull())
    googleAuth.resetGoogleMemCache()
    state.owner = 'account-b'
    state.resolveDecrypt!(JSON.stringify({
      access_token: 'token-a',
      refresh_token: 'refresh-a',
      expires_at: Date.now() + 3600_000,
      oauth_profile: 'calendar-events-v1',
    }))
    await bootstrapA

    expect(googleAuth.getStoredTokens()).toBeNull()
    expect(googleAuth.isGoogleStorageReady()).toBe(false)
    expect(localStorage.getItem('arty-account-b-google-tokens-enc')).toBeNull()
  })

  it('ne pose aucun marqueur sous B si la persistance du grant A finit après le switch', async () => {
    state.delayEncrypt = true
    const storingA = googleAuth.storeMailboxFreeGrant({
      access_token: 'token-a',
      refresh_token: 'refresh-a',
      expires_at: Date.now() + 3600_000,
    })
    await vi.waitFor(() => expect(state.resolveEncrypt).not.toBeNull())

    state.owner = 'account-b'
    state.resolveEncrypt!('encrypted-a')

    await expect(storingA).rejects.toThrow(/superseded/i)
    expect(googleAuth.getStoredTokens()).toBeNull()
    expect(localStorage.getItem('arty-account-b-google-oauth-mailbox-free-v1')).toBeNull()
    expect(localStorage.getItem('arty-account-b-google-oauth-reconsent-required')).toBeNull()
    expect(localStorage.getItem('arty-account-b-google-tokens-enc')).toBeNull()
  })
})
