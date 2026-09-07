// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { build } from 'esbuild'
import { Miniflare } from 'miniflare'

let runtime: Miniflare
beforeAll(async () => {
  const bundle = await build({ bundle: true, write: false, format: 'esm', platform: 'browser',
    stdin: { resolveDir: process.cwd(), contents: `
      import { readAnthropicRequestBody } from './functions/api/_lib/anthropicRequestBody.ts';
      export default { async fetch(request) {
        const read = await readAnthropicRequestBody(request);
        if (!read.ok) return read.response;
        return fetch('https://synthetic-provider.invalid/messages', {
          method: 'POST', body: JSON.stringify(read.body), headers: {'content-type':'application/json'}
        });
      } };
    ` } })
  runtime = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-07-01',
    outboundService: async request => {
      // No real provider. Drain an actual workerd upload and return small proof.
      expect(request.url).toBe('https://synthetic-provider.invalid/messages')
      const raw = await request.text(), parsed = JSON.parse(raw)
      return Response.json({ bytes: Buffer.byteLength(raw), characters: parsed.text?.length ?? 0,
        prefix: parsed.text?.slice(0, 3), suffix: parsed.text?.slice(-3) })
    } })
})
afterAll(async () => { await runtime.dispose() })

describe('Anthropic bounded DOM and real reserialization in workerd (not a global RAM proof)', () => {
  it('accepts the exact 32 MB byte ceiling through real stream and upload', async () => {
    const body = '{"text":"' + 'a'.repeat(32_000_000 - 11) + '"}'
    const response = await runtime.dispatchFetch('https://arty.test', { method: 'POST', body })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ bytes: 32_000_000, characters: 31_999_989, prefix: 'aaa', suffix: 'aaa' })
  }, 30_000)
  it('keeps two simultaneous 11 MB attachment-sized strings and Unicode intact', async () => {
    const responses = await Promise.all([0, 1].map(async () => {
      const text = '日' + 'A'.repeat(11_000_000) + '😃'
      const response = await runtime.dispatchFetch('https://arty.test', { method: 'POST', body: JSON.stringify({ text }) })
      expect(response.status).toBe(200)
      return response.json()
    }))
    expect(responses).toEqual(Array(2).fill({ bytes: 11_000_018, characters: 11_000_003, prefix: '日AA', suffix: 'A😃' }))
  }, 30_000)
  it('refuses dense structures and long finite numbers before provider upload', async () => {
    for (const body of ['{"x":[' + '0,'.repeat(100_000) + '0]}', '{"x":0.' + '0'.repeat(100_000) + '1}']) {
      const response = await runtime.dispatchFetch('https://arty.test', { method: 'POST', body })
      expect(response.status).toBe(413)
      expect(await response.json()).toEqual({ error: 'payload_too_complex' })
    }
  })
})
