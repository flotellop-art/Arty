// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { consumeDailyQuota, getDailyQuotaStatus, voidDailyQuota, recordUsage } from '../../../functions/api/_lib/quota'
import { makeD1Harness, type D1Harness } from './d1Harness'

let h: D1Harness
const email = 'haiku-migration@example.test'
const old = 'claude-haiku-4-5-20251001', next = 'claude-haiku-5-5'
beforeAll(async () => { h = await makeD1Harness() })
afterAll(async () => { await h.dispose() })
beforeEach(async () => { await h.reset(); h.env.DAILY_QUOTA_PER_MODEL = JSON.stringify({ [old]: 3, default: 50 }) })
describe('Haiku migration, real D1', () => {
  it('shares dated and alias 4.5 consumption with 5.5', async () => {
    await consumeDailyQuota(h.env, email, 'claude-haiku-4-5')
    await consumeDailyQuota(h.env, email, old)
    expect(await consumeDailyQuota(h.env, email, next)).toMatchObject({ allowed: true, count: 3, limit: 3 })
    expect(await consumeDailyQuota(h.env, email, 'claude-haiku-4-5')).toMatchObject({ allowed: false, count: 4, limit: 3 })
  })
  it('retains the global quota when no per-model policy is configured', async () => {
    h.env.DAILY_QUOTA_PER_MODEL = undefined; h.env.DAILY_QUOTA_PER_USER = '2'
    expect(await consumeDailyQuota(h.env, email, old)).toMatchObject({ allowed: true, count: 1, limit: 2 })
    expect(await consumeDailyQuota(h.env, email, 'gpt-5')).toMatchObject({ allowed: true, count: 2, limit: 2 })
    expect(await consumeDailyQuota(h.env, email, next)).toMatchObject({ allowed: false, count: 3, limit: 2 })
    expect((await getDailyQuotaStatus(h.env, email)).byModel.every(row => row.quotaCount == null)).toBe(true)
  })
  it('inherits the old limit and consumption without renaming billing rows', async () => {
    await consumeDailyQuota(h.env, email, old); await consumeDailyQuota(h.env, email, old)
    const last = await consumeDailyQuota(h.env, email, next)
    expect(last).toMatchObject({ allowed: true, count: 3, limit: 3 })
    const refused = await consumeDailyQuota(h.env, email, next)
    expect(refused).toMatchObject({ allowed: false, count: 4, limit: 3 })
    await voidDailyQuota(h.env, email, next, refused.debited!)
    const status = await getDailyQuotaStatus(h.env, email)
    expect(status.total).toBe(3)
    expect(status.byModel).toEqual(expect.arrayContaining([
      expect.objectContaining({ model: old, count: 2, quotaCount: 3, limit: 3 }),
      expect.objectContaining({ model: next, count: 1, quotaCount: 3, limit: 3 }),
    ]))
  })
  it('new explicit limit applies to both IDs, including old clients', async () => {
    h.env.DAILY_QUOTA_PER_MODEL = JSON.stringify({ [old]: 100, [next]: 1 })
    expect(await consumeDailyQuota(h.env, email, next)).toMatchObject({ allowed: true, count: 1, limit: 1 })
    expect(await consumeDailyQuota(h.env, email, old)).toMatchObject({ allowed: false, count: 2, limit: 1 })
  })
  it('does not double the cap with concurrent old and new requests', async () => {
    await consumeDailyQuota(h.env, email, old); await consumeDailyQuota(h.env, email, old)
    const results = await Promise.all([consumeDailyQuota(h.env, email, old), consumeDailyQuota(h.env, email, next)])
    expect(results.filter(r => r.allowed).length).toBeLessThanOrEqual(1)
    for (const [i, result] of results.entries()) if (!result.allowed) await voidDailyQuota(h.env, email, i === 0 ? old : next, result.debited!)
    expect((await getDailyQuotaStatus(h.env, email)).total).toBeLessThanOrEqual(3)
  })
  it('keeps persisted historical cost while pricing new usage at the current rate', async () => {
    await consumeDailyQuota(h.env, email, old)
    const day = new Date().toISOString().slice(0, 10)
    await h.db.prepare('UPDATE quota_model SET cost_usd_micro = 15000000 WHERE email = ?1 AND day = ?2 AND model = ?3').bind(email, day, old).run()
    await consumeDailyQuota(h.env, email, next)
    await recordUsage(h.env, email, next, { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 0, cacheCreationTokens: 0, audioSeconds: 0 })
    const status = await getDailyQuotaStatus(h.env, email)
    expect(status.byModel.find(r => r.model === old)?.costUsd).toBe(15)
    expect(status.byModel.find(r => r.model === next)?.costUsd).toBe(3)
  })
})
