// @vitest-environment node
import { build } from 'esbuild'
import { Miniflare } from 'miniflare'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

let runtime: Miniflare, upstreamStatus: number
let calls: Array<{ url: string; method: string; key: string | null }>
beforeAll(async () => {
  const bundle = await build({ bundle: true, write: false, format: 'esm', platform: 'browser',
    stdin: { resolveDir: process.cwd(), contents: `
      import { onRequestPost } from './functions/api/ai/proxy.ts';
      export default { fetch(request, env, ctx) {
        if (new URL(request.url).pathname === '/follow-control') return fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST', body: '{}', redirect: 'follow', headers: {'x-api-key':'synthetic-owner'} });
        return onRequestPost({request, env, waitUntil: p => ctx.waitUntil(p)});
      }};` } })
  runtime = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-07-01',
    bindings: { GOOGLE_CLIENT_ID: 'synthetic-client', ALLOWED_EMAILS: 'redirect@example.test', ANTHROPIC_API_KEY: 'synthetic-owner' },
    outboundService: async request => {
      if (new URL(request.url).pathname === '/tokeninfo') return Response.json({
        aud: 'synthetic-client', email: 'redirect@example.test', email_verified: true, sub: 'synthetic-user',
      })
      calls.push({ url: request.url, method: request.method, key: request.headers.get('x-api-key') })
      await request.text()
      if (new URL(request.url).origin !== 'https://api.anthropic.com') return new Response('PRIVATE_TARGET', { status: 200 })
      if (upstreamStatus === 200) return Response.json({ content: [{ type: 'text', text: 'synthetic answer' }], usage: { input_tokens: 3, output_tokens: 2 } })
      return new Response('PRIVATE_REDIRECT_BODY', { status: upstreamStatus, headers: { location: 'https://must-not-follow.invalid/private' } })
    } })
}, 30000)
afterAll(async () => { await runtime.dispose() })
beforeEach(() => { calls = []; upstreamStatus = 307 })
const invoke = (byok = false) => runtime.dispatchFetch('https://arty.test/api/ai/proxy', {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-google-token': 'synthetic-google',
    ...(byok ? { 'x-api-key': 'synthetic-personal' } : {}) },
  body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 100, messages: [{ role: 'user', content: 'Bonjour' }] }),
})

describe('actual Anthropic redirect transport in workerd', () => {
  it.each([301, 302, 303, 307, 308].flatMap(status => [false, true].map(byok => ({ status, byok }))))(
    '$status / BYOK=$byok never follows or exposes a provider redirect', async ({ status, byok }) => {
      upstreamStatus = status
      const response = await invoke(byok)
      expect(calls).toEqual([{ url: 'https://api.anthropic.com/v1/messages', method: 'POST', key: byok ? 'synthetic-personal' : 'synthetic-owner' }])
      expect(response.status).toBe(409)
      expect(await response.json()).toEqual({ error: 'upstream_outcome_unknown' })
      expect(response.headers.get('location')).toBeNull()
      expect(response.headers.get('cache-control')).toBe('no-store')
    })
  it('the deliberately unsafe control observes both POSTs and forwarded key', async () => {
    const response = await runtime.dispatchFetch('https://arty.test/follow-control')
    expect(response.status).toBe(200)
    expect(calls).toEqual([
      { url: 'https://api.anthropic.com/v1/messages', method: 'POST', key: 'synthetic-owner' },
      { url: 'https://must-not-follow.invalid/private', method: 'POST', key: 'synthetic-owner' },
    ])
  })
  it.each([false, true])('keeps an ordinary successful response, BYOK=%s', async byok => {
    upstreamStatus = 200
    const response = await invoke(byok)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ content: [{ type: 'text', text: 'synthetic answer' }] })
    expect(calls).toHaveLength(1)
  })
})
