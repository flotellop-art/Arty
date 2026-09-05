// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { onRequestPost as geminiProxy } from '../../../functions/api/ai/gemini-proxy'
import { makeD1Harness, type D1Harness } from './d1Harness'
import { checkAllowedVerifiedUser } from '../../../functions/api/_lib/checkAllowedUser'
import { consumeEmailTrialMessage } from '../../../functions/api/_lib/emailTrial'

const EMAIL = 'gemini-fallback@example.test'
const TOKEN = 'google-access-token'
const CLIENT_ID = 'arty-client-id'
let h: D1Harness
let quotaDeadline: Promise<() => void>

// Control only the production quota deadline, not workerd's clock or SQL.
// Normal-path cases never expire it; delayed cases explicitly do. Thus used=1
// stays a strict assertion even on a busy CI host. Separate unit tests assert
// that the actual deadline duration is exactly 250 ms.
function controlQuotaDeadline(): Promise<() => void> {
  const realSetTimeout = globalThis.setTimeout
  const realClearTimeout = globalThis.clearTimeout
  const handles = new Set<ReturnType<typeof setTimeout>>()
  let announce!: (expire: () => void) => void
  const registered = new Promise<() => void>((resolve) => { announce = resolve })
  vi.spyOn(globalThis, 'setTimeout').mockImplementation(((callback: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => {
    if (delay !== 250) return realSetTimeout(callback, delay, ...args)
    const handle = Object.create(null) as ReturnType<typeof setTimeout>
    handles.add(handle)
    announce(() => { if (handles.delete(handle)) callback(...args) })
    return handle
  }) as typeof setTimeout)
  vi.spyOn(globalThis, 'clearTimeout').mockImplementation((handle) => {
    if (!handles.delete(handle as ReturnType<typeof setTimeout>)) realClearTimeout(handle)
  })
  return registered
}

beforeAll(async () => {
  h = await makeD1Harness({
    GOOGLE_CLIENT_ID: CLIENT_ID,
    GEMINI_API_KEY: 'gemini-server-key',
  })
})
afterAll(async () => { await h.dispose() })
afterEach(() => { vi.restoreAllMocks() })
beforeEach(async () => {
  await h.reset()
  vi.restoreAllMocks()
  delete h.env.GEMINI_36_DISABLED
  quotaDeadline = controlQuotaDeadline()
})

function context(request: Request, background: Promise<unknown>[]) {
  return {
    request,
    env: h.env,
    waitUntil(promise: Promise<unknown>) { background.push(promise) },
  } as never
}

function authResponse(url: string): Response | null {
  if (url.includes('/tokeninfo')) return Response.json({
    aud: CLIENT_ID,
    email: EMAIL,
    email_verified: true,
    user_id: 'google-sub',
  })
  if (url.includes('/oauth2/v2/userinfo')) {
    return Response.json({ email: EMAIL, verified_email: true, id: 'google-sub' })
  }
  return null
}

function request(): Request {
  return new Request('https://tryarty.com/api/ai/gemini-proxy', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-google-token': TOKEN },
    body: JSON.stringify({
      model: 'gemini-3.6-flash',
      stream: false,
      contents: [{ role: 'user', parts: [{ text: 'Actualités du jour' }] }],
      tools: [{ google_search: {} }],
    }),
  })
}

function success(): Response {
  return Response.json({
    candidates: [{ content: { parts: [{ text: 'ok' }] } }],
    usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20 },
  })
}

async function grantTrial(): Promise<void> {
  await h.db.prepare(
    `INSERT INTO subscriptions (user_email, status, plan_type)
     VALUES (?1, 'active', 'trial')`,
  ).bind(EMAIL).run()
}

function holdTrialResponse(table: 'trial_usage' | 'email_trial_usage', afterCommit = true) {
  let release!: () => void
  const held = new Promise<void>((resolve) => { release = resolve })
  let confirmCommit!: () => void
  const committed = new Promise<void>((resolve) => { confirmCommit = resolve })
  const db = h.env.DB!
  const wrapped = new Proxy(db, {
    get(target, prop) {
      if (prop !== 'prepare') return Reflect.get(target, prop)
      return (sql: string) => {
        const statement = target.prepare(sql)
        if (!sql.includes(`INSERT INTO ${table}`)) return statement
        return { bind: (...values: unknown[]) => ({ first: async () => {
          if (!afterCommit) await held
          const row = await statement.bind(...values).first()
          confirmCommit()
          if (afterCommit) await held
          return row
        } }) }
      }
    },
  })
  return { release, committed, db, wrapped }
}

