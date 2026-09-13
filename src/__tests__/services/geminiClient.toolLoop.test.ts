import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ owner: 'A', epoch: 1 }))
vi.mock('../../services/userSession', () => ({ getActiveUserId: () => state.owner, getActiveSessionEpoch: () => state.epoch }))
vi.mock('../../services/aiHttp', () => ({ buildAiHeaders: async () => ({}), fetchWithTimeout: (url: string, init: RequestInit, _: number, signal: AbortSignal) => fetch(url, { ...init, signal }) }))
vi.mock('../../services/aiEntitlementReceipt', () => ({ captureAiEntitlementReceipt: () => ({ updateTrial() {}, error: () => null }) }))
vi.mock('../../services/activeApiKey', () => ({ getGeminiKey: () => 'test-key' }))
vi.mock('../../services/locationContext', () => ({ buildLocationContext: async () => '' }))
vi.mock('../../services/costTracker', () => ({ recordUsage: vi.fn() }))
vi.mock('../../services/factChecker', () => ({ setSearchContext: vi.fn() }))
vi.mock('../../services/toolDefinitions', () => ({ TOOLS: ['ask_user', 'read_memory', 'update_memory', 'list_calendar'].map(name => ({ name, description: 'Test function', input_schema: { type: 'object', properties: {} } })) }))

import { streamGeminiMessage } from '../../services/geminiClient'

const fetchMock = vi.fn()
beforeEach(() => { vi.stubGlobal('fetch', fetchMock); fetchMock.mockReset(); state.owner = 'A'; state.epoch = 1 })
afterEach(() => vi.unstubAllGlobals())
function response(parts: unknown[], finish = 'STOP', trailing: unknown[] = []) {
  const chunks = [{ candidates: [{ content: { role: 'model', parts }, finishReason: finish }], modelVersion: 'gemini-3.8-flash' }, ...trailing]
  // Last SSE line has no newline: must still preserve its signature.
  return new Response(chunks.map(chunk => `data: ${JSON.stringify(chunk)}`).join('\n\n'))
}
type Options = NonNullable<Parameters<typeof streamGeminiMessage>[4]>
function start(options: Options = {}) {
  let text = ''
  const done = vi.fn(), error = vi.fn()
  const controller = streamGeminiMessage([{ role: 'user', content: 'Lis ma mémoire' }], token => { text += token }, done, error,
    { model: 'gemini-3.8-flash', ...options })
  return { controller, done, error, text: () => text }
}
function body(index: number) { return JSON.parse(fetchMock.mock.calls[index][1].body) }

