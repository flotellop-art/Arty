// @vitest-environment node
import { readFileSync } from 'node:fs'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { reserveSubsidizedAttempt as reserve, dispatchSubsidizedAttempt as dispatch,
  settleSubsidizedAttempt as settle, type SubsidizedEnvelope } from '../../../functions/api/_lib/subsidizedBudget'
import { ANTHROPIC_SUBSIDIZED_TARIFF, type SubsidizedCostProof } from '../../../functions/api/_lib/anthropicSubsidizedUsage'
import { onRequestPost } from '../../../functions/api/ai/proxy'
import { createSession } from '../../../functions/api/_lib/emailTrial'
import { makeD1Harness, type D1Harness } from './d1Harness'

const SCOPE = 'arty-subsidized', MODEL = 'claude-haiku-4-5-20251001', EMAIL = 'settlement@example.test'
let h: D1Harness
const envelope: SubsidizedEnvelope = { policyRevision: 1, ceilingMicroUsd: 60, envelopeId: 'synthetic-text-v1' }
const proof: SubsidizedCostProof = { responseId: 'msg_synthetic', tariff: ANTHROPIC_SUBSIDIZED_TARIFF,
  costMicroUsd: 12, inputTokens: 7, outputTokens: 1, cacheReadTokens: 0, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0,
  searches: 0, requestBoundsExceeded: false }
