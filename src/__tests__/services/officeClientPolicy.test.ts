import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../services/activeApiKey', () => ({ getAnthropicKey: () => 'server-provided', getMistralKey: () => 'server-provided' }))
vi.mock('../../services/conversationCompressor', () => ({ compressIfNeeded: vi.fn() }))
vi.mock('../../services/locationContext', () => ({ buildLocationContext: vi.fn() }))
vi.mock('../../services/costTracker', () => ({ recordUsage: vi.fn() }))
vi.mock('../../services/trialClient', () => ({ updateTrialFromResponse: vi.fn() }))
vi.mock('../../services/googleAuth', () => ({ getValidAccessToken: vi.fn(async () => null), getStoredTokens: () => null, isGoogleStorageReady: () => true }))
vi.mock('../../services/emailTrialClient', () => ({ getTrialToken: () => null }))
vi.mock('../../services/userSession', () => ({ getActiveSession: () => null, getActiveUserId: () => null, getActiveSessionEpoch: () => 0 }))
vi.mock('../../services/storage', () => ({ getConversation: vi.fn() }))

import { streamMessage } from '../../services/anthropicClient'
import { streamMistralMessage } from '../../services/mistralClient'
import { compressIfNeeded } from '../../services/conversationCompressor'
import { buildLocationContext } from '../../services/locationContext'
import { getValidAccessToken } from '../../services/googleAuth'
import { getConversation } from '../../services/storage'
import { runFactCheckOnLatest } from '../../services/factChecker'
import { officeFixture } from '../helpers/officeFixture'

beforeEach(() => { vi.clearAllMocks(); vi.spyOn(console, 'log').mockImplementation(() => {}) })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('Politique Office au dernier point réseau', () => {
  it.each(['claude', 'mistral'])('%s : revalidation projet après les headers peut encore refuser le POST', async provider => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
    let authCompleted = false
    vi.mocked(getValidAccessToken).mockImplementationOnce(async () => { authCompleted = true; return null })
    const failure = new Error('project_revision_changed')
    const beforeDocumentRequest = vi.fn(async () => { expect(authCompleted).toBe(true); throw failure })
    const result = new Promise<Error>(resolve => {
      const args = [[{ role: 'user', content: 'Extraits privés' }], () => {}, () => {}, resolve] as const
      if (provider === 'claude') streamMessage(...args, { documentReadOnly: true, beforeDocumentRequest })
      else streamMistralMessage(...args, { documentReadOnly: true, beforeDocumentRequest })
    })
    expect(await result).toBe(failure); expect(beforeDocumentRequest).toHaveBeenCalledTimes(1); expect(fetch).not.toHaveBeenCalled()
  })
  it.each(['claude', 'mistral'])('%s réel : payload sans tools ni prétraitement externe', async (provider) => {
    const fetch = vi.fn(async () => new Response(provider === 'claude' ? 'event: message_stop\ndata: {"type":"message_stop"}\n\n' : 'data: [DONE]\n\n'))
    vi.stubGlobal('fetch', fetch)
    const tool = vi.fn()
    await new Promise<void>((resolve, reject) => {
      const args = [[{ role: 'user', content: 'Prix récents près de chez moi : document joint' }], () => {}, resolve, reject] as const
      if (provider === 'claude') streamMessage(...args, { documentReadOnly: true, onToolCall: tool })
      else streamMistralMessage(...args, { documentReadOnly: true, onToolCall: tool, webSearch: true })
    })
    expect(fetch).toHaveBeenCalledTimes(1)
    const body = JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)
    expect(body.tools).toBeUndefined()
    expect(body.tool_choice).toBeUndefined()
    expect(JSON.stringify(body)).toContain('DOCUMENT READ-ONLY MODE')
    expect(compressIfNeeded).not.toHaveBeenCalled()
    expect(buildLocationContext).not.toHaveBeenCalled()
    expect(tool).not.toHaveBeenCalled()
  })

  it.each(['claude', 'mistral'])('%s réel : Stop pendant les headers empêche le fetch', async (provider) => {
    let resume!: (token: null) => void
    vi.mocked(getValidAccessToken).mockReturnValueOnce(new Promise((r) => { resume = r }))
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    let stopped = false
    const failure = new Error('office_cancelled')
    const result = new Promise<Error>((resolve) => {
      const options = { documentReadOnly: true, assertRequestCurrent: () => { if (stopped) throw failure } }
      const args = [[{ role: 'user', content: 'Texte privé' }], () => {}, () => {}, resolve] as const
      if (provider === 'claude') streamMessage(...args, options)
      else streamMistralMessage(...args, options)
    })
    // Both clients reach the async header call after a microtask boundary.
    await vi.waitFor(() => expect(resume).toBeTypeOf('function'))
    stopped = true; resume(null)
    expect(await result).toBe(failure)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('le fact-check réel ne récupère aucun lien public pour un fil Office', async () => {
    vi.stubGlobal('fetch', vi.fn())
    vi.mocked(getConversation).mockReturnValue({ id: 'c', title: 'x', createdAt: 0, updatedAt: 0, messages: [
      { id: 'u', role: 'user', content: 'Lis', timestamp: 1, files: [officeFixture()] },
      { id: 'a', role: 'assistant', content: '[Source](https://example.invalid/private?token=secret)', timestamp: 2 },
    ] })
    await runFactCheckOnLatest('c', vi.fn())
    expect(fetch).not.toHaveBeenCalled()
  })
})
