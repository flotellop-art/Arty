// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { onRequestPost } from '../../../functions/api/ai/proxy'
import { createSession } from '../../../functions/api/_lib/emailTrial'
import { makeD1Harness, type D1Harness } from './d1Harness'

const EMAIL = 'anthropic-preflight@example.test', CLIENT = 'synthetic-client'
const MODEL = 'claude-haiku-4-5-20251001'
const paths = ['google', 'otp', 'free', 'wallet', 'subscription', 'vip', 'byok', 'otp-byok'] as const
type Path = typeof paths[number]
let h: D1Harness, session: string, background: Promise<unknown>[], sent: { body: Record<string, unknown>; headers: Headers }[]
beforeAll(async () => { h = await makeD1Harness({ GOOGLE_CLIENT_ID: CLIENT, ANTHROPIC_API_KEY: 'synthetic-owner' }) })
afterAll(async () => { await h.dispose() })
beforeEach(async () => {
  await h.reset()
  delete h.env.ALLOWED_EMAILS
  h.env.ANTHROPIC_API_KEY = 'synthetic-owner'
  session = (await createSession(h.env, EMAIL))!
  background = []; sent = []
  // Do not turn local host load into an admission timeout. Dedicated deadline
  // suites attest the real 250ms contract; these tests inspect durable money.
  const realSet = globalThis.setTimeout, realClear = globalThis.clearTimeout
  const held = new Set<ReturnType<typeof setTimeout>>()
  vi.spyOn(globalThis, 'setTimeout').mockImplementation(((callback: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => {
    if (delay !== 250) return realSet(callback, delay, ...args)
    const handle = Object.create(null) as ReturnType<typeof setTimeout>; held.add(handle); return handle
  }) as typeof setTimeout)
  vi.spyOn(globalThis, 'clearTimeout').mockImplementation(handle => {
    if (!held.delete(handle as ReturnType<typeof setTimeout>)) realClear(handle)
  })
  vi.spyOn(Math, 'random').mockReturnValue(1)
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes('/tokeninfo')) return Response.json({ aud: CLIENT, email: EMAIL, email_verified: true })
    expect(String(input)).toBe('https://api.anthropic.com/v1/messages')
    sent.push({ body: JSON.parse(await new Response(init?.body).text()), headers: new Headers(init?.headers) })
    return Response.json({ content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 10, output_tokens: 2 } })
  }))
})
afterEach(async () => { await Promise.allSettled(background); vi.unstubAllGlobals(); vi.restoreAllMocks() })

async function seed(path: Path) {
  const plan = path === 'subscription' ? 'subscription' : 'trial'
  if (path !== 'free' && path !== 'wallet') {
    await h.db.prepare("INSERT INTO subscriptions (user_email, status, plan_type) VALUES (?1, 'active', ?2)").bind(EMAIL, plan).run()
  }
  if (path === 'vip') h.env.ALLOWED_EMAILS = EMAIL
  await h.db.prepare('INSERT INTO trial_usage (email, used, updated_at) VALUES (?1, 7, 0)').bind(EMAIL).run()
  await h.db.prepare('INSERT INTO email_trial_usage (email, used, updated_at) VALUES (?1, 13, 0)').bind(EMAIL).run()
  await h.db.prepare('INSERT INTO wallet (user_email, balance_micro) VALUES (?1, ?2)').bind(EMAIL, path === 'wallet' ? 100_000_000 : 0).run()
}
function request(path: Path, body: string, extra: HeadersInit = {}) {
  return new Request('https://tryarty.com/api/ai/proxy', { method: 'POST', body, headers: {
    'content-type': 'application/json', 'anthropic-version': '2023-06-01',
    'anthropic-beta': 'pdfs-2024-09-25,prompt-caching-2024-07-31',
    ...(path.startsWith('otp') ? { 'x-arty-trial-token': session } : { 'x-google-token': 'synthetic-google' }),
    ...(path.includes('byok') ? { 'x-api-key': 'synthetic-byok' } : {}), ...extra,
  } })
}
function invoke(req: Request, db = h.db) {
  return onRequestPost({ request: req, env: { ...h.env, DB: db },
    waitUntil: (p: Promise<unknown>) => { background.push(p) } } as never) as Promise<Response>
}
async function counters() {
  return Promise.all(['trial_usage', 'email_trial_usage'].map(table => h.db.prepare(`SELECT used FROM ${table} WHERE email=?1`).bind(EMAIL).first()))
}

