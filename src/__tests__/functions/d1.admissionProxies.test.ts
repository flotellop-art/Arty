// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { onRequestPost as anthropic } from '../../../functions/api/ai/proxy'
import { onRequestPost as openai } from '../../../functions/api/ai/openai-proxy'
import { onRequestPost as gemini } from '../../../functions/api/ai/gemini-proxy'
import { onRequestPost as mistral } from '../../../functions/api/ai/mistral-proxy'
import { onRequestPost as image } from '../../../functions/api/ai/image-gen'
import { onRequestPost as tts } from '../../../functions/api/ai/tts'
import { onRequestPost as extract } from '../../../functions/api/ai/memory-extract'
import { onRequestPost as search } from '../../../functions/api/search/web'
import { onRequestPost as urlFetch } from '../../../functions/api/fetch/url'
import { onRequestPost as geo } from '../../../functions/api/geo/reverse'
import { onRequestPost as trails } from '../../../functions/api/geo/trails'
import { createSession, consumeEmailTrialMessage } from '../../../functions/api/_lib/emailTrial'
import { checkAllowedVerifiedUser } from '../../../functions/api/_lib/checkAllowedUser'
import { makeD1Harness, type D1Harness } from './d1Harness'
import { fundSyntheticSubsidizedBudget } from './subsidizedBudgetFixture'

const EMAIL = 'admission@example.test', CLIENT_ID = 'arty-client-id'
const providers = [
  { name: 'anthropic', call: anthropic, model: 'claude-haiku-4-5-20251001', key: 'x-api-key' },
  { name: 'openai', call: openai, model: 'gpt-5-mini', key: 'x-openai-key' },
  { name: 'gemini', call: gemini, model: 'gemini-3.6-flash', key: 'authorization' },
  { name: 'mistral', call: mistral, model: 'mistral-medium-latest', key: 'authorization' },
] as const
type Provider = typeof providers[number]
type Identity = 'google' | 'otp'
const matrix = providers.flatMap(provider => (['google', 'otp'] as const).map(identity => ({ ...provider, identity })))
let h: D1Harness, session: string, background: Promise<unknown>[], providerCalls: number
let deadline: Promise<() => void>

// Only the 250ms admission timer is controlled, never workerd or SQL clocks.
// Exact wall-time boundaries are locked separately in trialAdmission.test.ts.
function controlledDeadline() {
  const set = globalThis.setTimeout, clear = globalThis.clearTimeout
  const handles = new Map<ReturnType<typeof setTimeout>, () => void>()
  let announce!: (expire: () => void) => void
  const registered = new Promise<() => void>(resolve => { announce = resolve })
  vi.spyOn(globalThis, 'setTimeout').mockImplementation(((callback: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => {
    if (delay !== 250) return set(callback, delay, ...args)
    const handle = Object.create(null) as ReturnType<typeof setTimeout>
    handles.set(handle, () => callback(...args))
    announce(() => {
      for (const [active, expire] of handles) { handles.delete(active); expire() }
    })
    return handle
  }) as typeof setTimeout)
  vi.spyOn(globalThis, 'clearTimeout').mockImplementation(handle => {
    if (!handles.delete(handle as ReturnType<typeof setTimeout>)) clear(handle)
  })
  return registered
}

beforeAll(async () => {
  h = await makeD1Harness({ GOOGLE_CLIENT_ID: CLIENT_ID, ANTHROPIC_API_KEY: 'synthetic-anthropic',
    OPENAI_API_KEY: 'synthetic-openai', GEMINI_API_KEY: 'synthetic-gemini', MISTRAL_API_KEY: 'synthetic-mistral' })
})
afterAll(async () => { await h.dispose() })
beforeEach(async () => {
  await h.reset()
  h.env.DB = h.db
  delete h.env.ALLOWED_EMAILS
  h.env.OPENAI_VISION_ENABLED = 'true'
  h.env.LINKUP_API_KEY = 'synthetic-linkup'
  h.env.GOOGLE_MAPS_API_KEY = 'synthetic-maps'
  await h.db.prepare("INSERT INTO subscriptions (user_email, status, plan_type) VALUES (?1, 'active', 'trial')").bind(EMAIL).run()
  await h.db.prepare('INSERT INTO wallet (user_email, balance_micro) VALUES (?1, 10000000)').bind(EMAIL).run()
  await h.db.prepare('INSERT INTO trial_usage (email, used, updated_at) VALUES (?1, 7, 0)').bind(EMAIL).run()
  await h.db.prepare('INSERT INTO email_trial_usage (email, used, updated_at) VALUES (?1, 13, 0)').bind(EMAIL).run()
  session = (await createSession(h.env, EMAIL))!
  expect(session).toBeTruthy()
  background = []; providerCalls = 0
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  vi.spyOn(Math, 'random').mockReturnValue(1)
  deadline = controlledDeadline()
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes('/tokeninfo')) return Response.json({ aud: CLIENT_ID, email: EMAIL, email_verified: true, sub: 'synthetic-sub' })
    providerCalls++
    // Real fetch drains the upload. A stub that returns without reading a
    // streamed vision body cannot prove the permit/transport completion path.
    await new Response(init?.body ?? null).arrayBuffer()
    return Response.json({ content: [{ type: 'text', text: 'ok' }], choices: [{ message: { content: 'ok' } }],
      candidates: [{ content: { parts: [{ text: 'ok' }] } }],
      usage: { input_tokens: 10, output_tokens: 2, prompt_tokens: 10, completion_tokens: 2 },
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2 } })
  }))
})
afterEach(async () => {
  await Promise.allSettled(background)
  h.env.DB = h.db
  vi.unstubAllGlobals(); vi.restoreAllMocks()
})

