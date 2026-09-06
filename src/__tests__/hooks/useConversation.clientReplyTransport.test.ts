import 'fake-indexeddb/auto'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useConversation } from '../../hooks/useConversation'
import * as storage from '../../services/storage'
import { setActiveSession } from '../../services/userSession'
import { initCrypto } from '../../services/crypto'
import { bootstrapGoogleStorage, resetGoogleMemCache } from '../../services/googleAuth'
import { setActiveKeys } from '../../services/activeApiKey'
import { setTrialToken } from '../../services/emailTrialClient'
import * as calendar from '../../services/calendarClient'
import { clientReplyQuestion, type ClientReplyFields } from '../../services/workflows/clientReply'
vi.mock('../../services/apiBase', () => ({ apiUrl: (path: string) => path }))
let serial = 0
const fields: ClientReplyFields = { request: 'Question du client '.repeat(500).slice(0, 8192), facts: 'Surface : 88 m². '.repeat(600).slice(0, 8192),
  objective: 'Préparer la réponse client.', tone: 'firm', noAdditionalFacts: false }
const resultText = 'Bonjour, la surface est de 88 m². La date reste à confirmer.'
const response = () => new Response([
  { type: 'message_start', message: { id: 'synthetic-response', type: 'message', role: 'assistant', model: 'claude-sonnet-5', content: [], usage: { input_tokens: 80 } } },
  { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: resultText } },
  { type: 'content_block_stop', index: 0 },
  { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 30 } }, { type: 'message_stop' },
].map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } })
beforeEach(async () => {
  vi.restoreAllMocks(); localStorage.clear(); resetGoogleMemCache(); storage.resetConversationMemCache()
  setActiveSession({ userId: `transport-reply-${++serial}`, authMethod: 'email', displayName: 'Synthetic', email: 'synthetic@example.invalid', createdAt: 1 })
  await initCrypto(`synthetic-reply-key-${serial}`); await bootstrapGoogleStorage(); await storage.bootstrapConversationStorage()
  setActiveKeys('synthetic-anthropic-key', undefined, 'synthetic-mistral-key'); setTrialToken('synthetic-email-identity')
  vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
    if (url === '/api/ai/mistral-proxy') return new Response(`data: ${JSON.stringify({ model: 'mistral-medium-latest', choices: [{ delta: { content: resultText } }], usage: { prompt_tokens: 80, completion_tokens: 30 } })}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })
    if (url !== '/api/ai/proxy') throw new Error(`Unexpected endpoint ${String(url)}`)
    return response()
  }))
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
describe('client reply through real shared transport, synthetic HTTP', () => {
  it.each([false, true])('persists full fields+restriction, detached long retry, no Calendar context, reload does not regenerate (EU=%s)', async euOnly => {
    const calendarRead = vi.spyOn(calendar, 'captureCalendarContext'), hook = renderHook(() => useConversation()), controller = new AbortController()
    let pending!: Promise<boolean>, id = ''
    const observation = { settle: vi.fn(), discard: vi.fn() }
    act(() => { pending = hook.result.current.startClientReply({ fields, locale: 'fr', euOnly, signal: controller.signal,
      assertDraft: () => {}, assertAccess: () => {}, review: hook.result.current.projectReview.review, observation,
      onAdopted(value) { id = value; controller.abort() },
    }) })
    await waitFor(() => expect(hook.result.current.projectReview.request?.kind).toBe('confirm'))
    expect(fetch).not.toHaveBeenCalled(); expect(storage.getConversations()).toHaveLength(0)
    const review = hook.result.current.projectReview.request!
    expect(review).toMatchObject({ clientReply: fields, question: clientReplyQuestion(fields, 'fr'), historyMessages: 0 })
    act(() => { hook.result.current.projectReview.answer(review.reviewId, true); hook.result.current.projectReview.answer(review.reviewId, true) })
    await act(async () => expect(await pending).toBe(true))
    await waitFor(() => expect(storage.getConversation(id)?.messages.at(-1)?.content).toBe(resultText))
    expect(fetch).toHaveBeenCalledOnce(); expect(calendarRead).not.toHaveBeenCalled()
    expect(observation.settle).toHaveBeenCalledExactlyOnceWith('saved'); expect(observation.discard).not.toHaveBeenCalled()
    expect(storage.getConversation(id)).toMatchObject({ outputRestriction: 'client-reply-draft-v1', title: fields.objective, hasProjectContext: true })
    expect(storage.getConversation(id)?.projectId).toBeUndefined()
    expect(storage.getConversation(id)?.messages[0]?.content).toBe(clientReplyQuestion(fields, 'fr'))
    await act(async () => expect(await hook.result.current.setConversationProject(id, null)).toBeNull())
    act(() => hook.result.current.retryMessage(storage.getConversation(id)!.messages.at(-1)!.id))
    await waitFor(() => expect(hook.result.current.projectReview.request?.kind).toBe('confirm'))
    const retryReview = hook.result.current.projectReview.request!
    expect(retryReview).toMatchObject({ question: clientReplyQuestion(fields, 'fr'), historyMessages: 0 })
    expect('clientReply' in retryReview).toBe(false) // marker is not a saved invocation
    act(() => hook.result.current.projectReview.answer(retryReview.reviewId, true))
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(storage.getConversation(id)?.messages.at(-1)?.content).toBe(resultText))
    for (const [url, init] of vi.mocked(fetch).mock.calls) {
      expect(url).toBe(euOnly ? '/api/ai/mistral-proxy' : '/api/ai/proxy')
      const payload = JSON.parse(init!.body as string)
      expect(payload.tools ?? []).toEqual([]); expect(JSON.stringify(payload)).toContain(fields.facts)
      expect(JSON.stringify(payload)).toContain('CLIENT REPLY PREPARATION ONLY')
    }
    hook.unmount(); storage.resetConversationMemCache(); await storage.bootstrapConversationStorage()
    const reopened = renderHook(() => useConversation()); act(() => reopened.result.current.selectConversation(id))
    expect(reopened.result.current.activeConversation?.messages.at(-1)?.content).toBe(resultText)
    expect(reopened.result.current.activeConversation?.outputRestriction).toBe('client-reply-draft-v1')
    expect(reopened.result.current.activeConversation?.title).toBe(fields.objective)
    expect(fetch).toHaveBeenCalledTimes(2); expect(calendarRead).not.toHaveBeenCalled()
    expect(observation.settle).toHaveBeenCalledOnce()
  })
  it.each(['cancel', 'stop', 'storage', 'ownerAfterAdoption', 'stopAfterAdoption', 'throwAfterAdoption'] as const)('handles %s without an unauthorized request or false storage failure', async outcome => {
    const hook = renderHook(() => useConversation()), controller = new AbortController(); let pending!: Promise<boolean>, id = ''
    act(() => { pending = hook.result.current.startClientReply({ fields, locale: 'fr', euOnly: false, signal: controller.signal,
      assertDraft: () => {}, assertAccess: () => {}, review: hook.result.current.projectReview.review,
      onAdopted(value) {
        id = value
        if (outcome === 'ownerAfterAdoption') setActiveSession({ userId: 'different-owner', authMethod: 'email', displayName: 'B', createdAt: 1 })
        if (outcome === 'stopAfterAdoption') hook.result.current.stopStreaming(value)
        if (outcome === 'throwAfterAdoption') throw new Error('UI callback error')
      },
    }) })
    await waitFor(() => expect(hook.result.current.projectReview.request?.kind).toBe('confirm'))
    if (outcome === 'storage') vi.spyOn(storage, 'insertConversationsAtomically').mockImplementation(() => { throw new Error('QuotaExceededError') })
    act(() => {
      if (outcome === 'stop') controller.abort()
      else hook.result.current.projectReview.answer(hook.result.current.projectReview.request!.reviewId, outcome === 'cancel' ? null : true)
    })
    await act(async () => { await pending })
    if (outcome === 'throwAfterAdoption') {
      await waitFor(() => expect(storage.getConversation(id)?.messages.at(-1)?.content).toBe(resultText)); expect(fetch).toHaveBeenCalledOnce()
    } else expect(fetch).not.toHaveBeenCalled()
    if (['cancel', 'stop', 'storage'].includes(outcome)) expect(storage.getConversations()).toHaveLength(0)
  })
})
