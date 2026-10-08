import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { streamMessage } from '../../services/anthropicClient'
import { recordUsage } from '../../services/costTracker'

vi.mock('../../services/apiBase', () => ({ apiUrl: (path: string) => path }))
vi.mock('../../services/aiHttp', async original => ({
  ...await original<typeof import('../../services/aiHttp')>(),
  buildAiHeaders: vi.fn(async () => ({ 'Content-Type': 'application/json' })),
}))
vi.mock('../../services/conversationCompressor', () => ({ compressIfNeeded: vi.fn(async messages => messages) }))
vi.mock('../../services/locationContext', () => ({ buildLocationContext: vi.fn(async () => '') }))
vi.mock('../../services/costTracker', () => ({ recordUsage: vi.fn() }))
vi.mock('../../services/factChecker', () => ({ setSearchContext: vi.fn() }))

function response(blocks: Array<Record<string, unknown>>, stopReason = 'end_turn') {
  const events: Array<Record<string, unknown>> = [{ type: 'message_start', message: { model: 'claude-haiku-5-5', usage: { input_tokens: 10 } } }]
  blocks.forEach((block, index) => {
    events.push({ type: 'content_block_start', index, content_block: block })
    if (block.type === 'thinking') events.push({ type: 'content_block_delta', index, delta: { type: 'signature_delta', signature: block.signature } })
    if (block.type === 'text') events.push({ type: 'content_block_delta', index, delta: { type: 'text_delta', text: block.text } })
    if (block.type === 'tool_use' || block.type === 'server_tool_use') events.push({ type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } })
    events.push({ type: 'content_block_stop', index })
  })
  events.push({ type: 'message_delta', delta: { stop_reason: stopReason }, usage: { output_tokens: 5 } }, { type: 'message_stop' })
  return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''))
}
const options = { model: 'claude-haiku-5-5' }
const bodies = () => vi.mocked(fetch).mock.calls.map(call => JSON.parse(call[1]!.body as string))
function send(extra: Parameters<typeof streamMessage>[4] = options) {
  const onToken = vi.fn(), onDone = vi.fn(), onError = vi.fn()
  const completed = new Promise<void>(resolve => streamMessage([{ role: 'user', content: 'Analyse ce document.' }], onToken,
    () => { onDone(); resolve() }, error => { onError(error); resolve() }, extra, 'synthetic'))
  return { completed, onToken, onDone, onError }
}
beforeEach(() => { vi.clearAllMocks(); localStorage.clear() })
afterEach(() => vi.unstubAllGlobals())

