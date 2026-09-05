import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const records = new Map<string, Record<string, unknown>>()
  return {
    records,
    owner: 'user-1', epoch: 1,
    beforeRead: null as null | Promise<void>,
    transaction: vi.fn(),
    compressImageIfNeeded: vi.fn(async (data: string, mimeType: string) => ({
      data: `compressed:${data}`,
      mimeType,
      size: 42,
    })),
  }
})

vi.mock('idb', () => ({
  openDB: vi.fn(async () => ({
    put: vi.fn(async (_store: string, value: Record<string, unknown>) => {
      mocks.records.set(String(value.fileId), value)
    }),
    get: vi.fn(async (_store: string, key: string) => { await mocks.beforeRead; return mocks.records.get(key) }),
    transaction: (...args: unknown[]) => { mocks.transaction(...args); return {
      store: {
        get: async (key: string) => mocks.records.get(key),
        put: async (value: Record<string, unknown>) => { mocks.records.set(String(value.fileId), value) },
      },
      abort: vi.fn(), done: Promise.resolve(),
    } },
  })),
}))

vi.mock('../../services/crypto', async importOriginal => ({
  ...await importOriginal<typeof import('../../services/crypto')>(),
  captureCryptoGuard: () => { const owner = mocks.owner, epoch = mocks.epoch; return () => owner === mocks.owner && epoch === mocks.epoch },
  isCryptoReady: vi.fn(() => true),
  selfTestCrypto: vi.fn(async () => {}),
  encrypt: vi.fn(async (value: string) => `encrypted:${value}`),
  decrypt: vi.fn(async (value: string) => value.slice('encrypted:'.length)),
}))

vi.mock('../../services/userSession', () => ({
  getActiveUserId: () => mocks.owner,
  getActiveSessionEpoch: () => mocks.epoch,
}))

vi.mock('../../services/imageCompression', () => ({
  compressImageIfNeeded: mocks.compressImageIfNeeded,
}))

import { getFile, putFile } from '../../services/secureFileStorage'

describe('secureFileStorage — asset canonique PR-A', () => {
  beforeEach(() => {
    mocks.records.clear()
    mocks.owner = 'user-1'; mocks.epoch = 1; mocks.beforeRead = null; mocks.transaction.mockClear()
    mocks.compressImageIfNeeded.mockClear()
  })

  it('persiste exactement le canonique et restitue toutes ses métadonnées', async () => {
    await putFile({
      id: 'canonical-1',
      name: 'facade.jpg',
      type: 'image/jpeg',
      data: 'AQIDBA==', // 4 octets réels
      size: 999_999, // taille caller volontairement fausse
      width: 4096,
      height: 3072,
      normalizationVersion: 2,
    })

    expect(mocks.compressImageIfNeeded).not.toHaveBeenCalled()
    expect(mocks.records.get('canonical-1')).toMatchObject({
      mimeType: 'image/jpeg',
      size: 4,
      width: 4096,
      height: 3072,
      normalizationVersion: 2,
      encryptedData: 'encrypted:AQIDBA==',
    })
    await expect(getFile('canonical-1')).resolves.toEqual({
      id: 'canonical-1',
      name: 'facade.jpg',
      type: 'image/jpeg',
      data: 'AQIDBA==',
      size: 4,
      width: 4096,
      height: 3072,
      normalizationVersion: 2,
    })
  })

  it('garde le compresseur historique pour une image générée sans métadonnées', async () => {
    await putFile({
      id: 'legacy-generated',
      name: 'image.png',
      type: 'image/png',
      data: 'legacy-base64',
      size: 0,
    })

    expect(mocks.compressImageIfNeeded).toHaveBeenCalledWith('legacy-base64', 'image/png')
    expect(mocks.records.get('legacy-generated')).toMatchObject({
      size: 42,
      encryptedData: 'encrypted:compressed:legacy-base64',
    })
  })

  it('refuse un faux canonique sans dimensions', async () => {
    await expect(putFile({
      id: 'broken',
      name: 'broken.jpg',
      type: 'image/jpeg',
      data: 'AQID',
      normalizationVersion: 2,
    })).rejects.toThrow('invalid dimensions')
    expect(mocks.compressImageIfNeeded).not.toHaveBeenCalled()
  })

  it('refuse les métadonnées canoniques falsifiées ou hors bornes', async () => {
    const base = {
      id: 'forged',
      name: 'forged.jpg',
      type: 'image/jpeg',
      data: 'AQID',
      width: 4096,
      height: 3072,
    }

    await expect(putFile({ ...base, normalizationVersion: 99 })).rejects.toThrow(
      'Unsupported canonical image normalization version',
    )
    await expect(putFile({ ...base, width: 4097, normalizationVersion: 2 })).rejects.toThrow(
      'invalid dimensions',
    )
    await expect(putFile({ ...base, type: 'application/pdf', normalizationVersion: 2 })).rejects.toThrow(
      'unsupported MIME type',
    )
    expect(mocks.compressImageIfNeeded).not.toHaveBeenCalled()
  })
  it('refuse de remplacer le même fileId appartenant à un autre compte', async () => {
    const existing = { fileId: 'shared-id', ownerKey: 'arty-user-2', encryptedData: 'PRIVATE B' }
    mocks.records.set('shared-id', existing)
    await expect(putFile({ id: 'shared-id', name: 'a', type: 'text/plain', data: 'A' })).rejects.toThrow('Crypto context changed')
    expect(mocks.records.get('shared-id')).toBe(existing)
    expect(mocks.transaction).toHaveBeenCalledWith('files', 'readwrite')
  })
  it('refuse un owner explicite périmé avant compression ou accès IDB', async () => {
    await expect(putFile({ id: 'old', name: 'a', type: 'text/plain', data: 'A' }, 'user-2')).rejects.toThrow('Crypto context changed')
    expect(mocks.compressImageIfNeeded).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
  it('ne chiffre et ne persiste rien après changement de session durant compression', async () => {
    let release!: (value: { data: string; mimeType: string; size: number }) => void
    mocks.compressImageIfNeeded.mockReturnValueOnce(new Promise(resolve => { release = resolve }))
    const saving = putFile({ id: 'stale', name: 'a', type: 'text/plain', data: 'A' }).catch(e => e)
    mocks.owner = 'user-2'; mocks.epoch++
    release({ data: 'A', mimeType: 'text/plain', size: 1 })
    expect(await saving).toMatchObject({ name: 'CryptoContextChanged' })
    expect(mocks.records.size).toBe(0); expect(mocks.transaction).not.toHaveBeenCalled()
  })
  it('ne restitue pas un ancien fichier lu après changement de session pendant IDB', async () => {
    await putFile({ id: 'old', name: 'a', type: 'text/plain', data: 'A' })
    let release!: () => void; mocks.beforeRead = new Promise(resolve => { release = resolve })
    const reading = getFile('old')
    await Promise.resolve(); await Promise.resolve()
    mocks.epoch++; release()
    await expect(reading).resolves.toBeNull()
  })
})
