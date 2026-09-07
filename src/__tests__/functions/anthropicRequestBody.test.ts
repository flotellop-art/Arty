// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { ANTHROPIC_BODY_MAX_BYTES as MAX, ANTHROPIC_BODY_MAX_DEPTH as DEPTH,
  ANTHROPIC_BODY_MAX_TOKENS as TOKENS, readAnthropicRequestBody } from '../../../functions/api/_lib/anthropicRequestBody'

const bytes = (s: string) => new TextEncoder().encode(s)
function request(chunks: Array<string | Uint8Array>, headers?: HeadersInit) {
  let index = 0
  return new Request('https://tryarty.com/api/ai/proxy', { method: 'POST', headers,
    body: new ReadableStream<Uint8Array>({ pull(c) {
      if (index === chunks.length) { c.close(); return }
      const chunk = chunks[index++]
      c.enqueue(typeof chunk === 'string' ? bytes(chunk) : chunk)
    } }), duplex: 'half' } as RequestInit)
}
async function refused(chunks: Array<string | Uint8Array>, status = 400, headers?: HeadersInit) {
  const result = await readAnthropicRequestBody(request(chunks, headers))
  expect(result.ok).toBe(false)
  if (result.ok) throw new Error('unexpected acceptance')
  expect(result.response.status).toBe(status)
  expect(result.response.headers.get('cache-control')).toBe('no-store')
  return result.response.json()
}

describe('Anthropic request transport preflight', () => {
  it.each(['', 'null', '[]', 'true', '42', '"hello"', '{', '{"a":}', '{"a":1,}', '{"a":[1,]}', '{}{}', '{}junk'])('rejects invalid root/syntax %s', async raw => {
    await refused([raw])
  })
  it.each(['{}', 'junk', '"next"', '\u0000'])('drains true EOF and rejects late suffix %s', async suffix => {
    await refused(['{}', ' \r\n\t', suffix])
  })
  it.each(['{"__proto__":{"model":"other"}}', '{"\\u005f_proto__":{}}', '{"a":1,"a":2}',
    '{"a":{"x":1,"\\u0078":2}}', '{"x":1e999}', '{"x":-1e999}'])('refuses ambiguous DOM input %s', async raw => {
    await refused([raw])
    expect(({} as Record<string, unknown>).model).toBeUndefined()
  })
  it.each(['{"x":"\\ud800"}', '{"x":"\\udc00"}', '{"x":"\\ud800A"}',
    '{"text":"\\ud800","next":"\\udc00"}', '{"x":"\\ud800\\u1234"}'])('refuses orphan escaped surrogates %s', async raw => {
    await refused([...raw])
  })
  it.each(['{"x":"\\ud83d\\ude03"}', '{"x":"\\\\ud800"}', '{"x":"日本語 😃 é \\n \\u0000"}',
    '{"a":1,"b":-0.01,"c":1e3,"constructor":{"prototype":"ordinary data"}}'])('preserves accepted native JSON semantics %s', async raw => {
    const input = bytes(raw)
    const result = await readAnthropicRequestBody(request([...input].map(n => new Uint8Array([n]))))
    expect(result).toEqual({ ok: true, body: JSON.parse(raw) })
  })
  it('refuses invalid and incomplete UTF-8 without replacement', async () => {
    await refused([bytes('{"x":"'), new Uint8Array([0xff]), bytes('"}')])
    await refused([bytes('{"x":"'), new Uint8Array([0xe2, 0x82])])
  })
  it('accepts separate same-named keys, escapes, cache and tool JSON', async () => {
    const body = { model: 'claude-haiku-4-5-20251001', max_tokens: 64000, stream: true,
      system: [{ type: 'text', text: 'Bonjour 日本語', cache_control: { type: 'ephemeral' } }],
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 },
        { name: 'custom', input_schema: { type: 'object', properties: { x: { type: 'string' } } } }],
      messages: [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool-1',
        content: [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'JVBERi0xLjQK' } },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } }] }] }] }
    expect(await readAnthropicRequestBody(request([JSON.stringify(body)]))).toEqual({ ok: true, body })
  })
  it('accepts exactly the byte ceiling, including whitespace after a completed root', async () => {
    const raw = '{"text":"' + 'a'.repeat(MAX - 13) + '"}  '
    expect(bytes(raw).byteLength).toBe(MAX)
    const result = await readAnthropicRequestBody(request([raw]))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.body.text).toHaveLength(MAX - 13)
  }, 30_000)
  it.each([undefined, '1'])('rejects real excess with declared length %s', async length => {
    await refused(['{}', new Uint8Array(MAX - 1).fill(32)], 413,
      length ? { 'content-length': length } : undefined)
  })
  it('rejects announced excess without reading', async () => {
    await refused(['{}'], 413, { 'content-length': String(MAX + 1) })
  })
  it('bounds depth and dense structures even in a single source chunk', async () => {
    const atLimit = '{"x":' + '['.repeat(DEPTH - 1) + '0' + ']'.repeat(DEPTH - 1) + '}'
    expect((await readAnthropicRequestBody(request([atLimit]))).ok).toBe(true)
    await refused(['{"x":' + '['.repeat(DEPTH) + '0' + ']'.repeat(DEPTH) + '}'], 413)
    await refused(['{"x":[' + '0,'.repeat(TOKENS) + '0]}'], 413)
    await refused(['{"x":0.' + '0'.repeat(100_000) + '1}'], 413)
  })
  it('does not accept a completed root while EOF is still pending', async () => {
    let source!: ReadableStreamDefaultController<Uint8Array>
    const controller = new AbortController(), cancel = vi.fn()
    const req = new Request('https://tryarty.com/api/ai/proxy', { method: 'POST', signal: controller.signal,
      body: new ReadableStream<Uint8Array>({ start(c) { source = c; c.enqueue(bytes('{}')) }, cancel }),
      duplex: 'half' } as RequestInit)
    let completed = false
    const pending = readAnthropicRequestBody(req).then(r => { completed = true; return r })
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(completed).toBe(false)
    controller.abort()
    expect((await pending).ok).toBe(false)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(cancel).toHaveBeenCalledOnce()
    expect(source).toBeDefined()
  })
  it('rejects an already cancelled request and read failures', async () => {
    const controller = new AbortController(); controller.abort()
    const req = new Request('https://tryarty.com', { method: 'POST', body: '{}', signal: controller.signal })
    expect((await readAnthropicRequestBody(req)).ok).toBe(false)
    const failed = new Request('https://tryarty.com', { method: 'POST', body: new ReadableStream({ start(c) { c.error(new Error('synthetic')) } }), duplex: 'half' } as RequestInit)
    expect((await readAnthropicRequestBody(failed)).ok).toBe(false)
  })
})
