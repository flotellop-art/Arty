// @vitest-environment node
import { onRequestGet as walletBalance } from '../../../functions/api/wallet/balance'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { trialBenefitKey, TRIAL_BENEFIT_SQL, readSharedTrialRemaining, type TrialTable } from '../../../functions/api/_lib/trialBenefit'
import { consumeTrialCounter, readTrialCounterRemaining } from '../../../functions/api/_lib/trialAdmission'
import { voidTrialMessage, checkAllowedVerifiedUser } from '../../../functions/api/_lib/checkAllowedUser'
import { consumeEmailTrialMessage, voidEmailTrialMessage, createSession, storeOtp, verifyEmailTrialTokenDetailed } from '../../../functions/api/_lib/emailTrial'
import { onRequestPost as verifyOtp } from '../../../functions/api/auth/email/verify-otp'
import { onRequestPost as init } from '../../../functions/api/trial/init'
import { onRequestPost as anthropic } from '../../../functions/api/ai/proxy'
import { onRequestPost as openai } from '../../../functions/api/ai/openai-proxy'
import { onRequestPost as gemini } from '../../../functions/api/ai/gemini-proxy'
import { onRequestPost as mistral } from '../../../functions/api/ai/mistral-proxy'
import { makeD1Harness, type D1Harness } from './d1Harness'
import { creditWallet, getWalletBalance } from '../../../functions/api/_lib/wallet'

const GOOGLE = 'arty.benefit@gmail.com', OTP = 'artybenefit@gmail.com', CLIENT = 'synthetic-client'
let h: D1Harness
const noop = async () => undefined
beforeAll(async () => { h = await makeD1Harness({ GOOGLE_CLIENT_ID: CLIENT,
  ANTHROPIC_API_KEY: 'synthetic-owner', OPENAI_API_KEY: 'synthetic-owner',
  GEMINI_API_KEY: 'synthetic-owner', MISTRAL_API_KEY: 'synthetic-owner' }) })
afterAll(async () => { await h.dispose() })
beforeEach(async () => { await h.reset(); delete h.env.ALLOWED_EMAILS })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
async function seed(table: TrialTable, email: string, used: number | string) {
  await h.db.prepare(`INSERT INTO ${table} (email, used, updated_at) VALUES (?1, ?2, 123)`).bind(email, used).run()
}
function consume(table: TrialTable, email: string) { return consumeTrialCounter(h.env, email, table, noop) }
async function snapshot() {
  return Promise.all((['trial_usage', 'email_trial_usage'] as const).map(async table =>
    (await h.db.prepare(`SELECT email, used, updated_at FROM ${table} ORDER BY email`).all()).results))
}
async function plan(email = GOOGLE, value = 'trial') {
  await h.db.prepare("INSERT INTO subscriptions (user_email, status, plan_type) VALUES (?1, 'active', ?2)").bind(email, value).run()
}

