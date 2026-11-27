// @vitest-environment node
//
// Issue #393 — invariant « unité consommée ⟺ réponse servie » sur les proxys
// de chat. Avant ce correctif, proxy.ts (Anthropic) et mistral-proxy.ts ne
// rendaient que la réserve wallet : une surcharge 529 retentée 4 fois par le
// client brûlait 4 messages d'essai ou 4 unités du cap Sonnet.
//
// Politique (décision du 27 novembre 2026) : panne, surcharge, 429, clé du
// propriétaire et facturation rendent tout ; un refus de CONTENU (400 hors
// facturation) garde son unité, la réserve wallet étant toujours rendue.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { onRequestPost as anthropic } from '../../../functions/api/ai/proxy'
import { onRequestPost as openai } from '../../../functions/api/ai/openai-proxy'
import { onRequestPost as mistral } from '../../../functions/api/ai/mistral-proxy'
import { createSession } from '../../../functions/api/_lib/emailTrial'
import { isRefundableUpstreamFailure } from '../../../functions/api/_lib/unservedRefunds'
import { makeD1Harness, type D1Harness } from './d1Harness'

const EMAIL = 'refunds@example.test', CLIENT_ID = 'arty-client-id'
const TRIAL_USED = 7, OTP_USED = 13
const providers = [
  { name: 'anthropic', call: anthropic, upstream: 'api.anthropic.com',
    trialModel: 'claude-haiku-5-5', premiumModel: 'claude-sonnet-5-5', bucket: 'claude-sonnet' },
  { name: 'openai', call: openai, upstream: 'api.openai.com',
    trialModel: 'gpt-5-mini', premiumModel: 'gpt-5', bucket: 'gpt-5' },
  { name: 'mistral', call: mistral, upstream: 'api.mistral.ai',
    trialModel: 'mistral-medium-latest', premiumModel: 'mistral-medium-latest', bucket: null },
] as const
type Provider = typeof providers[number]
type Identity = 'google' | 'otp'
type Upstream = { status: number; body?: unknown } | 'throw'

let h: D1Harness, session: string, background: Promise<unknown>[]
let upstreamQueue: Upstream[], upstreamCalls: number
const month = () => new Date().toISOString().slice(0, 7)

beforeAll(async () => {
  h = await makeD1Harness({ GOOGLE_CLIENT_ID: CLIENT_ID, ANTHROPIC_API_KEY: 'synthetic-anthropic',
    OPENAI_API_KEY: 'synthetic-openai', MISTRAL_API_KEY: 'synthetic-mistral' })
})
afterAll(async () => { await h.dispose() })
beforeEach(async () => {
  await h.reset()
  h.env.DB = h.db
  delete h.env.ALLOWED_EMAILS
  await h.db.prepare('INSERT INTO trial_usage (email, used, updated_at) VALUES (?1, ?2, 0)').bind(EMAIL, TRIAL_USED).run()
  await h.db.prepare('INSERT INTO email_trial_usage (email, used, updated_at) VALUES (?1, ?2, 0)').bind(EMAIL, OTP_USED).run()
  session = (await createSession(h.env, EMAIL))!
  expect(session).toBeTruthy()
  background = []; upstreamQueue = []; upstreamCalls = 0
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  vi.spyOn(Math, 'random').mockReturnValue(1)
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/tokeninfo')) return Response.json({ aud: CLIENT_ID, email: EMAIL, email_verified: true, sub: 'synthetic-sub' })
    if (url.includes('/userinfo')) return Response.json({ email: EMAIL, verified_email: true, id: 'synthetic-sub' })
    upstreamCalls++
    await new Response(init?.body ?? null).arrayBuffer()
    const next = upstreamQueue.shift() ?? { status: 200 }
    if (next === 'throw') throw new Error('synthetic network failure')
    if (next.status !== 200) return Response.json(next.body ?? { error: { type: 'overloaded_error', message: 'Overloaded' } }, { status: next.status })
    return Response.json({ content: [{ type: 'text', text: 'ok' }], choices: [{ message: { content: 'ok' } }],
      usage: { input_tokens: 10, output_tokens: 2, prompt_tokens: 10, completion_tokens: 2 } })
  }))
})
afterEach(async () => {
  await Promise.allSettled(background)
  vi.unstubAllGlobals(); vi.restoreAllMocks()
})

