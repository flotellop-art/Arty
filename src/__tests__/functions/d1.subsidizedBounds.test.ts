// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { onRequestPost as extract } from '../../../functions/api/ai/memory-extract'
import { onRequestPost as search } from '../../../functions/api/search/web'
import { makeD1Harness, type D1Harness } from './d1Harness'

const EMAIL = 'bounds@example.test', CLIENT_ID = 'synthetic-client'
const sources = Array.from({ length: 6 }, (_, i) => `source${i}.example.test`)
const redirects = Array.from({ length: 5 }, (_, i) => `https://vertexaisearch.cloud.google.com/grounding-api-redirect/${i}`)
let h: D1Harness, calls: string[], prompts: string[]
beforeAll(async () => { h = await makeD1Harness({ GOOGLE_CLIENT_ID: CLIENT_ID,
  ANTHROPIC_API_KEY: 'synthetic-anthropic', LINKUP_API_KEY: 'synthetic-linkup' }) })
afterAll(async () => { await h.dispose() })
beforeEach(async () => {
  await h.reset(); calls = []; prompts = []
  await h.db.prepare("INSERT INTO subscriptions(user_email,status,plan_type) VALUES (?1,'active','subscription')").bind(EMAIL).run()
  vi.spyOn(Math, 'random').mockReturnValue(1)
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/tokeninfo')) return Response.json({ aud: CLIENT_ID, email: EMAIL, email_verified: true, sub: 'synthetic-sub' })
    calls.push(url)
    if (url.includes('grounding-api-redirect')) return new Response(null, { status: 302, headers: { location: 'https://redirect.example.test/page' } })
    const body = JSON.parse(String(init?.body ?? '{}'))
    if (url.endsWith('/v1/search')) {
      const source = String(body.q).match(/site:(\S+)$/)?.[1] ?? 'standard.example.test'
      return Response.json({ sources: Array.from({ length: 5 }, (_, i) => ({ name: 'source', url: `https://${source}/page${i}`, snippet: 'synthetic' })) })
    }
    if (url.endsWith('/v1/fetch')) return Response.json({})
    if (url === 'https://api.anthropic.com/v1/messages') {
      expect(body.model).toBe('claude-haiku-4-5-20251001'); expect(body.max_tokens).toBe(400)
      prompts.push(body.messages[0].content)
      return Response.json({ content: [{ type: 'text', text: '{"add":[],"replace":[]}' }], usage: { input_tokens: 10, output_tokens: 2 } })
    }
    throw new Error('Unexpected provider URL')
  }))
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
function request(path: string, body: unknown) {
  return new Request('https://tryarty.com/api/' + path, { method: 'POST', headers: {
    'content-type': 'application/json', 'x-google-token': 'synthetic-token',
  }, body: JSON.stringify(body) })
}
function invoke(handler: typeof extract, req: Request) {
  return handler({ request: req, env: h.env } as never) as Promise<Response>
}
async function used(table: 'bg_quota' | 'free_daily_quota') {
  return (await h.db.prepare(`SELECT SUM(count) AS n FROM ${table}`).first<{ n: number | null }>())?.n ?? 0
}
async function seedSearch(n: number) {
  await h.db.prepare('INSERT INTO free_daily_quota (email,day,family,count,updated_at) VALUES (?1,?2,?3,?4,0)')
    .bind(EMAIL, new Date().toISOString().slice(0, 10), 'web-search', n).run()
}
describe('paid Search fan-out and free-offer refusal', () => {
  it.each(['free','trial'])('refuses %s even with a full legacy search allowance', async plan => {
    await h.db.prepare('UPDATE subscriptions SET plan_type=?1').bind(plan).run()
    await seedSearch(14)
    const res = await invoke(search, request('search/web', { query: 'test', sources, maxResults: 5, verifyUrls: true }))
    expect(res.status).toBe(403); expect(calls).toEqual([]); expect(await used('free_daily_quota')).toBe(14)
  })
  it.each([false,true])('paid search retains bounded source/redirect verification=%s', async verifyUrls => {
    const res = await invoke(search, request('search/web', { query: 'test', sources, redirectUrls: redirects, verifyUrls }))
    expect(res.status).toBe(200); expect(calls).toHaveLength(verifyUrls ? 41 : 6)
    expect(await used('free_daily_quota')).toBe(0)
  })
  it('keeps standard verified search at six provider attempts', async () => {
    const res = await invoke(search, request('search/web', { query: 'test', verifyUrls: true }))
    expect(res.status).toBe(200); expect(calls).toHaveLength(6); expect(await used('free_daily_quota')).toBe(0)
  })
  it('does not apply the legacy free quota to a subscription', async () => {
    await seedSearch(50)
    const res = await invoke(search, request('search/web', { query: 'test', sources, verifyUrls: true }))
    expect(res.status).toBe(200); expect(calls).toHaveLength(36); expect(await used('free_daily_quota')).toBe(50)
  })
  it('normalizes maxResults and bounds duplicate sources actually executed', async () => {
    const res = await invoke(search, request('search/web', { query: 'test', sources: [sources[0],sources[0]], maxResults: 1.9, verifyUrls: true }))
    expect(res.status).toBe(200); expect(calls).toHaveLength(4); expect(await used('free_daily_quota')).toBe(0)
  })
})