describe('Anthropic preflight before every funding mutation — real local D1', () => {
  it.each(paths.flatMap(path => ['null', '[]', '{', '{"a":1,"a":2}'].map(raw => ({ path, raw }))))('$path rejects $raw without admission, debit, refund or provider', async ({ path, raw }) => {
    await seed(path)
    const forbidden = vi.fn()
    const guarded = new Proxy(h.db, { get(target, property) {
      if (property !== 'prepare') return Reflect.get(target, property)
      return (sql: string) => {
        if (/\b(?:trial_usage|email_trial_usage|subscriptions|licenses|wallet|reservation|credit_ledger|quota|free_daily_quota|premium_cap)\b/i.test(sql)) {
          forbidden(sql); throw new Error('preflight must not reach funding SQL')
        }
        return target.prepare(sql)
      }
    } })
    expect((await invoke(request(path, raw), guarded)).status).toBe(400)
    expect(forbidden).not.toHaveBeenCalled()
    expect(background).toHaveLength(0)
    expect(sent).toHaveLength(0)
    expect(await counters()).toEqual([{ used: 7 }, { used: 13 }])
  })
  it.each(paths)('%s preserves attachments, cache, custom/native tools, signatures, headers and funding', async path => {
    await seed(path)
    const body = { model: MODEL, max_tokens: 64000, stream: false,
      system: [{ type: 'text', text: 'Bonjour 日本語', cache_control: { type: 'ephemeral' } }],
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 },
        { name: 'calendar_read', input_schema: { type: 'object', properties: {} } }],
      messages: [{ role: 'assistant', content: [{ type: 'thinking', thinking: 'existing signed block', signature: 'unchanged' }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'JVBERi0xLjQK' } },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } }] }] }] }
    const response = await invoke(request(path, JSON.stringify(body)))
    expect(response.status).toBe(200)
    await response.text(); await Promise.all(background)
    expect(sent).toHaveLength(1)
    expect(sent[0].body).toEqual(body)
    expect(sent[0].headers.get('x-api-key')).toBe(path.includes('byok') ? 'synthetic-byok' : 'synthetic-owner')
    expect(sent[0].headers.get('anthropic-beta')).toBe('pdfs-2024-09-25,prompt-caching-2024-07-31')
    expect(sent[0].headers.get('anthropic-version')).toBe('2023-06-01')
    expect(await counters()).toEqual([{ used: path === 'google' ? 8 : 7 }, { used: path === 'otp' ? 14 : 13 }])
    const funds = await h.db.prepare('SELECT balance_micro, reserved_micro FROM wallet WHERE user_email=?1').bind(EMAIL).first<{ balance_micro: number; reserved_micro: number }>()
    expect(funds?.reserved_micro).toBe(0)
    if (path === 'wallet') expect(funds!.balance_micro).toBeLessThan(100_000_000)
    else expect(funds?.balance_micro).toBe(0)
  })
  it('prioritizes invalid transport over missing owner key or exhausted trial, without consuming', async () => {
    await seed('google'); delete h.env.ANTHROPIC_API_KEY
    expect((await invoke(request('google', '{'))).status).toBe(400)
    expect(await counters()).toEqual([{ used: 7 }, { used: 13 }])
    await h.db.prepare('UPDATE trial_usage SET used=30').run()
    expect((await invoke(request('google', 'null'))).status).toBe(400)
    expect(sent).toHaveLength(0)
  })
  it.each(['google', 'otp', 'subscription', 'vip', 'wallet', 'byok'] as const)('%s preserves actual served-model transformations', async path => {
    await seed(path)
    const body = { model: 'claude-sonnet-4-6', max_tokens: 65000, stream: false,
      thinking: { type: 'adaptive' }, output_config: { effort: 'high' },
      tools: [{ type: 'web_fetch_20260209', name: 'web_fetch' },
        { type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
      messages: [{ role: 'user', content: 'Bonjour' }] }
    const response = await invoke(request(path, JSON.stringify(body)))
    expect(response.status).toBe(200)
    await response.text(); await Promise.all(background)
    if (path === 'google' || path === 'otp') {
      expect(sent[0].body).toEqual({ model: MODEL, max_tokens: 64000, stream: false,
        tools: [body.tools[1]], messages: body.messages })
    } else expect(sent[0].body).toEqual(body)
  })
  it('refuses oversized declared input before trial consumption', async () => {
    await seed('otp')
    expect((await invoke(request('otp', '{}', { 'content-length': '32000001' }))).status).toBe(413)
    expect(await counters()).toEqual([{ used: 7 }, { used: 13 }])
    expect(background).toHaveLength(0); expect(sent).toHaveLength(0)
  })
  it('keeps authentication before body validation', async () => {
    expect((await invoke(new Request('https://tryarty.com/api/ai/proxy', { method: 'POST', body: 'null' }))).status).toBe(401)
    expect(sent).toHaveLength(0)
  })
  it.each(['free', 'wallet'] as const)('%s does not leak the wallet default into Free', async path => {
    await seed(path)
    const body = { model: MODEL, messages: [{ role: 'user', content: 'Bonjour' }], stream: false }
    const response = await invoke(request(path, JSON.stringify(body)))
    expect(response.status).toBe(200)
    await response.text(); await Promise.all(background)
    expect(sent[0].body).toEqual(path === 'wallet' ? { ...body, max_tokens: 8192 } : body)
  })
})
