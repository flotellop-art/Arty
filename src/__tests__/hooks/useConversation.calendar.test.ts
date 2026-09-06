import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { created, relinkCalendarGoogle, resetCalendarFixture, syntheticEvent } from '../helpers/calendarFixture'
import type { Conversation } from '../../types'
vi.mock('../../services/apiBase', () => ({ apiUrl: (path: string) => path }))
vi.mock('../../services/activeApiKey', () => ({ getOpenAIKey: () => 'synthetic-key', getActiveApiKey: () => 'synthetic-key' }))
vi.mock('../../services/storage', async original => ({ ...await original<typeof import('../../services/storage')>(), getConversations: vi.fn(), getConversation: vi.fn(), saveConversation: vi.fn(), isCacheReady: () => true }))
vi.mock('../../services/anthropicClient', () => ({ streamMessage: vi.fn(() => new AbortController()) }))
vi.mock('../../services/autoMemory', () => ({ maybeExtractMemory: vi.fn() }))
vi.mock('../../services/pdfUrlFetch', () => ({ fetchPdfMarkdowns: vi.fn(async () => ''), fetchUrlMarkdowns: vi.fn(async () => ({ block: '', unreadable: [] })) }))
vi.mock('../../services/factChecker', () => ({ clearSearchContext: vi.fn(), getFactCheckMode: () => 'off', runFactCheckOnLatest: vi.fn() }))
vi.mock('../../services/taskService', () => ({ detectSuggestedTasks: () => [], addTask: vi.fn() }))
vi.mock('../../services/reminderService', () => ({ detectReminderIntent: () => null, createReminder: vi.fn() }))
vi.mock('../../services/router/notifyRouteOverrides', () => ({ notifyRouteOverrides: vi.fn() }))
vi.mock('../../services/router/gatherRouteInput', async original => ({
  ...await original<typeof import('../../services/router/gatherRouteInput')>(),
  gatherRouteInput: (ctx: object) => ({ ...ctx, selectedModel: 'claude', availability: { claude: true, mistral: true, gemini: true, openai: true }, plan: { plan: 'vip', isPro: false, creditsCoverPremium: false }, reflectionLevel: 'auto' }),
}))
import * as storage from '../../services/storage'
import { streamMessage } from '../../services/anthropicClient'
import { useConversation } from '../../hooks/useConversation'
import { createToolExecutor } from '../../services/toolExecutor'
import { fetchPdfMarkdowns } from '../../services/pdfUrlFetch'
import { deferred } from '../helpers/workspaceLocks'
let conv: Conversation
beforeEach(async () => {
  await resetCalendarFixture(); vi.clearAllMocks()
  conv = { id: 'calendar-conversation', title: 'Synthetic', messages: [], createdAt: 1, updatedAt: 1 }
  vi.mocked(storage.getConversations).mockImplementation(() => [conv])
  vi.mocked(storage.getConversation).mockImplementation(() => conv)
  vi.mocked(storage.saveConversation).mockImplementation(saved => { conv = saved })
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
const input = { title: 'Synthetic', start: '2026-08-13T09:00', end: '2026-08-13T10:00' }
function setup() {
  const hook = renderHook(() => useConversation())
  const executor = createToolExecutor({} as never, {} as never)
  act(() => { hook.result.current.selectConversation(conv.id); hook.result.current.setToolHandler(executor) })
  return hook
}
describe('Calendar turn authority — real hook/dispatcher/handler/crypto, simulated providers', () => {
  it('passes a local captured scope through the real dispatcher and confirms a single mutation', async () => {
    const fetcher = vi.fn(async () => created()); vi.stubGlobal('fetch', fetcher)
    const hook = setup()
    await act(async () => { await hook.result.current.sendMessage('Crée un rendez-vous', conv.id) })
    const options = vi.mocked(streamMessage).mock.calls[0]![4]!
    await act(async () => { expect((await options.onToolCall!('create_calendar_event', input)).result).toContain('confirmée') })
    expect(fetcher).toHaveBeenCalledOnce()
    expect(JSON.parse(fetcher.mock.calls[0][1].body).calendarAccount).toBe('a@example.invalid')
    act(() => hook.result.current.stopStreaming())
  })
  it('does not recapture B after an async URL preparation started for A', async () => {
    const gate = deferred<string>()
    vi.mocked(fetchPdfMarkdowns).mockReturnValueOnce(gate.promise)
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    const hook = setup()
    let sending!: Promise<boolean>
    act(() => { sending = hook.result.current.sendMessage('Lis https://example.invalid/source.pdf puis crée un rendez-vous', conv.id) })
    await vi.waitFor(() => expect(fetchPdfMarkdowns).toHaveBeenCalled())
    await act(async () => relinkCalendarGoogle('b'))
    await act(async () => { gate.resolve(''); await sending })
    const options = vi.mocked(streamMessage).mock.calls[0]?.[4]
    if (options) await act(async () => { await expect(options.onToolCall!('create_calendar_event', input)).rejects.toThrow() })
    expect(fetcher).not.toHaveBeenCalled()
    act(() => hook.result.current.stopStreaming())
  })
  it('blocks the next provider request after a Calendar result loses its grant', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ events: [syntheticEvent] })))
    const hook = setup()
    await act(async () => { await hook.result.current.sendMessage('Mon agenda ?', conv.id) })
    const options = vi.mocked(streamMessage).mock.calls[0]![4]!
    await act(async () => { await options.onToolCall!('list_calendar', {}) })
    await options.beforeDocumentRequest!()
    await act(async () => relinkCalendarGoogle('b'))
    expect(options.assertRequestCurrent).toThrow()
    await expect(options.beforeDocumentRequest!()).rejects.toThrow()
    act(() => hook.result.current.stopStreaming())
  })
  it('Stop prevents a pending tool from dispatching Calendar', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    const hook = setup()
    await act(async () => { await hook.result.current.sendMessage('Agenda', conv.id) })
    const options = vi.mocked(streamMessage).mock.calls[0]![4]!
    act(() => hook.result.current.stopStreaming())
    await expect(options.onToolCall!('create_calendar_event', input)).rejects.toThrow()
    expect(fetcher).not.toHaveBeenCalled()
  })
})