function request(p: Provider, identity: Identity, byok = false) {
  return new Request('https://tryarty.com/api/ai/' + p.name, { method: 'POST', headers: {
    'content-type': 'application/json',
    ...(identity === 'google' ? { 'x-google-token': 'synthetic-google' } : { 'x-arty-trial-token': session }),
    ...(byok ? { [p.key]: p.key === 'authorization' ? 'Bearer synthetic-byok' : 'synthetic-byok' } : {}),
  }, body: JSON.stringify({ model: p.model, stream: false, max_tokens: 100,
    messages: [{ role: 'user', content: 'Bonjour' }],
    ...(p.name === 'anthropic' ? {} : { contents: [{ role: 'user', parts: [{ text: 'Bonjour' }] }] }) }) })
}
function invoke(p: Provider, identity: Identity, byok = false) {
  return p.call({ request: request(p, identity, byok), env: h.env,
    waitUntil: (promise: Promise<unknown>) => { background.push(promise) } } as never) as Promise<Response>
}
async function unchangedWallet() {
  expect(await h.db.prepare('SELECT balance_micro, reserved_micro FROM wallet WHERE user_email = ?1').bind(EMAIL).first())
    .toEqual({ balance_micro: 10000000, reserved_micro: 0 })
  for (const table of ['reservation', 'credit_ledger']) {
    expect(await h.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).toEqual({ n: 0 })
  }
}
async function refused(response: Response) {
  expect(response.status).toBe(503)
  expect(await response.json()).toMatchObject({ error: 'admission_unavailable' })
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(response.headers.get('retry-after')).toBe('30')
  expect(response.headers.get('x-trial-remaining')).toBeNull()
  expect(providerCalls).toBe(0)
  await unchangedWallet()
}
function faultDb(matches: (sql: string) => boolean, action: (statement: D1PreparedStatement, values: unknown[]) => Promise<unknown>) {
  return new Proxy(h.db, { get(target, prop) {
    if (prop !== 'prepare') return Reflect.get(target, prop)
    return (sql: string) => {
      const statement = target.prepare(sql)
      if (!matches(sql)) return statement
      return { bind: (...values: unknown[]) => ({ first: () => action(statement, values) }) }
    }
  } })
}

