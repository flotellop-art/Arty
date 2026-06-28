import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../services/userSession', () => ({
  getActiveUserId: () => 'user-test',
}))

import { secureGet, secureSet, initCrypto, verifyCrypto } from '../../services/crypto'
import { initCryptoForApiKey, SERVER_PROVIDED_API_KEY } from '../../services/cryptoPassphrase'

describe('cryptoPassphrase server-provided hardening', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('does not use the public server-provided sentinel as the encryption passphrase', async () => {
    await initCryptoForApiKey(SERVER_PROVIDED_API_KEY)

    const localSecret = localStorage.getItem('arty-user-test-local-crypto-passphrase')
    expect(localSecret).toMatch(/^[a-f0-9]{64}$/)
    expect(localSecret).not.toBe(SERVER_PROVIDED_API_KEY)
    await expect(verifyCrypto(localSecret!)).resolves.toBe(true)
    await expect(verifyCrypto(SERVER_PROVIDED_API_KEY)).resolves.toBe(false)
  })

  it('migrates legacy ciphertext encrypted with server-provided to the local secret', async () => {
    await initCrypto(SERVER_PROVIDED_API_KEY)
    await secureSet('arty-user-test-google-tokens-enc', { access_token: 'legacy-token' })

    await initCryptoForApiKey(SERVER_PROVIDED_API_KEY)

    const localSecret = localStorage.getItem('arty-user-test-local-crypto-passphrase')
    expect(localSecret).toMatch(/^[a-f0-9]{64}$/)
    await expect(verifyCrypto(localSecret!)).resolves.toBe(true)
    await expect(secureGet<{ access_token: string }>('arty-user-test-google-tokens-enc')).resolves.toEqual({
      access_token: 'legacy-token',
    })
  })
})
