import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../services/aiHttp', async importOriginal => ({
  ...await importOriginal<typeof import('../../services/aiHttp')>(),
  buildAiHeaders: async () => ({ 'Content-Type': 'application/json', 'x-google-token': 'synthetic-token' }),
}))
vi.mock('../../services/locationContext', () => ({ buildLocationContext: async () => '' }))

import i18n from '../../i18n'
import { streamMessage } from '../../services/anthropicClient'
import { streamGeminiMessage } from '../../services/geminiClient'
import { streamMistralMessage } from '../../services/mistralClient'
import { sendMessageStream } from '../../services/openaiClient'
import { admissionUnavailableError } from '../../services/admissionFailure'
import { getTrialRemaining, setTrialRemaining } from '../../services/trialClient'
import { getActiveUserId, setActiveSession } from '../../services/userSession'

const providers = ['anthropic', 'gemini', 'mistral', 'openai', 'mistral-forced-search'] as const
type Provider = typeof providers[number]
function invoke(provider: Provider) {
  const onToken = vi.fn(), onDone = vi.fn(), onToolCall = vi.fn(async () => ({ result: 'unused' }))
  let onError!: ReturnType<typeof vi.fn>
  const outcome = new Promise<Error>(resolve => { onError = vi.fn(resolve) })
  const messages = [{ role: 'user', content: 'Quelles sont les actualités du jour ?' }]
  const options = { comparisonTextOnly: true, tools: [] }
  if (provider === 'anthropic') streamMessage(messages, onToken, onDone, onError, options, 'server-provided')
  else if (provider === 'gemini') streamGeminiMessage(messages, onToken, onDone, onError, options, 'server-provided')
  else if (provider === 'mistral' || provider === 'mistral-forced-search') streamMistralMessage(messages, onToken, onDone, onError,
    provider === 'mistral' ? options : { onToolCall, webSearch: true }, 'server-provided')
  else sendMessageStream(messages, 'server-provided', onToken, onDone, onError, options)
  return { outcome, onToken, onDone, onError, onToolCall }
}

beforeEach(async () => {
  localStorage.clear()
  setActiveSession({ userId: 'admission-test-user', authMethod: 'google', displayName: 'Test', createdAt: 0 })
  setTrialRemaining(17)
  await i18n.changeLanguage('fr')
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('real text-client handling of an unconfirmed admission', () => {
  it.each(['fr', 'en'])('localizes the terminal transport refusal in %s without retry', async language => {
    await i18n.changeLanguage(language)
    const http = vi.fn(async () => Response.json({ error: 'upstream_outcome_unknown' }, { status: 409 }))
    vi.stubGlobal('fetch', http)
    const call = invoke('anthropic')
    expect((await call.outcome).message).toBe(i18n.t('errors.apiOutcomeUnknown'))
    expect(http).toHaveBeenCalledOnce(); expect(getTrialRemaining()).toBe(17)
  })
  it.each([
    ['subsidized_budget_exhausted', 503, 'SubsidizedBudgetExhaustedError', 'errors.subsidizedBudgetExhausted'],
    ['subsidized_request_unsupported', 400, 'SubsidizedRequestUnsupportedError', 'errors.subsidizedRequestUnsupported'],
  ] as const)('Anthropic treats %s as terminal without spending credits or expiring the trial', async (error, status, name, message) => {
    const http = vi.fn(async () => Response.json({ error }, { status }))
    vi.stubGlobal('fetch', http)
    const call = invoke('anthropic')
    expect(await call.outcome).toMatchObject({ name, message: i18n.t(message) })
    expect(http).toHaveBeenCalledOnce(); expect(call.onError).toHaveBeenCalledOnce()
    expect(getTrialRemaining()).toBe(17); expect(getActiveUserId()).toBe('admission-test-user')
    expect(call.onToolCall).not.toHaveBeenCalled(); expect(call.onDone).not.toHaveBeenCalled()
  })
  it.each(providers)('%s reports the localized temporary refusal once without replaying any AI/tool call', async provider => {
    const http = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({ error: 'admission_unavailable' }, { status: 503 }))
    vi.stubGlobal('fetch', http)
    const call = invoke(provider)
    expect(await call.outcome).toMatchObject({ name: 'AdmissionUnavailableError', message: i18n.t('errors.admissionUnavailable') })
    expect(http).toHaveBeenCalledOnce()
    expect(call.onError).toHaveBeenCalledOnce()
    expect(getActiveUserId()).toBe('admission-test-user')
    expect(getTrialRemaining()).toBe(17)
    expect(call.onToken).not.toHaveBeenCalled(); expect(call.onDone).not.toHaveBeenCalled(); expect(call.onToolCall).not.toHaveBeenCalled()
    if (provider === 'mistral-forced-search') {
      expect(JSON.parse(http.mock.calls[0][1]!.body as string).tool_choice)
        .toEqual({ type: 'function', function: { name: 'web_search' } })
    }
  })

  it('preserves the existing Anthropic retry schedule for a genuine transient 503', async () => {
    const delays: number[] = [], realSetTimeout = globalThis.setTimeout
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((callback: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => {
      if ([2000, 4000, 8000].includes(delay ?? 0)) {
        delays.push(delay!); queueMicrotask(() => callback(...args))
        return 0 as unknown as ReturnType<typeof setTimeout>
      }
      return realSetTimeout(callback, delay, ...args)
    }) as typeof setTimeout)
    const http = vi.fn(async () => Response.json({ error: 'wallet_temporarily_unavailable' }, { status: 503 }))
    vi.stubGlobal('fetch', http)
    const call = invoke('anthropic')
    expect((await call.outcome).name).not.toBe('AdmissionUnavailableError')
    expect(http).toHaveBeenCalledTimes(4); expect(delays).toEqual([2000, 4000, 8000])
    expect(call.onError).toHaveBeenCalledOnce(); expect(call.onDone).not.toHaveBeenCalled()
  })

  it.each(['fr', 'en'])('has a translated actionable message in %s, not a raw server code', async language => {
    await i18n.changeLanguage(language)
    const error = admissionUnavailableError(503, JSON.stringify({ error: 'admission_unavailable' }))!
    expect(error.message).toBe(i18n.t('errors.admissionUnavailable'))
    expect(error.message).not.toMatch(/admission[._]/)
    expect(admissionUnavailableError(401, JSON.stringify({ error: 'admission_unavailable' }))).toBeNull()
    expect(admissionUnavailableError(503, JSON.stringify({ error: 'different_conflict' }))).toBeNull()
    expect(admissionUnavailableError(503, 'invalid json')).toBeNull()
  })
})
