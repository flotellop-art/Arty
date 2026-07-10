/** @vitest-environment node */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeD1Harness, type D1Harness } from './d1Harness'

const authMocks = vi.hoisted(() => ({
  google: vi.fn(),
  trial: vi.fn(),
}))

vi.mock('../../../functions/api/_lib/checkAllowedUser', () => ({
  verifyGoogleUserStrict: authMocks.google,
}))
vi.mock('../../../functions/api/_lib/emailTrial', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../functions/api/_lib/emailTrial')>()
  return { ...actual, verifyEmailTrialToken: authMocks.trial }
})

import { onRequestPost } from '../../../functions/api/account/delete'

let h: D1Harness

async function count(table: string, column: string, value: string): Promise<number> {
  const row = await h.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = ?1`)
    .bind(value).first<{ n: number }>()
  return row?.n ?? 0
}

beforeAll(async () => { h = await makeD1Harness({ GOOGLE_CLIENT_ID: 'arty-client' }) })
afterAll(async () => { await h.dispose() })
beforeEach(async () => {
  await h.reset()
  authMocks.google.mockReset()
  authMocks.trial.mockReset()
})

describe('/api/account/delete', () => {
  it('transactionally erases Google personal data, reports and same-email trial data', async () => {
    const email = 'owner@example.com'
    authMocks.google.mockResolvedValue(email)
    await h.db.prepare("INSERT INTO memory (user_id, category, data) VALUES (?1, 'profil', '{}')").bind(email).run()
    await h.db.prepare("INSERT INTO trial_usage (email, used, updated_at) VALUES (?1, 2, unixepoch())").bind(email).run()
    await h.db.prepare("INSERT INTO email_trial_sessions (token_hash, email, created_at, expires_at) VALUES ('hash', ?1, unixepoch(), unixepoch() + 1000)").bind(email).run()
    await h.db.prepare("INSERT INTO content_reports (id, reporter_email, category, message_excerpt) VALUES ('g', ?1, 'other', 'private')").bind(email).run()
    await h.db.prepare("INSERT INTO content_reports (id, reporter_email, category, message_excerpt) VALUES ('t', ?1, 'other', 'private')").bind(`trial-email:${email}`).run()
    await h.db.prepare("INSERT INTO subscriptions (user_email, status, plan_type) VALUES (?1, 'active', 'subscription')").bind(email).run()

    const res = await onRequestPost({
      request: new Request('https://tryarty.com/api/account/delete', {
        method: 'POST', headers: { 'x-google-token': 'tok' },
      }),
      env: h.env,
    } as never)

    expect(res.status).toBe(200)
    expect(await count('memory', 'user_id', email)).toBe(0)
    // Minimal usage counters survive erasure so reconnecting cannot reset caps.
    expect(await count('trial_usage', 'email', email)).toBe(1)
    expect(await count('email_trial_sessions', 'email', email)).toBe(0)
    expect(await count('content_reports', 'reporter_email', email)).toBe(0)
    expect(await count('content_reports', 'reporter_email', `trial-email:${email}`)).toBe(0)
    // Accounting/legal records are deliberately retained.
    expect(await count('subscriptions', 'user_email', email)).toBe(1)
  })

  it('supports x-arty-trial-token without authorizing deletion of Google data', async () => {
    const email = 'trial@example.com'
    authMocks.trial.mockResolvedValue(email)
    await h.db.prepare("INSERT INTO memory (user_id, category, data) VALUES (?1, 'profil', '{}')").bind(email).run()
    await h.db.prepare("INSERT INTO email_trial_sessions (token_hash, email, created_at, expires_at) VALUES ('hash2', ?1, unixepoch(), unixepoch() + 1000)").bind(email).run()
    await h.db.prepare("INSERT INTO email_trial_usage (email, used, updated_at) VALUES (?1, 3, unixepoch())").bind(email).run()
    await h.db.prepare("INSERT INTO quota_model (email, day, model, count, updated_at) VALUES (?1, '2026-07-09', 'gpt-5-mini', 1, unixepoch())").bind(`trial-email:${email}`).run()
    await h.db.prepare("INSERT INTO bg_quota (email, day, task, count, updated_at) VALUES (?1, '2026-07-09', 'content-report', 1, unixepoch())").bind(`trial-email:${email}`).run()
    await h.db.prepare("INSERT INTO content_reports (id, reporter_email, category, message_excerpt) VALUES ('trial-report', ?1, 'other', 'private')").bind(`trial-email:${email}`).run()
    await h.db.prepare("INSERT INTO content_reports (id, reporter_email, category, message_excerpt) VALUES ('legacy-trial-report', ?1, 'other', 'private')").bind(`emailtrial:${email}`).run()

    const res = await onRequestPost({
      request: new Request('https://tryarty.com/api/account/delete', {
        method: 'POST', headers: { 'x-arty-trial-token': 'trial-token' },
      }),
      env: h.env,
    } as never)

    expect(res.status).toBe(200)
    expect(authMocks.trial).toHaveBeenCalled()
    expect(await count('email_trial_sessions', 'email', email)).toBe(0)
    expect(await count('email_trial_usage', 'email', email)).toBe(1)
    expect(await count('content_reports', 'reporter_email', `trial-email:${email}`)).toBe(0)
    expect(await count('content_reports', 'reporter_email', `emailtrial:${email}`)).toBe(0)
    expect(await count('bg_quota', 'email', `trial-email:${email}`)).toBe(1)
    expect(await count('quota_model', 'email', `trial-email:${email}`)).toBe(1)
    expect(await count('memory', 'user_id', email)).toBe(1)
  })

  it('returns failure instead of claiming success when the transactional batch fails', async () => {
    authMocks.trial.mockResolvedValue('trial@example.com')
    const statement = {
      bind: vi.fn(),
      run: vi.fn(async () => ({})),
    } as unknown as D1PreparedStatement
    ;(statement.bind as unknown as ReturnType<typeof vi.fn>).mockReturnValue(statement)
    const db = {
      prepare: vi.fn(() => statement),
      batch: vi.fn(async () => { throw new Error('D1 unavailable') }),
    } as unknown as D1Database
    const res = await onRequestPost({
      request: new Request('https://tryarty.com/api/account/delete', {
        method: 'POST', headers: { 'x-arty-trial-token': 'trial-token' },
      }),
      env: { DB: db },
    } as never)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Account deletion incomplete' })
  })
})
