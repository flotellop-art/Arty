import 'fake-indexeddb/auto'
import { openDB } from 'idb'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
const files = vi.hoisted(() => ({ getFile: vi.fn() }))
vi.mock('../../services/secureFileStorage', () => files)
import { captureGeneratedImageView, readGeneratedImage } from '../../services/generatedImageFiles'
import { initCrypto } from '../../services/crypto'
import * as users from '../../services/userSession'
import { generatedImageIds, validGeneratedImage } from '../../services/generatedImages'
const id = '123e4567-e89b-12d3-a456-426614174000'
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a9sAAAAASUVORK5CYII='
const session = { userId: 'a', authMethod: 'demo' as const, displayName: 'Synthetic', createdAt: 1 }
function deferred<T>() { let resolve!: (value: T) => void; return { promise: new Promise<T>(r => { resolve = r }), resolve: (value: T) => resolve(value) } }
beforeEach(async () => {
  vi.clearAllMocks(); localStorage.clear(); users.setActiveSession(session); await initCrypto('synthetic')
  const { beginProjectOperation } = await import('../../services/projects/store')
  try { await beginProjectOperation() } catch { /* previous test deliberately fenced */ }
  const db = await openDB('arty-projects', 1); await db.delete('meta', 'erasure-fence'); db.close()
  files.getFile.mockResolvedValue({ id, name: 'image.png', type: 'image/png', data: png })
})
afterEach(() => vi.restoreAllMocks())
describe('gallery reads with real scope/crypto/IDB fence', () => {
  it('reads explicit owner and uses stored MIME, not original misleading filename', async () => {
    files.getFile.mockResolvedValue({ id, name: 'image.png', type: 'image/jpeg', data: btoa('\xff\xd8\xffsynthetic-jpeg') })
    const result = await readGeneratedImage(id, new AbortController().signal, captureGeneratedImageView())
    expect(files.getFile).toHaveBeenCalledWith(id, 'a')
    expect(result.blob.type).toBe('image/jpeg'); expect(result.filename).toBe(`arty-image-${id}.jpg`)
    await result.validate()
  })
  it.each(['aba', 'epoch', 'crypto', 'fence', 'durable', 'known', 'abort'] as const)('refuses a late binary after %s invalidation', async change => {
    const gate = deferred<unknown>(), controller = new AbortController()
    files.getFile.mockReturnValue(gate.promise)
    const pending = readGeneratedImage(id, controller.signal, captureGeneratedImageView())
    const rejected = expect(pending).rejects.toThrow()
    while (!files.getFile.mock.calls.length) await new Promise(resolve => setTimeout(resolve, 1))
    if (change === 'aba') { users.setActiveSession({ ...session, userId: 'b' }); users.setActiveSession(session) }
    if (change === 'epoch') users.invalidateActiveSessionWork()
    if (change === 'crypto') await initCrypto('changed')
    if (change === 'fence') localStorage.setItem(users.PROJECT_ERASURE_FENCE_KEY, 'changed')
    if (change === 'durable') { const db = await openDB('arty-projects', 1); await db.put('meta', 'changed', 'erasure-fence'); db.close() }
    if (change === 'known') users.removeKnownSession('a')
    if (change === 'abort') controller.abort()
    gate.resolve({ id, type: 'image/png', data: png }); await rejected
  })
  it.each(['image/svg+xml', 'text/html', 'application/pdf', 'image/jpeg'])('refuses wrong MIME/signature %s', async type => {
    files.getFile.mockResolvedValue({ id, type, data: png })
    await expect(readGeneratedImage(id, new AbortController().signal, captureGeneratedImageView())).rejects.toThrow()
  })
  it('serializes binary reads and never decrypts an invalid queued scope', async () => {
    const gate = deferred<unknown>()
    files.getFile.mockReturnValue(gate.promise)
    const first = readGeneratedImage(id, new AbortController().signal, captureGeneratedImageView())
    const second = readGeneratedImage(id, new AbortController().signal, captureGeneratedImageView())
    const rejected1 = expect(first).rejects.toThrow(), rejected2 = expect(second).rejects.toThrow()
    while (!files.getFile.mock.calls.length) await new Promise(resolve => setTimeout(resolve, 1))
    users.invalidateActiveSessionWork(); gate.resolve({ id, type: 'image/png', data: png })
    await Promise.all([rejected1, rejected2]); expect(files.getFile).toHaveBeenCalledOnce()
  })
  it('rejects invalid references, arrays and binary bounds', () => {
    expect(generatedImageIds([id, id])).toEqual([])
    expect(generatedImageIds([id, 'foreign'])).toEqual([])
    expect(generatedImageIds(new Array(2))).toEqual([])
    expect(validGeneratedImage(png, 'image/png')).toBe(true)
    expect(validGeneratedImage('A'.repeat(13_981_020), 'image/png')).toBe(false)
  })
})
