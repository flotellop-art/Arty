// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { makeD1Harness, type D1Harness } from './d1Harness'
import { resolveUserPlan } from '../../../functions/api/_lib/checkAllowedUser'

// Zone 4 (C8/F-5) — matrice plan × état D1 (subscriptions / licenses).
let h: D1Harness
beforeAll(async () => { h = await makeD1Harness() })
afterAll(async () => { await h.dispose() })
beforeEach(async () => { await h.reset() })

async function insertSub(email: string, status: string, plan: string, periodEnd: string | null = null) {
  await h.db.prepare(
    `INSERT INTO subscriptions (user_email, status, plan_type, current_period_end) VALUES (?1,?2,?3,?4)`,
  ).bind(email, status, plan, periodEnd).run()
}

describe('resolveUserPlan — matrice plan × état (zone 4)', () => {
  it('sans ligne → free', async () => {
    expect(await resolveUserPlan(h.env, 'none@x.io')).toBe('free')
  })

  it('abonnement actif → subscription ; pro → pro ; vip → vip', async () => {
    await insertSub('sub@x.io', 'active', 'subscription')
    await insertSub('pro@x.io', 'active', 'pro')
    await insertSub('vip@x.io', 'active', 'vip')
    expect(await resolveUserPlan(h.env, 'sub@x.io')).toBe('subscription')
    expect(await resolveUserPlan(h.env, 'pro@x.io')).toBe('pro')
    expect(await resolveUserPlan(h.env, 'vip@x.io')).toBe('vip')
  })

  it('cancelled AVANT fin de période = accès conservé ; APRÈS = perdu', async () => {
    await insertSub('keep@x.io', 'cancelled', 'subscription', '2099-01-01T00:00:00Z')
    await insertSub('lost@x.io', 'cancelled', 'subscription', '2000-01-01T00:00:00Z')
    expect(await resolveUserPlan(h.env, 'keep@x.io')).toBe('subscription')
    expect(await resolveUserPlan(h.env, 'lost@x.io')).toBe('free')
  })

  it('licence active (sans abonnement) → pro', async () => {
    await h.db.prepare(
      `INSERT INTO licenses (user_email, license_key, status) VALUES (?1,?2,'active')`,
    ).bind('lic@x.io', 'KEY-lic').run()
    expect(await resolveUserPlan(h.env, 'lic@x.io')).toBe('pro')
  })

  it('licence disabled → pas pro (retombe free)', async () => {
    await h.db.prepare(
      `INSERT INTO licenses (user_email, license_key, status) VALUES (?1,?2,'disabled')`,
    ).bind('dis@x.io', 'KEY-dis').run()
    expect(await resolveUserPlan(h.env, 'dis@x.io')).toBe('free')
  })

  it('priorité : abonnement actif l’emporte sur une licence active (même email)', async () => {
    const email = 'both@x.io'
    await insertSub(email, 'active', 'subscription')
    await h.db.prepare(
      `INSERT INTO licenses (user_email, license_key, status) VALUES (?1,?2,'active')`,
    ).bind(email, 'KEY-both').run()
    // resolveUserPlan teste la subscription AVANT la licence → 'subscription'.
    expect(await resolveUserPlan(h.env, email)).toBe('subscription')
  })

  it('subscriptions plan_type=trial actif → trial', async () => {
    await insertSub('tr@x.io', 'active', 'trial')
    expect(await resolveUserPlan(h.env, 'tr@x.io')).toBe('trial')
  })

  it('status inactive / expired explicite → free (pas seulement ligne absente)', async () => {
    await insertSub('ina@x.io', 'inactive', 'subscription')
    await insertSub('exp@x.io', 'expired', 'subscription')
    expect(await resolveUserPlan(h.env, 'ina@x.io')).toBe('free')
    expect(await resolveUserPlan(h.env, 'exp@x.io')).toBe('free')
  })
})