describe.each(matrix)('$name / $identity admission', p => {
  const table = p.identity === 'google' ? 'trial_usage' : 'email_trial_usage'
  const initial = p.identity === 'google' ? 7 : 13
  it('refuses missing D1 before any provider call or wallet fallback', async () => {
    h.env.DB = undefined
    await refused(await invoke(p, p.identity))
  })
  it('refuses a plan/session SQL outage without a fake sign-out', async () => {
    h.env.DB = faultDb(sql => sql.includes(p.identity === 'google' ? 'SELECT plan_type' : 'SELECT email FROM email_trial_sessions'),
      async () => { throw new Error('synthetic read failure') })
    await refused(await invoke(p, p.identity))
  })
  it('refuses an ambiguous trial write without provider call, refund or replay', async () => {
    let writes = 0
    h.env.DB = faultDb(sql => sql.includes(`INSERT INTO ${table}`), async () => { writes++; throw new Error('unknown commit') })
    await refused(await invoke(p, p.identity))
    await Promise.all(background)
    expect(writes).toBe(1)
    expect(await h.db.prepare(`SELECT used FROM ${table} WHERE email = ?1`).bind(EMAIL).first()).toEqual({ used: initial })
  })
  it.each(['before-commit', 'after-commit', 'cap-reached', 'rejected'] as const)('refuses a late %s; compensates only its confirmed write', async kind => {
    if (kind === 'cap-reached') await h.db.prepare(`UPDATE ${table} SET used = 30 WHERE email = ?1`).bind(EMAIL).run()
    let release!: () => void, arrived!: () => void, writes = 0
    const held = new Promise<void>(resolve => { release = resolve })
    const reached = new Promise<void>(resolve => { arrived = resolve })
    h.env.DB = faultDb(sql => sql.includes(`INSERT INTO ${table}`), async (statement, values) => {
      writes++
      if (kind === 'before-commit' || kind === 'rejected') { arrived(); await held }
      if (kind === 'rejected') throw new Error('late unknown result')
      const row = await statement.bind(...values).first()
      arrived()
      if (kind !== 'before-commit') await held
      return row
    })
    try {
      const operation = invoke(p, p.identity)
      const expire = await deadline
      await reached
      expire()
      await refused(await operation)
      // A separate successful debit must survive this request's compensation.
      if (kind !== 'cap-reached') {
        const independent = p.identity === 'google'
          ? await checkAllowedVerifiedUser(EMAIL, { ...h.env, DB: h.db })
          : await consumeEmailTrialMessage({ ...h.env, DB: h.db }, EMAIL)
        expect(independent).toMatchObject({ trialDebited: true })
      }
      release()
      await Promise.all(background)
      expect(providerCalls).toBe(0)
      expect(writes).toBe(1)
      expect(await h.db.prepare(`SELECT used FROM ${table} WHERE email = ?1`).bind(EMAIL).first())
        .toEqual({ used: kind === 'cap-reached' ? 30 : initial + 1 })
      const other = p.identity === 'google' ? 'email_trial_usage' : 'trial_usage'
      expect(await h.db.prepare(`SELECT used FROM ${other} WHERE email = ?1`).bind(EMAIL).first())
        .toEqual({ used: p.identity === 'google' ? 13 : 7 })
      await unchangedWallet()
    } finally { release(); await Promise.allSettled(background) }
  })
  it('preserves an ordinary confirmed trial debit and does not use purchased credits', async () => {
    if (p.name === 'anthropic') await fundSyntheticSubsidizedBudget(h.db)
    const response = await invoke(p, p.identity)
    expect(response.status).toBe(200)
    expect(response.headers.get('x-trial-remaining')).toBe(String(30 - initial - 1))
    await response.text(); await Promise.all(background)
    expect(providerCalls).toBe(1)
    expect(await h.db.prepare(`SELECT used FROM ${table} WHERE email = ?1`).bind(EMAIL).first()).toEqual({ used: initial + 1 })
    await unchangedWallet()
  })
})

describe.each(providers)('$name positive exceptions', p => {
  it.each(['byok', 'vip', 'subscription'] as const)('preserves %s without consuming a trial message', async kind => {
    if (kind === 'subscription') await h.db.prepare("UPDATE subscriptions SET plan_type = 'subscription' WHERE user_email = ?1").bind(EMAIL).run()
    else {
      h.env.DB = undefined
      if (kind === 'vip') h.env.ALLOWED_EMAILS = EMAIL
    }
    const response = await invoke(p, 'google', kind === 'byok')
    expect(response.status).toBe(200)
    expect(response.headers.get('x-trial-remaining')).toBeNull()
    await response.text(); await Promise.all(background)
    expect(providerCalls).toBe(1)
    expect(await h.db.prepare('SELECT used FROM trial_usage WHERE email = ?1').bind(EMAIL).first()).toEqual({ used: 7 })
    await unchangedWallet()
  })
})

describe('image modality checks never debit a locked trial', () => {
  it.each(['trial', 'unavailable'] as const)('rejects %s without provider, trial or wallet debit', async kind => {
    if (kind === 'unavailable') h.env.DB = undefined
    const response = await image({ request: new Request('https://tryarty.com/api/ai/image-gen', { method: 'POST',
      headers: { 'x-google-token': 'synthetic-google' }, body: JSON.stringify({ prompt: 'A test tree' }) }),
      env: h.env, waitUntil: (p: Promise<unknown>) => { background.push(p) } } as never) as Response
    if (kind === 'unavailable') await refused(response)
    else { expect(response.status).toBe(403); expect(await response.json()).toMatchObject({ error: 'image_plan_locked' }) }
    expect(providerCalls).toBe(0)
    expect(await h.db.prepare('SELECT used FROM trial_usage WHERE email = ?1').bind(EMAIL).first()).toEqual({ used: 7 })
    await unchangedWallet()
  })
})

