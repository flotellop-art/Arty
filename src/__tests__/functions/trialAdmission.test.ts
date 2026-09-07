// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { consumeTrialCounter } from '../../../functions/api/_lib/trialAdmission'
import type { Env } from '../../../functions/env'

function fixture() {
  let resolve!: (row: { count: unknown } | null) => void
  let reject!: (error: Error) => void
  const query = new Promise<{ count: unknown } | null>((yes, no) => { resolve = yes; reject = no })
  const first = vi.fn(() => query)
  const read = vi.fn(async () => ({ used: 30 }))
  const env = { DB: { prepare: (sql: string) => ({ bind: () => ({ first: sql.startsWith('INSERT') ? first : read }) }) } } as unknown as Env
  const refund = vi.fn(async () => undefined)
  const background: Promise<unknown>[] = []
  const waitUntil = (p: Promise<unknown>) => { background.push(p) }
  return { env, first, read, resolve, reject, refund, background, waitUntil }
}
beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('strict trial admission deadline and exact late compensation', () => {
  it('admits a confirmed debit at 249ms and cancels the timer', async () => {
    const f = fixture()
    const operation = consumeTrialCounter(f.env, 'test@example.test', 'trial_usage', f.refund, f.waitUntil)
    await vi.advanceTimersByTimeAsync(249)
    f.resolve({ count: 8 })
    expect(await operation).toEqual({ status: 'consumed', count: 8 })
    expect(f.background).toHaveLength(0)
    expect(f.refund).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['consumed', 'cap_reached', 'rejected', 'malformed'] as const)('refuses at exactly 250ms; late %s never grants access', async kind => {
    const f = fixture()
    let finished = false
    const operation = consumeTrialCounter(f.env, 'test@example.test', 'email_trial_usage', f.refund, f.waitUntil)
      .then(result => { finished = true; return result })
    await vi.advanceTimersByTimeAsync(249)
    expect(finished).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await operation).toEqual({ status: 'unavailable' })
    expect(f.refund).not.toHaveBeenCalled()
    expect(f.background).toHaveLength(1)
    if (kind === 'rejected') f.reject(new Error('unknown write result'))
    else f.resolve(kind === 'cap_reached' ? null : { count: kind === 'consumed' ? 8 : '8' })
    await Promise.all(f.background)
    expect(f.refund).toHaveBeenCalledTimes(kind === 'consumed' ? 1 : 0)
    expect(f.first).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([undefined, null, '1', 0, -1, 31, 1.5, NaN, Infinity])('never grants/refunds an unproven returned count %s', async count => {
    const f = fixture()
    const operation = consumeTrialCounter(f.env, 'test@example.test', 'trial_usage', f.refund, f.waitUntil)
    f.resolve({ count })
    expect(await operation).toEqual({ status: 'unavailable' })
    expect(f.refund).not.toHaveBeenCalled()
    expect(f.first).toHaveBeenCalledTimes(1)
  })

  it.each(['consumed', 'cap_reached', 'rejected'] as const)('without waitUntil waits for the actual %s result, never grants on timeout', async kind => {
    const f = fixture()
    let finished = false
    const operation = consumeTrialCounter(f.env, 'test@example.test', 'trial_usage', f.refund)
      .then(result => { finished = true; return result })
    await vi.advanceTimersByTimeAsync(250)
    expect(finished).toBe(false)
    if (kind === 'rejected') f.reject(new Error('unknown'))
    else f.resolve(kind === 'consumed' ? { count: 1 } : null)
    expect(await operation).toEqual(kind === 'consumed' ? { status: 'consumed', count: 1 }
      : { status: kind === 'rejected' ? 'unavailable' : 'cap_reached' })
    expect(f.refund).not.toHaveBeenCalled()
  })

  it('drains the same compensation once when waitUntil registration fails', async () => {
    const f = fixture()
    const operation = consumeTrialCounter(f.env, 'test@example.test', 'trial_usage', f.refund, () => { throw new Error('context closed') })
    await vi.advanceTimersByTimeAsync(250)
    f.resolve({ count: 1 })
    expect(await operation).toEqual({ status: 'unavailable' })
    expect(f.refund).toHaveBeenCalledTimes(1)
    expect(f.first).toHaveBeenCalledTimes(1)
  })

  it('never replays an ambiguous compensation, even with a closed context', async () => {
    const f = fixture()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    f.refund.mockRejectedValueOnce(new Error('acknowledgment lost'))
    const operation = consumeTrialCounter(f.env, 'test@example.test', 'trial_usage', f.refund, () => { throw new Error('context closed') })
    await vi.advanceTimersByTimeAsync(250)
    f.resolve({ count: 1 })
    expect(await operation).toEqual({ status: 'unavailable' })
    expect(f.refund).toHaveBeenCalledTimes(1)
    expect(f.first).toHaveBeenCalledTimes(1)
  })
})
