// @vitest-environment node
// Fixed paired experiment: identical handler, request and D1 instance; no delay
// injection. Runtime clocks are not compared as interchangeable stopwatches.
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { build } from 'esbuild'
import { Miniflare, Response as LocalResponse } from 'miniflare'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { onRequestPost } from '../../../functions/api/ai/proxy'
import type { Env } from '../../../functions/env'
import { traceAdmission, admissionFinancialState } from './admissionTrace'

const EMAIL = 'subsidized-chat@example.test'
const identity = { aud: 'synthetic-client', email: EMAIL, email_verified: true, sub: 'synthetic-subject' }
let mf: Miniflare, db: D1Database
let authCalls = 0, providerCalls = 0
const records: unknown[] = []
beforeAll(async () => {
  const root = resolve('.').replaceAll('\\', '/')
  const bundle = await build({ stdin: { resolveDir: root, loader: 'ts', contents: `
    import {onRequestPost} from '${root}/functions/api/ai/proxy.ts';
    import {traceAdmission,admissionFinancialState} from '${root}/src/__tests__/functions/admissionTrace.ts';
    export default { async fetch(request,env,ctx) {
      const observer=traceAdmission(env.DB), random=Math.random; Math.random=()=>1;
      try {
        const response=await onRequestPost({request,env:{...env,DB:observer.db},
          waitUntil(task){observer.waitUntil(task);ctx.waitUntil(task)}});
        observer.mark('response',{status:response.status});
        const body=await response.json(), settlement=await observer.drain();
        const state=await admissionFinancialState(env.DB);
        return Response.json({status:response.status,body,events:observer.events,settlement,state}, {status:response.status});
      } finally {await observer.drain();observer.restore();Math.random=random}
    } }` }, bundle: true, format: 'esm', platform: 'browser', write: false, logLevel: 'silent' })
  mf = new Miniflare({ modules: true, script: bundle.outputFiles[0]!.text,
    compatibilityDate: '2026-04-10', d1Databases: { DB: 'paired-admission' },
    bindings: { GOOGLE_CLIENT_ID: 'synthetic-client', ANTHROPIC_API_KEY: 'synthetic-owner' },
    outboundService(request) {
      if (request.url.startsWith('https://oauth2.googleapis.com/tokeninfo?')) {
        authCalls++; return LocalResponse.json(identity)
      }
      providerCalls++; throw new Error('Unexpected outbound request in paired diagnostic')
    },
  })
  db = await mf.getD1Database('DB') as unknown as D1Database
  for (const path of ['schema.sql', 'migrations/0013_subsidized_budget.sql']) {
    const statements = readFileSync(path, 'utf8').split('\n').filter(line => !line.trim().startsWith('--')).join('\n').split(';').filter(sql => sql.trim())
    for (const sql of statements) await db.prepare(sql).run()
  }
})
afterAll(async () => {
  await mf?.dispose()
  if (process.env.ARTY_TOPOLOGY_REPORT) writeFileSync(process.env.ARTY_TOPOLOGY_REPORT, JSON.stringify(records, null, 2))
})

async function reset() {
  for (const table of ['subscriptions', 'licenses', 'trial_usage', 'email_trial_usage', 'wallet', 'reservation', 'subsidized_attempt_v1', 'subsidized_budget_v1']) {
    await db.prepare(`DELETE FROM ${table}`).run()
  }
  await db.prepare("INSERT INTO subscriptions(user_email,status,plan_type) VALUES(?,'active','trial')").bind(EMAIL).run()
  await db.prepare('INSERT INTO trial_usage(email,used,updated_at) VALUES(?,30,0)').bind(EMAIL).run()
  await db.prepare('INSERT INTO wallet(user_email,balance_micro) VALUES(?,100000000)').bind(EMAIL).run()
  await db.prepare("INSERT INTO subsidized_budget_v1(scope,revision,enabled,limit_micro_usd,limit_attempts) VALUES('arty-subsidized',1,1,50000000,10)").run()
}
const requestInit = () => ({ method: 'POST', headers: {
  'content-type': 'application/json', 'x-google-token': 'synthetic-google', 'x-arty-require-funding': 'v1:trial-google',
  'anthropic-beta': 'pdfs-2024-09-25,prompt-caching-2024-07-31',
}, body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 64000, stream: true,
  system: [{ type: 'text', text: 'Synthetic system', cache_control: { type: 'ephemeral' } }],
  tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
  messages: [{ role: 'user', content: 'Synthetic search' }],
}) })

// Four predeclared pairs, alternate order to expose warm-up/order effects.
it.each([0, 1, 2, 3])('compares original trial-to-wallet in paired runtimes, sample %i', async sample => {
  for (const runtime of sample % 2 ? ['workerd', 'node'] : ['node', 'workerd']) {
    await reset(); authCalls = 0; providerCalls = 0
    let result: { status: number; body: unknown; events: unknown[]; settlement: unknown; state: unknown }
    const wallStart = performance.now()
    if (runtime === 'workerd') {
      const response = await mf.dispatchFetch('https://tryarty.com/api/ai/proxy', requestInit())
      result = await response.json() as typeof result
    } else {
      const observer = traceAdmission(db)
      vi.spyOn(Math, 'random').mockReturnValue(1)
      vi.stubGlobal('fetch', async (url: RequestInfo | URL) => {
        if (String(url).startsWith('https://oauth2.googleapis.com/tokeninfo?')) { authCalls++; return Response.json(identity) }
        providerCalls++; throw new Error('Unexpected provider request in paired diagnostic')
      })
      try {
        const response = await onRequestPost({ request: new Request('https://tryarty.com/api/ai/proxy', requestInit()),
          env: { DB: observer.db, GOOGLE_CLIENT_ID: 'synthetic-client', ANTHROPIC_API_KEY: 'synthetic-owner' } as Env,
          waitUntil: observer.waitUntil,
        } as never) as Response
        observer.mark('response', { status: response.status })
        result = { status: response.status, body: await response.json(), events: observer.events,
          settlement: await observer.drain(), state: await admissionFinancialState(db) }
      } finally { await observer.drain(); observer.restore(); vi.unstubAllGlobals(); vi.restoreAllMocks() }
    }
    const record = { sample, runtime, wallMsIncludingSettlement: performance.now() - wallStart, ...result, authCalls, providerCalls }
    records.push(record)
    if (result.status !== 409) console.info('PAIRED_ADMISSION_TRACE', JSON.stringify(record))
    expect(result.state).toEqual({ trial: { used: 30, updated_at: 0 }, wallet: { balance_micro: 100000000, reserved_micro: 0 }, holds: [], tickets: [], emailTrial: [] })
    expect(authCalls).toBe(1); expect(providerCalls).toBe(0)
    expect(result.settlement).toEqual({ rejectedBackground: [], rejectedSql: [] })
    expect(result.status, JSON.stringify(record)).toBe(409)
    expect(result.body).toEqual({ error: 'continuation_funding_changed' })
  }
}, 15000)
