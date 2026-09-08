// @vitest-environment node
// The three original RED oracles are preserved; qualified positive paths follow.
import { readFileSync } from 'node:fs'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { onRequestPost } from '../../../functions/api/ai/proxy'
import { onRequestPost as continuePost } from '../../../functions/api/ai/anthropic-continue-v1'
import { createSession } from '../../../functions/api/_lib/emailTrial'
import { makeD1Harness, type D1Harness } from './d1Harness'
import { traceAdmission, admissionFinancialState } from './admissionTrace'

const EMAIL = 'subsidized-chat@example.test'
const schema = readFileSync(new URL('../../../migrations/0013_subsidized_budget.sql', import.meta.url), 'utf8')
  .split('\n').filter(line => !line.trim().startsWith('--')).join('\n').split(';').filter(sql => sql.trim())
let h: D1Harness, calls: RequestInit[], background: Promise<unknown>[], token: string
let providerResponse: () => Response | Promise<Response>
beforeAll(async () => { h = await makeD1Harness({ GOOGLE_CLIENT_ID: 'synthetic-client', ANTHROPIC_API_KEY: 'synthetic-owner' }) })
afterAll(async () => { await h.dispose() })
beforeEach(async () => {
  await h.reset(); calls = []; background = []
  h.env.DB = h.db; delete h.env.ALLOWED_EMAILS
  providerResponse = () => Response.json({ content: [{ type: 'text', text: 'synthetic' }], usage: { input_tokens: 10, output_tokens: 2 } })
  for (const sql of schema) await h.db.prepare(sql).run()
  await h.db.prepare('DELETE FROM subsidized_attempt_v1').run()
  await h.db.prepare('DELETE FROM subsidized_budget_v1').run()
  await h.db.prepare("INSERT INTO subsidized_budget_v1 (scope,revision,enabled,limit_micro_usd,limit_attempts) VALUES ('arty-subsidized',1,1,0,0)").run()
  token = (await createSession(h.env, EMAIL))!
  vi.spyOn(Math, 'random').mockReturnValue(1)
  vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url).includes('/tokeninfo')) {
      const secondary = new URL(String(url)).searchParams.get('access_token') === 'synthetic-second-google'
      return Response.json({ aud: 'synthetic-client', email: secondary ? 'second-chat@example.test' : EMAIL,
        email_verified: true, sub: secondary ? 'synthetic-second-subject' : 'synthetic-subject' })
    }
    calls.push(init!)
    return providerResponse()
  }))
})

const body = () => ({ model: 'claude-haiku-4-5-20251001', max_tokens: 64000, stream: true,
  system: [{ type: 'text', text: 'Synthetic system', cache_control: { type: 'ephemeral' } }],
  tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
  messages: [{ role: 'user', content: 'Synthetic search' }] })
function request(path = 'free', payload: Record<string, unknown> = body(), extra: HeadersInit = {}) {
  return new Request('https://tryarty.com/api/ai/proxy', { method: 'POST', body: JSON.stringify(payload), headers: {
    'content-type': 'application/json', 'anthropic-beta': 'pdfs-2024-09-25,prompt-caching-2024-07-31',
    ...(path.startsWith('otp') ? { 'x-arty-trial-token': token } : { 'x-google-token': 'synthetic-google' }),
    ...(path.includes('byok') ? { 'x-api-key': 'synthetic-byok' } : {}), ...extra,
  } })
}
function invoke(req = request()) {
  return onRequestPost({ env: h.env, request: req, waitUntil: (p: Promise<unknown>) => { background.push(p) } } as never) as Promise<Response>
}
async function fund(attempts = 10) {
  await h.db.prepare('UPDATE subsidized_budget_v1 SET limit_micro_usd = 50000000, limit_attempts = ?').bind(attempts).run()
}
async function seedTrial() {
  await h.db.prepare("INSERT INTO subscriptions (user_email,status,plan_type) VALUES (?,'active','trial')").bind(EMAIL).run()
  await h.db.prepare('INSERT INTO trial_usage (email,used,updated_at) VALUES (?,7,0)').bind(EMAIL).run()
}
async function totals() {
  return h.db.prepare('SELECT reserved_micro_usd,reserved_attempts FROM subsidized_budget_v1').first()
}

