import { beforeEach, describe, expect, it, vi } from 'vitest'
const open = vi.hoisted(() => vi.fn())
vi.mock('idb', () => ({ openDB: open }))
import { openExistingDB } from '../../services/readOnlyExistingDB'
function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason: unknown) => void; return { promise: new Promise<T>((a, b) => { resolve = a; reject = b }), resolve, reject } }
beforeEach(() => { open.mockReset() })
describe('readonly existing database admission', () => {
  it('returns an existing connection to its caller', async () => {
    const db = { close: vi.fn() }; open.mockResolvedValue(db)
    expect(await openExistingDB('existing', 1, () => {})).toBe(db); expect(db.close).not.toHaveBeenCalled()
  })
  it('rolls back an absent DB and drains both upgrade and open errors', async () => {
    const d = deferred<unknown>(), txDone = deferred<void>(), abort = vi.fn(() => { const error = new DOMException('', 'AbortError'); txDone.reject(error); d.reject(error) })
    open.mockImplementation((_n, _v, callbacks) => { queueMicrotask(() => callbacks.upgrade({}, 0, 1, { done: txDone.promise, abort })); return d.promise })
    expect(await openExistingDB('absent', 1, () => {})).toBeNull(); expect(abort).toHaveBeenCalledOnce()
  })
  it.each(['blocked', 'cancelled', 'scope'] as const)('closes a late connection after %s without stealing', async mode => {
    const d = deferred<unknown>(), db = { close: vi.fn() }, signal = new AbortController(), guard = vi.fn()
    let callbacks: { blocked(): void }
    open.mockImplementation((_n, _v, value) => { callbacks = value; return d.promise })
    const result = openExistingDB('x', 1, guard, signal.signal).catch(e => e)
    if (mode === 'blocked') callbacks!.blocked()
    if (mode === 'cancelled') signal.abort()
    if (mode === 'scope') guard.mockImplementation(() => { throw new Error('stale') })
    if (mode !== 'scope') expect(await result).toMatchObject({ name: mode === 'blocked' ? 'InvalidStateError' : 'AbortError' })
    d.resolve(db); if (mode === 'scope') expect(await result).toMatchObject({ message: 'stale' })
    await vi.waitFor(() => expect(db.close).toHaveBeenCalledOnce())
  })
  it('removes the abort listener even if openDB throws synchronously', async () => {
    const controller = new AbortController(), remove = vi.spyOn(controller.signal, 'removeEventListener')
    open.mockImplementation(() => { throw new Error('sync') })
    await expect(openExistingDB('x', 1, () => {}, controller.signal)).rejects.toThrow('sync')
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
    controller.abort()
  })
})
