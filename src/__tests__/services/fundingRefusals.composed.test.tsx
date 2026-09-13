import 'fake-indexeddb/auto'
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as google from '../../services/googleAuth'
import { initCrypto } from '../../services/crypto'
import { setActiveSession } from '../../services/userSession'
import * as session from '../../services/userSession'
import { clearWalletCache, fetchWalletBalance, creditsCoverPremium, getWalletSnapshot } from '../../services/walletClient'
import { getTrialRemaining, setTrialRemaining } from '../../services/trialClient'
import { WalletBadge } from '../../components/layout/WalletBadge'
import { usePlanStatus } from '../../hooks/usePlanStatus'
import { streamMessage } from '../../services/anthropicClient'
import { streamGeminiMessage, geminiResearch } from '../../services/geminiClient'
import { streamMistralMessage } from '../../services/mistralClient'
import { sendMessageStream } from '../../services/openaiClient'
import i18n from '../../i18n'
import { captureAiEntitlementReceipt, trialExpiredError } from '../../services/aiEntitlementReceipt'
import { setTrialToken } from '../../services/emailTrialClient'

vi.mock('../../services/apiBase', () => ({ apiUrl: (path: string) => path }))
vi.mock('../../services/locationContext', () => ({ buildLocationContext: async () => '' }))
vi.mock('../../services/quotaStatus', () => ({ fetchMonthlyQuotaStatus: async () => null }))

const providers = ['anthropic', 'gemini', 'mistral', 'openai', 'mistral-forced-search'] as const
type Provider = typeof providers[number]
const paths: Record<Provider, string> = { anthropic: '/api/ai/proxy', gemini: '/api/ai/gemini-proxy',
  mistral: '/api/ai/mistral-proxy', openai: '/api/ai/openai-proxy', 'mistral-forced-search': '/api/ai/mistral-proxy' }