describe('actual memory extraction input admission', () => {
  it.each([{ body: null }, { body: [] }, { body: 5 }, { body: 'bad' }])('rejects a non-object before quota/provider: $body', async ({ body }) => {
    const res = await invoke(extract, request('ai/memory-extract', body))
    expect(res.status).toBe(400); expect(calls).toEqual([]); expect(await used('bg_quota')).toBe(0)
  })
  it('does not consume a quota for an empty/short transcript', async () => {
    const res = await invoke(extract, request('ai/memory-extract', { transcript: 'merci' }))
    expect(await res.json()).toEqual({ add: [], replace: [] })
    expect(calls).toEqual([]); expect(await used('bg_quota')).toBe(0)
  })
  it('rejects malformed JSON before quota/provider', async () => {
    const req = new Request('https://tryarty.com/api/ai/memory-extract', { method: 'POST',
      headers: { 'x-google-token': 'synthetic-token' }, body: '{' })
    expect((await invoke(extract, req)).status).toBe(400)
    expect(calls).toEqual([]); expect(await used('bg_quota')).toBe(0)
  })
  it.each([0, 1])('enforces the exact byte boundary with extra %s byte', async extra => {
    const json = JSON.stringify({ transcript: 'a'.repeat(100), facts: [] })
    const req = new Request('https://tryarty.com/api/ai/memory-extract', { method: 'POST',
      headers: { 'x-google-token': 'synthetic-token' }, body: json + ' '.repeat(262144 - json.length + extra) })
    expect((await invoke(extract, req)).status).toBe(extra ? 413 : 200)
    expect(calls).toHaveLength(extra ? 0 : 1); expect(await used('bg_quota')).toBe(extra ? 0 : 1)
  })
  it.each([undefined, '1'])('rejects actual chunked bytes above 256 KiB with length %s', async length => {
    const bytes = new TextEncoder().encode(JSON.stringify({ transcript: 'x'.repeat(262144) }))
    let offset = 0
    const stream = new ReadableStream<Uint8Array>({ pull(controller) {
      if (offset >= bytes.length) { controller.close(); return }
      const end = Math.min(offset + 16384, bytes.length); controller.enqueue(bytes.slice(offset, end)); offset = end
    } })
    const req = new Request('https://tryarty.com/api/ai/memory-extract', { method: 'POST', headers: {
      'x-google-token': 'synthetic-token', ...(length ? { 'content-length': length } : {}),
    }, body: stream, duplex: 'half' } as RequestInit)
    const res = await invoke(extract, req)
    expect(res.status).toBe(413); expect(calls).toEqual([]); expect(await used('bg_quota')).toBe(0)
  })
  it('drops an oversized ID rather than truncating it into another identity', async () => {
    const id64 = 'lm-' + 'x'.repeat(61), id65 = id64 + 'z'
    const res = await invoke(extract, request('ai/memory-extract', { transcript: 'a'.repeat(100), facts: [
      { id: id64, content: 'accepted' }, { id: id65, content: 'should-not-appear' },
    ] }))
    expect(res.status).toBe(200); expect(prompts[0]).toContain(`[${id64}] accepted`)
    expect(prompts[0]).not.toContain('should-not-appear'); expect(prompts[0]).not.toContain(id65)
  })
  it('bounds repeated short facts and ignores empty and malformed facts', async () => {
    const facts = [...Array.from({ length: 200 }, (_, i) => ({ id: `lm-empty-${i}`, content: '' })),
      null, { id: 'not-an-id', content: 'bad' },
      ...Array.from({ length: 81 }, (_, i) => ({ id: `lm-${i}`, content: 'a' }))]
    const res = await invoke(extract, request('ai/memory-extract', { transcript: 'a'.repeat(100), facts }))
    expect(res.status).toBe(200); expect(prompts[0]).not.toContain('lm-empty')
    expect(prompts[0].match(/\[lm-\d+\]/g)).toHaveLength(80)
    expect(prompts[0]).not.toContain('[lm-80]')
  })
  it('keeps normal 80-fact Unicode input and the existing transcript prefix', async () => {
    const facts = Array.from({ length: 80 }, (_, i) => ({ id: `lm-${i}`, content: '中文😀'.repeat(10) }))
    const transcript = '👋こんにちは'.repeat(1200)
    const res = await invoke(extract, request('ai/memory-extract', { transcript, facts }))
    expect(res.status).toBe(200); expect(prompts[0].match(/\[lm-\d+\]/g)).toHaveLength(80)
    const [factsPart, transcriptPart] = prompts[0].split("\n\nMESSAGES RÉCENTS DE L'UTILISATEUR :\n")
    expect(new TextEncoder().encode(factsPart).length).toBeLessThanOrEqual(32768)
    expect(transcriptPart).toBe(transcript.slice(0, 6000)); expect(await used('bg_quota')).toBe(1)
  })
  it('preserves the 5000-unit content boundary, including a surrogate cut', async () => {
    const content = 'a'.repeat(199) + '😀'
    const res = await invoke(extract, request('ai/memory-extract', { transcript: 'a'.repeat(100),
      facts: Array.from({ length: 26 }, (_, i) => ({ id: `lm-${i}`, content })) }))
    expect(res.status).toBe(200)
    const factsPart = prompts[0].split("\n\nMESSAGES RÉCENTS DE L'UTILISATEUR :\n")[0]
    expect(factsPart.match(/\[lm-\d+\]/g)).toHaveLength(25)
    expect(factsPart).toContain('[lm-24] ' + content.slice(0, 200))
    expect(factsPart).not.toContain('[lm-25]')
    expect(new TextEncoder().encode(factsPart).length).toBeLessThanOrEqual(32768)
  })
})
