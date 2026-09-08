// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { onRequestPost } from '../../../functions/api/ai/proxy'
import { createSession } from '../../../functions/api/_lib/emailTrial'
import { makeD1Harness, type D1Harness } from './d1Harness'

const EMAIL = 'redirect@example.test', BALANCE = 100_000_000
let h: D1Harness, background: Promise<unknown>[], calls: RequestInit[], token: string
let provider: () => Response
beforeAll(async () => { h = await makeD1Harness({ GOOGLE_CLIENT_ID: 'synthetic-client', ANTHROPIC_API_KEY: 'synthetic-owner' }) })
afterAll(async () => { await h.dispose() })
beforeEach(async () => {
  await h.reset(); delete h.env.ALLOWED_EMAILS
  background = []; calls = []
  token = (await createSession(h.env, EMAIL))!
  await h.db.prepare('INSERT INTO wallet (user_email,balance_micro) VALUES (?,?)').bind(EMAIL, BALANCE).run()
  provider = () => new Response('PRIVATE_REDIRECT', { status: 307, headers: { location: 'https://must-not-follow.invalid' } })
  vi.spyOn(Math, 'random').mockReturnValue(1)
  vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url).includes('/tokeninfo')) return Response.json({ aud: 'synthetic-client', email: EMAIL, email_verified: true })
    calls.push(init!)
    return provider()
  }))
})
afterEach(async () => { await Promise.allSettled(background); vi.unstubAllGlobals(); vi.restoreAllMocks() })
function invoke(otp = false, byok = false) {
  return onRequestPost({ env: h.env, waitUntil: (p: Promise<unknown>) => { background.push(p) },
    request: new Request('https://tryarty.com/api/ai/proxy', { method: 'POST', headers: {
      'content-type': 'application/json', ...(otp ? { 'x-arty-trial-token': token } : { 'x-google-token': 'synthetic-google' }),
      ...(byok ? { 'x-api-key': 'synthetic-personal' } : {}),
    }, body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 100, messages: [{ role: 'user', content: 'Bonjour' }] }) }),
  } as never) as Promise<Response>
}
async function ledger() { await Promise.all(background); return (await h.db.prepare('SELECT amount_micro,meta FROM credit_ledger WHERE kind=\'debit\'').all<{ amount_micro: number; meta: string }>()).results }

describe('Anthropic redirect outcome and real wallet settlement', () => {
  it.each([301,302,303,307,308])('HTTP%s settles the unknown wallet outcome once, without void or claimed measured usage', async status => {
    let held = 0
    provider = () => new Response('PRIVATE_REDIRECT', { status, headers: { location: 'https://must-not-follow.invalid' } })
    // Read the actual hold after invocation; reservation survives as settled.
    const response = await invoke()
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'upstream_outcome_unknown' })
    const rows = await ledger()
    const reservation = await h.db.prepare('SELECT status,reserved_micro FROM reservation').first<{ status: string; reserved_micro: number }>()
    held = reservation!.reserved_micro
    expect(held).toBeGreaterThan(0); expect(reservation!.status).toBe('settled')
    expect(rows).toHaveLength(1); expect(rows[0].amount_micro).toBe(-held)
    expect(JSON.parse(rows[0].meta)).toMatchObject({ usageMeasured: false, fallback: 'full_reservation' })
    expect(await h.db.prepare('SELECT balance_micro,reserved_micro FROM wallet').first()).toEqual({ balance_micro: BALANCE-held, reserved_micro: 0 })
    expect(calls).toHaveLength(1); expect(calls[0].redirect).toBe('manual')
  })
  it.each(['free','trial','otp','subscription','vip','byok'])('%s does not acquire a wallet charge from a redirect', async path => {
    if (path === 'free') await h.db.prepare('UPDATE wallet SET balance_micro=0').run()
    if (path === 'trial' || path === 'subscription') await h.db.prepare("INSERT INTO subscriptions (user_email,status,plan_type) VALUES (?,'active',?)").bind(EMAIL,path).run()
    if (path === 'vip') h.env.ALLOWED_EMAILS = EMAIL
    const response = await invoke(path === 'otp', path === 'byok')
    expect(response.status).toBe(409)
    expect(await ledger()).toEqual([])
    expect((await h.db.prepare('SELECT id FROM reservation').all()).results).toEqual([])
    expect(calls).toHaveLength(1)
    if (path === 'trial' || path === 'otp') expect(response.headers.get('x-trial-remaining')).toBe('29')
  })
  it.each(['reject','pending'])('does not await or expose a redirect body whose cancel is %s', async cancelMode => {
    let cancelled = 0
    provider = () => new Response(new ReadableStream({ cancel() {
      cancelled++
      return cancelMode === 'reject' ? Promise.reject(new Error('PRIVATE_CANCEL')) : new Promise<void>(() => {})
    } }), { status: 307, headers: { location: 'https://must-not-follow.invalid' } })
    const response = await invoke(false, true)
    expect(response.status).toBe(409); expect(cancelled).toBe(1)
    expect(await response.text()).not.toContain('PRIVATE')
    expect(await ledger()).toEqual([])
  })
})