describe('Gmail shared negative benefit — real D1, no account merge', () => {
  it.each(['arty.benefit@gmail.com', 'A.R.T.Y.Benefit+tag@GoogleMail.COM', ' artybenefit@gmail.com '])
  ('JS and indexed SQL agree for %s, including historical aliases', async email => {
    expect(trialBenefitKey(email)).toBe(OTP)
    await seed('trial_usage', email, 4)
    expect(await readSharedTrialRemaining(h.env, GOOGLE)).toBe(26)
    expect(await h.db.prepare(`SELECT ${TRIAL_BENEFIT_SQL} AS key FROM trial_usage`).first()).toEqual({ key: OTP })
    expect((await h.db.prepare(`EXPLAIN QUERY PLAN SELECT used FROM trial_usage WHERE ${TRIAL_BENEFIT_SQL} = ?1`).bind(OTP).all()).results)
      .toEqual(expect.arrayContaining([expect.objectContaining({ detail: expect.stringContaining('trial_usage_shared_benefit_v1') })]))
  })
  it.each(['a@gmail.com@evil.test', '', '+tag@custom.test'])
  ('never creates a shared key for %s', email => { expect(trialBenefitKey(email)).toBeNull() })

  it('adds all historical counters, not max; never creates or rewrites rows during a peek', async () => {
    await seed('trial_usage', GOOGLE, 7); await seed('trial_usage', 'artybenefit+old@googlemail.com', 5)
    await seed('email_trial_usage', OTP, 13)
    const before = await snapshot()
    expect(await readSharedTrialRemaining(h.env, GOOGLE)).toBe(5)
    expect(await snapshot()).toEqual(before)
    expect(await consume('trial_usage', GOOGLE)).toEqual({ status: 'consumed', count: 26 })
    expect(await consume('email_trial_usage', OTP)).toEqual({ status: 'consumed', count: 27 })
  })
  it.each([['trial_usage', GOOGLE], ['email_trial_usage', OTP]] as const)
  ('guards the first INSERT into %s when the other channel used all 30', async (table, email) => {
    const other = table === 'trial_usage' ? 'email_trial_usage' : 'trial_usage'
    await seed(other, other === 'trial_usage' ? GOOGLE : OTP, 30)
    const before = await snapshot()
    expect(await consume(table, email)).toEqual({ status: 'cap_reached' })
    expect(await snapshot()).toEqual(before)
  })
  it('admits one and only one across Google/OTP/aliases at total 29', async () => {
    await seed('trial_usage', GOOGLE, 17); await seed('email_trial_usage', OTP, 12)
    const results = await Promise.all([
      consume('trial_usage', GOOGLE), consume('email_trial_usage', OTP),
      consume('trial_usage', 'a.r.t.y.benefit+new@googlemail.com'),
    ])
    expect(results.filter(r => r.status === 'consumed')).toEqual([{ status: 'consumed', count: 30 }])
    expect(results.filter(r => r.status === 'cap_reached')).toHaveLength(2)
    expect(await readSharedTrialRemaining(h.env, OTP)).toBe(0)
  })
  it('keeps a historical 60 unchanged and exhausted, without new 30 or repair', async () => {
    await seed('trial_usage', GOOGLE, 30); await seed('email_trial_usage', OTP, 30)
    const before = await snapshot()
    expect(await consume('trial_usage', GOOGLE)).toEqual({ status: 'cap_reached' })
    expect(await consume('email_trial_usage', OTP)).toEqual({ status: 'cap_reached' })
    expect(await readSharedTrialRemaining(h.env, OTP)).toBe(0)
    expect(await snapshot()).toEqual(before)
  })
  it.each([-1, 1.5, 31, 'broken'])('a corrupt sister counter %s prevents ANY grant or repair', async used => {
    await seed('email_trial_usage', OTP, used)
    const before = await snapshot()
    expect(await consume('trial_usage', GOOGLE)).toEqual({ status: 'unavailable' })
    expect(await readSharedTrialRemaining(h.env, GOOGLE)).toBeNull()
    expect(await snapshot()).toEqual(before)
  })
  it('shares ordinary domains and legacy plus restrictions, preserving non-Gmail dots', async () => {
    await seed('trial_usage', 'a@custom.test', 30)
    expect(await consume('email_trial_usage', 'a@custom.test')).toEqual({ status: 'cap_reached' })
    expect(await consume('trial_usage', 'a+b@custom.test')).toEqual({ status: 'cap_reached' })
    expect(await readTrialCounterRemaining(h.env, 'a@custom.test', 'email_trial_usage')).toBe(0)
    expect(await consume('trial_usage', 'a.b@custom.test')).toEqual({ status: 'consumed', count: 1 })
    expect(await consume('email_trial_usage', 'ab@custom.test')).toEqual({ status: 'consumed', count: 1 })
  })
  it.each(['a+b@custom.test', 'A+OLD@CUSTOM.TEST', ' a@custom.test '])('SQL/JS agree for ordinary %s', async email => {
    expect(trialBenefitKey(email)).toBe('a@custom.test')
    await seed('trial_usage', email, 10)
    expect(await readSharedTrialRemaining(h.env, 'a@custom.test')).toBe(20)
    expect(await consume('email_trial_usage', 'a@custom.test')).toEqual({ status: 'consumed', count: 11 })
  })
  it('a lost batch ACK retains the debit, without grant or speculative refund', async () => {
    await seed('trial_usage', GOOGLE, 17); await seed('email_trial_usage', OTP, 12)
    const batch = vi.fn(async (statements: D1PreparedStatement[]) => {
      await h.db.batch(statements); throw new Error('synthetic acknowledgment lost after COMMIT')
    })
    const db = new Proxy(h.db, { get(target, property) { return property === 'batch' ? batch : Reflect.get(target, property) } })
    const refund = vi.fn(noop)
    expect(await consumeTrialCounter({ ...h.env, DB: db }, GOOGLE, 'trial_usage', refund)).toEqual({ status: 'unavailable' })
    expect(await readSharedTrialRemaining(h.env, OTP)).toBe(0)
    expect(batch).toHaveBeenCalledOnce(); expect(refund).not.toHaveBeenCalled()
  })
  it('a failed readback rolls the ENTIRE batch back, not just its final SELECT', async () => {
    await seed('trial_usage', GOOGLE, 17); await seed('email_trial_usage', OTP, 12)
    const before = await snapshot()
    const batch = vi.fn(async (statements: D1PreparedStatement[]) => h.db.batch([
      ...statements.slice(0, -1), h.db.prepare(`SELECT CASE WHEN used = 18
        THEN abs(-9223372036854775808) ELSE 0 END FROM trial_usage WHERE email = ?1`).bind(GOOGLE),
    ]))
    const db = new Proxy(h.db, { get(target, property) { return property === 'batch' ? batch : Reflect.get(target, property) } })
    expect(await consumeTrialCounter({ ...h.env, DB: db }, GOOGLE, 'trial_usage', noop)).toEqual({ status: 'unavailable' })
    expect(await snapshot()).toEqual(before)
  })
  it('a late real Gmail debit refunds only itself after an independent OTP debit', async () => {
    await seed('trial_usage', GOOGLE, 17); await seed('email_trial_usage', OTP, 10)
    let release!: () => void, arrived!: () => void, expire!: () => void
    const blocked = new Promise<void>(resolve => { release = resolve })
    const committed = new Promise<void>(resolve => { arrived = resolve })
    const set = globalThis.setTimeout, clear = globalThis.clearTimeout
    const handles = new Set<ReturnType<typeof setTimeout>>()
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((callback: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => {
      if (delay !== 250) return set(callback, delay, ...args)
      const handle = Object.create(null) as ReturnType<typeof setTimeout>; handles.add(handle)
      expire = () => callback(...args)
      return handle
    }) as typeof setTimeout)
    vi.spyOn(globalThis, 'clearTimeout').mockImplementation(handle => {
      if (!handles.delete(handle as ReturnType<typeof setTimeout>)) clear(handle)
    })
    const batch = vi.fn(async (statements: D1PreparedStatement[]) => {
      const result = await h.db.batch(statements); arrived(); await blocked; return result
    })
    const db = new Proxy(h.db, { get(target, property) { return property === 'batch' ? batch : Reflect.get(target, property) } })
    const tasks: Promise<unknown>[] = [], refund = vi.fn(() => voidTrialMessage(h.env, GOOGLE))
    const operation = consumeTrialCounter({ ...h.env, DB: db }, GOOGLE, 'trial_usage', refund, task => { tasks.push(task) })
    await committed; expire()
    expect(await operation).toEqual({ status: 'unavailable' })
    expect(await consume('email_trial_usage', OTP)).toEqual({ status: 'consumed', count: 29 })
    release(); await Promise.all(tasks)
    expect(batch).toHaveBeenCalledOnce(); expect(refund).toHaveBeenCalledOnce()
    expect(await h.db.prepare('SELECT used FROM trial_usage WHERE email=?1').bind(GOOGLE).first()).toEqual({ used: 17 })
    expect(await h.db.prepare('SELECT used FROM email_trial_usage WHERE email=?1').bind(OTP).first()).toEqual({ used: 11 })
  })
  it.each([0, 13, 30, -1])('OTP login reports shared remaining/unknown without invalidating identity (used=%s)', async used => {
    h.env.EMAIL_TRIAL_SECRET = 'synthetic-otp-secret'
    vi.spyOn(Math, 'random').mockReturnValue(1)
    await seed('trial_usage', GOOGLE, used)
    const code = await storeOtp(h.env, OTP)
    const response = await verifyOtp({ request: new Request('https://tryarty.com/api/auth/email/verify-otp', {
      method: 'POST', body: JSON.stringify({ email: 'arty.benefit+otp@googlemail.com', code }),
    }), env: h.env } as never) as Response
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    const body = await response.json() as { email: string; token: string; trial_messages_remaining: number | null }
    expect(body).toMatchObject({ email: OTP, trial_messages_remaining: used < 0 ? null : 30 - used })
    expect(await verifyEmailTrialTokenDetailed(new Request('https://tryarty.com', {
      headers: { 'x-arty-trial-token': body.token },
    }), h.env)).toEqual({ status: 'ok', email: OTP })
  })
  it('reconnect/new session and compensation do not reset or mutate another channel', async () => {
    await seed('trial_usage', GOOGLE, 17); await seed('email_trial_usage', OTP, 12)
    await createSession(h.env, OTP); await createSession(h.env, OTP)
    expect(await consume('trial_usage', GOOGLE)).toEqual({ status: 'consumed', count: 30 })
    await voidTrialMessage(h.env, GOOGLE)
    expect(await consume('email_trial_usage', OTP)).toEqual({ status: 'consumed', count: 30 })
    await voidEmailTrialMessage(h.env, OTP)
    expect(await h.db.prepare('SELECT used FROM trial_usage WHERE email=?1').bind(GOOGLE).first()).toEqual({ used: 17 })
    expect(await h.db.prepare('SELECT used FROM email_trial_usage WHERE email=?1').bind(OTP).first()).toEqual({ used: 12 })
  })
  it.each(['trial', 'subscription', 'pro', 'vip'])('preserves %s rights and OTP isolation at exhausted Gmail benefit', async value => {
    await plan(GOOGLE, value); await seed('email_trial_usage', OTP, 30)
    expect(await checkAllowedVerifiedUser(GOOGLE, h.env)).toEqual(value === 'trial'
      ? { error: 'trial_expired', email: GOOGLE } : { email: GOOGLE, planType: value })
    h.env.ALLOWED_EMAILS = GOOGLE
    expect(await checkAllowedVerifiedUser(GOOGLE, h.env)).toEqual({ email: GOOGLE, planType: 'vip' })
    expect(await consumeEmailTrialMessage(h.env, OTP)).toEqual({ error: 'trial_expired', email: `trial-email:${OTP}` })
  })
  it.each([false, true])('Google init reports OTP consumption even with existing Google plan=%s', async existing => {
    if (existing) await plan()
    await seed('email_trial_usage', OTP, 30)
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ aud: CLIENT, email: GOOGLE, email_verified: true })))
    const response = await init({ request: new Request('https://tryarty.com/api/trial/init', {
      method: 'POST', headers: { Authorization: 'Bearer synthetic-google' }, body: '{}' }), env: h.env } as never) as Response
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ plan: 'trial', trial_messages_remaining: 0 })
  })
  it('Google init never invents 30 or creates a plan on corrupt shared counters', async () => {
    await seed('email_trial_usage', OTP, -1)
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ aud: CLIENT, email: GOOGLE, email_verified: true })))
    const response = await init({ request: new Request('https://tryarty.com/api/trial/init', {
      method: 'POST', headers: { Authorization: 'Bearer synthetic-google' }, body: '{}' }), env: h.env } as never) as Response
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ error: 'admission_unavailable' })
    expect(await h.db.prepare('SELECT COUNT(*) AS n FROM subscriptions').first()).toEqual({ n: 0 })
  })
})

