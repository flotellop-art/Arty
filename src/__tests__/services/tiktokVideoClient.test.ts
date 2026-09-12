import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { prepareTikTokTurn, withTikTokAnalyses, type TikTokTurnOptions } from '../../services/tiktokVideoClient'
import { projectLocalSyncConversationShape } from '../../services/workspaceSync/captureProjection'
import type { Message } from '../../types'
import { resetCalendarFixture } from '../helpers/calendarFixture'
import { getTrialRemaining, setTrialRemaining } from '../../services/trialClient'
import { getWalletSnapshot, clearWalletCache, fetchWalletBalance } from '../../services/walletClient'
vi.mock('../../services/aiHttp', () => ({ buildAiHeaders: vi.fn(async () => ({ 'x-google-token': 'synthetic' })) }))
vi.mock('../../services/activeApiKey', () => ({ getGeminiKey: () => null }))
vi.mock('../../services/costTracker', () => ({ recordUsage: vi.fn() }))
const url = 'https://vm.tiktok.com/ZN8jJBpVS/'
const analysis = { url, text: '00:12 — un exemple observé.', model: 'gemini-3.5-flash', analyzedAt: 1 }
const message: Message = { id: 'm1', role: 'user', content: url, timestamp: 1, videoAnalysis: analysis }
function options(extra: Partial<TikTokTurnOptions> = {}): TikTokTurnOptions { return { text: url, messages: [], euOnly: false, available: true, documentRestricted: false, signal: new AbortController().signal, assertCurrent: vi.fn(), ...extra } }
const success = () => Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: analysis.text }] } }] }, { headers: { 'x-arty-model-used': analysis.model } })
beforeEach(async () => { await resetCalendarFixture(); clearWalletCache(); vi.clearAllMocks() })
afterEach(() => vi.unstubAllGlobals())
describe('TikTok conversation preparation', () => {
  it('sends only the URL, never the user question or private history', async () => {
    const fetcher = vi.fn(async () => success()); vi.stubGlobal('fetch', fetcher)
    const result = await prepareTikTokTurn(options({ text: `Mon secret médical. ${url}`, messages: [{ ...message, content: 'Private mail', videoAnalysis: undefined }] }))
    expect(result).toMatchObject({ ...analysis, analyzedAt: expect.any(Number) })
    expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toEqual({ model: 'gemini-3.8-flash', stream: false, tiktokVideoUrl: url, tiktokVideoFormat: 2 })
  })
  it.each([{ euOnly: true }, { available: false }, { documentRestricted: true }, { text: `${url} https://vt.tiktok.com/ABCD1234/` }])('blocks unsupported scope before network: %j', async extra => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    await expect(prepareTikTokTurn(options(extra))).rejects.toThrow()
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('reuses observations after reload without fetching and preserves original user content', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    const restored = JSON.parse(JSON.stringify(message))
    expect(await prepareTikTokTurn(options({ messages: [restored] }))).toEqual(analysis)
    expect(withTikTokAnalyses([restored])[0]!.content).toContain(analysis.text)
    expect(restored.content).toBe(url)
    expect(await prepareTikTokTurn(options({ text: 'Et à 32 secondes ?', messages: [restored] }))).toBeNull()
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('rejects truncated output or failure, never turning them into observations', async () => {
    for (const res of [Response.json({ error: 'tiktok_video_unavailable' }, { status: 502 }), Response.json({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: 'partial' }] } }] })]) {
      vi.stubGlobal('fetch', vi.fn(async () => res))
      await expect(prepareTikTokTurn(options())).rejects.toThrow()
    }
  })
  it.each(['Failed to fetch', 'NetworkError when attempting to fetch resource.', 'Load failed'])('explains an opaque network error without retrying: %s', async message => {
    const fetcher = vi.fn().mockRejectedValue(new TypeError(message)); vi.stubGlobal('fetch', fetcher)
    await expect(prepareTikTokTurn(options())).rejects.toThrow('n’a pas reçu le résultat de la lecture TikTok')
    expect(fetcher).toHaveBeenCalledOnce()
  })
  it.each(['Too many requests', 'Daily AI request limit reached', 'premium_cap_reached'])('does not promise a minute or a plan upgrade for a 429: %s', async error => {
    const fetcher = vi.fn(async () => Response.json({ error }, { status: 429 })); vi.stubGlobal('fetch', fetcher)
    await expect(prepareTikTokTurn(options())).rejects.toThrow('limite de demandes ou de quota')
    expect(fetcher).toHaveBeenCalledOnce()
  })
  it('preserves the video length refusal instead of calling it a network error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'tiktok_video_limit' }, { status: 502 })))
    await expect(prepareTikTokTurn(options())).rejects.toThrow('10 minutes')
  })
  it('reflects an exhausted trial and a terminal wallet refusal using the shared funding contract', async () => {
    setTrialRemaining(5)
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'trial_expired' }, { status: 403 })))
    await expect(prepareTikTokTurn(options())).rejects.toMatchObject({ name: 'TrialExpiredError' })
    expect(getTrialRemaining()).toBe(0)
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ hasWallet: true, balanceMicro: 900000, reservedMicro: 0, availableMicro: 900000, reversalPending: false })))
    await fetchWalletBalance()
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'wallet_reconciliation_pending' }, { status: 409 })))
    await expect(prepareTikTokTurn(options())).rejects.toMatchObject({ name: 'WalletReconciliationError' })
    expect(getWalletSnapshot()?.reversalPending).toBe(true)
  })
  it('does not mutate funding after the request becomes obsolete while reading an error body', async () => {
    setTrialRemaining(5)
    let current = true
    const res = Response.json({ error: 'trial_expired' }, { status: 403 })
    vi.spyOn(res, 'text').mockImplementation(async () => { current = false; return '{"error":"trial_expired"}' })
    vi.stubGlobal('fetch', vi.fn(async () => res))
    await expect(prepareTikTokTurn(options({ assertCurrent: () => { if (!current) throw new Error('changed') } }))).rejects.toThrow('changed')
    expect(getTrialRemaining()).toBe(5)
  })
  it('aborts the network and rejects late results after Stop', async () => {
    const ctrl = new AbortController(); let release!: (response: Response) => void; let signal: AbortSignal | undefined
    vi.stubGlobal('fetch', vi.fn((_url, init) => { signal = init.signal; return new Promise<Response>(resolve => { release = resolve }) }))
    const task = prepareTikTokTurn(options({ signal: ctrl.signal }))
    const check = expect(task).rejects.toThrow()
    await vi.waitFor(() => expect(signal).toBeDefined())
    ctrl.abort(); expect(signal!.aborted).toBe(true); release(success())
    await check
  })
  it('rejects a result after a session change', async () => {
    let current = true
    vi.stubGlobal('fetch', vi.fn(async () => { current = false; return success() }))
    await expect(prepareTikTokTurn(options({ assertCurrent: () => { if (!current) throw new Error('changed') } }))).rejects.toThrow('changed')
  })
  it('preserves validated video observations through sync projection and rejects malformed fields', () => {
    const conv = { id: 'c1', title: 'Video', createdAt: 1, updatedAt: 1, messages: [message] }
    expect(projectLocalSyncConversationShape(conv).messages[0]!.videoAnalysis).toEqual(analysis)
    expect(() => projectLocalSyncConversationShape({ ...conv, messages: [{ ...message, videoAnalysis: { ...analysis, text: 'x'.repeat(24001) } }] })).toThrow()
    expect(() => projectLocalSyncConversationShape({ ...conv, messages: [{ ...message, role: 'assistant' }] })).toThrow()
  })
})