describe('Gemini portable tool loop', () => {
  it('preserves parallel calls, opaque signatures and native history, then groups all results', async () => {
    const parts = [
      { thought: true, text: 'hidden thought' },
      { toolCall: { toolType: 'GOOGLE_SEARCH', args: { query: 'public' } } },
      { toolResponse: { toolType: 'GOOGLE_SEARCH', response: {} } },
      { functionCall: { name: 'ask_user', args: {}, id: 'one' }, thoughtSignature: 'opaque-first' },
      { functionCall: { name: 'ask_user', args: {}, id: 'two' } },
    ]
    const signature = { text: '', thoughtSignature: 'opaque-last' }
    fetchMock.mockResolvedValueOnce(response(parts, 'STOP', [{ candidates: [{ content: { parts: [signature] } }] }]))
      .mockResolvedValueOnce(response([{ text: 'Fini' }, { text: ' !' }]))
    const handler = vi.fn(async () => ({ result: 'Réponse utilisateur' }))
    const run = start({ onToolCall: handler, webSearch: true })
    await vi.waitFor(() => expect(run.done).toHaveBeenCalledTimes(1))
    expect(run.error).not.toHaveBeenCalled()
    expect(run.text()).toBe('Fini !')
    expect(handler).toHaveBeenCalledTimes(2)
    expect(body(0).toolConfig).toEqual({ includeServerSideToolInvocations: true, functionCallingConfig: { mode: 'VALIDATED' } })
    expect(body(1).contents.at(-2)).toEqual({ role: 'model', parts: [...parts, signature] })
    expect(body(1).contents.at(-1).parts.map((part: any) => part.functionResponse.id)).toEqual(['one', 'two'])
  })

  it('personal tools disable every native public tool and reject an invented search call', async () => {
    fetchMock.mockResolvedValueOnce(response([{ functionCall: { name: 'read_memory', args: {}, id: 'one' }, thoughtSignature: 's' }]))
      .mockResolvedValueOnce(response([{ functionCall: { name: 'web_search', args: { query: 'private' }, id: 'two' }, thoughtSignature: 't' }]))
      .mockResolvedValueOnce(response([{ text: 'Données privées conservées' }]))
    const handler = vi.fn(async () => ({ result: 'private data' }))
    const run = start({ onToolCall: handler, personalTools: true, webSearch: true })
    await vi.waitFor(() => expect(run.done).toHaveBeenCalledOnce())
    expect(handler).toHaveBeenCalledTimes(1)
    for (let i = 0; i < 3; i++) {
      expect(body(i).tools).toHaveLength(1)
      expect(body(i).tools[0].functionDeclarations.map((tool: any) => tool.name)).toContain('read_memory')
      expect(body(i).toolConfig).toBeUndefined()
    }
    expect(body(2).contents.at(-1).parts[0].functionResponse.response.result).toContain('indisponible')
  })

  it.each(['MAX_TOKENS', ''])('does not execute an incomplete function batch (%s)', async finish => {
    fetchMock.mockResolvedValueOnce(response([{ functionCall: { name: 'update_memory', args: {} } }], finish))
    const handler = vi.fn()
    const run = start({ onToolCall: handler, personalTools: true })
    await vi.waitFor(() => expect(run.error).toHaveBeenCalledOnce())
    expect(handler).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it.each(['stop', 'account'])('halts between two writes on %s', async cause => {
    fetchMock.mockResolvedValueOnce(response([
      { functionCall: { name: 'update_memory', args: { data: 1 }, id: 'one' }, thoughtSignature: 's' },
      { functionCall: { name: 'update_memory', args: { data: 2 }, id: 'two' } },
    ]))
    let release!: () => void
    const handler = vi.fn(() => new Promise<{ result: string }>(resolve => { release = () => resolve({ result: 'write done' }) }))
    const run = start({ onToolCall: handler, personalTools: true })
    await vi.waitFor(() => expect(handler).toHaveBeenCalledOnce())
    if (cause === 'stop') run.controller.abort()
    else { state.owner = 'B'; state.epoch++ }
    release()
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(handler).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(run.done).not.toHaveBeenCalled()
  })

  it('rejects invalid arguments and repeated write ids without effects', async () => {
    fetchMock.mockResolvedValueOnce(response([{ functionCall: { name: 'update_memory', args: [], id: 'one' }, thoughtSignature: 's' }]))
      .mockResolvedValueOnce(response([{ functionCall: { name: 'update_memory', args: {}, id: 'one' }, thoughtSignature: 't' }]))
      .mockResolvedValueOnce(response([{ text: 'Aucune action' }]))
    const handler = vi.fn()
    const run = start({ onToolCall: handler, personalTools: true })
    await vi.waitFor(() => expect(run.done).toHaveBeenCalledOnce())
    expect(handler).not.toHaveBeenCalled()
  })

  it('keeps the text comparator tool-free even with a handler', async () => {
    fetchMock.mockResolvedValueOnce(response([{ text: 'Texte' }]))
    const run = start({ comparisonTextOnly: true, personalTools: true, onToolCall: vi.fn(), tools: [] })
    await vi.waitFor(() => expect(run.done).toHaveBeenCalledOnce())
    expect(body(0).tools).toBeUndefined()
  })

  it('surfaces a quota denial on the second request without retrying a write', async () => {
    fetchMock.mockResolvedValueOnce(response([{ functionCall: { name: 'update_memory', args: {}, id: 'one' }, thoughtSignature: 's' }]))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'premium_cap_reached', bucket: 'gemini', cap: 100 }), { status: 429 }))
    const handler = vi.fn(async () => ({ result: 'saved' }))
    const run = start({ onToolCall: handler, personalTools: true })
    await vi.waitFor(() => expect(run.error).toHaveBeenCalledOnce())
    expect(run.error.mock.calls[0][0].message).toBe('premium_cap_reached')
    expect(handler).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
