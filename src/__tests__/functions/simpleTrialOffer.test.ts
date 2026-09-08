import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import type { DatabaseSync as SQLiteDatabase } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Env } from '../../../functions/env'
import { resolveNonTrialChatAccess } from '../../../functions/api/_lib/simpleTrialOffer'
import { onRequestPost as anthropic } from '../../../functions/api/ai/proxy'
import { onRequestPost as memory } from '../../../functions/api/ai/memory-extract'
import { onRequestPost as search } from '../../../functions/api/search/web'
import { onRequestPost as url } from '../../../functions/api/fetch/url'
import { onRequestPost as geo } from '../../../functions/api/geo/reverse'
import { onRequestPost as tts } from '../../../functions/api/ai/tts'
import { onRequestPost as memoryAction } from '../../../functions/api/memory/action'
import { onRequestPost as mistral } from '../../../functions/api/ai/mistral-proxy'
import { onRequestPost as gemini } from '../../../functions/api/ai/gemini-proxy'
import { onRequestPost as openai } from '../../../functions/api/ai/openai-proxy'
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite')
let raw: SQLiteDatabase, env: Env, providerCalls: string[], pending: Promise<unknown>[]
const email = 'trial@example.invalid'
const extras = [
  ['memory', memory, { transcript: 'Un souvenir synthétique. '.repeat(10), facts: [] }],
  ['search', search, { query: 'Synthetic test' }],
  ['url', url, { url: 'https://example.com' }],
  ['geo', geo, { latitude: 48, longitude: 2 }],
  ['tts', tts, { text: 'Synthetic test' }],
] as const
const chats = [['mistral', mistral], ['gemini', gemini], ['openai', openai]] as const
function plan(value: string) {
  raw.prepare('DELETE FROM subscriptions').run()
  raw.prepare("INSERT INTO subscriptions(user_email, status, plan_type) VALUES (?, 'active', ?)").run(email, value)
}
async function call(handler: PagesFunction<Env>, body: unknown, extra: Record<string,string> = {}) {
  return await handler({ env, request: new Request('https://arty.test/api/test', {
    method: 'POST', headers: { 'x-google-token': 'synthetic', 'content-type': 'application/json', ...extra }, body: JSON.stringify(body),
  }), waitUntil: (p: Promise<unknown>) => pending.push(p) } as never) as Response
}
beforeEach(() => {
  raw = new DatabaseSync(':memory:'); raw.exec(readFileSync('schema.sql', 'utf8'))
  const db = { prepare(sql: string) {
    let args: (string|number)[] = []
    return {
      bind(...values: (string|number)[]) { args = values; return this },
      async first() { const row = raw.prepare(sql).get(...args); return row ? { ...row } : null },
      async run() { const result = raw.prepare(sql).run(...args); return { success: true, meta: { changes: Number(result.changes) } } },
      async all() { return { success: true, results: raw.prepare(sql).all(...args).map(r => ({ ...r })) } },
    }
  } } as unknown as D1Database
  env = { DB: db, GOOGLE_CLIENT_ID: 'synthetic-client', ANTHROPIC_API_KEY: 'synthetic', OPENAI_API_KEY: 'synthetic',
    MISTRAL_API_KEY: 'synthetic', GEMINI_API_KEY: 'synthetic', LINKUP_API_KEY: 'synthetic', GOOGLE_MAPS_API_KEY: 'synthetic' } as Env
  pending = []; providerCalls = []
  raw.prepare('INSERT INTO trial_usage(email, used, updated_at) VALUES (?, 7, 1)').run(email)
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo|URL) => {
    const target = String(input)
    if (target.includes('/tokeninfo')) return Response.json({ email, email_verified: true, aud: 'synthetic-client', sub: 'synthetic' })
    providerCalls.push(target)
    return Response.json({ content: [{ type: 'text', text: '{"add":[],"replace":[]}' }], results: [], markdown: 'Synthetic',
      usage: { input_tokens: 10, output_tokens: 2 }, choices: [{ message: { content: 'Synthetic' } }] })
  }))
})
afterEach(async () => { await Promise.allSettled(pending); raw.close(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
describe('simple free offer: actual handlers, SQLite rights, simulated providers', () => {
  for (const kind of ['free', 'trial']) for (const [name, handler, body] of extras) {
    it(`${kind} refuses ${name} without provider call or quota write`, async () => {
      plan(kind); const res = await call(handler, body)
      expect(res.status).toBe(403); expect(await res.json()).toMatchObject({ error: 'paid_feature_required' })
      expect(providerCalls).toEqual([])
      expect(raw.prepare('SELECT used FROM trial_usage').get()?.used).toBe(7)
      expect(raw.prepare('SELECT count(*) AS n FROM bg_quota').get()?.n).toBe(0)
      expect(raw.prepare('SELECT count(*) AS n FROM free_daily_quota').get()?.n).toBe(0)
    })
  }
  for (const kind of ['subscription', 'pro', 'vip']) for (const [name, handler, body] of extras) {
    it(`${kind} retains server-funded ${name}`, async () => {
      plan(kind); await call(handler, body)
      expect(providerCalls).toHaveLength(1)
      expect(raw.prepare('SELECT used FROM trial_usage').get()?.used).toBe(7)
    })
  }
  it('retains actual OpenAI BYOK speech for a free user', async () => {
    plan('free'); expect((await call(tts, { text: 'Synthetic' }, { 'x-openai-key': 'synthetic-byok' })).status).toBe(200)
    expect(providerCalls).toHaveLength(1)
  })
  it('a wallet or unrelated BYOK key does not fund auxiliary services', async () => {
    plan('free'); raw.prepare('INSERT INTO wallet(user_email,balance_micro) VALUES (?,100000000)').run(email)
    expect((await call(search, { query: 'Synthetic' }, { 'x-api-key': 'synthetic-byok' })).status).toBe(403)
    expect(providerCalls).toEqual([])
  })
  for (const [name, handler] of chats) it(`active Google trial refuses ${name} before decrement`, async () => {
    plan('trial'); const res = await call(handler, { model: 'gpt-5-mini', messages: [{ role: 'user', content: 'Synthetic' }] })
    expect(res.status).toBe(403); expect(await res.json()).toMatchObject({ error: 'paid_feature_required' })
    expect(providerCalls).toEqual([]); expect(raw.prepare('SELECT used FROM trial_usage').get()?.used).toBe(7)
  })
  it('refunds a Haiku admission when the server key is missing', async () => {
    plan('trial'); delete env.ANTHROPIC_API_KEY
    expect((await call(anthropic, { model: 'claude-haiku-4-5', max_tokens: 100, messages: [{ role: 'user', content: 'Synthetic' }] })).status).toBe(401)
    await Promise.allSettled(pending)
    expect(raw.prepare('SELECT used FROM trial_usage').get()?.used).toBe(7); expect(providerCalls).toEqual([])
  })
  it('an email trial cannot use a Google wallet, even with the same email', async () => {
    plan('vip')
    const result = await resolveNonTrialChatAccess({ kind: 'email-trial', email }, env) as Response
    expect(result.status).toBe(403); expect(providerCalls).toEqual([])
  })
  it('only verified Google exhaustion reaches the existing wallet branch', async () => {
    plan('trial'); raw.prepare('UPDATE trial_usage SET used=30').run()
    expect(await resolveNonTrialChatAccess({ kind: 'google', email }, env)).toEqual({ error: 'trial_expired', email })
    raw.prepare('UPDATE trial_usage SET used=-1').run()
    expect(await resolveNonTrialChatAccess({ kind: 'google', email }, env)).toEqual({ error: 'admission_unavailable' })
  })
  it('preserves old cloud memory read/delete but refuses new free writes', async () => {
    plan('free'); raw.prepare("INSERT INTO memory(user_id,category,data) VALUES (?,'notes','[\"Old fact\"]')").run(email)
    expect((await call(memoryAction, { type: 'write', category: 'notes', data: ['New fact'] })).status).toBe(403)
    expect(await (await call(memoryAction, { type: 'read', category: 'notes' })).json()).toEqual({ data: ['Old fact'] })
    expect((await call(memoryAction, { type: 'delete', category: 'notes' })).status).toBe(200)
    expect(raw.prepare('SELECT count(*) AS n FROM memory').get()?.n).toBe(0)
  })
})