function invoke(p: Provider, identity: Identity, model: string, init: { rawBody?: string } = {}) {
  const request = new Request('https://tryarty.com/api/ai/' + p.name, { method: 'POST', headers: {
    'content-type': 'application/json',
    ...(identity === 'google' ? { 'x-google-token': 'synthetic-google' } : { 'x-arty-trial-token': session }),
  }, body: init.rawBody ?? JSON.stringify({ model, stream: false, max_tokens: 100,
    messages: [{ role: 'user', content: 'Bonjour' }] }) })
  return p.call({ request, env: h.env,
    waitUntil: (promise: Promise<unknown>) => { background.push(promise) } } as never) as Promise<Response>
}
async function settle(response: Response) {
  await response.text().catch(() => '')
  // Les remboursements tournent sous waitUntil : attendre qu'ils aient vidé.
  for (let i = 0; i < 5; i++) await Promise.allSettled(background)
}
async function grant(plan: 'trial' | 'subscription') {
  await h.db.prepare("INSERT INTO subscriptions (user_email, status, plan_type) VALUES (?1, 'active', ?2)").bind(EMAIL, plan).run()
}
const trialUsed = async (table: 'trial_usage' | 'email_trial_usage') =>
  (await h.db.prepare(`SELECT used FROM ${table} WHERE email = ?1`).bind(EMAIL).first<{ used: number }>())?.used
const dailyCount = async () =>
  (await h.db.prepare('SELECT COALESCE(SUM(count), 0) AS n FROM quota WHERE email = ?1').bind(EMAIL).first<{ n: number }>())!.n
const capCount = async (bucket: string) =>
  (await h.db.prepare('SELECT count FROM premium_cap WHERE email = ?1 AND month = ?2 AND bucket = ?3')
    .bind(EMAIL, month(), bucket).first<{ count: number }>())?.count

describe('isRefundableUpstreamFailure', () => {
  it.each([500, 502, 503, 529, 429, 401, 403, 408, 409])('rend les compteurs sur %s', status => {
    expect(isRefundableUpstreamFailure(status, false)).toBe(true)
  })
  it.each([400, 404, 413, 422])('garde l’unité sur un refus de contenu %s', status => {
    expect(isRefundableUpstreamFailure(status, false)).toBe(false)
  })
  it('rend toujours un motif de facturation, même en 400', () => {
    expect(isRefundableUpstreamFailure(400, true)).toBe(true)
  })
})

describe.each(providers.flatMap(p => (['google', 'otp'] as const).map(identity => ({ ...p, identity }))))(
  '$name / essai $identity', p => {
    const table = p.identity === 'google' ? 'trial_usage' : 'email_trial_usage'
    const other = p.identity === 'google' ? 'email_trial_usage' : 'trial_usage'
    const initial = p.identity === 'google' ? TRIAL_USED : OTP_USED
    beforeEach(async () => { if (p.identity === 'google') await grant('trial') })

    it.each([529, 503, 429])('rend le message d’essai sur un upstream %s', async status => {
      upstreamQueue.push({ status })
      const response = await invoke(p, p.identity, p.trialModel)
      expect(response.status).toBe(status)
      // Le compteur affiché par le client doit être celui APRÈS remboursement.
      const header = response.headers.get('x-trial-remaining')
      if (header !== null) expect(Number(header)).toBe(30 - initial)
      await settle(response)
      expect(upstreamCalls).toBe(1)
      expect(await trialUsed(table)).toBe(initial)
      expect(await trialUsed(other)).toBe(p.identity === 'google' ? OTP_USED : TRIAL_USED)
    })

    it('rend le message d’essai quand le fetch upstream lève', async () => {
      upstreamQueue.push('throw')
      const response = await invoke(p, p.identity, p.trialModel)
      expect(response.status).toBe(502)
      await settle(response)
      expect(await trialUsed(table)).toBe(initial)
    })

    it('le scénario #393 : une surcharge puis un succès ne coûtent qu’un message', async () => {
      upstreamQueue.push({ status: 529 })
      await settle(await invoke(p, p.identity, p.trialModel))
      const served = await invoke(p, p.identity, p.trialModel)
      expect(served.status).toBe(200)
      await settle(served)
      expect(upstreamCalls).toBe(2)
      expect(await trialUsed(table)).toBe(initial + 1)
    })

    it('garde le message d’essai sur un refus de contenu 400', async () => {
      upstreamQueue.push({ status: 400, body: { error: { type: 'invalid_request_error', message: 'messages: bad field' } } })
      const response = await invoke(p, p.identity, p.trialModel)
      expect(response.status).toBe(400)
      await settle(response)
      expect(await trialUsed(table)).toBe(initial + 1)
    })

    it('rend le message d’essai quand la clé serveur est à sec (400 facturation)', async () => {
      upstreamQueue.push({ status: 400, body: { error: { type: 'invalid_request_error',
        message: 'Your credit balance is too low to access the API.' } } })
      const response = await invoke(p, p.identity, p.trialModel)
      expect(response.status).toBe(400)
      await settle(response)
      expect(await trialUsed(table)).toBe(initial)
    })
  })

