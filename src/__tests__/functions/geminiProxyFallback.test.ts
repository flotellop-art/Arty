// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { onRequestPost as geminiProxy } from '../../../functions/api/ai/gemini-proxy'
import { makeD1Harness, type D1Harness } from './d1Harness'

const EMAIL = 'gemini-fallback@example.test'
const TOKEN = 'google-access-token'
const CLIENT_ID = 'arty-client-id'
let h: D1Harness

beforeAll(async () => {
  h = await makeD1Harness({
    GOOGLE_CLIENT_ID: CLIENT_ID,
    GEMINI_API_KEY: 'gemini-server-key',
  })
})
afterAll(async () => { await h.dispose() })
beforeEach(async () => {
  await h.reset()
  vi.restoreAllMocks()
  delete h.env.GEMINI_36_DISABLED
})

function context(request: Request, background: Promise<unknown>[]) {
  return {
    request,
    env: h.env,
    waitUntil(promise: Promise<unknown>) { background.push(promise) },
  } as never
}

function authResponse(url: string): Response | null {
  if (url.includes('/tokeninfo')) return Response.json({ aud: CLIENT_ID })
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

describe('Gemini proxy — fallback 3.6 compté une seule fois', () => {
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