describe.each([
  { name: 'free Haiku', call: anthropic, table: 'free_daily_quota', body: { model: 'claude-haiku-4-5-20251001', messages: [{ role: 'user', content: 'Bonjour' }], stream: false } },
  { name: 'voice', call: tts, table: 'free_daily_quota', body: { text: 'Bonjour' } },
  { name: 'memory extraction', call: extract, table: 'bg_quota', body: { transcript: 'Je préfère les réponses en français et je vis dans une petite ville.' } },
  { name: 'search', call: search, table: 'free_daily_quota', body: { query: 'example research' } },
  { name: 'URL fetch', call: urlFetch, table: 'free_daily_quota', body: { url: 'https://example.com/public' } },
  { name: 'geocoding', call: geo, table: 'free_daily_quota', body: { latitude: 48.5, longitude: 2.5 } },
  { name: 'trails', call: trails, table: 'free_daily_quota', body: { action: 'geometry', routeId: 12345 } },
])('$name subsidized handler', p => {
  it.each(['error', 'late'] as const)('refuses a %s quota before any external request', async kind => {
    // Known Free and an empty, readable wallet — failure is specifically quota.
    await h.db.prepare('DELETE FROM subscriptions').run()
    await h.db.prepare('DELETE FROM wallet').run()
    let release!: () => void, entered!: () => void, writes = 0
    let exactQuery: Promise<unknown> | undefined
    const held = new Promise<void>(resolve => { release = resolve })
    const reached = new Promise<void>(resolve => { entered = resolve })
    h.env.DB = faultDb(sql => sql.includes(`INSERT INTO ${p.table}`), async (statement, values) => {
      writes++
      entered()
      if (kind === 'error') throw new Error('synthetic quota outage')
      exactQuery = (async () => { await held; return statement.bind(...values).first() })()
      return exactQuery
    })
    try {
      const operation = p.call({ request: new Request('https://tryarty.com/api/subsidized-test', { method: 'POST',
        headers: { 'content-type': 'application/json', 'x-google-token': 'synthetic-google' }, body: JSON.stringify(p.body) }),
        env: h.env, waitUntil: (promise: Promise<unknown>) => { background.push(promise) } } as never) as Promise<Response>
      if (kind === 'late') { const expire = await deadline; await reached; expire() }
      const response = await operation
      expect(response.status).toBe(503)
      expect(await response.json()).toMatchObject({ error: 'admission_unavailable' })
      expect(response.headers.get('x-trial-remaining')).toBeNull()
      expect(providerCalls).toBe(0)
      expect(writes).toBe(1)
    } finally { release(); await Promise.allSettled(background) }
    // Daily caps count attempts, not refundable trial messages. A late write
    // may persist; it must never trigger a provider call after the refusal.
    if (kind === 'late') {
      expect(exactQuery).toBeDefined()
      expect(await exactQuery).toEqual({ count: 1 })
      expect((await h.db.prepare(`SELECT count FROM ${p.table}`).all()).results).toEqual([{ count: 1 }])
    }
    expect(providerCalls).toBe(0)
    expect(await h.db.prepare('SELECT COUNT(*) AS n FROM reservation').first()).toEqual({ n: 0 })
    expect(await h.db.prepare('SELECT used FROM trial_usage WHERE email = ?1').bind(EMAIL).first()).toEqual({ used: 7 })
  })
})

function visionRequest(identity: Identity, controller: AbortController, byok = false) {
  const png = new Uint8Array(57)
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  png.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 32, 0, 0, 0, 32], 8)
  png.set([0, 0, 0, 0, 0x49, 0x44, 0x41, 0x54], 33)
  png.set([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44], 45)
  return new Request('https://tryarty.com/api/ai/openai-proxy', { method: 'POST', signal: controller.signal,
    headers: { 'content-type': 'application/json', 'x-arty-vision': '1',
      ...(identity === 'google' ? { 'x-google-token': 'synthetic-google' } : { 'x-arty-trial-token': session }),
      ...(byok ? { 'x-openai-key': 'synthetic-byok' } : {}) },
    body: JSON.stringify({ model: 'gpt-5.6-terra', stream: true, stream_options: { include_usage: true }, max_completion_tokens: 100,
      messages: [{ role: 'user', content: [
        { type: 'image_url', image_url: { url: 'data:image/png;base64,' + Buffer.from(png).toString('base64'), detail: 'original' } },
        { type: 'text', text: 'Describe' }] }] }) })
}

