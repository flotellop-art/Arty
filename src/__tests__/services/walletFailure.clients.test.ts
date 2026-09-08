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
import { walletReconciliationError } from '../../services/walletFailure'

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

beforeEach(async () => { localStorage.clear(); await i18n.changeLanguage('fr') })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('real text-client handling of a blocked wallet', () => {
  it.each(providers)('%s reports the localized terminal conflict once without replaying any AI/tool call', async provider => {
    const http = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({ error: 'wallet_reconciliation_pending' }, { status: 409 }))
    vi.stubGlobal('fetch', http)
    const call = invoke(provider)
    expect(await call.outcome).toMatchObject({ name: 'WalletReconciliationError', message: i18n.t('wallet.reversalError') })
    expect(http).toHaveBeenCalledOnce()
    expect(call.onError).toHaveBeenCalledOnce()
    expect(call.onToken).not.toHaveBeenCalled(); expect(call.onDone).not.toHaveBeenCalled(); expect(call.onToolCall).not.toHaveBeenCalled()
    if (provider === 'mistral-forced-search') {
      expect(JSON.parse(http.mock.calls[0][1]!.body as string).tool_choice)
        .toEqual({ type: 'function', function: { name: 'web_search' } })
    }
  })

  it('preserves the Anthropic retry schedule for an attested transient 503', async () => {
    const delays: number[] = [], realSetTimeout = globalThis.setTimeout
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((callback: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => {
      if ([2000, 4000, 8000].includes(delay ?? 0)) {
        delays.push(delay!); queueMicrotask(() => callback(...args))
        return 0 as unknown as ReturnType<typeof setTimeout>
      }
      return realSetTimeout(callback, delay, ...args)
    }) as typeof setTimeout)
    const requests: { path: string; funding: string | null }[] = []
    const http = vi.fn(async (url: string, init?: RequestInit) => {
      requests.push({ path: new URL(url, 'https://tryarty.com').pathname,
        funding: new Headers(init?.headers).get('x-arty-require-funding') })
      return Response.json({ error: 'AI service error' }, { status: 503, headers: { 'x-arty-funding': 'v1:free' } })
    })
    vi.stubGlobal('fetch', http)
    const call = invoke('anthropic')
    expect((await call.outcome).name).not.toBe('WalletReconciliationError')
    expect(http).toHaveBeenCalledTimes(4); expect(delays).toEqual([2000, 4000, 8000])
    expect(requests).toEqual([{ path: '/api/ai/proxy', funding: null },
      ...Array.from({ length: 3 }, () => ({ path: '/api/ai/anthropic-continue-v1', funding: 'v1:free' }))])
    expect(call.onError).toHaveBeenCalledOnce(); expect(call.onDone).not.toHaveBeenCalled()
  })

  it.each(['fr', 'en'])('has a translated actionable message in %s, not a raw server code', async language => {
    await i18n.changeLanguage(language)
    const error = walletReconciliationError(409, JSON.stringify({ error: 'wallet_reconciliation_pending' }))!
    expect(error.message).toBe(i18n.t('wallet.reversalError'))
    expect(error.message).not.toMatch(/wallet[._]/)
    expect(walletReconciliationError(503, JSON.stringify({ error: 'wallet_reconciliation_pending' }))).toBeNull()
    expect(walletReconciliationError(409, JSON.stringify({ error: 'different_conflict' }))).toBeNull()
    expect(walletReconciliationError(409, 'invalid json')).toBeNull()
  })
})