describe('Haiku 5.5 provider contract, simulated HTTP', () => {
  it('continues pause_turn with the full assistant and no fabricated user message', async () => {
    const paused = [{ type: 'thinking', thinking: '', signature: 'paused-signature' },
      { type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'synthetic' } }]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response(paused, 'pause_turn'))
      .mockResolvedValueOnce(response([{ type: 'text', text: 'Final.' }])))
    const run = send(); await run.completed
    expect(run.onDone).toHaveBeenCalledOnce(); expect(run.onError).not.toHaveBeenCalled()
    expect(bodies()[1].messages).toHaveLength(2)
    expect(bodies()[1].messages[1]).toEqual({ role: 'assistant', content: paused })
  })
  it('reports incomplete after bounded repeated server pauses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response([{ type: 'text', text: '' }], 'pause_turn')))
    const run = send(); await run.completed
    expect(fetch).toHaveBeenCalledTimes(30)
    expect(run.onDone).not.toHaveBeenCalled(); expect(run.onError).toHaveBeenCalledOnce()
  })
  it.each([false, true])('sets fast Sonnet explicitly and omits thinking on Haiku=%s', async haiku => {
    vi.stubGlobal('fetch', vi.fn(async () => response([{ type: 'text', text: 'Réponse.' }])))
    const run = send({ routeDecision: { subModel: haiku ? 'claude-haiku-4-5-20251001' : 'claude-haiku-5-5',
      thinking: { enabled: false, effort: null, budget: 0 } } as NonNullable<Parameters<typeof streamMessage>[4]>['routeDecision'] })
    await run.completed
    expect(run.onError).not.toHaveBeenCalled()
    if (haiku) {
      expect(bodies()[0].thinking).toBeUndefined(); expect(bodies()[0].output_config).toBeUndefined()
      expect(bodies()[0].temperature).toBe(0.7)
    } else {
      expect(bodies()[0].thinking).toEqual({ type: 'adaptive' })
      expect(bodies()[0].output_config).toEqual({ effort: 'low' })
    }
  })
  it.each([options, { ...options, documentReadOnly: true, maxOutputTokens: 2048 }, { ...options, comparisonTextOnly: true }])('bounds thinking in forced/restricted calls %j', async config => {
    vi.stubGlobal('fetch', vi.fn(async () => response([{ type: 'text', text: 'Réponse.' }])))
    const run = send(config); await run.completed
    expect(run.onError).not.toHaveBeenCalled()
    const body = bodies()[0]
    expect(body.model).toBe('claude-haiku-5-5')
    expect(body.thinking).toEqual({ type: 'adaptive' })
    expect(body.output_config).toEqual({ effort: 'low' })
    for (const key of ['temperature', 'top_p', 'top_k', 'tool_choice']) expect(body).not.toHaveProperty(key)
    if ('documentReadOnly' in config || 'comparisonTextOnly' in config) expect(body).not.toHaveProperty('tools')
  })
  it('keeps adaptive reasoning omitted for deep chat', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response([{ type: 'thinking', thinking: '', signature: 'signed' }, { type: 'text', text: 'Réponse.' }])))
    const run = send({ routeDecision: { subModel: 'claude-haiku-5-5', thinking: { enabled: true, effort: 'high', budget: 16000 } } as NonNullable<Parameters<typeof streamMessage>[4]>['routeDecision'] })
    await run.completed
    expect(run.onError).not.toHaveBeenCalled()
    expect(bodies()[0].thinking).toEqual({ type: 'adaptive' })
    expect(bodies()[0].output_config).toEqual({ effort: 'low' })
    expect(run.onToken.mock.calls.flat().join('')).toBe('Réponse.')
  })
  it('preserves signed empty thinking and append-only prefixes over three calls', async () => {
    const tool = vi.fn(async () => ({ result: 'Tool result' }))
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(response([{ type: 'thinking', thinking: '', signature: 'signature-1' }, { type: 'tool_use', id: 't1', name: 'synthetic', input: { n: 1 } }], 'tool_use'))
      .mockResolvedValueOnce(response([{ type: 'thinking', thinking: '', signature: 'signature-2' }, { type: 'tool_use', id: 't2', name: 'synthetic', input: { n: 2 } }], 'tool_use'))
      .mockResolvedValueOnce(response([{ type: 'text', text: 'Terminé.' }])))
    const run = send({ ...options, onToolCall: tool }); await run.completed
    expect(run.onError).not.toHaveBeenCalled(); expect(tool).toHaveBeenCalledTimes(2)
    const sent = bodies()
    const stripCache = (value: unknown) => JSON.parse(JSON.stringify(value, (key, v) => key === 'cache_control' ? undefined : v))
    for (let i = 1; i < sent.length; i++) {
      expect(stripCache(sent[i].messages.slice(0, sent[i - 1].messages.length))).toEqual(stripCache(sent[i - 1].messages))
      expect(sent[i].system).toEqual(sent[0].system); expect(sent[i].tools).toEqual(sent[0].tools)
      expect(sent[i].thinking).toEqual(sent[0].thinking); expect(sent[i].output_config).toEqual(sent[0].output_config)
    }
    expect(sent[2].messages[1].content[0]).toEqual({ type: 'thinking', thinking: '', signature: 'signature-1' })
    expect(sent[2].messages[3].content[0]).toEqual({ type: 'thinking', thinking: '', signature: 'signature-2' })
  })
  it.each(['refusal', 'max_tokens', 'model_context_window_exceeded'])('signals %s before executing tools', async stop => {
    const tool = vi.fn()
    vi.stubGlobal('fetch', vi.fn(async () => response(stop === 'refusal' ? [] : [{ type: 'tool_use', id: 't', name: 'synthetic', input: {} }], stop)))
    const run = send({ ...options, onToolCall: tool }); await run.completed
    expect(run.onDone).not.toHaveBeenCalled(); expect(run.onError).toHaveBeenCalledOnce(); expect(tool).not.toHaveBeenCalled()
    expect(recordUsage).toHaveBeenCalledWith('claude-haiku-5-5', 10, 5, 10)
  })
  it('identifies a refusal after partial text without calling done or tools', async () => {
    const tool = vi.fn()
    vi.stubGlobal('fetch', vi.fn(async () => response([{ type: 'text', text: 'PARTIAL REFUSED TEXT' }], 'refusal')))
    const run = send({ ...options, onToolCall: tool }); await run.completed
    expect(run.onToken).toHaveBeenCalledWith('PARTIAL REFUSED TEXT')
    expect(run.onError.mock.calls[0]![0].name).toBe('ModelRefusalError')
    expect(run.onDone).not.toHaveBeenCalled(); expect(tool).not.toHaveBeenCalled()
  })
})