describe.each(['google', 'otp'] as const)('%s vision cancellation versus trial deadline', identity => {
  it.each(['vision-first', 'quota-first'] as const)('%s gives at most one compensation and releases the vision permit', async order => {
    const table = identity === 'google' ? 'trial_usage' : 'email_trial_usage'
    const initial = identity === 'google' ? 7 : 13
    let release!: () => void, committed!: () => void, refunds = 0
    const held = new Promise<void>(resolve => { release = resolve })
    const reached = new Promise<void>(resolve => { committed = resolve })
    const gated = faultDb(sql => sql.includes(`INSERT INTO ${table}`), async (statement, values) => {
      const row = await statement.bind(...values).first()
      committed(); await held; return row
    })
    h.env.DB = new Proxy(gated, { get(target, prop) {
      if (prop !== 'prepare') return Reflect.get(target, prop)
      return (sql: string) => {
        const statement = target.prepare(sql)
        if (!sql.includes(`UPDATE ${table}`)) return statement
        return { bind: (...values: unknown[]) => ({ run: async () => { refunds++; return statement.bind(...values).run() } }) }
      }
    } })
    const controller = new AbortController()
    try {
      const operation = openai({ request: visionRequest(identity, controller), env: h.env,
        waitUntil: (p: Promise<unknown>) => { background.push(p) } } as never) as Promise<Response>
      const expire = await Promise.race([deadline, operation.then(response => {
        throw new Error(`Vision unexpectedly finished before its admission query: HTTP ${response.status}`)
      })])
      await reached
      if (order === 'vision-first') controller.abort(new Error('user cancelled'))
      else expire()
      const response = await operation
      expect(response.status).toBe(order === 'vision-first' ? 408 : 503)
      await response.text()
      controller.abort(new Error('late cancel'))
      expire()
      expect(providerCalls).toBe(0)
      await unchangedWallet()
      const other = identity === 'google' ? await checkAllowedVerifiedUser(EMAIL, { ...h.env, DB: h.db })
        : await consumeEmailTrialMessage({ ...h.env, DB: h.db }, EMAIL)
      expect(other).toMatchObject({ trialDebited: true })
      release(); await Promise.all(background)
      expect(refunds).toBe(1)
      expect(await h.db.prepare(`SELECT used FROM ${table} WHERE email = ?1`).bind(EMAIL).first()).toEqual({ used: initial + 1 })
      expect(providerCalls).toBe(0)
      await unchangedWallet()
      // A fresh BYOK vision can acquire the sole permit after refusal/cancel.
      const next = await openai({ request: visionRequest('google', new AbortController(), true), env: h.env,
        waitUntil: (p: Promise<unknown>) => { background.push(p) } } as never) as Response
      expect(next.status).toBe(200)
      await next.text(); await Promise.all(background)
      expect(providerCalls).toBe(1)
    } finally { release(); await Promise.allSettled(background) }
  })
})

describe.each(['google', 'otp'] as const)('%s corrupted counter during late compensation', identity => {
  it.each([-1, 1.5, 'broken', 31])('never repairs used=%s or reopens the trial', async used => {
    const table = identity === 'google' ? 'trial_usage' : 'email_trial_usage'
    let release!: () => void, committed!: () => void
    const held = new Promise<void>(resolve => { release = resolve })
    const reached = new Promise<void>(resolve => { committed = resolve })
    h.env.DB = faultDb(sql => sql.includes(`INSERT INTO ${table}`), async (statement, values) => {
      const row = await statement.bind(...values).first()
      committed(); await held; return row
    })
    try {
      const operation = invoke(providers[0], identity)
      const expire = await deadline
      await reached
      expire()
      await refused(await operation)
      await h.db.prepare(`UPDATE ${table} SET used = ?2, updated_at = 123 WHERE email = ?1`).bind(EMAIL, used).run()
      release(); await Promise.all(background)
      expect(await h.db.prepare(`SELECT used, updated_at FROM ${table} WHERE email = ?1`).bind(EMAIL).first())
        .toEqual({ used, updated_at: 123 })
      h.env.DB = h.db
      await refused(await invoke(providers[0], identity))
    } finally { release(); await Promise.allSettled(background) }
  })
})