describe('qualified chat funding and outcome boundaries, actual local D1', () => {
  it.each(['v1:free', 'v1:wallet'].flatMap(funding => ['error', 'late', 'corrupt'].map(fault => ({ funding, fault }))))(
    'does not confirm $funding from a $fault wallet read', async ({ funding, fault }) => {
      await fund()
      await h.db.prepare('INSERT INTO wallet (user_email,balance_micro) VALUES (?,100000000)').bind(EMAIL).run()
      let resolveRead!: () => void, faultReads = 0
      let interceptedRead: Promise<Record<string, unknown> | null> | undefined, readOwner: unknown
      const lateRead = new Promise<void>(resolve => { resolveRead = resolve })
      h.env.DB = new Proxy(h.db, { get(target, key) {
        if (key === 'prepare') return (sql: string) => {
          const statement = target.prepare(sql)
          if (!sql.includes('SELECT balance_micro, reserved_micro,')) return statement
          return { bind: (...values: unknown[]) => ({ first: () => {
            readOwner = values[0]
            interceptedRead = (async () => {
              faultReads++
              if (fault === 'error') throw new Error('synthetic wallet read failure')
              const row = await statement.bind(...values).first<Record<string, unknown>>()
              if (fault === 'late') await lateRead
              return fault === 'corrupt' ? { ...row, reserved_micro: -1 } : row
            })()
            return interceptedRead
          } }) }
        }
        const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value
      } })
      const response = await continuePost({ env: h.env, request: request('free', body(), { 'x-arty-require-funding': funding }),
        waitUntil: (p: Promise<unknown>) => background.push(p) } as never) as Response
      const assertNoConsumption = async () => {
        expect(calls).toHaveLength(0)
        expect((await h.db.prepare('SELECT id FROM reservation').all()).results).toEqual([])
        expect((await h.db.prepare('SELECT id FROM subsidized_attempt_v1').all()).results).toEqual([])
        expect(await h.db.prepare('SELECT balance_micro,reserved_micro FROM wallet').first())
          .toEqual({ balance_micro: 100000000, reserved_micro: 0 })
        expect((await h.db.prepare('SELECT used FROM trial_usage').all()).results).toEqual([])
      }
      try {
        expect(faultReads).toBe(1)
        expect(response.status).toBe(503)
        expect(await response.json()).toMatchObject({ error: 'admission_unavailable' })
        await assertNoConsumption()
      } finally {
        resolveRead()
        if (interceptedRead) {
          if (fault === 'error') await expect(interceptedRead).rejects.toThrow('synthetic wallet read failure')
          else expect(await interceptedRead).toMatchObject({ balance_micro: 100000000, reserved_micro: fault === 'corrupt' ? -1 : 0 })
          expect(readOwner).toBe(EMAIL)
        }
        await Promise.all(background)
      }
      await assertNoConsumption()
    })
  it.each(['error', 'late', 'corrupt'])('does not charge a wallet from a %s exhausted-trial snapshot', async fault => {
    await fund(); await seedTrial()
    await h.db.prepare('UPDATE trial_usage SET used=30').run()
    await h.db.prepare('INSERT INTO wallet (user_email,balance_micro) VALUES (?,100000000)').bind(EMAIL).run()
    let releaseRead!: () => void, reads = 0, readOwner: unknown
    let interceptedRead: Promise<Record<string, unknown> | null> | undefined
    const lateRead = new Promise<void>(resolve => { releaseRead = resolve })
    h.env.DB = new Proxy(h.db, { get(target, key) {
      if (key === 'batch') return async (statements: D1PreparedStatement[]) => {
        reads++; readOwner = EMAIL
        let results: D1Result[] = []
        interceptedRead = (async () => {
          if (fault === 'error') throw new Error('synthetic trial snapshot failure')
          results = await target.batch(statements)
          if (fault === 'late') await lateRead
          if (fault === 'corrupt') results[results.length - 1].results = [{ total: 0, invalid: 1 }]
          return { used: fault === 'corrupt' ? -1 : 30 }
        })()
        await interceptedRead; return results
      }
      const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value
    } })
    const assertNoConsumption = async () => {
      expect(calls).toHaveLength(0)
      expect((await h.db.prepare('SELECT id FROM reservation').all()).results).toEqual([])
      expect((await h.db.prepare('SELECT id FROM subsidized_attempt_v1').all()).results).toEqual([])
      expect(await totals()).toEqual({ reserved_micro_usd: 0, reserved_attempts: 0 })
      expect(await h.db.prepare('SELECT balance_micro,reserved_micro FROM wallet WHERE user_email=?').bind(EMAIL).first())
        .toEqual({ balance_micro: 100000000, reserved_micro: 0 })
      expect(await h.db.prepare('SELECT used FROM trial_usage WHERE email=?').bind(EMAIL).first()).toEqual({ used: 30 })
    }
    try {
      const response = await continuePost({ env: h.env,
        request: request('trial', body(), { 'x-arty-require-funding': 'v1:wallet' }),
        waitUntil: (p: Promise<unknown>) => background.push(p) } as never) as Response
      expect(reads).toBe(1); expect(readOwner).toBe(EMAIL)
      expect(response.status).toBe(503)
      expect(await response.json()).toMatchObject({ error: 'admission_unavailable' })
      await assertNoConsumption()
    } finally {
      releaseRead()
      if (interceptedRead) {
        if (fault === 'error') await expect(interceptedRead).rejects.toThrow('synthetic trial snapshot failure')
        else expect(await interceptedRead).toEqual({ used: fault === 'corrupt' ? -1 : 30 })
      }
      await Promise.all(background)
    }
    await assertNoConsumption()
    expect(reads).toBe(1)
  })
  it.each(['v1:free', 'v1:wallet'])('attests a genuinely absent wallet for required %s', async funding => {
    await fund()
    const response = await invoke(request('free', body(), { 'x-arty-require-funding': funding }))
    expect(response.status).toBe(funding === 'v1:free' ? 200 : 409)
    if (funding === 'v1:wallet') expect(await response.json()).toEqual({ error: 'continuation_funding_changed' })
    else { expect(response.headers.get('x-arty-funding')).toBe('v1:free'); await response.text() }
    await Promise.all(background)
    expect(calls).toHaveLength(funding === 'v1:free' ? 1 : 0)
    expect((await h.db.prepare('SELECT id FROM subsidized_attempt_v1').all()).results).toHaveLength(funding === 'v1:free' ? 1 : 0)
    expect((await h.db.prepare('SELECT id FROM reservation').all()).results).toEqual([])
    expect((await h.db.prepare('SELECT user_email FROM wallet').all()).results).toEqual([])
  })
  it('preserves the bounded legacy fallback for an unconstrained failed wallet read', async () => {
    await fund()
    await h.db.prepare('INSERT INTO wallet (user_email,balance_micro) VALUES (?,100000000)').bind(EMAIL).run()
    let reads = 0
    h.env.DB = new Proxy(h.db, { get(target, key) {
      if (key === 'prepare') return (sql: string) => {
        if (sql.includes('SELECT balance_micro, reserved_micro,')) return { bind: () => ({ first: async () => {
          reads++; throw new Error('synthetic legacy read failure')
        } }) }
        return target.prepare(sql)
      }
      const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value
    } })
    const response = await invoke(request())
    expect(response.status).toBe(200); expect(response.headers.get('x-arty-funding')).toBe('v1:free')
    await response.text(); await Promise.all(background)
    expect(reads).toBe(1); expect(calls).toHaveLength(1)
    expect((await h.db.prepare('SELECT state FROM subsidized_attempt_v1').all()).results).toEqual([{ state: 'engaged' }])
    expect((await h.db.prepare('SELECT id FROM reservation').all()).results).toEqual([])
    expect(await h.db.prepare('SELECT balance_micro,reserved_micro FROM wallet').first()).toEqual({ balance_micro: 100000000, reserved_micro: 0 })
  })
  it.each([
    ['free', 'v1:free'], ['trial', 'v1:trial-google'], ['otp', 'v1:trial-email'],
    ['subscription', 'v1:subscription'], ['vip', 'v1:vip'], ['wallet', 'v1:wallet'],
    ['byok', 'v1:byok'], ['otp-byok', 'v1:byok'], ['exhausted-wallet', 'v1:wallet'],
  ])('continues unchanged %s funding through the versioned route', async (path, funding) => {
    await fund()
    if (path === 'trial' || path === 'exhausted-wallet') await seedTrial()
    if (path === 'exhausted-wallet') await h.db.prepare('UPDATE trial_usage SET used=30').run()
    if (path.includes('wallet')) await h.db.prepare('INSERT INTO wallet (user_email,balance_micro) VALUES (?,100000000)').bind(EMAIL).run()
    if (path === 'subscription') await h.db.prepare("INSERT INTO subscriptions (user_email,status,plan_type) VALUES (?,'active','subscription')").bind(EMAIL).run()
    if (path === 'vip') h.env.ALLOWED_EMAILS = EMAIL
    const response = await continuePost({ env: h.env, request: request(path, body(), { 'x-arty-require-funding': funding }),
      waitUntil: (p: Promise<unknown>) => background.push(p) } as never) as Response
    expect(response.status).toBe(200); expect(response.headers.get('x-arty-funding')).toBe(funding)
    await response.text(); await Promise.all(background)
    expect(calls).toHaveLength(1)
    expect((await h.db.prepare('SELECT id FROM subsidized_attempt_v1').all()).results).toHaveLength(
      ['free', 'trial', 'otp'].includes(path) ? 1 : 0,
    )
    if (path === 'exhausted-wallet') expect(await h.db.prepare('SELECT used FROM trial_usage').first()).toEqual({ used: 30 })
  })
  it('keeps already-selected wallet funding if an exhausted trial counter changes after its snapshot', async () => {
    await seedTrial(); await h.db.prepare('UPDATE trial_usage SET used=30').run()
    await h.db.prepare('INSERT INTO wallet (user_email,balance_micro) VALUES (?,100000000)').bind(EMAIL).run()
    let changed = false
    h.env.DB = new Proxy(h.db, { get(target, key) {
      if (key === 'batch') return async (statements: D1PreparedStatement[]) => {
        const result = await target.batch(statements)
        if (!changed) { changed = true; await h.db.prepare('UPDATE trial_usage SET used=7').run() }
        return result
      }
      const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value
    } })
    const response = await invoke(request('free', body(), { 'x-arty-require-funding': 'v1:wallet' }))
    expect(response.status).toBe(200); expect(response.headers.get('x-arty-funding')).toBe('v1:wallet')
    await response.text(); await Promise.all(background)
    expect(changed).toBe(true); expect(calls).toHaveLength(1)
    expect(await h.db.prepare('SELECT used FROM trial_usage').first()).toEqual({ used: 7 })
    expect((await h.db.prepare('SELECT id FROM subsidized_attempt_v1').all()).results).toEqual([])
  })
  it.each([
    { scenario: 'trial-to-wallet', path: 'trial', expected: 'v1:trial-google', used: 30, wallet: 100000000 },
    { scenario: 'free-to-wallet', path: 'free', expected: 'v1:free', wallet: 100000000 },
    { scenario: 'wallet-to-free', path: 'free', expected: 'v1:wallet', wallet: 0 },
    { scenario: 'byok-lost', path: 'trial', expected: 'v1:byok', used: 7, wallet: 100000000 },
    { scenario: 'subscription-to-trial', path: 'trial', expected: 'v1:subscription', used: 7, wallet: 100000000 },
    { scenario: 'google-to-otp', path: 'otp', expected: 'v1:trial-google', wallet: 0 },
  ])('refuses continuation funding change $scenario before any new AI debit/hold/provider', async ({ scenario, path, expected, used, wallet }) => {
    await fund()
    if (path === 'trial') { await seedTrial(); await h.db.prepare('UPDATE trial_usage SET used=?').bind(used!).run() }
    await h.db.prepare('INSERT INTO wallet (user_email,balance_micro) VALUES (?,?)').bind(EMAIL, wallet).run()
    const observer = traceAdmission(h.db)
    h.env.DB = observer.db
    try {
      const response = await onRequestPost({ env: h.env,
        request: request(path, body(), { 'x-arty-require-funding': expected }),
        waitUntil: (task: Promise<unknown>) => { background.push(task); observer.waitUntil(task) },
      } as never) as Response
      observer.mark('response', { status: response.status })
      const responseBody = await response.json()
      const settlement = await observer.drain()
      const state = await admissionFinancialState(h.db)
      const evidence = { scenario, status: response.status, body: responseBody, events: observer.events, settlement, state, providerCalls: calls.length }
      // Collect all financial evidence before status can fail and print it once.
      if (response.status !== 409 || process.env.ARTY_TRACE_ADMISSION === '1') console.info('ADMISSION_TRACE', JSON.stringify(evidence))
      expect(state.holds).toEqual([])
      expect(state.tickets).toEqual([])
      expect(state.emailTrial).toEqual([])
      expect(state.wallet).toEqual({ balance_micro: wallet, reserved_micro: 0 })
      if (path === 'trial') expect(state.trial).toEqual({ used, updated_at: 0 })
      expect(calls).toHaveLength(0)
      expect(settlement).toEqual({ rejectedBackground: [], rejectedSql: [] })
      expect(response.status, JSON.stringify(evidence)).toBe(409)
      expect(responseBody).toEqual({ error: 'continuation_funding_changed' })
    } finally { await observer.drain(); h.env.DB = h.db; observer.restore() }
  })
  it.each(['free', 'trial', 'otp'])('%s sends a funded native-search SSE intact with an engaged ticket', async path => {
    if (path === 'trial') await seedTrial()
    await fund()
    const content = [
      ['message_start', { type: 'message_start', message: { id: 'synthetic', model: body().model,
        usage: { input_tokens: 10, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } }],
      ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'web_search_tool_result',
        tool_use_id: 's', content: [{ type: 'web_search_result', url: 'https://example.test', title: 'Synthetic', encrypted_content: 'EXACT+/=' }] } }],
      ['content_block_stop', { type: 'content_block_stop', index: 0 }],
      ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2 } }],
      ['message_stop', { type: 'message_stop' }],
    ].map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join('')
    providerResponse = async () => {
      expect((await h.db.prepare('SELECT state FROM subsidized_attempt_v1').all()).results).toEqual([{ state: 'engaged' }])
      return new Response(content, { headers: { 'content-type': 'text/event-stream' } })
    }
    const response = await invoke(request(path))
    expect(response.status).toBe(200); expect(await response.text()).toBe(content)
    await Promise.all(background)
    expect(calls).toHaveLength(1); expect(calls[0].redirect).toBe('manual')
    expect(JSON.parse(calls[0].body as string)).toEqual({ ...body(), max_tokens: 2000, service_tier: 'standard_only',
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 1 }] })
    expect(await totals()).toEqual({ reserved_micro_usd: 4020000, reserved_attempts: 1 })
    expect((await h.db.prepare('SELECT state FROM subsidized_attempt_v1').all()).results).toEqual([{ state: 'engaged' }])
  })
  it.each(['off', 'missing', 'revision'])('refuses %s policy with no POST and compensates a confirmed trial debit', async policy => {
    await seedTrial(); await fund()
    if (policy === 'off') await h.db.prepare('UPDATE subsidized_budget_v1 SET enabled = 0').run()
    if (policy === 'missing') await h.db.prepare('DELETE FROM subsidized_budget_v1').run()
    if (policy === 'revision') await h.db.prepare('UPDATE subsidized_budget_v1 SET revision = 2').run()
    const response = await invoke(request('trial'))
    expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: 'admission_unavailable', message: 'Accès temporairement indisponible. Réessayez plus tard.' })
    await Promise.all(background)
    expect(calls).toHaveLength(0)
    expect(await h.db.prepare('SELECT used FROM trial_usage WHERE email=?').bind(EMAIL).first()).toEqual({ used: 7 })
    expect((await h.db.prepare('SELECT id FROM subsidized_attempt_v1').all()).results).toEqual([])
  })
  it('does not fund an active trial from purchased credits when subsidy is exhausted', async () => {
    await seedTrial()
    await h.db.prepare('INSERT INTO wallet (user_email,balance_micro) VALUES (?,100000000)').bind(EMAIL).run()
    const response = await invoke(request('trial'))
    expect(await response.json()).toEqual({ error: 'subsidized_budget_exhausted' }); expect(calls).toHaveLength(0)
    expect(await h.db.prepare('SELECT balance_micro FROM wallet WHERE user_email=?').bind(EMAIL).first()).toEqual({ balance_micro: 100000000 })
    expect((await h.db.prepare('SELECT * FROM reservation').all()).results).toEqual([])
  })
  it.each(['subscription', 'vip', 'byok', 'otp-byok', 'wallet', 'exhausted-wallet'])('%s remains independent of unavailable subsidy storage', async path => {
    if (path === 'subscription') await h.db.prepare("INSERT INTO subscriptions (user_email,status,plan_type) VALUES (?,'active','subscription')").bind(EMAIL).run()
    if (path === 'vip') h.env.ALLOWED_EMAILS = EMAIL
    if (path.includes('wallet')) await h.db.prepare('INSERT INTO wallet (user_email,balance_micro) VALUES (?,100000000)').bind(EMAIL).run()
    if (path === 'exhausted-wallet') {
      await seedTrial(); await h.db.prepare('UPDATE trial_usage SET used = 30').run()
    }
    const touched = vi.fn()
    h.env.DB = new Proxy(h.db, { get(target, key) {
      if (key === 'prepare') return (sql: string) => {
        if (/subsidized_/.test(sql)) { touched(); throw new Error('Subsidy storage unavailable') }
        return target.prepare(sql)
      }
      const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value
    } })
    const response = await invoke(request(path)); await response.text(); await Promise.all(background)
    expect(response.status).toBe(200); expect(calls).toHaveLength(1); expect(touched).not.toHaveBeenCalled()
    expect(await totals()).toEqual({ reserved_micro_usd: 0, reserved_attempts: 0 })
  })
  it.each(['trial', 'otp'])('keeps exhausted %s without credits expired even when subsidy is OFF', async path => {
    if (path === 'trial') { await seedTrial(); await h.db.prepare('UPDATE trial_usage SET used = 30').run() }
    else await h.db.prepare('INSERT INTO email_trial_usage (email,used,updated_at) VALUES (?,30,0)').bind(EMAIL).run()
    await h.db.prepare('UPDATE subsidized_budget_v1 SET enabled = 0').run()
    const response = await invoke(request(path))
    expect(response.status).toBe(403); expect(await response.json()).toMatchObject({ error: 'trial_expired' })
    expect(calls).toHaveLength(0)
  })
  it('shares the last chat attempt across verified identities and request hosts', async () => {
    await fund(1)
    const secondary = request('free', body(), { 'x-google-token': 'synthetic-second-google' })
    const secondaryHost = new Request('https://appfacade.pages.dev/api/ai/proxy', {
      method: 'POST', headers: secondary.headers, body: await secondary.text(),
    })
    const [first, second] = await Promise.all([invoke(), invoke(secondaryHost)])
    expect([first.status, second.status].sort()).toEqual([200, 503]); expect(calls).toHaveLength(1)
    const winner = first.ok ? first : second, loser = first.ok ? second : first
    await winner.text()
    expect(await loser.json()).toEqual({ error: 'subsidized_budget_exhausted' })
    await Promise.all(background)
    const quotaIdentities = (await h.db.prepare('SELECT email FROM free_daily_quota ORDER BY email').all()).results
    expect(quotaIdentities.map(row => row.email)).toEqual(['second-chat@example.test', EMAIL].sort())
    expect(await totals()).toMatchObject({ reserved_attempts: 1 })
    expect((await h.db.prepare('SELECT state FROM subsidized_attempt_v1').all()).results).toEqual([{ state: 'engaged' }])
  }, 15000)
  it('reserves a new ticket for each continuation and refuses the next without changing its history', async () => {
    await fund(2)
    const history = { ...body(), messages: [{ role: 'assistant', content: [
      { type: 'server_tool_use', id: 'pending', name: 'web_search', input: { query: 'synthetic' } },
      { type: 'tool_use', id: 'c', name: 'local', input: {} },
    ] }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c', content: 'synthetic result' }] }] }
    providerResponse = () => Response.json({ stop_reason: 'pause_turn', content: [{ type: 'text', text: 'synthetic' }], usage: { input_tokens: 10, output_tokens: 2 } })
    for (let i = 0; i < 2; i++) { const response = await invoke(request('free', history)); expect(response.status).toBe(200); await response.text(); await Promise.all(background) }
    const refusal = await invoke(request('free', history))
    expect(await refusal.json()).toEqual({ error: 'subsidized_budget_exhausted' }); expect(calls).toHaveLength(2)
    expect(calls.every(c => JSON.stringify(JSON.parse(c.body as string).messages) === JSON.stringify(history.messages))).toBe(true)
    expect(await totals()).toEqual({ reserved_micro_usd: 8040000, reserved_attempts: 2 })
  }, 15000)
  it.each([302, 400, 503, 'network'] as const)('retains the engaged reserve and trial debit after provider outcome %s', async outcome => {
    await seedTrial(); await fund()
    providerResponse = () => {
      if (outcome === 'network') throw new Error('Synthetic lost provider ACK')
      return new Response('Synthetic upstream', { status: outcome, headers: { location: 'https://untrusted.example.test' } })
    }
    const response = await invoke(request('trial')); await response.text(); await Promise.all(background)
    expect(response.status).toBe(outcome === 'network' ? 502 : outcome === 302 ? 409 : outcome)
    expect(response.headers.get('location')).toBeNull(); expect(calls).toHaveLength(1)
    expect(await totals()).toEqual({ reserved_micro_usd: 4020000, reserved_attempts: 1 })
    expect(await h.db.prepare('SELECT used FROM trial_usage WHERE email=?').bind(EMAIL).first()).toEqual({ used: 8 })
  })
  it.each(['reserve-ack', 'engage-ack', 'revoked', 'cancelled'])('never sends or replays a write after %s', async fault => {
    await seedTrial(); await fund()
    const controller = new AbortController(), marked = new WeakSet<object>()
    h.env.DB = new Proxy(h.db, { get(target, key) {
      if (key === 'prepare') return (sql: string) => {
        const stmt = target.prepare(sql)
        if (fault === 'engage-ack' && sql.includes("SET state = 'engaged'")) return {
          bind: (...values: unknown[]) => ({ all: async () => { await stmt.bind(...values).all(); throw new Error('Synthetic lost engagement ACK') } }),
        }
        if (!/subsidized_/.test(sql)) return stmt
        return { bind: (...values: unknown[]) => { const bound = stmt.bind(...values); marked.add(bound); return bound } }
      }
      if (key === 'batch') return async (statements: D1PreparedStatement[]) => {
        const result = await target.batch(statements)
        if (statements.some(s => marked.has(s))) {
          if (fault === 'reserve-ack') throw new Error('Synthetic lost reservation ACK')
          if (fault === 'revoked') await target.prepare('UPDATE subsidized_budget_v1 SET enabled=0').run()
          if (fault === 'cancelled') controller.abort()
        }
        return result
      }
      const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value
    } })
    const req = new Request(request('trial'), { signal: controller.signal })
    const response = await invoke(req); await response.text(); await Promise.all(background)
    expect(response.status).toBe(503); expect(calls).toHaveLength(0)
    expect(await totals()).toEqual({ reserved_micro_usd: 4020000, reserved_attempts: 1 })
    expect((await h.db.prepare('SELECT state FROM subsidized_attempt_v1').all()).results)
      .toEqual([{ state: fault === 'engage-ack' ? 'engaged' : 'reserved' }])
    expect(await h.db.prepare('SELECT used FROM trial_usage WHERE email=?').bind(EMAIL).first()).toEqual({ used: 7 })
  })
  it('returns the refusal while its sole trial compensation is suspended, then completes that same refund', async () => {
    await seedTrial()
    let release!: () => void, announce!: () => void, refundCalls = 0
    const entered = new Promise<void>(resolve => { announce = resolve })
    const held = new Promise<void>(resolve => { release = resolve })
    h.env.DB = new Proxy(h.db, { get(target, key) {
      if (key === 'prepare') return (sql: string) => {
        const stmt = target.prepare(sql)
        if (!/UPDATE trial_usage\s+SET used = MAX/.test(sql)) return stmt
        return { bind: (...values: unknown[]) => ({ run: async () => {
          refundCalls++; announce(); await held; return stmt.bind(...values).run()
        } }) }
      }
      const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value
    } })
    const pending = invoke(request('trial'))
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await entered
      const result = await Promise.race([pending, new Promise<'blocked'>(resolve => { timer = setTimeout(() => resolve('blocked'), 1000) })])
      expect(result).not.toBe('blocked')
      if (result === 'blocked') throw new Error('Refusal blocked behind compensation')
      expect(result.status).toBe(503); expect(await result.json()).toEqual({ error: 'subsidized_budget_exhausted' })
      expect(await h.db.prepare('SELECT used FROM trial_usage WHERE email=?').bind(EMAIL).first()).toEqual({ used: 8 })
    } finally { clearTimeout(timer); release(); await pending; await Promise.all(background) }
    expect(refundCalls).toBe(1); expect(calls).toHaveLength(0)
    expect(await h.db.prepare('SELECT used FROM trial_usage WHERE email=?').bind(EMAIL).first()).toEqual({ used: 7 })
  }, 15000)
})
afterEach(async () => { await Promise.allSettled(background); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('primary Anthropic chat must respect the common exhausted subsidy', () => {
  it.each(['free','trial','otp'])('%s cannot dispatch native-search chat without shared funding', async path => {
    if (path === 'trial') await h.db.prepare("INSERT INTO subscriptions (user_email,status,plan_type) VALUES (?,'active','trial')").bind(EMAIL).run()
    const response = await onRequestPost({ env: h.env, waitUntil: (p: Promise<unknown>) => { background.push(p) },
      request: new Request('https://tryarty.com/api/ai/proxy', { method: 'POST', headers: {
        'content-type': 'application/json', ...(path === 'otp' ? { 'x-arty-trial-token': token } : { 'x-google-token': 'synthetic-google' }),
        'anthropic-beta': 'pdfs-2024-09-25,prompt-caching-2024-07-31',
      }, body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 64000,
        system: [{ type: 'text', text: 'synthetic', cache_control: { type: 'ephemeral' } }],
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
        messages: [{ role: 'user', content: 'Synthetic search request' }],
      }) }),
    } as never) as Response
    expect(await response.json()).toEqual({ error: 'subsidized_budget_exhausted' }); await Promise.all(background)
    // Durable proof: the policy remained exhausted and no ticket paid the POST.
    expect(await h.db.prepare('SELECT limit_micro_usd,limit_attempts,reserved_micro_usd,reserved_attempts FROM subsidized_budget_v1').first())
      .toEqual({ limit_micro_usd: 0, limit_attempts: 0, reserved_micro_usd: 0, reserved_attempts: 0 })
    expect((await h.db.prepare('SELECT id FROM subsidized_attempt_v1').all()).results).toEqual([])
    expect.soft(calls).toHaveLength(0)
    expect(response.status).toBe(503)
    if (path !== 'free') {
      const table = path === 'otp' ? 'email_trial_usage' : 'trial_usage'
      expect(await h.db.prepare(`SELECT used FROM ${table} WHERE email = ?`).bind(EMAIL).first())
        .toEqual({ used: 0 })
    }
  })
})