beforeAll(async () => {
  h = await makeD1Harness({ GOOGLE_CLIENT_ID: 'synthetic-client', ANTHROPIC_API_KEY: 'synthetic-owner' })
  for (const name of ['0013_subsidized_budget.sql', '0014_subsidized_settlement.sql']) {
    const sql = readFileSync(new URL(`../../../migrations/${name}`, import.meta.url), 'utf8')
      .split('\n').filter(s => !s.trim().startsWith('--')).join('\n').split(';').filter(s => s.trim())
    for (const statement of sql) await h.db.prepare(statement).run()
  }
})
afterAll(async () => { await h.dispose() })
beforeEach(async () => {
  await h.reset(); delete h.env.ALLOWED_EMAILS
  await h.db.prepare('DELETE FROM subsidized_settlement_v1').run()
  await h.db.prepare('DELETE FROM subsidized_attempt_v1').run()
  await h.db.prepare('DELETE FROM subsidized_budget_v1').run()
  await h.db.prepare(`INSERT INTO subsidized_budget_v1 (scope,revision,enabled,limit_micro_usd,limit_attempts)
    VALUES (?,1,1,100,10)`).bind(SCOPE).run()
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
const state = () => h.db.prepare('SELECT reserved_micro_usd,reserved_attempts,pending_admission_id,enabled FROM subsidized_budget_v1').first()
const receipts = async () => (await h.db.prepare('SELECT * FROM subsidized_settlement_v1').all()).results
async function ticket(send = true) {
  const r = await reserve(h.db, envelope)
  if (r.status !== 'reserved') throw new Error('Synthetic reservation failed')
  if (send) expect((await dispatch(h.db, r.ticket, async () => 'synthetic')).status).toBe('sent')
  return r.ticket
}
function lostAck(): D1Database {
  return new Proxy(h.db, { get(target, key) {
    if (key === 'batch') return async (statements: D1PreparedStatement[]) => {
      await target.batch(statements); throw new Error('synthetic lost ACK after commit')
    }
    const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value
  } })
}
describe('real D1 settlement of provider cost', () => {
  it('releases unused money once under concurrent replay, retaining attempt and no-resend', async () => {
    const t = await ticket()
    expect(await Promise.all([settle(h.db, t, proof), settle(h.db, t, proof)])).toEqual(['settled', 'settled'])
    expect(await state()).toMatchObject({ reserved_micro_usd: 12, reserved_attempts: 1, pending_admission_id: null })
    expect(await receipts()).toHaveLength(1)
    const send = vi.fn(async () => 'must not send')
    expect((await dispatch(h.db, t, send)).status).toBe('unavailable'); expect(send).not.toHaveBeenCalled()
    await ticket(); expect(await state()).toMatchObject({ reserved_micro_usd: 72, reserved_attempts: 2 })
  })
  it('does not settle an unengaged or forged ticket, or a conflicting proof', async () => {
    const t = await ticket(false)
    expect(await settle(h.db, t, proof)).toBe('unavailable')
    await dispatch(h.db, t, async () => 'synthetic')
    expect(await settle(h.db, { ...t, envelopeId: 'other' }, proof)).toBe('unavailable')
    expect(await settle(h.db, t, proof)).toBe('settled')
    expect(await settle(h.db, t, { ...proof, responseId: 'msg_conflict' })).toBe('unavailable')
    expect(await settle(h.db, t, { ...proof, inputTokens: 8, costMicroUsd: 13 })).toBe('unavailable')
    expect(await state()).toMatchObject({ reserved_micro_usd: 12, reserved_attempts: 1 })
  })
  it('keeps a committed receipt after lost ACK and makes its retry idempotent', async () => {
    const t = await ticket()
    expect(await settle(lostAck(), t, proof)).toBe('unavailable')
    expect(await settle(h.db, t, proof)).toBe('settled')
    expect(await state()).toMatchObject({ reserved_micro_usd: 12, reserved_attempts: 1 })
  })
  it('rolls back the release when receipt insertion fails', async () => {
    const t = await ticket()
    await h.db.prepare("CREATE TRIGGER reject_receipt BEFORE INSERT ON subsidized_settlement_v1 BEGIN SELECT RAISE(ABORT,'synthetic failure'); END").run()
    try {
      expect(await settle(h.db, t, proof)).toBe('unavailable')
      expect(await state()).toMatchObject({ reserved_micro_usd: 60, pending_admission_id: null })
      expect(await receipts()).toEqual([])
    } finally { await h.db.prepare('DROP TRIGGER reject_receipt').run() }
  })
  it('preserves conservation when a reservation races settlement', async () => {
    const t = await ticket()
    const [s, r] = await Promise.all([settle(h.db, t, proof), reserve(h.db, envelope)])
    expect(s).toBe('settled')
    expect(['reserved', 'budget_exhausted']).toContain(r.status)
    expect(await state()).toMatchObject({ reserved_micro_usd: r.status === 'reserved' ? 72 : 12,
      reserved_attempts: r.status === 'reserved' ? 2 : 1, pending_admission_id: null })
  })
  it('does not replenish the attempt quota even for an explicitly zero-cost response', async () => {
    await h.db.prepare('UPDATE subsidized_budget_v1 SET limit_attempts=1').run()
    const t = await ticket()
    expect(await settle(h.db, t, { ...proof, inputTokens: 0, outputTokens: 0, costMicroUsd: 0 })).toBe('settled')
    expect((await reserve(h.db, envelope)).status).toBe('budget_exhausted')
    expect(await state()).toMatchObject({ reserved_micro_usd: 0, reserved_attempts: 1 })
  })
  it('does not release an old revision or an invalid price; broken ceiling disables admissions', async () => {
    const t = await ticket()
    expect(await settle(h.db, t, { ...proof, costMicroUsd: 1 })).toBe('unavailable')
    await h.db.prepare('UPDATE subsidized_budget_v1 SET revision=2').run()
    expect(await settle(h.db, t, proof)).toBe('unavailable')
    await h.db.prepare('UPDATE subsidized_budget_v1 SET revision=1').run()
    expect(await settle(h.db, t, { ...proof, inputTokens: 100, costMicroUsd: 105 })).toBe('over_ceiling')
    expect(await state()).toMatchObject({ reserved_micro_usd: 60, enabled: 0 })
    expect(await receipts()).toEqual([])
    expect((await reserve(h.db, envelope)).status).toBe('unavailable')
  })
})

describe('real handler, provider stream and D1 budget together', () => {
  const frame = (p: unknown) => `data: ${JSON.stringify(p)}\n\n`
  const usage = { input_tokens: 8000, output_tokens: 1000, cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0, server_tool_use: { web_search_requests: 0 } }
  const json = { type: 'message', role: 'assistant', id: 'msg_handler', model: MODEL,
    stop_reason: 'end_turn', content: [{ type: 'text', text: 'synthetic' }], usage }
  const stream = () => frame({ type: 'message_start', message: { ...json, stop_reason: null,
    usage: { ...usage, output_tokens: 1 } } })
    + frame({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage })
    + frame({ type: 'message_stop' })
  it.each(['json', 'sse', 'missing-stop', 'error', 'read-failure', 'missing-search', 'over-bound'])('settles only complete %s evidence', async kind => {
    await h.db.prepare('UPDATE subsidized_budget_v1 SET limit_micro_usd=100000000').run()
    await h.db.prepare("INSERT INTO subscriptions (user_email,status,plan_type) VALUES (?,'active','trial')").bind(EMAIL).run()
    await h.db.prepare('INSERT INTO trial_usage (email,used,updated_at) VALUES (?,0,0)').bind(EMAIL).run()
    const calls: RequestInit[] = [], background: Promise<unknown>[] = []
    let pulls = 0
    vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).includes('/tokeninfo')) return Response.json({ aud: 'synthetic-client', email: EMAIL, email_verified: true, sub: 'synthetic' })
      calls.push(init!)
      if (kind === 'json') return Response.json(json)
      if (kind === 'over-bound') return Response.json({ ...json, usage: { ...usage, output_tokens: 2001 } })
      if (kind === 'missing-search') return Response.json({ ...json, usage: { ...usage, server_tool_use: undefined } })
      if (kind === 'read-failure') return new Response(new ReadableStream({ pull(c) {
        if (pulls++ === 0) c.enqueue(new TextEncoder().encode(stream()))
        else c.error(new Error('synthetic interrupted response'))
      } }, { highWaterMark: 0 }), { headers: { 'content-type': 'text/event-stream' } })
      const raw = kind === 'missing-stop' ? stream().replace(frame({ type: 'message_stop' }), '')
        : stream() + (kind === 'error' ? frame({ type: 'error' }) : '')
      return new Response(raw, { headers: { 'content-type': 'text/event-stream' } })
    }))
    const response = await onRequestPost({ env: h.env, waitUntil: (p: Promise<unknown>) => background.push(p),
      request: new Request('https://tryarty.com/api/ai/proxy', { method: 'POST', headers: { 'x-google-token': 'synthetic' },
        body: JSON.stringify({ model: MODEL, max_tokens: 64000, stream: true,
          tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
          messages: [{ role: 'user', content: 'synthetic' }] }) }) } as never) as Response
    expect(response.status).toBe(200)
    expect(response.headers.get('x-arty-funding')).toBe('v1:trial-google')
    await response.text().catch(() => 'synthetic stream failure'); await Promise.all(background)
    expect(calls).toHaveLength(1)
    expect(JSON.parse(String(calls[0].body))).toMatchObject({ max_tokens: 2000,
      tools: [{ name: 'web_search', max_uses: 1 }] })
    const complete = kind === 'json' || kind === 'sse'
    expect(await state()).toMatchObject({ reserved_micro_usd: complete ? 13000 : 4020000, reserved_attempts: 1 })
    expect(await receipts()).toHaveLength(complete ? 1 : 0)
    if (kind === 'read-failure') expect(pulls).toBe(2)
    if (kind === 'over-bound') expect(await state()).toMatchObject({ enabled: 0 })
  })
  it.each(['otp', 'byok', 'subscription', 'wallet'])('limits only subsidized funding: %s', async path => {
    await h.db.prepare('UPDATE subsidized_budget_v1 SET limit_micro_usd=100000000').run()
    const session = path === 'otp' ? await createSession(h.env, EMAIL) : ''
    if (path === 'subscription') await h.db.prepare("INSERT INTO subscriptions (user_email,status,plan_type) VALUES (?,'active','subscription')").bind(EMAIL).run()
    if (path === 'wallet') await h.db.prepare('INSERT INTO wallet (user_email,balance_micro) VALUES (?,100000000)').bind(EMAIL).run()
    const calls: RequestInit[] = [], background: Promise<unknown>[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).includes('/tokeninfo')) return Response.json({ aud: 'synthetic-client', email: EMAIL, email_verified: true, sub: 'synthetic' })
      calls.push(init!); return Response.json(json)
    }))
    const response = await onRequestPost({ env: h.env, waitUntil: (p: Promise<unknown>) => background.push(p),
      request: new Request('https://tryarty.com/api/ai/proxy', { method: 'POST', headers: {
        ...(path === 'otp' ? { 'x-arty-trial-token': session! } : { 'x-google-token': 'synthetic' }),
        ...(path === 'byok' ? { 'x-api-key': 'synthetic-personal-key' } : {}),
      }, body: JSON.stringify({ model: MODEL, max_tokens: 64000,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
        messages: [{ role: 'user', content: 'synthetic' }] }) }) } as never) as Response
    expect(response.status).toBe(200)
    await response.text(); await Promise.all(background)
    expect(calls).toHaveLength(1)
    const sent = JSON.parse(String(calls[0].body))
    expect(sent.tools[0].max_uses).toBe(path === 'otp' ? 1 : 5)
    if (path !== 'wallet') expect(sent.max_tokens).toBe(path === 'otp' ? 2000 : 64000)
    else expect(sent.max_tokens).toBeGreaterThan(2000)
    expect(await receipts()).toHaveLength(path === 'otp' ? 1 : 0)
    expect(await state()).toMatchObject({ reserved_attempts: path === 'otp' ? 1 : 0 })
  })
})
