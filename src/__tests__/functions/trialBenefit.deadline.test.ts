// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Env } from '../../../functions/env'
import { consumeTrialCounter } from '../../../functions/api/_lib/trialAdmission'

function ack(count: unknown = 18, total: unknown = 30, invalid: unknown = 0) {
  return [0, 1, 2, 3].map(() => ({ success: true, results: [] })).concat([
    { success: true, results: count === null ? [] : [{ count }] as never[] },
    { success: true, results: [{ total, invalid }] as never[] },
  ])
}
function fixture() {
  let resolve!: (value: unknown) => void, reject!: (error: Error) => void
  const pending = new Promise((yes, no) => { resolve = yes; reject = no })
  const batch = vi.fn(() => pending)
  const env = { DB: { prepare: () => ({ bind: () => ({}) }), batch } } as unknown as Env
  const refund = vi.fn(async () => undefined), background: Promise<unknown>[] = []
  const call = (waitUntil: ((p: Promise<unknown>) => void) | undefined = p => { background.push(p) }) =>
    consumeTrialCounter(env, 'a.b@gmail.com', 'trial_usage', refund, waitUntil)
  return { call, resolve, reject, refund, batch, background }
}
beforeEach(() => vi.useFakeTimers())
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('Gmail batch acknowledgment, shared count and same 250ms deadline', () => {
  it('a complete ACK at 249ms returns shared 30, not local18', async () => {
    const f = fixture(), operation = f.call()
    await vi.advanceTimersByTimeAsync(249); f.resolve(ack())
    expect(await operation).toEqual({ status: 'consumed', count: 30 })
    expect(f.batch).toHaveBeenCalledOnce(); expect(f.refund).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
  it.each(['consumed', 'exhausted', 'lost-ack', 'malformed'] as const)
  ('at250 refuses and late %s compensates only a proven debit', async kind => {
    const f = fixture(), operation = f.call()
    await vi.advanceTimersByTimeAsync(250)
    expect(await operation).toEqual({ status: 'unavailable' })
    if (kind === 'lost-ack') f.reject(new Error('unknown commit'))
    else f.resolve(kind === 'consumed' ? ack() : kind === 'exhausted' ? ack(null, 60) : ack('18', 30))
    await Promise.all(f.background)
    expect(f.refund).toHaveBeenCalledTimes(kind === 'consumed' ? 1 : 0)
    expect(f.batch).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0)
  })
  it.each([
    { name: 'missing batch', value: undefined }, { name: 'partial ACK', value: ack().slice(0, 5) },
    ...[0, 1, 2, 3, 4, 5].map(index => ({ name: `failed statement${index}`,
      value: ack().map((r, i) => i === index ? { ...r, success: false } : r) })),
    { name: 'empty RETURNING below cap', value: ack(null, 29) },
    { name: 'no RETURNING but positive total', value: ack(null, 1) },
    { name: 'zero debit', value: ack(0, 29) }, { name: 'string debit', value: ack('1', 29) },
    { name: 'debit larger than total', value: ack(18, 17) }, { name: 'overcap debit', value: ack(18, 31) },
    { name: 'corrupt sister', value: ack(null, 0, 1) }, { name: 'string total', value: ack(1, '1') },
    { name: 'fraction total', value: ack(1, 1.5) }, { name: 'unsafe total', value: ack(null, Number.MAX_SAFE_INTEGER + 1) },
  ])('refuses $name without any refund or replay', async ({ value }) => {
    const f = fixture(), operation = f.call()
    f.resolve(value)
    expect(await operation).toEqual({ status: 'unavailable' })
    expect(f.batch).toHaveBeenCalledOnce(); expect(f.refund).not.toHaveBeenCalled()
  })
})
