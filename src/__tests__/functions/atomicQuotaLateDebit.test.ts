// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { consumeCapAtomic, consumeRefundableCapAtomic } from '../../../functions/api/_lib/atomicQuota'
import type { Env } from '../../../functions/env'

function fixture() {
  let resolve!: (row: { count: number } | null) => void
  let reject!: (error: Error) => void
  const query = new Promise<{ count: number } | null>((yes, no) => { resolve = yes; reject = no })
  const first = vi.fn(() => query)
  const env = { DB: { prepare: () => ({ bind: () => ({ first }) }) } } as unknown as Env
  const refund = vi.fn(async () => undefined)
  const background: Promise<unknown>[] = []
  const waitUntil = (promise: Promise<unknown>) => { background.push(promise) }
  return { env, first, resolve, reject, refund, background, waitUntil }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('refundable trial cap — exact late query, never a blind refund', () => {
  it('keeps a normal confirmed debit and cancels its deadline', async () => {
    const f = fixture()
    const operation = consumeRefundableCapAtomic(f.env, 'sql', [], f.refund, f.waitUntil)
    f.resolve({ count: 8 })
    expect(await operation).toEqual({ status: 'consumed', count: 8 })
    expect(f.background).toHaveLength(0)
    expect(f.refund).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['consumed', 'cap_reached', 'rejected'] as const)('tracks a late %s result and refunds only its confirmed debit', async (kind) => {
    const f = fixture()
    let finished = false
    const operation = consumeRefundableCapAtomic(f.env, 'sql', [], f.refund, f.waitUntil)
      .then((result) => { finished = true; return result })
    await vi.advanceTimersByTimeAsync(249)
    expect(finished).toBe(false)
    expect(f.background).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(await operation).toEqual({ status: 'fail_open' })
    expect(f.background).toHaveLength(1)
    expect(f.refund).not.toHaveBeenCalled()
    if (kind === 'rejected') f.reject(new Error('late D1 failure'))
    else f.resolve(kind === 'consumed' ? { count: 8 } : null)
    await Promise.all(f.background)
    expect(f.refund).toHaveBeenCalledTimes(kind === 'consumed' ? 1 : 0)
    expect(f.first).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['consumed', 'cap_reached', 'rejected'] as const)('without a waiter, waits for the real %s outcome', async (kind) => {
    const f = fixture()
    let finished = false
    const operation = consumeRefundableCapAtomic(f.env, 'sql', [], f.refund)
      .then((result) => { finished = true; return result })
    await vi.advanceTimersByTimeAsync(250)
    expect(finished).toBe(false)
    if (kind === 'rejected') f.reject(new Error('late D1 failure'))
    else f.resolve(kind === 'consumed' ? { count: 8 } : null)
    expect(await operation).toEqual(kind === 'consumed'
      ? { status: 'consumed', count: 8 }
      : { status: kind === 'rejected' ? 'fail_open' : 'cap_reached' })
    expect(f.refund).not.toHaveBeenCalled()
  })

  it('drains the same compensation when waitUntil registration throws', async () => {
    const f = fixture()
    let finished = false
    const operation = consumeRefundableCapAtomic(f.env, 'sql', [], f.refund, () => { throw new Error('closed context') })
      .then((result) => { finished = true; return result })
    await vi.advanceTimersByTimeAsync(250)
    expect(finished).toBe(false)
    f.resolve({ count: 8 })
    expect(await operation).toEqual({ status: 'fail_open' })
    expect(f.refund).toHaveBeenCalledTimes(1)
    expect(f.first).toHaveBeenCalledTimes(1)
  })

  it('does not retry a failed compensation', async () => {
    const f = fixture()
    f.refund.mockRejectedValueOnce(new Error('ambiguous refund'))
    const operation = consumeRefundableCapAtomic(f.env, 'sql', [], f.refund, f.waitUntil)
    await vi.advanceTimersByTimeAsync(250)
    await operation
    const drained = expect(Promise.all(f.background)).rejects.toThrow('ambiguous refund')
    f.resolve({ count: 8 })
    await drained
    expect(f.refund).toHaveBeenCalledTimes(1)
  })

  it('ordinary caps retain fail-open with the exact original pending result', async () => {
    const f = fixture()
    const operation = consumeCapAtomic(f.env, 'sql', [])
    await vi.advanceTimersByTimeAsync(250)
    const result = await operation
    expect(result.status).toBe('fail_open')
    if (result.status !== 'fail_open') throw new Error('expected fail-open')
    f.resolve(null)
    expect(await result.pending).toEqual({ status: 'cap_reached' })
    expect(f.first).toHaveBeenCalledTimes(1)
  })
})
