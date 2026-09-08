import { describe, expect, it } from 'vitest'
import { createAnthropicSubsidizedUsageParser as parser } from '../../../functions/api/_lib/anthropicSubsidizedUsage'

const contract = { model: 'claude-haiku-4-5-20251001', maxOutputTokens: 2000, maxSearches: 1 }
const initial = () => ({ input_tokens: 100, output_tokens: 1, cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0, server_tool_use: { web_search_requests: 0 } })
const final = () => ({ input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 200,
  cache_creation_input_tokens: 300, cache_creation: { ephemeral_5m_input_tokens: 100, ephemeral_1h_input_tokens: 200 },
  server_tool_use: { web_search_requests: 1 } })
const message = () => ({ id: 'msg_synthetic', model: contract.model, type: 'message', role: 'assistant',
  stop_reason: 'end_turn', content: [{ type: 'text', text: 'synthetic' }], usage: final() })
const frame = (p: unknown) => `data: ${JSON.stringify(p)}\n\n`
const frames = () => [
  { type: 'message_start', message: { ...message(), stop_reason: null, content: [], usage: initial() } },
  { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'synthetic' } },
  { type: 'content_block_stop', index: 0 },
  { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: final() },
  { type: 'message_stop' },
]
function parse(events = frames(), complete = true) {
  const p = parser('sse', contract); p.feed(events.map(frame).join('')); return p.finalize(complete)
}
describe('subsidized cost proof is stricter than analytics', () => {
  it.each(['json', 'sse'] as const)('attests mixed caches and search with %s', format => {
    const p = parser(format, contract)
    const wire = format === 'json' ? JSON.stringify(message(), null, 2) : frames().map(frame).join('').replaceAll('\n', '\r\n')
    for (let i = 0; i < wire.length; i += 7) p.feed(wire.slice(i, i + 7))
    expect(p.finalize(true)).toMatchObject({ costMicroUsd: 12045, inputTokens: 1000, outputTokens: 100,
      cacheReadTokens: 200, cacheWrite5mTokens: 100, cacheWrite1hTokens: 200, searches: 1 })
    expect(p.finalize(true)).toBeNull()
  })
  it('keeps initial input when the final text delta contains only output', () => {
    const p = parser('sse', { ...contract, maxSearches: 0 })
    p.feed(frame({ type: 'message_start', message: { ...message(), stop_reason: null, usage: initial() } }))
    p.feed(frame({ type: 'message_delta', delta: { stop_reason: 'max_tokens' }, usage: { output_tokens: 10 } }))
    p.feed(frame({ type: 'message_stop' }))
    expect(p.finalize(true)?.costMicroUsd).toBe(150)
  })
  it('accepts a completed pause without granting permission for another POST', () => {
    const e = frames(); e[4].delta = { stop_reason: 'pause_turn' }
    expect(parse(e)?.costMicroUsd).toBe(12045)
  })
  it('accepts multiple cumulative deltas and official nullable metadata without rebilling output details', () => {
    const p = parser('sse', contract)
    const e = frames()
    p.feed(e.slice(0, 4).map(frame).join(''))
    p.feed(frame({ type: 'message_delta', delta: { stop_reason: null }, usage: {
      ...final(), output_tokens: 50, output_tokens_details: { thinking_tokens: 20 },
    } }))
    p.feed(frame({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: {
      input_tokens: null, output_tokens: 100, cache_read_input_tokens: null, cache_creation_input_tokens: null,
      cache_creation: null, server_tool_use: null, output_tokens_details: null,
    } }))
    p.feed(frame({ type: 'message_stop' }))
    expect(p.finalize(true)?.costMicroUsd).toBe(12045)
  })
  it('accepts nullable no-cache/no-tools metadata only with explicit zero counters and no search capability', () => {
    const p = parser('json', { ...contract, maxSearches: 0 })
    p.feed(JSON.stringify({ ...message(), usage: { ...initial(), cache_creation: null, server_tool_use: null,
      output_tokens_details: null, service_tier: null, inference_geo: null } }))
    expect(p.finalize(true)?.costMicroUsd).toBe(105)
  })
  it.each(['stop', 'eof', 'error', 'duplicate', 'decrease', 'missing-search', 'unknown-usage', 'cache-mismatch', 'wrong-model'])('retains hold after %s', kind => {
    const e = frames()
    if (kind === 'stop') e.pop()
    if (kind === 'error') e.push({ type: 'error' })
    if (kind === 'duplicate') e.push(e[0])
    if (kind === 'decrease') e[4].usage!.input_tokens = 1
    if (kind === 'missing-search') delete (e[4].usage as Record<string, unknown>).server_tool_use
    if (kind === 'unknown-usage') Object.assign(e[4].usage!, { future_billable_units: 1 })
    if (kind === 'cache-mismatch') e[4].usage!.cache_creation_input_tokens = 301
    if (kind === 'wrong-model') e[0].message!.model = 'claude-opus-4-8'
    expect(parse(e, kind !== 'eof')).toBeNull()
  })
  it.each([-1, 1.1, Number.MAX_SAFE_INTEGER + 1, '2', null])('rejects unsafe usage %s', value => {
    const p = parser('json', contract)
    p.feed(JSON.stringify({ ...message(), usage: { ...final(), output_tokens: value } }))
    expect(p.finalize(true)).toBeNull()
  })
  it.each(['\ndata: {bad}\n\n', '\ndata: {"type":"message_stop"}', '\ndata: \uFFFD\n\n'])('rejects damaged data even after plausible usage', tail => {
    const p = parser('sse', contract); p.feed(frames().map(frame).join('') + tail)
    expect(p.finalize(true)).toBeNull()
  })
  it('does not accept a second JSON message or missing cache detail', () => {
    const p = parser('json', contract); p.feed(JSON.stringify(message()) + JSON.stringify(message()))
    expect(p.finalize(true)).toBeNull()
    const q = parser('json', contract), m = message()
    delete (m.usage as Record<string, unknown>).cache_creation
    q.feed(JSON.stringify(m)); expect(q.finalize(true)).toBeNull()
  })
  it('rounds sub-microUSD costs up once and permits explicitly zero billed searches', () => {
    const p = parser('json', contract)
    p.feed(JSON.stringify({ ...message(), usage: { ...initial(), input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1 } }))
    expect(p.finalize(true)?.costMicroUsd).toBe(1)
  })
})