const families = ['claude-haiku', 'claude-sonnet', 'claude-opus', 'mistral-medium', 'gemini-flash', 'gemini-pro', 'gpt-mini', 'gpt-full']
const wallet = (n = 900000) => Response.json({ hasWallet: true, balanceMicro: n, reservedMicro: 0, availableMicro: n, reversalPending: false })
const plan = (name = 'free') => Response.json({ auth: 'ok', status: name === 'free' ? 'inactive' : 'active', plan: name,
  allowed_families: name === 'free' ? ['claude-haiku'] : families,
  locked_families: name === 'free' ? families.slice(1) : [], daily_remaining: null, daily_limits: null })
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r }); return { promise, resolve } }
let serial = 0, owner = ''
async function login(id: string, token = 'SYNTHETIC-G1') {
  setActiveSession({ userId: id, authMethod: 'google', displayName: 'Synthetic', createdAt: 1 })
  await initCrypto(`synthetic-funding-key-${id}`)
  await google.storeUser({ email: 'synthetic@example.invalid', name: 'Synthetic', picture: '' })
  await google.storeMailboxFreeGrant({ access_token: token, refresh_token: 'SYNTHETIC-REFRESH', expires_at: Date.now() + 3600000 }, undefined,
    { verifiedEmail: 'synthetic@example.invalid' })
  await google.bootstrapGoogleStorage()
}
function invoke(provider: Provider, byok = false, assertRequestCurrent?: () => void) {
  const onToken = vi.fn(), onDone = vi.fn(), onToolCall = vi.fn(async () => ({ result: 'unused' }))
  const done = deferred<Error>(), onError = vi.fn((error: Error) => done.resolve(error))
  const messages = [{ role: 'user', content: 'Quelles sont les actualités du jour ?' }]
  const options = { comparisonTextOnly: true, tools: [], assertRequestCurrent }
  const key = byok ? 'SYNTHETIC-BYOK' : 'server-provided'
  const controller = provider === 'anthropic' ? streamMessage(messages, onToken, onDone, onError, options, key)
    : provider === 'gemini' ? streamGeminiMessage(messages, onToken, onDone, onError, options, key)
    : provider === 'openai' ? sendMessageStream(messages, byok ? key : null, onToken, onDone, onError, options)
    : streamMistralMessage(messages, onToken, onDone, onError, provider === 'mistral' ? options : { onToolCall, webSearch: true, assertRequestCurrent }, key)
  return { outcome: done.promise, onToken, onDone, onError, onToolCall, controller }
}
function stub(ai: () => Promise<Response>, currentPlan = 'free') {
  const http = vi.fn(async (url: string, _init?: RequestInit) => url === '/api/wallet/balance' ? wallet()
    : url === '/api/subscription/status' ? plan(currentPlan) : ai())
  vi.stubGlobal('fetch', http)
  return http
}
beforeEach(async () => {
  localStorage.clear(); google.resetGoogleMemCache(); clearWalletCache()
  owner = `funding-${++serial}`; await login(owner); await i18n.changeLanguage('fr')
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('real AI client → current funding cache → rendered badge / plan (synthetic HTTP)', () => {
  it.each(['fr', 'en'])('Anthropic redirect is terminal and localized in %s, without changing account, trial or wallet', async language => {
    await i18n.changeLanguage(language); setTrialRemaining(17)
    const http = stub(async () => Response.json({ error: 'upstream_outcome_unknown' }, { status: 409 }))
    await fetchWalletBalance()
    const before = getWalletSnapshot(), count = http.mock.calls.length
    const call = invoke('anthropic'), error = await call.outcome
    expect(error.message).toBe(i18n.t('errors.apiOutcomeUnknown'))
    expect(error.message).not.toMatch(/upstream_outcome_unknown|errors\./)
    expect(error.name).not.toBe('WalletReconciliationError')
    expect(http.mock.calls.slice(count).map(([url]) => url)).toEqual(['/api/ai/proxy'])
    expect(getWalletSnapshot()).toEqual(before); expect(getTrialRemaining()).toBe(17)
    expect(session.getActiveUserId()).toBe(owner)
    expect(call.onError).toHaveBeenCalledOnce()
    expect(call.onDone).not.toHaveBeenCalled(); expect(call.onToken).not.toHaveBeenCalled(); expect(call.onToolCall).not.toHaveBeenCalled()
  })
  it.each(providers.flatMap(provider => ['fr', 'en'].map(language => ({ provider, language }))))('$provider closes a warm wallet immediately after 409 in $language without extra network', async ({ provider, language }) => {
    await i18n.changeLanguage(language)
    const http = stub(async () => Response.json({ error: 'wallet_reconciliation_pending' }, { status: 409 }))
    render(<WalletBadge />); const hook = renderHook(() => usePlanStatus())
    await waitFor(() => expect(hook.result.current.allowedFamilies).toContain('gpt-full'))
    expect(screen.getByLabelText(i18n.t('wallet.badgeAria'))).toHaveTextContent('90')
    const before = http.mock.calls.length
    let error!: Error
    await act(async () => { error = await invoke(provider).outcome })
    expect(error.name).toBe('WalletReconciliationError')
    expect(http.mock.calls.slice(before).map(([url]) => url)).toEqual([paths[provider]])
    expect(new Headers(http.mock.calls.at(-1)![1]?.headers).get('x-google-token')).toBe('SYNTHETIC-G1')
    expect(creditsCoverPremium()).toBe(false)
    expect(hook.result.current.allowedFamilies).toEqual(['claude-haiku'])
    expect(screen.getByRole('button', { name: `${i18n.t('wallet.badgeAria')}: ${i18n.t('wallet.reversalBadge')}` })).toBeVisible()
  })
  it.each(providers.flatMap(provider => ['fr', 'en'].map(language => ({ provider, language }))))(
    '$provider localizes trial expiry in $language, publishes zero, and never retries', async ({ provider, language }) => {
      await i18n.changeLanguage(language); setTrialRemaining(5)
      const http = stub(async () => Response.json({ error: 'trial_expired' }, { status: 403 }))
      const call = invoke(provider), error = await call.outcome
      expect(error).toMatchObject({ name: 'TrialExpiredError', message: i18n.t('trial.expiredError') })
      expect(error.message).not.toContain('trial.')
      expect(getTrialRemaining()).toBe(0)
      expect(http.mock.calls.map(([url]) => url)).toEqual([paths[provider]])
      expect(call.onError).toHaveBeenCalledOnce(); expect(call.onDone).not.toHaveBeenCalled()
      expect(call.onToken).not.toHaveBeenCalled(); expect(call.onToolCall).not.toHaveBeenCalled()
    })
  it.each(['vip', 'subscription', 'pro'])('a wallet refusal does not remove verified %s rights', async name => {
    stub(async () => Response.json({ error: 'wallet_reconciliation_pending' }, { status: 409 }), name)
    const hook = renderHook(() => usePlanStatus())
    await waitFor(() => expect(hook.result.current.plan).toBe(name))
    await act(async () => { await invoke('anthropic').outcome })
    expect(creditsCoverPremium()).toBe(false)
    expect(hook.result.current.plan).toBe(name); expect(hook.result.current.allowedFamilies).toEqual(families)
  })
  it.each(providers.flatMap(provider => ['wallet', 'trial'].flatMap(kind => ['A-B-A', 'relink', 'abort'].map(change => ({ provider, kind, change })))))(
    '$provider ignores late $kind metadata after $change during body parsing', async ({ provider, kind, change }) => {
      const body = deferred<string>(), reading = vi.fn(() => body.promise)
      const response = Response.json({}, { status: kind === 'wallet' ? 409 : 403 })
      // Delay the error body, not the fetch: this targets the gap AFTER the existing request guards.
      vi.spyOn(response, 'text').mockImplementation(reading)
      vi.spyOn(response, 'clone').mockReturnValue(response)
      const http = stub(async () => response)
      setTrialRemaining(5); await fetchWalletBalance()
      const call = invoke(provider); await waitFor(() => expect(reading).toHaveBeenCalled())
      const epoch = session.getActiveSessionEpoch()
      if (change === 'A-B-A') { await login(`${owner}-B`); await login(owner, 'SYNTHETIC-G2') }
      else if (change === 'abort') call.controller.abort()
      else {
        await google.storeMailboxFreeGrant({ access_token: 'SYNTHETIC-G2', refresh_token: 'SYNTHETIC-REFRESH', expires_at: Date.now() + 3600000 }, undefined,
          { verifiedEmail: 'synthetic@example.invalid' })
        expect(session.getActiveSessionEpoch()).toBe(epoch)
      }
      setTrialRemaining(17); await fetchWalletBalance()
      body.resolve(JSON.stringify({ error: kind === 'wallet' ? 'wallet_reconciliation_pending' : 'trial_expired' }))
      await call.outcome
      expect(getTrialRemaining()).toBe(17)
      expect(getWalletSnapshot()).toMatchObject({ availableMicro: 900000, reversalPending: false })
      expect(http.mock.calls.filter(([url]) => url === paths[provider])).toHaveLength(1)
    })

  it.each(providers)('%s ignores a replaced invocation while its body is pending in the same session', async provider => {
    let current = true
    const body = deferred<string>(), reading = vi.fn(() => body.promise), response = new Response(null, { status: 403 })
    vi.spyOn(response, 'text').mockImplementation(reading); vi.spyOn(response, 'clone').mockReturnValue(response)
    stub(async () => response); setTrialRemaining(5)
    const call = invoke(provider, false, () => { if (!current) throw new DOMException('Retired', 'AbortError') })
    await waitFor(() => expect(reading).toHaveBeenCalled()); current = false
    body.resolve(JSON.stringify({ error: 'trial_expired' })); await call.outcome
    expect(getTrialRemaining()).toBe(5)
  })

  it('retires an already-running wallet GET before announcing the blocked badge', async () => {
    const gate = deferred<Response>(), http = stub(async () => Response.json({ error: 'wallet_reconciliation_pending' }, { status: 409 }))
    render(<WalletBadge />); await screen.findByLabelText(i18n.t('wallet.badgeAria'))
    http.mockImplementationOnce(() => gate.promise)
    const old = fetchWalletBalance(); await waitFor(() => expect(http).toHaveBeenCalledTimes(2))
    await act(async () => { await invoke('openai').outcome })
    await act(async () => { gate.resolve(wallet()); expect(await old).toBeNull() })
    expect(getWalletSnapshot()).toMatchObject({ availableMicro: 0, reversalPending: true })
    expect(screen.getByRole('button', { name: `${i18n.t('wallet.badgeAria')}: ${i18n.t('wallet.reversalBadge')}` })).toBeVisible()
    expect(http).toHaveBeenCalledTimes(3)
  })

  it('trial zero reprojects an existing wallet locally without changing its balance or refetching the plan', async () => {
    setTrialRemaining(5)
    const http = stub(async () => Response.json({ error: 'trial_expired' }, { status: 403 }))
    const hook = renderHook(() => usePlanStatus())
    await waitFor(() => expect(hook.result.current.loading).toBe(false))
    expect(hook.result.current.allowedFamilies).toEqual(['claude-haiku'])
    const before = http.mock.calls.length
    await act(async () => { await invoke('openai').outcome })
    expect(getTrialRemaining()).toBe(0); expect(getWalletSnapshot()?.availableMicro).toBe(900000)
    expect(hook.result.current.allowedFamilies).toContain('gpt-full')
    expect(http.mock.calls.slice(before).map(([url]) => url)).toEqual([paths.openai])
  })

  it('retires old trial headers AND old errors, but accepts a new verified compensation', () => {
    setTrialRemaining(5)
    const old = captureAiEntitlementReceipt(true), terminal = captureAiEntitlementReceipt(true)
    terminal.error(403, JSON.stringify({ error: 'trial_expired' })); expect(getTrialRemaining()).toBe(0)
    old.updateTrial(new Response(null, { headers: { 'x-trial-remaining': '17' } })); expect(getTrialRemaining()).toBe(0)
    const fresh = captureAiEntitlementReceipt(true)
    fresh.updateTrial(new Response(null, { headers: { 'x-trial-remaining': '1' } })); expect(getTrialRemaining()).toBe(1)
    old.error(403, JSON.stringify({ error: 'trial_expired' })); expect(getTrialRemaining()).toBe(1)
  })

  it.each(['wallet', 'trial'])('direct BYOK cannot mutate Arty %s metadata, even with a matching error code', async kind => {
    const http = stub(async () => Response.json({ error: kind === 'wallet' ? 'wallet_reconciliation_pending' : 'trial_expired' }, { status: kind === 'wallet' ? 409 : 403 }))
    await fetchWalletBalance(); setTrialRemaining(5)
    await invoke('openai', true).outcome
    expect(http.mock.calls.at(-1)![0]).toBe('https://api.openai.com/v1/chat/completions')
    expect(getTrialRemaining()).toBe(5); expect(getWalletSnapshot()?.availableMicro).toBe(900000)
  })

  it.each(['trial_expired', 'wallet_reconciliation_pending'])('hybrid research propagates %s instead of silently returning an empty research result', async code => {
    setTrialRemaining(5)
    const http = stub(async () => Response.json({ error: code }, { status: code === 'trial_expired' ? 403 : 409 }))
    await expect(geminiResearch('synthetic', 'server-provided')).rejects.toHaveProperty('name', code === 'trial_expired' ? 'TrialExpiredError' : 'WalletReconciliationError')
    expect(http.mock.calls.map(([url]) => url)).toEqual([paths.gemini])
  })

  it('OTP uses the actual email-trial transport and changes only its current local owner', async () => {
    google.resetGoogleMemCache()
    setActiveSession({ userId: `${owner}-otp`, authMethod: 'email', displayName: 'Synthetic', createdAt: 1 })
    await initCrypto('synthetic-otp-key'); await google.bootstrapGoogleStorage()
    setTrialToken('SYNTHETIC-OTP'); setTrialRemaining(17)
    const http = stub(async () => Response.json({ error: 'trial_expired' }, { status: 403 }))
    await invoke('openai').outcome
    const headers = new Headers(http.mock.calls[0][1]?.headers)
    expect(headers.get('x-arty-trial-token')).toBe('SYNTHETIC-OTP'); expect(headers.has('x-google-token')).toBe(false)
    expect(getTrialRemaining()).toBe(0)
  })

  it('refusal stays closed when optional storage is unavailable; pure formatting has no effect', async () => {
    stub(async () => Response.json({ error: 'wallet_reconciliation_pending' }, { status: 409 }))
    await fetchWalletBalance(); setTrialRemaining(5)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('synthetic quota') })
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('synthetic storage') })
    trialExpiredError(403, JSON.stringify({ error: 'trial_expired' })); expect(getTrialRemaining()).toBe(5)
    const receipt = captureAiEntitlementReceipt(true)
    receipt.error(409, JSON.stringify({ error: 'wallet_reconciliation_pending' }))
    receipt.error(403, JSON.stringify({ error: 'trial_expired' }))
    expect(getTrialRemaining()).toBe(0); expect(creditsCoverPremium()).toBe(false)
  })

  it('rejects malformed headers, wrong statuses and unrelated refusal contracts without granting or zeroing', () => {
    setTrialRemaining(5); const receipt = captureAiEntitlementReceipt(true)
    for (const raw of ['31', '-1', '3abc', '1.5', 'NaN', '']) receipt.updateTrial(new Response(null, { headers: { 'x-trial-remaining': raw } }))
    for (const status of [401, 409, 503]) expect(receipt.error(status, '{"error":"trial_expired"}')).toBeNull()
    expect(receipt.error(403, '{"error":"trial_model_restricted"}')).toBeNull()
    expect(receipt.error(403, 'invalid json')).toBeNull(); expect(getTrialRemaining()).toBe(5)
  })

  it.each(['model', 'tools'])('OpenAI does not dispatch a %s fallback after its invocation retires during body parsing', async kind => {
    let current = true
    const body = deferred<string>(), reading = vi.fn(() => body.promise), response = new Response(null, { status: 400 })
    vi.spyOn(response, 'text').mockImplementation(reading); vi.spyOn(response, 'clone').mockReturnValue(response)
    const http = stub(async () => response), retired = new Error('synthetic-retired-invocation'), done = deferred<Error>()
    const onToolCall = vi.fn(async () => ({ result: 'unused' })), onDone = vi.fn(), onToken = vi.fn()
    sendMessageStream([{ role: 'user', content: 'Synthetic' }], null, onToken, onDone, done.resolve, {
      onToolCall: kind === 'tools' ? onToolCall : undefined,
      assertRequestCurrent: () => { if (!current) throw retired },
    })
    await waitFor(() => expect(reading).toHaveBeenCalled()); current = false
    body.resolve(kind === 'model' ? 'model not found' : 'function tools not supported')
    expect(await done.promise).toBe(retired)
    expect(http.mock.calls.map(([url]) => url)).toEqual([paths.openai])
    expect(onDone).not.toHaveBeenCalled(); expect(onToken).not.toHaveBeenCalled(); expect(onToolCall).not.toHaveBeenCalled()
  })

  it.each(['abort', 'relink', 'owner-change'])('retires both funding mutations for %s without revoking the new receipt', async kind => {
    stub(async () => wallet()); await fetchWalletBalance(); setTrialRemaining(5)
    const controller = new AbortController(), receipt = captureAiEntitlementReceipt(true, controller.signal)
    if (kind === 'abort') controller.abort()
    else if (kind === 'owner-change') await login(`${owner}-B`)
    else await google.storeMailboxFreeGrant({ access_token: 'SYNTHETIC-G2', refresh_token: 'SYNTHETIC-REFRESH', expires_at: Date.now() + 3600000 }, undefined,
      { verifiedEmail: 'synthetic@example.invalid' })
    await fetchWalletBalance(); setTrialRemaining(17)
    receipt.error(409, '{"error":"wallet_reconciliation_pending"}')
    receipt.error(403, '{"error":"trial_expired"}')
    receipt.updateTrial(new Response(null, { headers: { 'x-trial-remaining': '0' } }))
    expect(getTrialRemaining()).toBe(17); expect(getWalletSnapshot()?.availableMicro).toBe(900000)
  })

  it('an unavailable private owner produces an inert receipt, never a capture exception', () => {
    setTrialRemaining(5)
    const denied = vi.spyOn(session, 'getActiveUserId').mockImplementation(() => { throw new Error('synthetic retired document') })
    const receipt = captureAiEntitlementReceipt(true)
    denied.mockRestore()
    receipt.error(403, '{"error":"trial_expired"}')
    expect(getTrialRemaining()).toBe(5)
  })

  it('a 409 without a verified snapshot invents neither a wallet nor amounts', async () => {
    const http = stub(async () => Response.json({ error: 'wallet_reconciliation_pending' }, { status: 409 }))
    await invoke('openai').outcome
    expect(getWalletSnapshot()).toBeNull(); expect(creditsCoverPremium()).toBe(false)
    expect(http.mock.calls.map(([url]) => url)).toEqual([paths.openai])
  })

  it('a reentrant request guard cannot restore trial metadata retired inside that guard', () => {
    setTrialRemaining(5)
    const terminal = captureAiEntitlementReceipt(true)
    const old = captureAiEntitlementReceipt(true, undefined, () => terminal.error(403, '{"error":"trial_expired"}'))
    old.updateTrial(new Response(null, { headers: { 'x-trial-remaining': '17' } }))
    expect(getTrialRemaining()).toBe(0)
  })
})
