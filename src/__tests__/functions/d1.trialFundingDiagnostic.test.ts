// @vitest-environment node
// Bounded investigation of PR500's 503-vs-409. Real local D1; synthetic auth
// and delayed SQL acknowledgements. No production deadline or oracle changes.
import { readFileSync, writeFileSync } from 'node:fs'
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { onRequestPost } from '../../../functions/api/ai/proxy'
import { makeD1Harness, type D1Harness } from './d1Harness'

const EMAIL = 'subsidized-chat@example.test'
const migration = readFileSync(new URL('../../../migrations/0013_subsidized_budget.sql', import.meta.url), 'utf8')
  .split('\n').filter(line => !line.trim().startsWith('--')).join('\n').split(';').filter(sql => sql.trim())
let h: D1Harness
const evidence: unknown[] = []
beforeAll(async () => { h = await makeD1Harness({ GOOGLE_CLIENT_ID: 'synthetic-client', ANTHROPIC_API_KEY: 'synthetic-owner' }) })
beforeEach(async () => {
  h.env.DB = h.db
  await h.reset()
  for (const sql of migration) await h.db.prepare(sql).run()
  await h.db.prepare('DELETE FROM subsidized_attempt_v1').run()
  await h.db.prepare('DELETE FROM subsidized_budget_v1').run()
  await h.db.prepare("INSERT INTO subsidized_budget_v1(scope,revision,enabled,limit_micro_usd,limit_attempts) VALUES('arty-subsidized',1,1,50000000,10)").run()
  await h.db.prepare("INSERT INTO subscriptions(user_email,status,plan_type) VALUES(?,'active','trial')").bind(EMAIL).run()
  await h.db.prepare('INSERT INTO trial_usage(email,used,updated_at) VALUES(?,30,123)').bind(EMAIL).run()
  await h.db.prepare('INSERT INTO wallet(user_email,balance_micro) VALUES(?,100000000)').bind(EMAIL).run()
  vi.spyOn(Math, 'random').mockReturnValue(1)
})
afterEach(() => { h.env.DB = h.db; vi.restoreAllMocks(); vi.unstubAllGlobals() })
afterAll(async () => {
  await h.dispose()
  if (process.env.ARTY_TRIAL_DIAGNOSTIC_REPORT) {
    writeFileSync(process.env.ARTY_TRIAL_DIAGNOSTIC_REPORT, JSON.stringify(evidence, null, 2))
  }
})

