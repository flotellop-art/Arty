// These are synthetic protocol tests, not a claim about live provider accuracy.
import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Env } from '../../../functions/env'
import { readAutonomousPage, searchAutonomous, nativeWebForbidden } from '../../../functions/api/_lib/autonomousWeb'
import { onRequestPost as searchRoute } from '../../../functions/api/search/web'
import { onRequestPost as fetchRoute } from '../../../functions/api/fetch/url'
import { onRequestPost as claudeRoute } from '../../../functions/api/ai/proxy'
import { onRequestPost as geminiRoute } from '../../../functions/api/ai/gemini-proxy'
import { onRequestPost as factRoute } from '../../../functions/api/ai/fact-check'

vi.mock('../../../functions/api/_lib/checkAllowedUser', async importOriginal => ({
  ...await importOriginal<object>(),
  checkAllowedUserPeek: vi.fn(async () => ({ email: 'test@example.com', planType: 'vip' })),
}))
vi.mock('../../../functions/api/_lib/emailTrial', async importOriginal => ({
  ...await importOriginal<object>(),
  resolveProxyIdentityDetailed: vi.fn(async () => ({ status: 'ok', identity: { kind: 'google', email: 'test@example.com' } })),
}))
vi.mock('../../../functions/api/_lib/atomicQuota', () => ({ consumeCapAtomic: vi.fn(async () => ({ status: 'consumed' })) }))
vi.mock('../../../functions/api/_lib/quota', async importOriginal => ({ ...await importOriginal<object>(), recordUsage: vi.fn(async () => {}) }))