const providers = [
  { name: 'anthropic', call: anthropic, model: 'claude-haiku-4-5-20251001', key: 'x-api-key' },
  { name: 'openai', call: openai, model: 'gpt-5-mini', key: 'x-openai-key' },
  { name: 'gemini', call: gemini, model: 'gemini-3.6-flash', key: 'authorization' },
  { name: 'mistral', call: mistral, model: 'mistral-medium-latest', key: 'authorization' },
] as const
describe.each(providers)('$name real handler and Gmail shared cap', p => {
  it('uses only the Google owner wallet after the shared 30; OTP cannot spend it', async () => {
    await plan(); await seed('trial_usage', GOOGLE, 17); await seed('email_trial_usage', OTP, 13)
    expect(await creditWallet(h.env, { provider: 'synthetic', eventId: 'topup', orderId: 'order',
      email: GOOGLE, amountMicro: 10_000_000 })).toEqual({ status: 'credited' })
    const session = await createSession(h.env, OTP), before = await snapshot()
    let sent = 0
    vi.spyOn(Math, 'random').mockReturnValue(1)
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/tokeninfo')) return Response.json({ aud: CLIENT, email: GOOGLE, email_verified: true })
      sent++
      return Response.json({ content: [{ type: 'text', text: 'ok' }], choices: [{ message: { content: 'ok' } }],
        candidates: [{ content: { parts: [{ text: 'ok' }] } }],
        usage: { input_tokens: 100, output_tokens: 100, prompt_tokens: 100, completion_tokens: 100 },
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 100 } })
    }))
    for (const identity of ['otp', 'google'] as const) {
      const background: Promise<unknown>[] = []
      const response = await p.call({ request: new Request('https://tryarty.com/api/ai/' + p.name, {
        method: 'POST', headers: { 'content-type': 'application/json',
          ...(identity === 'google' ? { 'x-google-token': 'synthetic-google' } : { 'x-arty-trial-token': session! }),
        }, body: JSON.stringify({ model: p.model, stream: false, max_tokens: 100,
          messages: [{ role: 'user', content: 'Bonjour' }], contents: [{ role: 'user', parts: [{ text: 'Bonjour' }] }] }),
      }), env: h.env, waitUntil: (task: Promise<unknown>) => { background.push(task) } } as never) as Response
      expect(response.status).toBe(identity === 'google' ? 200 : 403)
      if (identity === 'google') expect(response.headers.get('x-trial-remaining')).toBe('0')
      await response.text(); await Promise.all(background)
      expect(sent).toBe(identity === 'google' ? 1 : 0)
      if (identity === 'otp') expect(await getWalletBalance(h.env, GOOGLE)).toMatchObject({ balanceMicro: 10_000_000 })
    }
    expect((await getWalletBalance(h.env, GOOGLE)).balanceMicro).toBeLessThan(10_000_000)
    expect(await h.db.prepare("SELECT user_email FROM credit_ledger WHERE kind='debit'").all())
      .toMatchObject({ results: [{ user_email: GOOGLE }] })
    expect(await snapshot()).toEqual(before)
  })
  it.each(['google', 'otp'] as const)('%s direct requests refuse an exhausted cohort; BYOK still works', async identity => {
    await plan(); await seed('trial_usage', GOOGLE, 17); await seed('email_trial_usage', OTP, 13)
    const session = await createSession(h.env, OTP)
    let sent = 0
    vi.spyOn(Math, 'random').mockReturnValue(1)
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/tokeninfo')) return Response.json({ aud: CLIENT, email: GOOGLE, email_verified: true })
      sent++
      return Response.json({ content: [{ type: 'text', text: 'ok' }], choices: [{ message: { content: 'ok' } }],
        candidates: [{ content: { parts: [{ text: 'ok' }] } }], usage: { input_tokens: 1, output_tokens: 1 } })
    }))
    const before = await snapshot()
    for (const byok of [false, true]) {
      const background: Promise<unknown>[] = []
      const response = await p.call({ request: new Request('https://tryarty.com/api/ai/' + p.name, {
        method: 'POST', headers: { 'content-type': 'application/json',
          ...(identity === 'google' ? { 'x-google-token': 'synthetic-google' } : { 'x-arty-trial-token': session! }),
          ...(byok ? { [p.key]: p.key === 'authorization' ? 'Bearer synthetic-byok' : 'synthetic-byok' } : {}),
          'cf-connecting-ip': byok ? '203.0.113.2' : '203.0.113.1',
        }, body: JSON.stringify({ model: p.model, stream: false, max_tokens: 100,
          messages: [{ role: 'user', content: 'Bonjour' }], contents: [{ role: 'user', parts: [{ text: 'Bonjour' }] }] }),
      }), env: h.env, waitUntil: (task: Promise<unknown>) => { background.push(task) } } as never) as Response
      expect(response.status).toBe(byok ? 200 : 403)
      if (!byok) expect(await response.json()).toMatchObject({ error: identity === 'otp' && p.name !== 'anthropic' ? 'paid_feature_required' : 'trial_expired' })
      else await response.text()
      await Promise.all(background)
      expect(sent).toBe(byok ? 1 : 0)
    }
    expect(await snapshot()).toEqual(before)
  })
})

