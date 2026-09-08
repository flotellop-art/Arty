import { describe, expect, it, vi } from 'vitest'
import { parseSSEStream } from '../../services/anthropicClient'

const event = (type: string, data: Record<string, unknown>) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`
const start = event('message_start', { message: { model: 'claude-haiku-4-5-20251001', usage: { input_tokens: 10 } } })
const delta = event('message_delta', { delta: { stop_reason: 'pause_turn' }, usage: { output_tokens: 3 } })
const stop = event('message_stop', {})
const block = (index: number, content_block: Record<string, unknown>) => event('content_block_start', { index, content_block })
const end = (index: number) => event('content_block_stop', { index })
const parse = (body: string) => parseSSEStream(new Response(body), () => {})

describe('native continuation requires lossless, logically complete SSE', () => {
  it.each(['tool_use', 'server_tool_use'])('rejects ambiguous initial input plus streamed input for %s', async type => {
    const initial = { query: 'initial', opaque: 'kept' }
    const result = await parse(start + block(0, { type, id: 's', name: 'web_search', input: initial })
      + event('content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json: '{"query":"next"}' } })
      + end(0) + delta + stop)
    expect(result.replaySafe).toBe(false)
    expect(result.contentBlocks[0]).toMatchObject({ input: initial })
  })
  it.each(['tool_use', 'server_tool_use'])('preserves normal empty initial input plus streamed input for %s', async type => {
    const result = await parse(start + block(0, { type, id: 's', name: 'web_search', input: {} })
      + event('content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json: '{"query":"next"}' } })
      + end(0) + delta + stop)
    expect(result.replaySafe).toBe(true)
    expect(result.contentBlocks[0]).toMatchObject({ input: { query: 'next' } })
  })
  it('preserves complete initial tool input and extra caller fields', async () => {
    const native = { type: 'server_tool_use', id: 's', name: 'web_search', input: { query: 'initial' }, caller: { type: 'direct' } }
    const text = { type: 'text', text: 'Initial text', citations: [{ url: 'https://example.test', custom: 'exact' }] }
    const result = await parse(start + block(0, native) + end(0) + block(1, text) + end(1) + delta + stop)
    expect(result.contentBlocks).toEqual([native, text])
    expect(result).toMatchObject({ stopReason: 'pause_turn', messageStopped: true, replaySafe: true })
  })
  it.each(['truncated', 'malformed-input', 'wrong-index', 'open-block', 'unknown-block', 'invalid-sse', 'unknown-delta'])('never authorizes replay of %s', async kind => {
    const native = block(0, { type: 'server_tool_use', id: 's', name: 'web_search', input: {} })
    const content = kind === 'unknown-block' ? block(0, { type: 'unpriced_extension', secret: 'retain' }) + end(0)
      : kind === 'invalid-sse' ? 'event: content_block_start\ndata: {bad\n\n'
      : native + (kind === 'malformed-input' ? event('content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json: '{broken' } })
        : kind === 'unknown-delta' ? event('content_block_delta', { index: 0, delta: { type: 'future_delta', value: 'lost' } }) : '')
        + (kind === 'open-block' ? '' : end(kind === 'wrong-index' ? 8 : 0))
    const result = await parse(start + content + delta + (kind === 'truncated' ? '' : stop))
    expect(result.stopReason).toBe('pause_turn')
    expect(result.messageStopped && result.replaySafe).toBe(false)
  })
  it.each([{ type: 'server_tool_use', id: 's', name: 'web_search', input: null },
    { type: 'text', text: 42 }, { type: 'thinking', thinking: null, signature: 'signature' }])('does not repair malformed initial fields %j', async initial => {
    expect((await parse(start + block(0, initial) + end(0) + delta + stop)).replaySafe).toBe(false)
  })
  it('rejects invalid UTF-8 instead of replaying replacement characters', async () => {
    const prefix = new TextEncoder().encode(start + 'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":"')
    const suffix = new TextEncoder().encode('"}}\n\n' + end(0) + delta + stop)
    const bytes = new Uint8Array([...prefix, 0xff, ...suffix])
    await expect(parseSSEStream(new Response(bytes), () => {})).rejects.toThrow()
  })
  it('stops callbacks within the same received chunk and does not await pending cancellation', async () => {
    const controller = new AbortController(), cancel = vi.fn(() => new Promise<void>(() => {}))
    const text = start + block(0, { type: 'text', text: '' })
      + event('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'first' } })
      + event('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'forbidden' } }) + end(0) + delta + stop
    const response = new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(text)) }, cancel }))
    const onToken = vi.fn(() => controller.abort())
    await expect(parseSSEStream(response, onToken, 100, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(onToken).toHaveBeenCalledTimes(1); expect(cancel).toHaveBeenCalledOnce()
  }, 1000)
})
