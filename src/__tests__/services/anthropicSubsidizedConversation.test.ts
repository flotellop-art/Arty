import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('../../services/aiHttp', async original => ({
  ...await original<typeof import('../../services/aiHttp')>(),
  buildAiHeaders: async (options: { extra?: Record<string, string> }) => ({ ...options.extra, 'content-type': 'application/json', 'x-google-token': 'synthetic',
    'anthropic-version': '2023-06-01', 'anthropic-beta': 'pdfs-2024-09-25,prompt-caching-2024-07-31' }),
}))
vi.mock('../../services/locationContext', () => ({ buildLocationContext: async () => '' }))
import { streamMessage } from '../../services/anthropicClient'
import { qualifyAnthropicSubsidizedRequest } from '../../../functions/api/_lib/anthropicSubsidizedRequest'
import { alignBodyWithServedModel } from '../../../functions/api/ai/proxy'
import { setActiveSession } from '../../services/userSession'
import { setTrialRemaining, getTrialRemaining } from '../../services/trialClient'
import i18n from '../../i18n'

const model = 'claude-haiku-4-5-20251001'
const search = { type: 'web_search_20250305', name: 'web_search', max_uses: 5 }
const encrypted = 'synthetic-encrypted-content+/='
const event = (type: string, data: Record<string, unknown>) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`
function streamBody(stop: string, id: string) {
  return [
    event('message_start', { message: { model, usage: { input_tokens: 10, output_tokens: 0 } } }),
    event('content_block_start', { index: 0, content_block: { type: 'server_tool_use', id, name: 'web_search' } }),
    event('content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json: '{"query":"synthetic"}' } }),
    event('content_block_stop', { index: 0 }),
    event('content_block_start', { index: 1, content_block: { type: 'web_search_tool_result', tool_use_id: id,
      content: [{ type: 'web_search_result', url: 'https://example.test/source', title: 'Synthetic source', encrypted_content: encrypted }] } }),
    event('content_block_stop', { index: 1 }),
    event('content_block_start', { index: 2, content_block: { type: 'text' } }),
    event('content_block_delta', { index: 2, delta: { type: 'text_delta', text: stop === 'pause_turn' ? 'Recherche…' : 'Résultat sourcé.' } }),
    event('content_block_stop', { index: 2 }),
    event('message_delta', { delta: { stop_reason: stop }, usage: { output_tokens: 10 } }),
    event('message_stop', {}),
  ].join('')
}
function response(stop: string, id: string, funding: string | null = 'v1:free') {
  return new Response(streamBody(stop, id), { headers: { 'content-type': 'text/event-stream',
    ...(funding ? { 'x-arty-funding': funding } : {}) } })
}
beforeEach(async () => {
  localStorage.clear(); setActiveSession({ userId: 'synthetic-budget-user', authMethod: 'google', displayName: 'Test', createdAt: 0 })
  setTrialRemaining(17); await i18n.changeLanguage('fr')
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('real native-search client continuation against the closed request contract', () => {
  it.each(['missing', 'invalid'])('does not retry an initial error with %s funding evidence', async kind => {
    const http = vi.fn(async () => Response.json({ error: 'AI service error' }, {
      status: 502, headers: kind === 'invalid' ? { 'x-arty-funding': 'v2:free' } : {},
    }))
    vi.stubGlobal('fetch', http)
    let finish!: (value: string | Error) => void
    const completed = new Promise<string | Error>(resolve => { finish = resolve })
    const onDone = vi.fn(() => finish('done'))
    streamMessage([{ role: 'user', content: 'Synthetic research' }], () => {}, onDone, finish,
      { model, tools: [search] }, 'server-provided')
    expect(await completed).toBeInstanceOf(Error)
    expect(http).toHaveBeenCalledOnce(); expect(onDone).not.toHaveBeenCalled()
  })
  it.each(['stable', 'changed', 'missing-success'])('binds a retry to the first error receipt: %s', async scenario => {
    vi.useFakeTimers()
    try {
      const http = vi.fn(async () => http.mock.calls.length === 1
        ? Response.json({ error: 'AI service error' }, { status: 529, headers: { 'x-arty-funding': 'v1:free' } })
        : response('end_turn', 'final', scenario === 'stable' ? 'v1:free' : scenario === 'changed' ? 'v1:wallet' : null))
      vi.stubGlobal('fetch', http)
      let finish!: (value: string | Error) => void
      const completed = new Promise<string | Error>(resolve => { finish = resolve })
      const onDone = vi.fn(() => finish('done')), onToken = vi.fn()
      streamMessage([{ role: 'user', content: 'Synthetic research' }], onToken, onDone, finish,
        { model, tools: [search] }, 'server-provided')
      await vi.advanceTimersByTimeAsync(2000)
      const result = await completed
      expect(http).toHaveBeenCalledTimes(2)
      const retry = http.mock.calls[1] as unknown as [string, RequestInit]
      expect(retry[0]).toMatch(/\/api\/ai\/anthropic-continue-v1$/)
      expect(new Headers(retry[1].headers).get('x-arty-require-funding')).toBe('v1:free')
      if (scenario === 'stable') { expect(result).toBe('done'); expect(onDone).toHaveBeenCalledOnce() }
      else { expect(result).toBeInstanceOf(Error); expect(onDone).not.toHaveBeenCalled(); expect(onToken).not.toHaveBeenCalled() }
    } finally { vi.useRealTimers() }
  })
  it('limits retries and pauses together to 30 HTTP attempts before any final client tool', async () => {
    vi.useFakeTimers()
    try {
      let calls = 0
      const http = vi.fn(async () => {
        calls++
        if (calls % 2) return Response.json({ error: 'AI service error' }, { status: 529, headers: { 'x-arty-funding': 'v1:free' } })
        if (calls < 30) return response('pause_turn', `s${calls}`)
        return new Response(event('message_start', { message: { model } })
          + event('content_block_start', { index: 0, content_block: { type: 'tool_use', id: 'last', name: 'local', input: {} } })
          + event('content_block_stop', { index: 0 }) + event('message_delta', { delta: { stop_reason: 'tool_use' } })
          + event('message_stop', {}), { headers: { 'x-arty-funding': 'v1:free' } })
      })
      vi.stubGlobal('fetch', http)
      let finish!: (value: string | Error) => void
      const completed = new Promise<string | Error>(resolve => { finish = resolve })
      const onDone = vi.fn(() => finish('done')), onToolCall = vi.fn(async () => ({ result: 'must not run' }))
      streamMessage([{ role: 'user', content: 'Synthetic research' }], () => {}, onDone, finish,
        { model, tools: [search, { name: 'local', input_schema: { type: 'object' } }], onToolCall }, 'server-provided')
      await vi.advanceTimersByTimeAsync(60000)
      expect(await completed).toBeInstanceOf(Error)
      expect(calls).toBe(30); expect(onToolCall).not.toHaveBeenCalled(); expect(onDone).not.toHaveBeenCalled()
    } finally { vi.useRealTimers() }
  })
  it('does not prepare documents again after Stop during retry backoff', async () => {
    vi.useFakeTimers()
    try {
      const http = vi.fn(async () => Response.json({ error: 'AI service error' }, { status: 529, headers: { 'x-arty-funding': 'v1:free' } }))
      vi.stubGlobal('fetch', http)
      const onDone = vi.fn(), onError = vi.fn(), beforeDocumentRequest = vi.fn(async () => {})
      const controller = streamMessage([{ role: 'user', content: 'Synthetic research' }], () => {}, onDone, onError,
        { model, tools: [search], beforeDocumentRequest }, 'server-provided')
      await vi.advanceTimersByTimeAsync(1000)
      expect(http).toHaveBeenCalledOnce()
      controller.abort()
      await vi.advanceTimersByTimeAsync(10000)
      expect(http).toHaveBeenCalledOnce(); expect(beforeDocumentRequest).toHaveBeenCalledOnce()
      expect(onDone).not.toHaveBeenCalled(); expect(onError).not.toHaveBeenCalled()
    } finally { vi.useRealTimers() }
  })
  it.each(['web_search', 'web_fetch'])('continues a deferred %s result without requiring a new native call', async name => {
    const definition = name === 'web_search' ? search : { type: 'web_fetch_20260209', name }
    const nativeCall = { type: 'server_tool_use', id: 'deferred', name, input: name === 'web_search'
      ? { query: 'synthetic' } : { url: 'https://example.test/source' } }
    const nativeResult = { type: `${name}_tool_result`, tool_use_id: 'deferred', content: name === 'web_search'
      ? [{ type: 'web_search_result', url: 'https://example.test/source', title: 'Synthetic', encrypted_content: encrypted }]
      : { type: 'web_fetch_result', url: 'https://example.test/source', retrieved_at: '2026-09-08T00:00:00Z',
        content: { type: 'document', source: { type: 'text', media_type: 'text/plain', data: 'Synthetic document' }, title: 'Synthetic' } } }
    const requests: Record<string, unknown>[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      requests.push(JSON.parse(init.body))
      const content = requests.length === 1 ? nativeCall : requests.length === 2 ? nativeResult : { type: 'text', text: 'Finished' }
      return new Response(event('message_start', { message: { model: 'claude-sonnet-5' } })
        + event('content_block_start', { index: 0, content_block: content }) + event('content_block_stop', { index: 0 })
        + event('message_delta', { delta: { stop_reason: requests.length < 3 ? 'pause_turn' : 'end_turn' } })
        + event('message_stop', {}), { headers: { 'x-arty-funding': 'v1:byok' } })
    }))
    let finish!: (result: string | Error) => void
    const completed = new Promise<string | Error>(resolve => { finish = resolve })
    const onDone = vi.fn(() => finish('done')), onToolCall = vi.fn(async () => ({ result: 'forbidden' }))
    streamMessage([{ role: 'user', content: 'Synthetic research' }], () => {}, onDone, finish,
      { model: 'claude-sonnet-5', tools: [definition], onToolCall }, 'synthetic-byok')
    expect(await completed).toBe('done'); expect(onDone).toHaveBeenCalledOnce(); expect(onToolCall).not.toHaveBeenCalled()
    expect(requests).toHaveLength(3)
    expect((requests[2].messages as unknown[]).slice(1)).toEqual([
      { role: 'assistant', content: [nativeCall] }, { role: 'assistant', content: [nativeResult] },
    ])
    expect(requests[2].tools).toEqual(requests[0].tools)
  })
  it.each(['funded', 'exhausted'])('preserves native state through pause_turn then %s admission', async outcome => {
    const bodies: Record<string, unknown>[] = [], onToken = vi.fn(), onToolCall = vi.fn(async () => ({ result: 'must not run' }))
    const http = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(alignBodyWithServedModel(init!.body as string, model))
      bodies.push(body)
      if (bodies.length === 1) return response('pause_turn', 's1')
      if (outcome === 'exhausted') return Response.json({ error: 'subsidized_budget_exhausted' }, { status: 503 })
      return response('end_turn', 's2')
    })
    vi.stubGlobal('fetch', http)
    let done!: () => void, failed!: (error: Error) => void
    const result = new Promise<'done' | Error>(resolve => { done = () => resolve('done'); failed = resolve })
    const onDone = vi.fn(done), onError = vi.fn(failed)
    streamMessage([{ role: 'user', content: 'Recherche synthétique' }], onToken, onDone, onError,
      { model, tools: [search], onToolCall }, 'server-provided')
    const final = await result
    expect(http).toHaveBeenCalledTimes(2)
    for (const [url, init] of http.mock.calls) {
      expect(qualifyAnthropicSubsidizedRequest(JSON.parse(alignBodyWithServedModel(init!.body as string, model)), Object.fromEntries(new Headers(init!.headers)))).not.toBeNull()
      expect(String(url)).toMatch(/\/api\/ai\/(proxy|anthropic-continue-v1)$/)
    }
    expect(String(http.mock.calls[0][0])).toContain('/api/ai/proxy')
    expect(String(http.mock.calls[1][0])).toContain('/api/ai/anthropic-continue-v1')
    expect(new Headers(http.mock.calls[1][1]!.headers).get('x-arty-require-funding')).toBe('v1:free')
    expect(JSON.stringify(bodies[1].messages)).toContain(encrypted)
    expect(bodies[1].tools).toEqual(bodies[0].tools)
    expect(onToolCall).not.toHaveBeenCalled(); expect(getTrialRemaining()).toBe(17)
    if (outcome === 'funded') {
      expect(final).toBe('done'); expect(onDone).toHaveBeenCalledOnce(); expect(onError).not.toHaveBeenCalled()
      expect(onToken.mock.calls.map(c => c[0]).join('')).toBe('Recherche…Résultat sourcé.')
    } else {
      expect(final).toMatchObject({ name: 'SubsidizedBudgetExhaustedError' })
      expect(onDone).not.toHaveBeenCalled(); expect(onError).toHaveBeenCalledOnce()
    }
  })
  it.each([2, 29, 30])('keeps one history and one global limit through %s pauses, without a client tool handler', async pauses => {
    const requests: Record<string, unknown>[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      requests.push(JSON.parse(init.body))
      return response(requests.length <= pauses ? 'pause_turn' : 'end_turn', `s${requests.length}`)
    }))
    let finish!: (value: string | Error) => void
    const finished = new Promise<string | Error>(resolve => { finish = resolve })
    const onDone = vi.fn(() => finish('done')), onError = vi.fn(finish)
    streamMessage([{ role: 'user', content: 'Ancienne question' }, { role: 'assistant', content: 'Ancienne réponse' },
      { role: 'user', content: 'Recherche synthétique' }], () => {}, onDone, onError, { model, tools: [search] }, 'server-provided')
    const result = await finished
    expect(requests).toHaveLength(Math.min(pauses + 1, 30))
    requests.forEach((req, index) => {
      expect(req.messages).toHaveLength(3 + index)
      const encoded = JSON.stringify(req.messages)
      expect(encoded.split('Ancienne question')).toHaveLength(2)
      expect(encoded.split('Ancienne réponse')).toHaveLength(2)
      for (let previous = 1; previous <= index; previous++) {
        const contents = (req.messages as { content: unknown }[]).slice(3).map(m => m.content) as { id?: string }[][]
        expect(contents.flat().filter(b => b.id === `s${previous}`)).toHaveLength(1)
      }
    })
    if (pauses < 30) { expect(result).toBe('done'); expect(onDone).toHaveBeenCalledOnce(); expect(onError).not.toHaveBeenCalled() }
    else { expect(result).toBeInstanceOf(Error); expect(onDone).not.toHaveBeenCalled(); expect(onError).toHaveBeenCalledOnce() }
  })
  it.each(['document', 'comparison', 'no-tools', 'custom-only', 'unrelated-native', 'unknown-native', 'ambiguous-input',
    'no-funding', 'invalid-funding', 'truncated', 'malformed', 'client-tool'])('does not continue an unauthorized/incomplete %s pause', async kind => {
    const onToolCall = vi.fn(async () => ({ result: 'forbidden' }))
    const http = vi.fn(async () => {
      let text = streamBody('pause_turn', 's1')
      if (kind === 'truncated') text = text.replace(event('message_stop', {}), '')
      if (kind === 'malformed') text = text.replace('{\\"query\\":\\"synthetic\\"}', '{broken')
      if (kind === 'client-tool') text = text.replace('"server_tool_use"', '"tool_use"')
      if (kind === 'ambiguous-input') text = text.replace('"name":"web_search"', '"name":"web_search","input":{"query":"initial","opaque":"kept"}')
      return new Response(text, { headers: kind === 'no-funding' ? {} : { 'x-arty-funding': kind === 'invalid-funding' ? 'v2:free' : 'v1:free' } })
    })
    vi.stubGlobal('fetch', http)
    let finish!: (value: string | Error) => void
    const finished = new Promise<string | Error>(resolve => { finish = resolve })
    const onDone = vi.fn(() => finish('done'))
    streamMessage([{ role: 'user', content: 'Recherche synthétique' }], () => {}, onDone, finish,
      { model, tools: kind === 'no-tools' ? []
        : kind === 'custom-only' ? [{ type: 'custom', name: 'web_search', input_schema: { type: 'object', properties: {} } }]
        : kind === 'unrelated-native' ? [{ type: 'web_fetch_20260209', name: 'web_fetch' }]
        : kind === 'unknown-native' ? [{ type: 'web_search_future', name: 'web_search' }] : [search], onToolCall,
        documentReadOnly: kind === 'document', comparisonTextOnly: kind === 'comparison' }, 'server-provided')
    expect(await finished).toBeInstanceOf(Error)
    expect(http).toHaveBeenCalledOnce(); expect(onDone).not.toHaveBeenCalled(); expect(onToolCall).not.toHaveBeenCalled()
  })
  it.each(['stop', 'owner'])('keeps %s terminal during the final token, without a new POST or late completion', async action => {
    let controller!: AbortController, current = true
    const http = vi.fn(async () => response('pause_turn', 's1')); vi.stubGlobal('fetch', http)
    const onDone = vi.fn(), onError = vi.fn()
    const onToken = vi.fn(() => { if (action === 'stop') controller.abort(); else current = false })
    controller = streamMessage([{ role: 'user', content: 'Recherche synthétique' }], onToken, onDone, onError,
      { model, tools: [search], assertRequestCurrent() { if (!current) throw new DOMException('Owner changed', 'AbortError') } }, 'server-provided')
    await vi.waitFor(() => expect(onToken).toHaveBeenCalledOnce())
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(http).toHaveBeenCalledOnce(); expect(onDone).not.toHaveBeenCalled(); expect(onError).not.toHaveBeenCalled()
  })
  it('does not execute a client tool at the last iteration without capacity for its result', async () => {
    let count = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      if (++count < 30) return response('pause_turn', `s${count}`)
      return new Response(event('message_start', { message: { model } })
        + event('content_block_start', { index: 0, content_block: { type: 'tool_use', id: 'c', name: 'local', input: {} } })
        + event('content_block_stop', { index: 0 }) + event('message_delta', { delta: { stop_reason: 'tool_use' } })
        + event('message_stop', {}), { headers: { 'x-arty-funding': 'v1:free' } })
    }))
    let finish!: (value: string | Error) => void
    const done = new Promise<string | Error>(resolve => { finish = resolve })
    const onDone = vi.fn(() => finish('done')), onToolCall = vi.fn(async () => ({ result: 'must not run' }))
    streamMessage([{ role: 'user', content: 'Recherche synthétique' }], () => {}, onDone, finish,
      { model, tools: [search, { name: 'local', description: 'Synthetic', input_schema: { type: 'object', properties: {} } }], onToolCall }, 'server-provided')
    expect(await done).toBeInstanceOf(Error); expect(count).toBe(30)
    expect(onDone).not.toHaveBeenCalled(); expect(onToolCall).not.toHaveBeenCalled()
  })
  it.each(['missing-route', 'wrong-receipt'])('does not fall back to the unrestricted proxy after %s', async scenario => {
    const urls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async url => {
      urls.push(String(url))
      if (urls.length === 1) return response('pause_turn', 's1')
      return scenario === 'missing-route' ? new Response(null, { status: 404 }) : response('end_turn', 's2', 'v1:wallet')
    }))
    let finish!: (value: string | Error) => void
    const done = new Promise<string | Error>(resolve => { finish = resolve })
    const onDone = vi.fn(() => finish('done')), onToken = vi.fn()
    streamMessage([{ role: 'user', content: 'Recherche synthétique' }], onToken, onDone, finish, { model, tools: [search] }, 'server-provided')
    expect(await done).toBeInstanceOf(Error); expect(urls).toHaveLength(2)
    expect(urls[0]).toMatch(/\/api\/ai\/proxy$/); expect(urls[1]).toMatch(/\/api\/ai\/anthropic-continue-v1$/)
    expect(onDone).not.toHaveBeenCalled(); expect(onToken.mock.calls.flat().join('')).toBe('Recherche…')
  })
})
