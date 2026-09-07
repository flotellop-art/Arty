// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { consumeTrialCounter } from '../../../functions/api/_lib/trialAdmission'
import { makeD1Harness, type D1Harness } from './d1Harness'

let h: D1Harness
const EMAIL = 'counter@example.test'
beforeAll(async () => { h = await makeD1Harness() })
afterAll(async () => { await h.dispose() })
beforeEach(async () => { await h.reset() })

describe.each(['trial_usage', 'email_trial_usage'] as const)('%s real atomic SQL', table => {
  const refund = vi.fn(async () => undefined)
  it('creates a fresh trial at exactly one, without refund', async () => {
    expect(await consumeTrialCounter(h.env, EMAIL, table, refund)).toEqual({ status: 'consumed', count: 1 })
    expect(refund).not.toHaveBeenCalled()
  })

  it.each([-1, -100, 1.5, 30.5, 31, 'broken'])('does not mutate corrupt used=%s or grant access', async used => {
    await h.db.prepare(`INSERT INTO ${table} (email, used, updated_at) VALUES (?1, ?2, 123)`).bind(EMAIL, used).run()
    for (let retry = 0; retry < 2; retry++) {
      expect(await consumeTrialCounter(h.env, EMAIL, table, refund)).toEqual({ status: 'unavailable' })
      expect(await h.db.prepare(`SELECT used, updated_at FROM ${table} WHERE email = ?1`).bind(EMAIL).first())
        .toEqual({ used, updated_at: 123 })
    }
    expect(refund).not.toHaveBeenCalled()
  })

  it('recognizes exactly 30 as exhausted and leaves the other identity namespace alone', async () => {
    await h.db.prepare(`INSERT INTO ${table} (email, used, updated_at) VALUES (?1, 30, 123)`).bind(EMAIL).run()
    expect(await consumeTrialCounter(h.env, EMAIL, table, refund)).toEqual({ status: 'cap_reached' })
    const other = table === 'trial_usage' ? 'email_trial_usage' : 'trial_usage'
    expect(await h.db.prepare(`SELECT used FROM ${other} WHERE email = ?1`).bind(EMAIL).first()).toBeNull()
  })

  it('admits exactly one of two requests racing for the last message', async () => {
    await h.db.prepare(`INSERT INTO ${table} (email, used, updated_at) VALUES (?1, 29, 0)`).bind(EMAIL).run()
    const results = await Promise.all([1, 2].map(() => consumeTrialCounter(h.env, EMAIL, table, refund)))
    expect(results.filter(r => r.status === 'consumed')).toEqual([{ status: 'consumed', count: 30 }])
    expect(results.filter(r => r.status === 'cap_reached')).toHaveLength(1)
    expect(await h.db.prepare(`SELECT used FROM ${table} WHERE email = ?1`).bind(EMAIL).first()).toEqual({ used: 30 })
  })
})
