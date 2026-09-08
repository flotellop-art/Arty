// @vitest-environment node
// Real client -> real route/admission -> local workerd D1. Only identity
// tokens, location and provider responses are synthetic; no paid API calls.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
vi.mock('../../services/aiHttp', () => ({ buildAiHeaders: async (o: { extra?: Record<string, string> }) => ({
  'content-type': 'application/json', 'x-google-token': 'synthetic-google', ...o.extra,
}) }))
vi.mock('../../services/locationContext', () => ({ buildLocationContext: async () => '' }))
import { streamMessage } from '../../services/anthropicClient'
import { onRequestPost as initial } from '../../../functions/api/ai/proxy'
import { onRequestPost as continuation } from '../../../functions/api/ai/anthropic-continue-v1'
import { makeD1Harness, type D1Harness } from '../functions/d1Harness'
import { fundSyntheticSubsidizedBudget } from '../functions/subsidizedBudgetFixture'
import { setActiveSession } from '../../services/userSession'

const EMAIL = 'native-client@example.test', MODEL = 'claude-haiku-4-5-20251001'
let h: D1Harness, background: Promise<unknown>[]
let browser: JSDOM
const event = (type: string, data: Record<string, unknown>) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`
function providerResponse(call: number) {
  return new Response([
    event('message_start', { message: { model: MODEL, usage: { input_tokens: 10, output_tokens: 0 } } }),
    event('content_block_start', { index: 0, content_block: { type: 'server_tool_use', id: `s${call}`, name: 'web_search', input: { query: 'synthetic' } } }),
    event('content_block_stop', { index: 0 }),
    event('content_block_start', { index: 1, content_block: { type: 'web_search_tool_result', tool_use_id: `s${call}`,
      content: [{ type: 'web_search_result', url: 'https://example.test', title: 'Synthetic', encrypted_content: 'EXACT+/=' }] } }),
    event('content_block_stop', { index: 1 }),
    event('content_block_start', { index: 2, content_block: { type: 'text', text: '' } }),
    event('content_block_delta', { index: 2, delta: { type: 'text_delta', text: call === 1 ? 'Recherche…' : 'Résultat.' } }),
    event('content_block_stop', { index: 2 }),
    event('message_delta', { delta: { stop_reason: call === 1 ? 'pause_turn' : 'end_turn' }, usage: { output_tokens: 10 } }),
    event('message_stop', {}),
  ].join(''), { headers: { 'content-type': 'text/event-stream' } })
}
beforeAll(async () => {
  browser = new JSDOM('', { url: 'https://tryarty.com' })
  h = await makeD1Harness({ GOOGLE_CLIENT_ID: 'synthetic-client', ANTHROPIC_API_KEY: 'synthetic-owner' })
})
afterAll(async () => { await h.dispose(); browser.window.close() })
beforeEach(async () => {
  h.env.DB = h.db
  await h.reset(); await fundSyntheticSubsidizedBudget(h.db); background = []
  // Browser storage/events only. Keep Node URL/fetch primitives for Miniflare.
  vi.stubGlobal('window', browser.window); vi.stubGlobal('localStorage', browser.window.localStorage)
  vi.stubGlobal('CustomEvent', browser.window.CustomEvent)
  localStorage.clear(); setActiveSession({ userId: 'synthetic-native', authMethod: 'google', displayName: 'Synthetic', createdAt: 0 })
  vi.spyOn(Math, 'random').mockReturnValue(1)
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
})
afterEach(async () => { await Promise.allSettled(background); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('actual browser-client native continuation with local D1', () => {
  it.each([500, 529])('does not spend wallet credits when the last trial response is HTTP %s', async status => {
    await h.db.prepare("INSERT INTO subscriptions (user_email,status,plan_type) VALUES (?,'active','trial')").bind(EMAIL).run()
    await h.db.prepare('INSERT INTO trial_usage (email,used,updated_at) VALUES (?,29,0)').bind(EMAIL).run()
    await h.db.prepare('INSERT INTO wallet (user_email,balance_micro) VALUES (?,100000000)').bind(EMAIL).run()
    const paths: string[] = [], restrictions: (string | null)[] = []
    let providerCalls = 0
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'https://tryarty.com')
      if (url.pathname.endsWith('/tokeninfo')) return Response.json({
        aud: 'synthetic-client', email: EMAIL, email_verified: true, sub: 'synthetic-subject',
      })
      if (url.hostname === 'api.anthropic.com') {
        providerCalls++
        return providerCalls === 1 ? Response.json({ error: { type: 'overloaded_error' } }, { status }) : providerResponse(2)
      }
      paths.push(url.pathname); restrictions.push(new Headers(init?.headers).get('x-arty-require-funding'))
      const handler = url.pathname === '/api/ai/proxy' ? initial : continuation
      return handler({ env: h.env, request: new Request(url, init),
        waitUntil: (p: Promise<unknown>) => background.push(p) } as never) as Promise<Response>
    }))
    let finish!: (value: string | Error) => void
    const completed = new Promise<string | Error>(resolve => { finish = resolve })
    const onDone = vi.fn(() => finish('done'))
    streamMessage([{ role: 'user', content: 'Synthetic research' }], () => {}, onDone, finish,
      { model: MODEL, tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }] }, 'server-provided')
    const result = await completed
    await Promise.all(background)
    expect(result).toMatchObject({ name: 'ContinuationFundingChangedError' })
    expect(onDone).not.toHaveBeenCalled()
    expect(paths).toEqual(['/api/ai/proxy', '/api/ai/anthropic-continue-v1'])
    expect(restrictions).toEqual([null, 'v1:trial-google'])
    expect(providerCalls).toBe(1)
    expect((await h.db.prepare('SELECT id FROM reservation').all()).results).toEqual([])
    expect((await h.db.prepare('SELECT state FROM subsidized_attempt_v1').all()).results).toEqual([{ state: 'engaged' }])
    expect(await h.db.prepare('SELECT used FROM trial_usage').first()).toEqual({ used: 30 })
    expect(await h.db.prepare('SELECT balance_micro,reserved_micro FROM wallet').first()).toEqual({ balance_micro: 100000000, reserved_micro: 0 })
  }, 15000)
  it.each(['funded', 'budget-exhausted', 'last-trial-with-wallet', 'wallet-read-unavailable'])('%s retains a distinct funding admission per HTTP attempt', async scenario => {
    if (scenario === 'budget-exhausted') await h.db.prepare('UPDATE subsidized_budget_v1 SET limit_attempts=1').run()
    if (scenario === 'last-trial-with-wallet') {
      await h.db.prepare("INSERT INTO subscriptions (user_email,status,plan_type) VALUES (?,'active','trial')").bind(EMAIL).run()
      await h.db.prepare('INSERT INTO trial_usage (email,used,updated_at) VALUES (?,29,0)').bind(EMAIL).run()
      await h.db.prepare('INSERT INTO wallet (user_email,balance_micro) VALUES (?,100000000)').bind(EMAIL).run()
    }
    const providerBodies: unknown[] = [], paths: string[] = [], engagedStates: unknown[][] = []
    let failedWalletReads = 0
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'https://tryarty.com')
      if (url.pathname === '/oauth2/v3/tokeninfo' || url.pathname.endsWith('/tokeninfo')) {
        return Response.json({ aud: 'synthetic-client', email: EMAIL, email_verified: true, sub: 'synthetic-subject' })
      }
      if (url.hostname === 'api.anthropic.com') {
        providerBodies.push(JSON.parse(init!.body as string))
        engagedStates.push((await h.db.prepare('SELECT state FROM subsidized_attempt_v1').all()).results)
        return providerResponse(providerBodies.length)
      }
      paths.push(url.pathname)
      if (scenario === 'wallet-read-unavailable' && url.pathname === '/api/ai/anthropic-continue-v1') {
        await h.db.prepare('INSERT INTO wallet (user_email,balance_micro) VALUES (?,100000000)').bind(EMAIL).run()
        h.env.DB = new Proxy(h.db, { get(target, key) {
          if (key === 'prepare') return (sql: string) => {
            if (sql.includes('SELECT balance_micro, reserved_micro,')) return { bind: () => ({ first: async () => {
              failedWalletReads++; throw new Error('synthetic continuation wallet outage')
            } }) }
            return target.prepare(sql)
          }
          const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value
        } })
      }
      const handler = url.pathname === '/api/ai/proxy' ? initial
        : url.pathname === '/api/ai/anthropic-continue-v1' ? continuation : null
      if (!handler) return new Response(null, { status: 404 })
      return handler({ env: h.env, request: new Request(url, init), waitUntil: (p: Promise<unknown>) => background.push(p) } as never) as Promise<Response>
    }))
    let finish!: (value: string | Error) => void
    const done = new Promise<string | Error>(resolve => { finish = resolve })
    const onDone = vi.fn(() => finish('done')), onError = vi.fn(finish), onToken = vi.fn()
    streamMessage([{ role: 'user', content: 'Recherche synthétique' }], onToken, onDone, onError,
      { model: MODEL, tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }] }, 'server-provided')
    const result = await done
    await Promise.all(background)
    expect(paths).toEqual(['/api/ai/proxy', '/api/ai/anthropic-continue-v1'])
    const count = scenario === 'funded' ? 2 : 1
    expect(providerBodies).toHaveLength(count)
    expect(engagedStates).toEqual(Array.from({ length: count }, (_, i) => Array(i + 1).fill({ state: 'engaged' })))
    const tickets = (await h.db.prepare('SELECT id,state FROM subsidized_attempt_v1').all()).results as { id: string; state: string }[]
    expect(tickets).toHaveLength(count); expect(new Set(tickets.map(t => t.id)).size).toBe(count)
    expect((await h.db.prepare('SELECT id FROM reservation').all()).results).toEqual([])
    if (scenario === 'funded') {
      expect(result).toBe('done'); expect(onDone).toHaveBeenCalledOnce(); expect(onError).not.toHaveBeenCalled()
      expect(JSON.stringify(providerBodies[1])).toContain('EXACT+/=')
    } else {
      expect(result).toMatchObject({ name: scenario === 'budget-exhausted' ? 'SubsidizedBudgetExhaustedError'
        : scenario === 'wallet-read-unavailable' ? 'AdmissionUnavailableError' : 'ContinuationFundingChangedError' })
      expect(onDone).not.toHaveBeenCalled(); expect(onError).toHaveBeenCalledOnce()
    }
    if (scenario === 'last-trial-with-wallet') {
      expect(await h.db.prepare('SELECT used FROM trial_usage').first()).toEqual({ used: 30 })
      expect(await h.db.prepare('SELECT balance_micro,reserved_micro FROM wallet').first()).toEqual({ balance_micro: 100000000, reserved_micro: 0 })
    }
    if (scenario === 'wallet-read-unavailable') {
      expect(failedWalletReads).toBe(1)
      expect(await h.db.prepare('SELECT balance_micro,reserved_micro FROM wallet').first()).toEqual({ balance_micro: 100000000, reserved_micro: 0 })
    }
  }, 15000)
})
