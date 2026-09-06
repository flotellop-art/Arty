import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('../../services/activeApiKey', () => ({ getAnthropicKey: () => 'server-provided', getMistralKey: () => null, getGeminiKey: () => null, getOpenAIKey: () => null }))
vi.mock('../../services/conversationCompressor', () => ({ compressIfNeeded: vi.fn() }))
vi.mock('../../services/locationContext', () => ({ buildLocationContext: vi.fn() }))
vi.mock('../../services/costTracker', () => ({ recordUsage: vi.fn() }))
vi.mock('../../services/trialClient', () => ({ updateTrialFromResponse: vi.fn() }))
vi.mock('../../services/googleAuth', () => ({ getValidAccessToken: vi.fn(async () => null), getStoredTokens: () => null, isGoogleStorageReady: () => true }))
vi.mock('../../services/emailTrialClient', () => ({ getTrialToken: () => null }))
vi.mock('../../services/userSession', () => ({ getActiveSession: () => null, getActiveUserId: vi.fn(() => 'a'), getActiveSessionEpoch: vi.fn(() => 1) }))
import { streamMessage } from '../../services/anthropicClient'
import { streamMistralMessage } from '../../services/mistralClient'
import { streamGeminiMessage } from '../../services/geminiClient'
import { sendMessageStream } from '../../services/openaiClient'
import { compressIfNeeded } from '../../services/conversationCompressor'
import { buildLocationContext } from '../../services/locationContext'
import { updateTrialFromResponse } from '../../services/trialClient'
import { getValidAccessToken } from '../../services/googleAuth'
import { getActiveSessionEpoch } from '../../services/userSession'
import type { ModelInvocationOptions, ModelUsedEvent } from '../../services/modelLabels'
const providers = ['claude', 'mistral', 'gemini', 'openai'] as const
type Provider = typeof providers[number]
const models = { claude: 'claude-sonnet-5', mistral: 'mistral-medium-latest', gemini: 'gemini-3.6-flash', openai: 'gpt-5.6-terra' }
function sse(provider: Provider, model?: unknown) {
  const body = provider === 'claude'
    ? [{ type: 'message_start', message: { model, usage: {} } }, { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }, { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello' } }, { type: 'content_block_stop', index: 0 }, { type: 'message_stop' }]
    : provider === 'gemini' ? [{ modelVersion: model, candidates: [{ content: { parts: [{ text: 'Hello' }] }, finishReason: 'STOP' }] }]
      : [{ model, choices: [{ delta: { content: 'Hello' }, finish_reason: 'stop' }] }]
  return body.map(obj => `${provider === 'claude' ? `event: ${(obj as { type: string }).type}\n` : ''}data: ${JSON.stringify(obj)}\n\n`).join('')
}
function start(provider: Provider, options: ModelInvocationOptions, done: () => void, error: (e: Error) => void) {
  const full = { ...options, model: models[provider], systemPrompt: 'NEUTRAL', tools: [], comparisonTextOnly: true, background: true, expectedUserId: 'a', expectedSessionEpoch: 1 }
  const messages = [{ role: 'user', content: 'https://www.youtube.com/watch?v=12345678901 Prix près de chez moi' }]
  if (provider === 'claude') return streamMessage(messages, () => {}, done, error, full)
  if (provider === 'mistral') return streamMistralMessage(messages, () => {}, done, error, full)
  if (provider === 'gemini') return streamGeminiMessage(messages, () => {}, done, error, full)
  return sendMessageStream(messages as Parameters<typeof sendMessageStream>[0], null, () => {}, done, error, full)
}
beforeEach(() => { vi.clearAllMocks(); vi.mocked(getValidAccessToken).mockReset().mockResolvedValue(null); vi.mocked(getActiveSessionEpoch).mockReturnValue(1); vi.spyOn(console, 'log').mockImplementation(() => {}) })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
describe('Real clients, simulated HTTP: text-only and attribution', () => {
  it('Claude rechecks document consent after backoff and blocks a stale retry before a second HTTP call', async () => {
    const fetch = vi.fn(async () => new Response('{}', { status: 503 })); vi.stubGlobal('fetch', fetch)
    const gate = vi.fn(async () => { if (fetch.mock.calls.length) throw new Error('Document scope revoked') })
    const error = await new Promise<Error>(resolve => streamMessage([{ role: 'user', content: 'Document' }], () => {}, () => {}, resolve,
      { documentReadOnly: true, comparisonTextOnly: true, maxOutputTokens: 8192, beforeDocumentRequest: gate }))
    expect(error.message).toBe('Document scope revoked'); expect(gate).toHaveBeenCalledTimes(2); expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('Claude contextual output bound is applied to the real request, with the exact approved prompt', async () => {
    const fetch = vi.fn(async () => new Response(sse('claude', models.claude)))
    vi.stubGlobal('fetch', fetch)
    const gate = vi.fn(async () => {})
    await new Promise<void>((resolve, reject) => streamMessage([{ role: 'user', content: '中文 Document' }], () => {}, resolve, reject,
      { documentReadOnly: true, comparisonTextOnly: true, maxOutputTokens: 8192, systemPrompt: 'APPROVED', model: 'claude-sonnet-5', beforeDocumentRequest: gate }))
    const body = JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)
    expect(body.max_tokens).toBe(8192); expect(body.system[0].text).toBe('APPROVED'); expect(body.tools).toBeUndefined()
    expect(gate).toHaveBeenCalledTimes(1); expect(getValidAccessToken).toHaveBeenCalled()
    expect(gate.mock.invocationCallOrder[0]).toBeGreaterThan(vi.mocked(getValidAccessToken).mock.invocationCallOrder[0]!)
  })
  it.each([0, -1, 8193, 1.5, NaN, Infinity])('Claude rejects invalid output bound %s before auth or HTTP', limit => {
    const error = vi.fn(), fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
    streamMessage([], () => {}, () => {}, error, { documentReadOnly: true, maxOutputTokens: limit })
    expect(error).toHaveBeenCalledExactlyOnceWith(expect.any(Error)); expect(getValidAccessToken).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled()
  })
  it('Claude refuses a bound outside documentary mode, but preserves the absent-option default', async () => {
    const error = vi.fn(), fetch = vi.fn(async () => new Response(sse('claude', models.claude))); vi.stubGlobal('fetch', fetch)
    streamMessage([], () => {}, () => {}, error, { maxOutputTokens: 8192 })
    expect(error).toHaveBeenCalledTimes(1); expect(fetch).not.toHaveBeenCalled(); expect(getValidAccessToken).not.toHaveBeenCalled()
    await new Promise<void>((resolve, reject) => start('claude', {}, resolve, reject))
    expect(JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string).max_tokens).toBe(65536)
  })
  it.each(providers)('%s preserves requested model when the provider reports a substitution', async provider => {
    const substituted = { claude: 'claude-haiku-4-5-20251001', mistral: 'mistral-medium-2505', gemini: 'gemini-3.5-flash', openai: 'gpt-5' }[provider]
    vi.stubGlobal('fetch', vi.fn(async () => new Response(sse(provider, substituted))))
    const onModelUsed = vi.fn()
    await new Promise<void>((resolve, reject) => start(provider, { onModelUsed }, resolve, reject))
    expect(onModelUsed.mock.calls.at(-1)?.[0]).toMatchObject({ model: substituted, requestedModel: models[provider], source: 'provider' })
  })
  it.each(providers)('%s sends neutral text and confirms the identical provider ID', async provider => {
    const fetch = vi.fn(async () => new Response(sse(provider, models[provider])))
    vi.stubGlobal('fetch', fetch); const onModelUsed = vi.fn()
    await new Promise<void>((resolve, reject) => start(provider, { onModelUsed }, resolve, reject))
    const body = JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)
    expect(body.tools).toBeUndefined()
    expect(JSON.stringify(body)).not.toContain('fileData')
    const system = body.system?.[0]?.text ?? body.systemInstruction?.parts?.[0]?.text ?? body.messages?.[0]?.content
    expect(system).toBe('NEUTRAL')
    expect(buildLocationContext).not.toHaveBeenCalled(); expect(compressIfNeeded).not.toHaveBeenCalled()
    expect(onModelUsed.mock.calls.at(-1)?.[0]).toMatchObject({ model: models[provider], requestedModel: models[provider], source: 'provider' })
  })
  it.each(providers)('%s never confirms a missing model or malformed metadata', async provider => {
    const fetch = vi.fn(async () => new Response(sse(provider, { invalid: true })))
    vi.stubGlobal('fetch', fetch); const onModelUsed = vi.fn()
    await new Promise<void>((resolve, reject) => start(provider, { onModelUsed }, resolve, reject))
    expect(onModelUsed.mock.calls.map(c => c[0].source)).toEqual(['requested'])
  })
  it('Gemini header is proxy provenance only, absent on HTTP error', async () => {
    for (const status of [200, 403]) {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(status === 200 ? sse('gemini') : '{}', { status, headers: { 'x-arty-model-used': 'gemini-3.5-flash' } })))
      const events: ModelUsedEvent[] = []
      await new Promise<void>(resolve => start('gemini', { onModelUsed: e => events.push(e) }, resolve, () => resolve()))
      expect(events.map(e => e.source)).toEqual(status === 200 ? ['requested', 'proxy'] : ['requested'])
    }
  })
  it.each(providers)('%s switch after fetch never writes the new account trial counter', async provider => {
    let release!: (r: Response) => void
    const fetch = vi.fn(() => new Promise<Response>(resolve => { release = resolve }))
    vi.stubGlobal('fetch', fetch)
    const done = vi.fn(), error = vi.fn()
    start(provider, { assertRequestCurrent: () => { if (getActiveSessionEpoch() !== 1) throw new Error('stale') } }, done, error)
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    vi.mocked(getActiveSessionEpoch).mockReturnValue(2)
    release(new Response(sse(provider, models[provider]), { headers: { 'x-trial-remaining': '7' } }))
    await vi.waitFor(() => expect(done.mock.calls.length + error.mock.calls.length).toBeGreaterThan(0))
    expect(updateTrialFromResponse).not.toHaveBeenCalled()
  })
  it.each(providers)('%s Stop during auth prevents a fetch', async provider => {
    let release!: (t: null) => void
    vi.mocked(getValidAccessToken).mockReturnValueOnce(new Promise(r => { release = r }))
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
    const controller = start(provider, {}, () => {}, () => {})
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    controller.abort(); release(null)
    await new Promise(r => setTimeout(r, 10))
    expect(fetch).not.toHaveBeenCalled()
  })
})
