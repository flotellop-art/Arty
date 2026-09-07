// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { consumeSubsidizedDailyQuota } from '../../../functions/api/_lib/subsidizedDailyQuota'
import { makeD1Harness, type D1Harness } from './d1Harness'

let h: D1Harness
const EMAIL = 'daily@example.test', DAY = '2026-09-07'
beforeAll(async () => { h = await makeD1Harness() })
afterAll(async () => { await h.dispose() })
beforeEach(async () => { await h.reset() })

describe.each([
  { table: 'free_daily_quota', column: 'family', family: 'claude-haiku', limit: 10 },
  { table: 'free_daily_quota', column: 'family', family: 'tts', limit: 5 },
  { table: 'free_daily_quota', column: 'family', family: 'web-search', limit: 50 },
  { table: 'bg_quota', column: 'task', family: 'memory-extract', limit: 20 },
] as const)('$family strict daily admission', ({ table, column, family, limit }) => {
  const consume = (amount = 1) => consumeSubsidizedDailyQuota(h.env, table, EMAIL, DAY, family, limit, amount)
  const seed = async (count: number | string) => {
    await h.db.prepare(`INSERT INTO ${table} (email, day, ${column}, count, updated_at) VALUES (?1, ?2, ?3, ?4, 123)`)
      .bind(EMAIL, DAY, family, count).run()
  }
  const current = () => h.db.prepare(`SELECT count, updated_at FROM ${table} WHERE email = ?1 AND day = ?2 AND ${column} = ?3`)
    .bind(EMAIL, DAY, family).first()

  it.each([-1, 0.5, 'corrupt', 1000])('refuses corrupt count=%s without modifying it', async count => {
    await seed(count)
    expect(await consume()).toEqual({ status: 'unavailable' })
    expect(await current()).toEqual({ count, updated_at: 123 })
  })
  it('admits one concurrent last-unit request, then proves exhaustion', async () => {
    await seed(limit - 1)
    const results = await Promise.all([consume(), consume()])
    expect(results.filter(r => r.status === 'consumed')).toEqual([{ status: 'consumed', count: limit }])
    expect(results.filter(r => r.status === 'cap_reached')).toHaveLength(1)
    expect(await consume()).toEqual({ status: 'cap_reached' })
  })
  it('rejects invalid or oversized amounts without creating a row', async () => {
    for (const amount of [-1, 0, 1.5, NaN, Infinity]) expect(await consume(amount)).toEqual({ status: 'unavailable' })
    expect(await consume(limit + 1)).toEqual({ status: 'cap_reached' })
    expect(await current()).toBeNull()
  })
  it('treats multi-unit admission as all-or-nothing', async () => {
    expect(await consume(limit - 1)).toEqual({ status: 'consumed', count: limit - 1 })
    expect(await consume(2)).toEqual({ status: 'cap_reached' })
    expect(await consume(1)).toEqual({ status: 'consumed', count: limit })
  })
})
