// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { build } from 'esbuild'
import { Miniflare } from 'miniflare'

let runtime: Miniflare, calls: { url: string; headers: Record<string, string> }[]
beforeAll(async () => {
  const bundled = await build({ bundle: true, write: false, format: 'esm', platform: 'browser', stdin: {
    resolveDir: process.cwd(), contents: `
      import {onRequest} from './functions/api/_middleware.ts';
      import {onRequestPost} from './functions/api/ai/anthropic-continue-v1.ts';
      export default {fetch(request, env, ctx) {return onRequest({request, env,
        waitUntil:ctx.waitUntil.bind(ctx), next:()=>onRequestPost({request,env,waitUntil:ctx.waitUntil.bind(ctx)})});}};
    ` } })
  runtime = new Miniflare({ modules: true, script: bundled.outputFiles[0].text, compatibilityDate: '2026-07-01',
    bindings: { GOOGLE_CLIENT_ID: 'synthetic-client' },
    outboundService: async request => {
      calls.push({ url: request.url, headers: Object.fromEntries(request.headers) })
      if (new URL(request.url).pathname.endsWith('/tokeninfo')) return Response.json({
        aud: 'synthetic-client', email: 'synthetic@example.test', email_verified: true, sub: 'synthetic-subject',
      })
      await request.text()
      return Response.json({ content: [{ type: 'text', text: 'Synthetic' }] }, { headers: { 'x-arty-funding': 'v1:wallet' } })
    },
  })
})
beforeEach(() => { calls = [] })
afterAll(async () => { await runtime.dispose() })
const url = 'https://tryarty.com/api/ai/anthropic-continue-v1'
const body = JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 100, messages: [{ role: 'user', content: 'synthetic' }] })

describe('versioned continuation and native CORS in actual workerd', () => {
  it.each(['https://localhost', 'capacitor://localhost', 'https://tryarty.com'])('permits the restrictive header and exposes server funding to %s', async origin => {
    const preflight = await runtime.dispatchFetch(url, { method: 'OPTIONS', headers: { origin,
      'access-control-request-method': 'POST', 'access-control-request-headers': 'x-arty-require-funding' } })
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('access-control-allow-origin')).toBe(origin)
    expect(preflight.headers.get('access-control-allow-headers')).toContain('x-arty-require-funding')
    expect(calls).toHaveLength(0)
    const response = await runtime.dispatchFetch(url, { method: 'POST', body, headers: { origin,
      'x-google-token': 'synthetic-google', 'x-api-key': 'synthetic-byok', 'x-arty-require-funding': 'v1:byok' } })
    expect(response.status).toBe(200)
    expect(response.headers.get('access-control-expose-headers')).toContain('x-arty-funding')
    expect(response.headers.get('x-arty-funding')).toBe('v1:byok') // never the provider's spoofed wallet label
    const provider = calls.filter(c => c.url === 'https://api.anthropic.com/v1/messages')
    expect(provider).toHaveLength(1)
    expect(provider[0].headers['x-arty-require-funding']).toBeUndefined()
    expect(provider[0].headers['x-arty-funding']).toBeUndefined()
  })
  it.each([undefined, '', 'v2:free', 'v1:free,v1:wallet'])('refuses absent/invalid funding %s before any identity or AI request', async required => {
    const response = await runtime.dispatchFetch(url, { method: 'POST', body, headers: {
      origin: 'https://tryarty.com', ...(required !== undefined ? { 'x-arty-require-funding': required } : {}),
    } })
    expect(response.status).toBe(400); expect(await response.json()).toEqual({ error: 'continuation_funding_required' })
    expect(calls).toHaveLength(0)
  })
})
