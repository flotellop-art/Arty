import { beforeEach, describe, expect, it, vi } from 'vitest'

beforeEach(() => {
  localStorage.clear()
  vi.resetModules()
})

describe('crypto multi-compte', () => {
  it('migre chaque compte séparément sans avancer la version des autres', async () => {
    const sessions = await import('../../services/userSession')
    const crypto = await import('../../services/crypto')

    localStorage.setItem('arty-crypto-v2-disabled', '1')

    sessions.setActiveSession({
      userId: 'apikey-a', authMethod: 'apikey', displayName: 'A', createdAt: 1,
    })
    await crypto.initCrypto('secret-a')
    localStorage.setItem('arty-apikey-a-secret-enc', await crypto.encrypt('payload-a'))

    sessions.setActiveSession({
      userId: 'apikey-b', authMethod: 'apikey', displayName: 'B', createdAt: 2,
    })
    await crypto.initCrypto('secret-b')
    localStorage.setItem('arty-apikey-b-secret-enc', await crypto.encrypt('payload-b'))

    expect(localStorage.getItem('arty-apikey-a-crypto-version')).toBe('v1')
    expect(localStorage.getItem('arty-apikey-b-crypto-version')).toBe('v1')
    localStorage.removeItem('arty-crypto-v2-disabled')

    sessions.setActiveSession({
      userId: 'apikey-a', authMethod: 'apikey', displayName: 'A', createdAt: 1,
    })
    await crypto.initCrypto('secret-a')
    expect(localStorage.getItem('arty-apikey-a-crypto-version')).toBe('v2')
    expect(localStorage.getItem('arty-apikey-b-crypto-version')).toBe('v1')
    expect(await crypto.decrypt(localStorage.getItem('arty-apikey-a-secret-enc')!)).toBe('payload-a')

    sessions.setActiveSession({
      userId: 'apikey-b', authMethod: 'apikey', displayName: 'B', createdAt: 2,
    })
    await crypto.initCrypto('secret-b')
    expect(localStorage.getItem('arty-apikey-b-crypto-version')).toBe('v2')
    expect(await crypto.decrypt(localStorage.getItem('arty-apikey-b-secret-enc')!)).toBe('payload-b')

    sessions.setActiveSession({
      userId: 'apikey-a', authMethod: 'apikey', displayName: 'A', createdAt: 1,
    })
    await crypto.initCrypto('secret-a')
    expect(await crypto.decrypt(localStorage.getItem('arty-apikey-a-secret-enc')!)).toBe('payload-a')
  })

  it('recovers a legacy account containing a mix of unversioned v1 and v2 blobs', async () => {
    const sessions = await import('../../services/userSession')
    let cryptoModule = await import('../../services/crypto')
    sessions.setActiveSession({
      userId: 'apikey-mixed', authMethod: 'apikey', displayName: 'Mixed', createdAt: 1,
    })

    localStorage.setItem('arty-crypto-v2-disabled', '1')
    await cryptoModule.initCrypto('mixed-secret')
    const legacyV1 = (await cryptoModule.encrypt('legacy-v1')).replace(/^v1:/, '')
    localStorage.setItem('arty-apikey-mixed-one-enc', legacyV1)

    localStorage.removeItem('arty-crypto-v2-disabled')
    await cryptoModule.initCrypto('mixed-secret')
    const legacyV2 = (await cryptoModule.encrypt('legacy-v2')).replace(/^v2:/, '')
    localStorage.setItem('arty-apikey-mixed-two-enc', legacyV2)

    // Reproduce the pre-fix global state: global marker advanced, while this
    // account has no scoped check and contains both derivations.
    localStorage.removeItem('arty-apikey-mixed-crypto-check')
    localStorage.removeItem('arty-apikey-mixed-crypto-version')
    localStorage.setItem('arty-crypto-version', 'v2')
    vi.resetModules()
    cryptoModule = await import('../../services/crypto')
    await cryptoModule.initCrypto('mixed-secret')

    expect(await cryptoModule.decrypt(legacyV1)).toBe('legacy-v1')
    expect(await cryptoModule.decrypt(legacyV2)).toBe('legacy-v2')
    expect(localStorage.getItem('arty-apikey-mixed-crypto-version')).toBe('v2')
    expect(localStorage.getItem('arty-apikey-mixed-crypto-check')).toMatch(/^v2:/)
    // Adoption never rewrites user blobs in place, so a crash cannot mix them.
    expect(localStorage.getItem('arty-apikey-mixed-one-enc')).toBe(legacyV1)
    expect(localStorage.getItem('arty-apikey-mixed-two-enc')).toBe(legacyV2)
  })
})