describe('shared quota classification and continuation', () => {
  it.each([
    { google: 10, otp: 0, planValue: 'trial', state: 'active' },
    { google: 10, otp: 20, planValue: 'trial', state: 'exhausted' },
    { google: 10, otp: -1, planValue: 'trial', state: 'unknown' },
    { google: 10, otp: 0, planValue: 'free', state: 'outside-trial' },
  ])('wallet classification is $state from verified shared counters', async c => {
    await plan(GOOGLE, c.planValue); await seed('trial_usage', GOOGLE, c.google); await seed('email_trial_usage', OTP, c.otp)
    await creditWallet(h.env, { provider: 'synthetic', eventId: 'classify', orderId: 'classify', email: GOOGLE, amountMicro: 10000 })
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ aud: CLIENT, email: GOOGLE, email_verified: true })))
    const before = await snapshot()
    const response = await walletBalance({ request: new Request('https://tryarty.com/api/wallet/balance', {
      headers: { 'x-google-token': 'synthetic-google' } }), env: h.env } as never) as Response
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ trialState: c.state, availableMicro: 10000 })
    expect(await snapshot()).toEqual(before)
  })
  it('a continuation bound to trial refuses shared exhaustion without touching Google credits', async () => {
    await plan(); await seed('trial_usage', GOOGLE, 17); await seed('email_trial_usage', OTP, 13)
    await creditWallet(h.env, { provider: 'synthetic', eventId: 'continue', orderId: 'continue', email: GOOGLE, amountMicro: 10000000 })
    let providerCalls = 0
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/tokeninfo')) return Response.json({ aud: CLIENT, email: GOOGLE, email_verified: true })
      providerCalls++; throw new Error('No provider expected')
    }))
    const tasks: Promise<unknown>[] = [], before = await snapshot()
    const response = await anthropic({ request: new Request('https://tryarty.com/api/ai/proxy', {
      method: 'POST', headers: { 'x-google-token': 'synthetic-google', 'x-arty-require-funding': 'v1:trial-google', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 100, messages: [{ role: 'user', content: 'Synthetic continuation' }] }),
    }), env: h.env, waitUntil: (p: Promise<unknown>) => tasks.push(p) } as never) as Response
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: 'continuation_funding_changed' })
    await Promise.all(tasks)
    expect(providerCalls).toBe(0); expect(await snapshot()).toEqual(before)
    expect(await getWalletBalance(h.env, GOOGLE)).toMatchObject({ balanceMicro: 10000000, reservedMicro: 0 })
  })
})