const env = { SEARCH_PROVIDER: 'arty-index', AUTONOMOUS_WEB_URL: 'http://127.0.0.1:8789', AUTONOMOUS_WEB_LOCAL: 'true',
  AUTONOMOUS_WEB_KEY: 's'.repeat(48), LINKUP_API_KEY: 'must-never-be-used', BRAVE_SEARCH_API_KEY: 'must-never-be-used',
  ANTHROPIC_API_KEY: 'synthetic', GEMINI_API_KEY: 'synthetic',
  DB: { prepare: () => ({ run: async () => ({ success: true }) }) },
} as unknown as Env
const url = 'https://www.sqlite.org/fts5.html'
const text = 'Fictional test document. The test index belongs to the owner. '.repeat(3)
async function document() {
  const hash = [...new Uint8Array(await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(b => b.toString(16).padStart(2, '0')).join('')
  return { provider: 'arty-index', markdown: text, truncated: false, originalLength: text.length,
    receipt: { provider: 'arty-index', requestedUrl: url, finalUrl: url, captureMode: 'html-static', truncated: false, sha256: hash, retrievedAt: '2026-10-05T07:00:00Z' } }
}
function context(body: unknown, route = 'search/web') {
  return { env, request: new Request('https://tryarty.com/api/' + route, { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-google-token': 'private-user-token', Authorization: 'Bearer byok-test-key' }, body: JSON.stringify(body) }),
    waitUntil: vi.fn() } as never
}
beforeEach(() => { vi.stubGlobal('crypto', webcrypto); vi.clearAllMocks() })
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('owned index adapter and routes', () => {
  it('keeps sources, verification and opaque redirects inside the owned service', async () => {
    const page = await document()
    const calls: Array<{ url: string; body: any; headers: Headers }> = []
    vi.stubGlobal('fetch', vi.fn(async (input, init) => {
      const target = String(input), body = JSON.parse(init.body)
      calls.push({ url: target, body, headers: new Headers(init.headers) })
      if (target === 'http://127.0.0.1:8789/search') return Response.json({ provider: 'arty-index', bySource: {
        'www.sqlite.org': { results: [{ url, title: 'Test', snippet: 'Fictional test document.' }] }, 'absent.test': { results: [] },
      } })
      if (target === 'http://127.0.0.1:8789/fetch') return Response.json(page)
      throw new Error('External engine attempted: ' + target)
    }))
    const response = await searchRoute(context({ query: 'FTS5', sources: ['www.sqlite.org', 'absent.test'], verifyUrls: true,
      readerPolicy: 'public-browser', redirectUrls: ['https://vertexaisearch.cloud.google.com/grounding-api-redirect/test'] }))
    expect(response.status).toBe(200)
    const data = await response.json() as any
    expect(data.bySource['www.sqlite.org'].results[0].verified).toBe(true)
    expect(data.bySource['absent.test'].results).toEqual([])
    expect(calls).toHaveLength(2)
    for (const call of calls) {
      expect(call.headers.get('authorization')).toBe('Bearer ' + env.AUTONOMOUS_WEB_KEY)
      expect(call.headers.has('x-google-token')).toBe(false)
      expect(JSON.stringify(call.body)).not.toContain('private-user-token')
    }
  })

  it('reads legacy and PDF requests without ever falling back to Linkup or Browser Run', async () => {
    const spy = vi.fn(async () => Response.json({ error: 'not_in_index' }, { status: 404 }))
    vi.stubGlobal('fetch', spy)
    const response = await fetchRoute(context({ url: 'https://www.sqlite.org/absent.pdf' }, 'fetch/url'))
    expect(response.status).toBe(502)
    expect(await response.json()).toMatchObject({ error: 'not_in_index', provider: 'arty-index' })
    expect(spy).toHaveBeenCalledOnce()
    expect(String(spy.mock.calls[0]?.[0])).toBe('http://127.0.0.1:8789/fetch')
  })

  it('refuses old search clients and EU queries without region confirmation, without any network call', async () => {
    const spy = vi.fn(); vi.stubGlobal('fetch', spy)
    const legacy = await searchRoute(context({ query: 'FTS5' }))
    expect(legacy.status).toBe(409)
    const eu = await searchRoute(context({ query: 'FTS5', readerPolicy: 'eu-only' }))
    expect(eu.status).toBe(503)
    expect(spy).not.toHaveBeenCalled()
  })
  it('a mismatched frontend/server cannot silently use paid engines', async () => {
    const spy = vi.fn(); vi.stubGlobal('fetch', spy)
    const oldServer = { ...env, SEARCH_PROVIDER: 'linkup' }
    for (const [handler, body] of [
      [searchRoute, { query: 'FTS5', readerPolicy: 'public-browser', requireOwnedIndex: true }],
      [fetchRoute, { url, requireOwnedIndex: true }],
      [factRoute, { question: 'FTS5', response: text, requireOwnedIndex: true }],
    ] as const) {
      const response = await handler({ ...context(body) as any, env: oldServer })
      expect(response.status).toBe(409)
    }
    expect(spy).not.toHaveBeenCalled()
  })

  it('refuses unconfigured service, invalid hash, oversized response and unconfirmed EU', async () => {
    const spy = vi.fn()
    vi.stubGlobal('fetch', spy)
    await expect(searchAutonomous({ ...env, AUTONOMOUS_WEB_URL: undefined }, 'FTS5')).rejects.toThrow('index_unavailable')
    await expect(readAutonomousPage(env, url, undefined, true)).rejects.toThrow('eu_backend_unconfirmed')
    expect(spy).not.toHaveBeenCalled()
    const page = await document()
    spy.mockResolvedValueOnce(Response.json({ ...page, markdown: text + 'tampered' }))
    await expect(readAutonomousPage(env, url)).rejects.toThrow('index_unavailable')
    spy.mockResolvedValueOnce(new Response('x'.repeat(1_000_001)))
    await expect(searchAutonomous(env, 'FTS5')).rejects.toThrow('index_unavailable')
  })

  it('forwards Stop to the owned service and makes no engine retry', async () => {
    const ctrl = new AbortController()
    const spy = vi.fn(async (_input, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true })
    }))
    vi.stubGlobal('fetch', spy)
    const pending = searchAutonomous(env, 'FTS5', 5, [], false, ctrl.signal)
    ctrl.abort(new Error('Stop'))
    await expect(pending).rejects.toThrow('Stop')
    expect(spy).toHaveBeenCalledOnce()
  })

  it('blocks hosted tools on both model proxies for old clients and BYOK, before upstream work', async () => {
    const spy = vi.fn()
    vi.stubGlobal('fetch', spy)
    const claude = await claudeRoute(context({ model: 'claude-sonnet-5', max_tokens: 100,
      messages: [{ role: 'user', content: 'Test' }], tools: [{ type: 'web_fetch_20260209', name: 'web_fetch' }] }, 'ai/proxy'))
    const gemini = await geminiRoute(context({ model: 'gemini-3.5-flash', contents: [{ role: 'user', parts: [{ text: 'Test' }] }],
      tools: [{ google_search: {} }] }, 'ai/gemini-proxy'))
    expect(claude.status).toBe(409); expect(gemini.status).toBe(409)
    expect(spy).not.toHaveBeenCalled()
    expect(nativeWebForbidden(env, { tools: [{ type: 'web_search_20260318' }] }, 'anthropic')).toBe(true)
    expect(nativeWebForbidden(env, { tools: [{ name: 'web_search', input_schema: { type: 'object' } }] }, 'anthropic')).toBe(false)
    expect(nativeWebForbidden(env, { tools: [{ urlContext: {} }] }, 'gemini')).toBe(true)
    expect(nativeWebForbidden(env, { tools: [{ google_maps: {} }] }, 'gemini')).toBe(true)
    expect(nativeWebForbidden(env, { contents: [{ parts: [{ fileData: { fileUri: 'https://youtu.be/abcdefghijk' } }] }] }, 'gemini')).toBe(true)
  })

  it('the fact checker prepares owned sources and uses a cloud model without native tools', async () => {
    const destinations: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input, init) => {
      const target = String(input); destinations.push(target)
      if (target === 'http://127.0.0.1:8789/search') return Response.json({ provider: 'arty-index', results: [] })
      if (target === 'https://api.anthropic.com/v1/messages') {
        const body = JSON.parse(init.body)
        expect(body.tools).toBeUndefined()
        expect(body.messages[0].content).toContain('corpus Arty')
        return Response.json({ model: 'claude-sonnet-5', stop_reason: 'end_turn', content: [{ type: 'text', text: '{"claims":[]}' }], usage: {} })
      }
      throw new Error('Unexpected external destination: ' + target)
    }))
    const response = await factRoute(context({ tier: 'sonnet', question: 'FTS5 search', response: 'Example answer that should be checked for factual errors. '.repeat(3) }, 'ai/fact-check'))
    expect(response.status).toBe(200)
    expect(destinations).toEqual(['http://127.0.0.1:8789/search', 'https://api.anthropic.com/v1/messages'])
  })
})
