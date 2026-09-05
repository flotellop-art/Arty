import 'fake-indexeddb/auto'
import { openDB } from 'idb'
import { describe, expect, it, vi, beforeEach } from 'vitest'
vi.mock('../../services/crypto', async original => ({
  ...await original<typeof import('../../services/crypto')>(),
  captureCryptoGuard: () => () => true, isCryptoReady: () => true,
  encrypt: vi.fn(async (data: string) => `encrypted:${data}`),
}))
vi.mock('../../services/userSession', () => ({ getActiveUserId: () => 'owner', getActiveSessionEpoch: () => 1 }))
vi.mock('../../services/imageCompression', () => ({ compressImageIfNeeded: vi.fn(async (data: string, mimeType: string) => ({ data, mimeType, size: 1 })) }))
import { putFile } from '../../services/secureFileStorage'
import { encrypt } from '../../services/crypto'
import { compressImageIfNeeded } from '../../services/imageCompression'
const file = { id: 'request-file', name: 'file.txt', type: 'text/plain', data: 'YQ==', size: 1 }
describe('request guard inside real IndexedDB transactions (fake-indexeddb)', () => {
  beforeEach(() => vi.clearAllMocks())
  it.each(['compression', 'encryption'] as const)('Stop during %s prevents insertion', async phase => {
    let current = true
    if (phase === 'compression') vi.mocked(compressImageIfNeeded).mockImplementationOnce(async (data, mimeType) => { current = false; return { data, mimeType, size: 1 } })
    else vi.mocked(encrypt).mockImplementationOnce(async data => { current = false; return data })
    await expect(putFile({ ...file, id: phase }, 'owner', () => { if (!current) throw new DOMException('cancelled', 'AbortError') })).rejects.toMatchObject({ name: 'AbortError' })
    // The DB may not have been opened at all: initialize it through a valid unrelated write.
    await putFile({ ...file, id: `unrelated-${phase}` }, 'owner')
    const db = await openDB('arty-files', 1)
    expect(await db.get('files', phase)).toBeUndefined(); db.close()
  })
  it('aborts the transaction if the guard fails just before or after put, preserving an existing record', async () => {
    await putFile(file, 'owner')
    const db = await openDB('arty-files', 1)
    const original = await db.get('files', file.id)
    // Guard boundaries: entry, compressed, encrypted, DB open, tx.get, tx.put, tx.done.
    for (const failAt of [5, 6]) {
      let count = 0
      await expect(putFile({ ...file, data: 'Yg==' }, 'owner', () => { if (++count === failAt) throw new DOMException('cancelled', 'AbortError') })).rejects.toMatchObject({ name: 'AbortError' })
      expect(await db.get('files', file.id)).toEqual(original)
    }
    db.close()
  })
})