type Fault = 'none' | 'insert-late' | 'read-late' | 'combined-late' | 'sql-error' | 'corrupt-read' | 'plan-error'
it.each([
  { fault: 'none', expected: 409 },
  { fault: 'insert-late', expected: 503 },
  { fault: 'read-late', expected: 503 },
  { fault: 'combined-late', expected: 503 },
  { fault: 'sql-error', expected: 503 },
  { fault: 'corrupt-read', expected: 503 },
  { fault: 'plan-error', expected: 503 },
] satisfies { fault: Fault; expected: number }[])('investigates exhausted trial with $fault', async ({ fault, expected }) => {
  const start = performance.now()
  type Trace = { operation: string; startMs: number; sqlMs?: number; endMs?: number; result?: unknown; error?: string }
  const trace: Trace[] = []
  const pending: Promise<unknown>[] = [], background: Promise<unknown>[] = []
  let authCalls = 0, providerCalls = 0
  vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL) => {
    if (String(url).startsWith('https://oauth2.googleapis.com/tokeninfo?')) {
      authCalls++
      return Response.json({ aud: 'synthetic-client', email: EMAIL, email_verified: true, sub: 'synthetic-subject' })
    }
    providerCalls++
    throw new Error('Unexpected provider call: diagnostic never uses external providers')
  }))
  function statement(stmt: D1PreparedStatement, sql: string): D1PreparedStatement {
    const operation = sql.includes('INSERT INTO trial_usage') ? 'trial-insert'
      : sql.includes('SELECT used FROM trial_usage') ? 'trial-read'
        : sql.includes('FROM subscriptions') ? 'plan-read' : sql.trim().replace(/\s+/g, ' ')
    return new Proxy(stmt, { get(target, key) {
      if (key === 'bind') return (...args: unknown[]) => {
        const entry: Trace = { operation: `${operation}.bind`, startMs: performance.now() - start }
        trace.push(entry)
        try { return statement(target.bind(...args), sql) }
        catch (error) { entry.error = String(error); throw error }
        finally { entry.endMs = performance.now() - start }
      }
      const method = Reflect.get(target, key)
      if (typeof method !== 'function') return method
      if (!['first', 'run', 'all', 'raw'].includes(String(key))) return method.bind(target)
      return (...args: unknown[]) => {
        const entry: Trace = { operation, startMs: performance.now() - start }
        trace.push(entry)
        const task = (async () => {
          if ((fault === 'sql-error' && operation === 'trial-insert') || (fault === 'plan-error' && operation === 'plan-read')) {
            throw new Error('synthetic SQL failure')
          }
          const value = await Reflect.apply(method, target, args)
          entry.sqlMs = performance.now() - start
          const delay = (fault === 'insert-late' && operation === 'trial-insert') || (fault === 'read-late' && operation === 'trial-read')
            ? 350 : fault === 'combined-late' && ['trial-insert', 'trial-read'].includes(operation) ? 150 : 0
          if (delay) await new Promise(resolve => setTimeout(resolve, delay))
          return fault === 'corrupt-read' && operation === 'trial-read' ? { used: 'corrupt' } : value
        })().then(value => {
          entry.endMs = performance.now() - start
          entry.result = value
          return value
        }, error => {
          entry.endMs = performance.now() - start
          entry.error = String(error)
          throw error
        })
        pending.push(task)
        return task
      }
    } })
  }
  h.env.DB = new Proxy(h.db, { get(target, key) {
    if (key === 'prepare') return (sql: string) => {
      const entry: Trace = { operation: `prepare: ${sql.trim().replace(/\s+/g, ' ')}`, startMs: performance.now() - start }
      trace.push(entry)
      try { return statement(target.prepare(sql), sql) }
      catch (error) { entry.error = String(error); throw error }
      finally { entry.endMs = performance.now() - start }
    }
    const value = Reflect.get(target, key)
    return typeof value === 'function' ? value.bind(target) : value
  } })
  const request = new Request('https://tryarty.com/api/ai/proxy', { method: 'POST', headers: {
    'content-type': 'application/json', 'x-google-token': 'synthetic-google', 'x-arty-require-funding': 'v1:trial-google',
    'anthropic-beta': 'pdfs-2024-09-25,prompt-caching-2024-07-31',
  }, body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 64000, stream: true,
    system: [{ type: 'text', text: 'Synthetic system', cache_control: { type: 'ephemeral' } }],
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
    messages: [{ role: 'user', content: 'Synthetic search' }],
  }) })
  const response = await onRequestPost({ env: h.env, request, waitUntil: (task: Promise<unknown>) => background.push(task) } as never) as Response
  const responseMs = performance.now() - start
  const responseBody = await response.json()
  const backgroundOutcomes = await Promise.allSettled(background)
  const operationOutcomes: PromiseSettledResult<unknown>[] = []
  // A settled INSERT can schedule its SELECT: drain the exact growing list.
  for (let offset = 0; offset < pending.length;) {
    const batch = pending.slice(offset); offset = pending.length
    operationOutcomes.push(...await Promise.allSettled(batch))
  }
  const financialState = {
    trial: await h.db.prepare('SELECT used,updated_at FROM trial_usage').first(),
    wallet: await h.db.prepare('SELECT balance_micro,reserved_micro FROM wallet').first(),
    holds: (await h.db.prepare('SELECT id FROM reservation').all()).results,
    tickets: (await h.db.prepare('SELECT id FROM subsidized_attempt_v1').all()).results,
    providerCalls,
  }
  const trialStart = trace.find(row => row.operation === 'trial-insert')?.startMs
  const record = { fault, status: response.status, body: responseBody, responseMs,
    admissionMsAtResponse: trialStart === undefined ? null : responseMs - trialStart,
    authCalls, trace, financialState,
    backgroundOutcomes: backgroundOutcomes.map(value => value.status === 'fulfilled' ? 'fulfilled' : String(value.reason)),
    rejectedOperations: operationOutcomes.filter(value => value.status === 'rejected').map(value => String(value.reason)),
  }
  evidence.push(record)
  // Read all financial evidence BEFORE asserting status, even on failure.
  expect(financialState).toEqual({ trial: { used: 30, updated_at: 123 },
    wallet: { balance_micro: 100000000, reserved_micro: 0 }, holds: [], tickets: [], providerCalls: 0 })
  expect(authCalls).toBe(1)
  expect(backgroundOutcomes.every(value => value.status === 'fulfilled')).toBe(true)
  expect(record.rejectedOperations).toHaveLength(fault === 'sql-error' || fault === 'plan-error' ? 1 : 0)
  expect(response.status, JSON.stringify(record)).toBe(expected)
  expect((responseBody as { error: string }).error).toBe(expected === 409 ? 'continuation_funding_changed' : 'admission_unavailable')
})
