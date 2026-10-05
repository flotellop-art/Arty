import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetCalendarFixture } from '../helpers/calendarFixture'
import type { Conversation } from '../../types'
import type { HybridResearchContext } from '../../services/hybridResearchContext'
vi.mock('../../services/activeApiKey', () => ({ getOpenAIKey: () => 'synthetic', getActiveApiKey: () => 'synthetic', getGeminiKey: () => 'synthetic' }))
vi.mock('../../services/storage', async original => ({ ...await original<typeof import('../../services/storage')>(), getConversations: vi.fn(), getConversation: vi.fn(), saveConversation: vi.fn(), isCacheReady: () => true }))
vi.mock('../../services/anthropicClient', () => ({ streamMessage: vi.fn(() => new AbortController()) }))
vi.mock('../../services/geminiClient', () => ({ streamGeminiMessage: vi.fn(() => new AbortController()), geminiResearch: vi.fn() }))
vi.mock('../../services/autoMemory', () => ({ maybeExtractMemory: vi.fn() }))
vi.mock('../../services/pdfUrlFetch', () => ({ fetchPdfMarkdowns: vi.fn(async () => ''), fetchUrlMarkdowns: vi.fn(async () => ({ block: '', unreadable: [] })) }))
vi.mock('../../services/factChecker', () => ({ clearSearchContext: vi.fn(), getFactCheckMode: () => 'off', runFactCheckOnLatest: vi.fn() }))
vi.mock('../../services/taskService', () => ({ detectSuggestedTasks: () => [], addTask: vi.fn() }))
vi.mock('../../services/reminderService', () => ({ detectReminderIntent: () => null, createReminder: vi.fn() }))
vi.mock('../../services/router/notifyRouteOverrides', () => ({ notifyRouteOverrides: vi.fn() }))
vi.mock('../../services/router/gatherRouteInput', async original => ({
  ...await original<typeof import('../../services/router/gatherRouteInput')>(),
  gatherRouteInput: (ctx: object) => ({ ...ctx, selectedModel: 'auto', availability: { claude: true, mistral: true, gemini: true, openai: true }, plan: { plan: 'vip', isPro: true, creditsCoverPremium: false }, reflectionLevel: 'auto' }),
}))
import * as storage from '../../services/storage'
import { invalidateActiveSessionWork } from '../../services/userSession'
import { streamMessage } from '../../services/anthropicClient'
import { geminiResearch } from '../../services/geminiClient'
import { useConversation } from '../../hooks/useConversation'
const question = "Décris et analyse les données actuelles sur l'inégalité salariale entre hommes et femmes en France, en incluant les chiffres officiels, les causes principales et les évolutions récentes."
const research: HybridResearchContext = { summary: 'RESEARCH_SYNTHETIC', sources: [{ url: 'https://example.invalid/source', title: 'Synthetic' }] }
let conv: Conversation
beforeEach(async () => {
  await resetCalendarFixture(); vi.clearAllMocks()
  conv = { id: 'hybrid-chat', title: 'Synthetic', messages: [], createdAt: 1, updatedAt: 1 }
  vi.mocked(storage.getConversations).mockImplementation(() => [conv])
  vi.mocked(storage.getConversation).mockImplementation(() => conv)
  vi.mocked(storage.saveConversation).mockImplementation(saved => { conv = saved })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })
function setup() { const hook = renderHook(() => useConversation()); act(() => hook.result.current.selectConversation(conv.id)); return hook }
describe('actual user prompt through hybrid routing, simulated providers', () => {
  it.each([research, null])('keeps user text and sends application research separately (%j)', async context => {
    vi.mocked(geminiResearch).mockResolvedValue(context)
    const hook = setup()
    await act(async () => { await hook.result.current.sendMessage(question, conv.id) })
    await vi.waitFor(() => expect(streamMessage).toHaveBeenCalledOnce())
    expect(geminiResearch).toHaveBeenCalledWith(question, undefined, expect.any(String), conv.id, expect.any(Function))
    const call = vi.mocked(streamMessage).mock.calls[0]!
    expect(call[0].at(-1)).toEqual({ role: 'user', content: question })
    expect(call[4]?.hybridResearch).toEqual(context)
    expect(call[4]?.routeDecision).toMatchObject({ provider: 'hybrid', needsHybrid: true, webSearch: true })
    expect(conv.messages[0]?.content).toBe(question)
    expect(JSON.stringify(conv)).not.toContain(research.summary)
    act(() => hook.result.current.stopStreaming())
  })
  it.each(['stop', 'session'])('does not launch Claude after %s during research', async kind => {
    let release!: (value: HybridResearchContext) => void
    vi.mocked(geminiResearch).mockImplementation(() => new Promise(resolve => { release = resolve }))
    const hook = setup()
    await act(async () => { await hook.result.current.sendMessage(question, conv.id) })
    expect(geminiResearch).toHaveBeenCalledOnce()
    act(() => { if (kind === 'stop') hook.result.current.stopStreaming(); else invalidateActiveSessionWork() })
    await act(async () => { release(research) })
    expect(streamMessage).not.toHaveBeenCalled()
    act(() => hook.result.current.stopStreaming())
  })
})
