import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetCalendarFixture } from '../helpers/calendarFixture'
import type { Conversation } from '../../types'
const state = vi.hoisted(() => ({ provider: 'claude' }))
vi.mock('../../services/apiBase', () => ({ apiUrl: (path: string) => path }))
vi.mock('../../services/activeApiKey', () => ({ getOpenAIKey: () => 'synthetic', getActiveApiKey: () => 'synthetic', getGeminiKey: () => null }))
vi.mock('../../services/aiHttp', () => ({ buildAiHeaders: vi.fn(async () => ({ 'x-google-token': 'synthetic' })) }))
vi.mock('../../services/storage', async original => ({ ...await original<typeof import('../../services/storage')>(), getConversations: vi.fn(), getConversation: vi.fn(), saveConversation: vi.fn(), isCacheReady: () => true }))
vi.mock('../../services/anthropicClient', () => ({ streamMessage: vi.fn(() => new AbortController()) }))
vi.mock('../../services/geminiClient', () => ({ streamGeminiMessage: vi.fn(() => new AbortController()), geminiResearch: vi.fn(async () => '') }))
vi.mock('../../services/mistralClient', () => ({ streamMistralMessage: vi.fn(() => new AbortController()) }))
vi.mock('../../services/openaiClient', () => ({ sendMessageStream: vi.fn(() => new AbortController()) }))
vi.mock('../../services/autoMemory', () => ({ maybeExtractMemory: vi.fn() }))
vi.mock('../../services/pdfUrlFetch', () => ({ fetchPdfMarkdowns: vi.fn(async () => ''), fetchUrlMarkdowns: vi.fn(async () => ({ block: '', unreadable: [] })) }))
vi.mock('../../services/factChecker', () => ({ clearSearchContext: vi.fn(), getFactCheckMode: () => 'off', runFactCheckOnLatest: vi.fn() }))
vi.mock('../../services/taskService', () => ({ detectSuggestedTasks: () => [], addTask: vi.fn() }))
vi.mock('../../services/reminderService', () => ({ detectReminderIntent: () => null, createReminder: vi.fn() }))
vi.mock('../../services/router/notifyRouteOverrides', () => ({ notifyRouteOverrides: vi.fn() }))
vi.mock('../../services/router/gatherRouteInput', async original => ({
  ...await original<typeof import('../../services/router/gatherRouteInput')>(),
  gatherRouteInput: (ctx: object) => ({ ...ctx, selectedModel: state.provider, availability: { claude: true, mistral: true, gemini: true, openai: true }, plan: { plan: 'vip', isPro: false, creditsCoverPremium: false }, reflectionLevel: 'auto' }),
}))
import * as storage from '../../services/storage'
import { invalidateActiveSessionWork } from '../../services/userSession'
import { streamMessage } from '../../services/anthropicClient'
import { streamGeminiMessage } from '../../services/geminiClient'
import { streamMistralMessage } from '../../services/mistralClient'
import { sendMessageStream } from '../../services/openaiClient'
import { useConversation } from '../../hooks/useConversation'
const url = 'https://vm.tiktok.com/ZN8jJBpVS/'
const observation = '00:12 — exemple observé. https://youtu.be/abcdefghijk'
const response = () => Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: observation }] } }] }, { headers: { 'x-arty-model-used': 'gemini-3.8-flash' } })
let conv: Conversation
beforeEach(async () => {
  await resetCalendarFixture(); vi.clearAllMocks(); state.provider = 'claude'
  conv = { id: 'video-chat', title: 'Synthetic', messages: [], createdAt: 1, updatedAt: 1 }
  vi.mocked(storage.getConversations).mockImplementation(() => [conv])
  vi.mocked(storage.getConversation).mockImplementation(() => conv)
  vi.mocked(storage.saveConversation).mockImplementation(saved => { conv = saved })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
function setup() { const hook = renderHook(() => useConversation()); act(() => hook.result.current.selectConversation(conv.id)); return hook }
describe('TikTok in a real conversation hook, simulated providers', () => {
  it.each(['claude', 'gemini', 'mistral', 'openai'])('keeps %s selected and supplies saved observations', async provider => {
    state.provider = provider
    const network = vi.fn(async () => response()); vi.stubGlobal('fetch', network)
    const hook = setup()
    await act(async () => { await hook.result.current.sendMessage(url, conv.id) })
    expect(conv.messages[0]).toMatchObject({ content: url, videoAnalysis: { text: observation, model: 'gemini-3.8-flash' } })
    const client = { claude: streamMessage, gemini: streamGeminiMessage, mistral: streamMistralMessage, openai: sendMessageStream }[provider]!
    expect(client).toHaveBeenCalledOnce()
    expect(JSON.stringify(vi.mocked(client).mock.calls[0]![0])).toContain(observation)
    expect(network).toHaveBeenCalledOnce()
    if (provider === 'gemini') expect(vi.mocked(streamGeminiMessage).mock.calls[0]![4]?.videoSourceText).toBe(url)
    act(() => hook.result.current.stopStreaming())
  })
  it('reuses saved observations for follow-up and retry without paying for another analysis', async () => {
    const network = vi.fn(async () => response()); vi.stubGlobal('fetch', network)
    const hook = setup()
    await act(async () => { await hook.result.current.sendMessage(url, conv.id) })
    act(() => hook.result.current.stopStreaming())
    act(() => hook.result.current.retryLastUserMessage())
    await vi.waitFor(() => expect(streamMessage).toHaveBeenCalledTimes(2))
    expect(network).toHaveBeenCalledOnce()
    expect(conv.messages[0]!.videoAnalysis?.text).toBe(observation)
    act(() => hook.result.current.stopStreaming())
    await act(async () => { await hook.result.current.sendMessage('Et à douze secondes ?', conv.id) })
    expect(JSON.stringify(vi.mocked(streamMessage).mock.calls[2]![0])).toContain(observation)
    expect(network).toHaveBeenCalledOnce()
    act(() => hook.result.current.stopStreaming())
  })
  it('keeps the video analysis when retry creates a branch to preserve a generated image', async () => {
    const network = vi.fn(async () => response()); vi.stubGlobal('fetch', network)
    conv.messages = [
      { id: 'u1', role: 'user', content: url, timestamp: 1, videoAnalysis: { url, text: observation, model: 'gemini-3.8-flash', analyzedAt: 1 } },
      { id: 'a1', role: 'assistant', content: '', timestamp: 2, generatedImages: ['12345678-1234-1234-1234-123456789abc'] },
    ]
    const originalId = conv.id
    const hook = setup()
    act(() => hook.result.current.retryMessage('a1'))
    await vi.waitFor(() => expect(streamMessage).toHaveBeenCalledOnce())
    expect(conv.id).not.toBe(originalId)
    expect(conv.messages[0]!.videoAnalysis?.text).toBe(observation)
    expect(network).not.toHaveBeenCalled()
    act(() => hook.result.current.stopStreaming())
  })
  it.each(['stop', 'session'])('does not persist or generate after %s during video analysis', async kind => {
    let release!: (response: Response) => void; let signal: AbortSignal | undefined
    vi.stubGlobal('fetch', vi.fn((_url, init) => { signal = init.signal; return new Promise<Response>(resolve => { release = resolve }) }))
    const hook = setup(); let sending!: Promise<boolean>
    act(() => { sending = hook.result.current.sendMessage(url, conv.id) })
    await vi.waitFor(() => expect(signal).toBeDefined())
    act(() => { if (kind === 'stop') hook.result.current.stopStreaming(); else invalidateActiveSessionWork() })
    if (kind === 'stop') expect(signal!.aborted).toBe(true)
    await act(async () => { release(response()); await sending })
    expect(conv.messages.every(m => !m.videoAnalysis)).toBe(true)
    expect(streamMessage).not.toHaveBeenCalled()
    act(() => hook.result.current.stopStreaming())
  })
  it('fails explicitly before model generation when the video is refused or Europe-only', async () => {
    const network = vi.fn(async () => Response.json({ error: 'tiktok_video_unavailable' }, { status: 502 })); vi.stubGlobal('fetch', network)
    const hook = setup()
    await act(async () => { await hook.result.current.sendMessage(url, conv.id) })
    expect(streamMessage).not.toHaveBeenCalled(); expect(hook.result.current.error).toContain('vidéo')
    conv.euOnly = true; network.mockClear()
    await act(async () => { await hook.result.current.sendMessage(url, conv.id) })
    expect(network).not.toHaveBeenCalled(); expect(streamMistralMessage).not.toHaveBeenCalled()
  })
})