describe('Gemini proxy — fallback 3.6 compté une seule fois', () => {
  it.each([
    { status: 401, afterCommit: true }, { status: 200, afterCommit: true },
    { status: 503, afterCommit: true }, { status: 401, afterCommit: false },
  ])('compense le débit trial tardif, HTTP $status, commit avant deadline=$afterCommit', async ({ status, afterCommit }) => {
    await grantTrial()
    await h.db.prepare('INSERT INTO trial_usage (email, used, updated_at) VALUES (?1, 7, 0)').bind(EMAIL).run()
    await h.db.prepare('INSERT INTO email_trial_usage (email, used, updated_at) VALUES (?1, 13, 0)').bind(EMAIL).run()
    // Real SQL, gated before commit or after it. RETURNING cannot arrive until
    // after the proxy answers. No sleep, quota mock, or retry of the write.
    const { release, committed, db, wrapped } = holdTrialResponse('trial_usage', afterCommit)
    h.env.DB = wrapped
    const background: Promise<unknown>[] = []
    let upstreamCalls = 0
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const auth = authResponse(String(input))
      if (auth) return auth
      upstreamCalls += 1
      return status === 200 || (status === 503 && upstreamCalls === 2)
        ? success() : Response.json({ error: 'refused' }, { status })
    }) as typeof fetch
    try {
      const operation = geminiProxy(context(request(), background))
      const expire = await quotaDeadline
      if (afterCommit) await committed
      expire()
      const response = await operation
      expect(response.status).toBe(status === 503 ? 200 : status)
      await response.text()
      // An independent successful reservation must survive compensation.
      const other = await checkAllowedVerifiedUser(EMAIL, { ...h.env, DB: db })
      expect(other).toMatchObject({ trialDebited: true })
      release()
      await Promise.all(background)
      const trial = await db.prepare('SELECT used FROM trial_usage WHERE email = ?1')
        .bind(EMAIL).first<{ used: number }>()
      expect(trial?.used).toBe(8)
      const emailTrial = await db.prepare('SELECT used FROM email_trial_usage WHERE email = ?1')
        .bind(EMAIL).first<{ used: number }>()
      expect(emailTrial?.used).toBe(13)
      expect(upstreamCalls).toBe(status === 503 ? 2 : 1)
    } finally {
      release()
      await Promise.allSettled(background)
      h.env.DB = db
    }
  })

  it.each([7, 30])('email-trial tardif à used=%s ne touche ni Google ni un débit non effectué', async (initial) => {
    await h.db.prepare('INSERT INTO trial_usage (email, used, updated_at) VALUES (?1, 12, 0)').bind(EMAIL).run()
    await h.db.prepare('INSERT INTO email_trial_usage (email, used, updated_at) VALUES (?1, ?2, 0)').bind(EMAIL, initial).run()
    const { release, committed, db, wrapped } = holdTrialResponse('email_trial_usage')
    const background: Promise<unknown>[] = []
    try {
      const operation = consumeEmailTrialMessage({ ...h.env, DB: wrapped }, EMAIL, (p) => { background.push(p) })
      const expire = await quotaDeadline
      await committed
      expire()
      const result = await operation
      expect(result).toMatchObject({ planType: 'trial' })
      expect(result).not.toHaveProperty('trialDebited')
      expect(background).toHaveLength(1)
      release()
      await Promise.all(background)
      const trial = await db.prepare('SELECT used FROM trial_usage WHERE email = ?1').bind(EMAIL).first<{ used: number }>()
      const emailTrial = await db.prepare('SELECT used FROM email_trial_usage WHERE email = ?1').bind(EMAIL).first<{ used: number }>()
      expect(trial?.used).toBe(12)
      expect(emailTrial?.used).toBe(initial)
    } finally {
      release()
      await Promise.allSettled(background)
    }
  })

  it.each([400, 401, 403, 429])('ne fallback jamais sur HTTP %s et rembourse le trial', async (status) => {
    await grantTrial()
    const upstream: string[] = []
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      const auth = authResponse(url)
      if (auth) return auth
      if (url.includes('generativelanguage.googleapis.com')) {
        upstream.push(url)
        return Response.json({ error: 'refused' }, { status })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    }) as typeof fetch

    const background: Promise<unknown>[] = []
    const response = await geminiProxy(context(request(), background))
    expect(response.status).toBe(status)
    await response.text()
    await Promise.all(background)
    expect(upstream).toHaveLength(1)
    expect(upstream[0]).toContain('/gemini-3.6-flash:')
    const trial = await h.db.prepare('SELECT used FROM trial_usage WHERE email = ?1')
      .bind(EMAIL).first<{ used: number }>()
    expect(trial?.used ?? 0).toBe(0)
  })

  it.each([404, 503])('fallback une fois sur HTTP %s et ne consomme qu’une unité trial', async (status) => {
    await grantTrial()
    const upstream: string[] = []
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      const auth = authResponse(url)
      if (auth) return auth
      if (url.includes('generativelanguage.googleapis.com')) {
        upstream.push(url)
        return upstream.length === 1
          ? Response.json({ error: 'unavailable' }, { status })
          : success()
      }
      throw new Error(`Unexpected fetch: ${url}`)
    }) as typeof fetch

    const background: Promise<unknown>[] = []
    const response = await geminiProxy(context(request(), background))
    expect(response.status).toBe(200)
    expect(response.headers.get('x-arty-model-used')).toBe('gemini-3.5-flash')
    await response.text()
    await Promise.all(background)
    expect(upstream).toHaveLength(2)
    expect(upstream[0]).toContain('/gemini-3.6-flash:')
    expect(upstream[1]).toContain('/gemini-3.5-flash:')
    const trial = await h.db.prepare('SELECT used FROM trial_usage WHERE email = ?1')
      .bind(EMAIL).first<{ used: number }>()
    expect(trial?.used).toBe(1)
  })

  it('déplace l’unique quota subscription vers le modèle réellement servi', async () => {
    await h.db.prepare(
      `INSERT INTO subscriptions (user_email, status, plan_type)
       VALUES (?1, 'active', 'subscription')`,
    ).bind(EMAIL).run()
    let upstreamCalls = 0
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      const auth = authResponse(url)
      if (auth) return auth
      if (url.includes('generativelanguage.googleapis.com')) {
        upstreamCalls += 1
        return upstreamCalls === 1
          ? Response.json({ error: 'not found' }, { status: 404 })
          : success()
      }
      throw new Error(`Unexpected fetch: ${url}`)
    }) as typeof fetch

    const background: Promise<unknown>[] = []
    const response = await geminiProxy(context(request(), background))
    await response.text()
    await Promise.all(background)
    expect(response.status).toBe(200)
    const globalQuota = await h.db.prepare('SELECT count FROM quota WHERE email = ?1')
      .bind(EMAIL).first<{ count: number }>()
    expect(globalQuota?.count).toBe(1)
    const rows = await h.db.prepare(
      'SELECT model, count FROM quota_model WHERE email = ?1 ORDER BY model',
    ).bind(EMAIL).all<{ model: string; count: number }>()
    expect(rows.results).toEqual([
      expect.objectContaining({ model: 'gemini-3.5-flash', count: 1 }),
      expect.objectContaining({ model: 'gemini-3.6-flash', count: 0 }),
    ])
  })

  it('applique le killswitch global avant quota et appel upstream', async () => {
    await grantTrial()
    h.env.GEMINI_36_DISABLED = 'true'
    const upstream: string[] = []
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      const auth = authResponse(url)
      if (auth) return auth
      if (url.includes('generativelanguage.googleapis.com')) {
        upstream.push(url)
        return success()
      }
      throw new Error(`Unexpected fetch: ${url}`)
    }) as typeof fetch

    const background: Promise<unknown>[] = []
    const response = await geminiProxy(context(request(), background))
    await response.text()
    await Promise.all(background)
    expect(response.headers.get('x-arty-model-used')).toBe('gemini-3.5-flash')
    expect(upstream).toHaveLength(1)
    expect(upstream[0]).toContain('/gemini-3.5-flash:')
  })
})