describe.each(providers)('$name / abonnement', p => {
  beforeEach(async () => { await grant('subscription') })

  it('rend quota journalier et cap premium sur un upstream 529', async () => {
    if (p.bucket) {
      await h.db.prepare('INSERT INTO premium_cap (email, month, bucket, count, updated_at) VALUES (?1, ?2, ?3, 5, 0)')
        .bind(EMAIL, month(), p.bucket).run()
    }
    upstreamQueue.push({ status: 529 })
    const response = await invoke(p, 'google', p.premiumModel)
    expect(response.status).toBe(529)
    await settle(response)
    expect(await dailyCount()).toBe(0)
    if (p.bucket) expect(await capCount(p.bucket)).toBe(5)
  })

  it('consomme exactement une unité quand la réponse est servie', async () => {
    if (p.bucket) {
      await h.db.prepare('INSERT INTO premium_cap (email, month, bucket, count, updated_at) VALUES (?1, ?2, ?3, 5, 0)')
        .bind(EMAIL, month(), p.bucket).run()
    }
    const response = await invoke(p, 'google', p.premiumModel)
    expect(response.status).toBe(200)
    await settle(response)
    expect(await dailyCount()).toBe(1)
    if (p.bucket) expect(await capCount(p.bucket)).toBe(6)
  })

  it('un 429 de quota journalier ne fait pas monter le compteur', async () => {
    const day = new Date().toISOString().slice(0, 10)
    await h.db.prepare('INSERT INTO quota (email, day, count, updated_at) VALUES (?1, ?2, 50, 0)').bind(EMAIL, day).run()
    const response = await invoke(p, 'google', p.premiumModel)
    expect(response.status).toBe(429)
    expect(await response.clone().json()).toMatchObject({ limit: 50 })
    await settle(response)
    expect(upstreamCalls).toBe(0)
    expect(await dailyCount()).toBe(50)
  })

  it.skipIf(!p.bucket)('un cap premium atteint rend le quota journalier', async () => {
    await h.db.prepare('INSERT INTO premium_cap (email, month, bucket, count, updated_at) VALUES (?1, ?2, ?3, 1000, 0)')
      .bind(EMAIL, month(), p.bucket!).run()
    const response = await invoke(p, 'google', p.premiumModel)
    expect(response.status).toBe(429)
    expect(await response.clone().json()).toMatchObject({ error: 'premium_cap_reached' })
    await settle(response)
    expect(upstreamCalls).toBe(0)
    expect(await dailyCount()).toBe(0)
  })
})

describe('mistral — lecture du body avant tout débit', () => {
  it('un JSON invalide est refusé sans consommer d’essai', async () => {
    await grant('trial')
    const response = await invoke(providers[2], 'google', 'mistral-medium-latest', { rawBody: '{not json' })
    expect(response.status).toBe(400)
    await settle(response)
    expect(upstreamCalls).toBe(0)
    expect(await trialUsed('trial_usage')).toBe(TRIAL_USED)
  })
})
