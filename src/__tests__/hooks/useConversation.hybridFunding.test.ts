import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetCalendarFixture, google } from '../helpers/calendarFixture'
import type { Conversation } from '../../types'
import i18n from '../../i18n'
vi.mock('../../services/apiBase', () => ({ apiUrl: (path: string) => path }))
vi.mock('../../services/activeApiKey', () => ({ getOpenAIKey: () => null, getGeminiKey: () => null, getActiveApiKey: () => 'server-provided' }))
vi.mock('../../services/storage', async original => ({ ...await original<typeof import('../../services/storage')>(), getConversations: vi.fn(), getConversation: vi.fn(), saveConversation: vi.fn(), isCacheReady: () => true }))
vi.mock('../../services/anthropicClient', () => ({ streamMessage: vi.fn(() => new AbortController()) }))
vi.mock('../../services/autoMemory', () => ({ maybeExtractMemory: vi.fn() }))
vi.mock('../../services/pdfUrlFetch', () => ({ fetchPdfMarkdowns: vi.fn(async () => ''), fetchUrlMarkdowns: vi.fn(async () => ({ block: '', unreadable: [] })) }))
vi.mock('../../services/factChecker', () => ({ clearSearchContext: vi.fn(), setSearchContext: vi.fn(), getFactCheckMode: () => 'off', runFactCheckOnLatest: vi.fn() }))
vi.mock('../../services/taskService', () => ({ detectSuggestedTasks: () => [], addTask: vi.fn() }))
vi.mock('../../services/reminderService', () => ({ detectReminderIntent: () => null, createReminder: vi.fn() }))
vi.mock('../../services/router/notifyRouteOverrides', () => ({ notifyRouteOverrides: vi.fn() }))
vi.mock('../../services/router/gatherRouteInput', async original => ({
  ...await original<typeof import('../../services/router/gatherRouteInput')>(),
  gatherRouteInput: (ctx: object) => ({ ...ctx, selectedModel: 'auto', availability: { claude: true, mistral: true, gemini: true, openai: true }, plan: { plan: 'vip', isPro: false, creditsCoverPremium: false }, reflectionLevel: 'auto' }),
}))
import * as storage from '../../services/storage'
import { streamMessage } from '../../services/anthropicClient'
import { useConversation } from '../../hooks/useConversation'
import { getTrialRemaining, setTrialRemaining } from '../../services/trialClient'
let conv: Conversation
beforeEach(async () => {
  await resetCalendarFixture(); await google.bootstrapGoogleStorage(); vi.clearAllMocks()
  conv = { id: 'hybrid-funding', title: 'Synthetic', messages: [], createdAt: 1, updatedAt: 1 }
  vi.mocked(storage.getConversations).mockImplementation(() => [conv])
  vi.mocked(storage.getConversation).mockImplementation(() => conv)
  vi.mocked(storage.saveConversation).mockImplementation(saved => { conv = saved })
  setTrialRemaining(5)
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('actual hybrid hook and Gemini research, synthetic HTTP, observed Claude dispatch', () => {
  it.each(['trial_expired', 'wallet_reconciliation_pending'])('%s stops the chain before Claude and displays the refusal', async code => {
    const http = vi.fn(async () => Response.json({ error: code }, { status: code === 'trial_expired' ? 403 : 409 }))
    vi.stubGlobal('fetch', http)
    const hook = renderHook(() => useConversation())
    act(() => hook.result.current.selectConversation(conv.id))
    await act(async () => { await hook.result.current.sendMessage('Fais un rapport sur les énergies renouvelables', conv.id) })
    await waitFor(() => expect(hook.result.current.error).toBe(i18n.t(code === 'trial_expired' ? 'trial.expiredError' : 'wallet.reversalError')))
    expect(http.mock.calls.map(call => call[0])).toEqual(['/api/ai/gemini-proxy'])
    expect(streamMessage).not.toHaveBeenCalled()
    expect(getTrialRemaining()).toBe(code === 'trial_expired' ? 0 : 5)
  })
  it('keeps the established optional-research fallback for an ordinary 502', async () => {
    const http = vi.fn(async () => new Response(null, { status: 502 })); vi.stubGlobal('fetch', http)
    const hook = renderHook(() => useConversation())
    act(() => hook.result.current.selectConversation(conv.id))
    await act(async () => { await hook.result.current.sendMessage('Fais un rapport sur les énergies renouvelables', conv.id) })
    await waitFor(() => expect(streamMessage).toHaveBeenCalledOnce())
    expect(http.mock.calls.map(call => call[0])).toEqual(['/api/ai/gemini-proxy'])
    expect(getTrialRemaining()).toBe(5)
    act(() => hook.result.current.stopStreaming())
  })
})
