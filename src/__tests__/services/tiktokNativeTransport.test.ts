import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const { nativeRequest } = vi.hoisted(() => ({ nativeRequest: vi.fn() }))
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true }, CapacitorHttp: { request: nativeRequest } }))
vi.mock('../../services/googleAuth', () => ({ getValidAccessToken: vi.fn(async () => 'synthetic'), getStoredTokens: vi.fn(), isGoogleStorageReady: () => true }))
vi.mock('../../services/activeApiKey', () => ({ getGeminiKey: () => null }))
vi.mock('../../services/costTracker', () => ({ recordUsage: vi.fn() }))
import { postJsonNativeWithFallback } from '../../services/aiHttp'
import { prepareTikTokTurn } from '../../services/tiktokVideoClient'
const url = 'https://tryarty.com/api/ai/gemini-proxy'
const response = { status: 502, headers: { 'content-type': 'application/json' }, data: { error: 'tiktok_video_limit' } }
const budget = (extra = {}) => ({ connectTimeoutMs: 15000, readTimeoutMs: 100000, deadline: Date.now() + 100000, ...extra })
const post = (extra = {}) => postJsonNativeWithFallback(url, { 'Content-Type': 'application/json' }, { stream: false }, budget(extra))
beforeEach(() => { nativeRequest.mockReset(); vi.stubGlobal('fetch', vi.fn()) })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
describe('TikTok native response and cancellation', () => {
  it('reads the HTTP length refusal through native transport without a second request', async () => {
    nativeRequest.mockResolvedValue(response)
    await expect(prepareTikTokTurn({ text: 'https://vm.tiktok.com/ZN8jShEjq/', messages: [], euOnly: false, available: true,
      documentRestricted: false, signal: new AbortController().signal, assertCurrent: vi.fn() })).rejects.toThrow('3 minutes')
    expect(nativeRequest).toHaveBeenCalledOnce()
    expect(nativeRequest).toHaveBeenCalledWith(expect.objectContaining({ url, headers: expect.objectContaining({ Origin: 'https://localhost' }),
      data: { model: 'gemini-3.8-flash', stream: false, tiktokVideoUrl: 'https://vm.tiktok.com/ZN8jShEjq/' } }))
    expect(fetch).not.toHaveBeenCalled()
  })
  it('emits nothing for an already aborted request', async () => {
    const controller = new AbortController(); controller.abort()
    await expect(post({ signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(nativeRequest).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled()
  })
  it.each(['resolve', 'reject'])('ignores a native %s after Stop without any fallback', async kind => {
    let resolve!: (r: typeof response) => void, reject!: (e: unknown) => void
    nativeRequest.mockImplementation(() => new Promise((yes, no) => { resolve = yes; reject = no }))
    const controller = new AbortController()
    const task = post({ signal: controller.signal }); const rejected = expect(task).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(nativeRequest).toHaveBeenCalledOnce())
    controller.abort(); await rejected
    if (kind === 'resolve') resolve(response); else reject({ code: 'UnknownHostException' })
    await Promise.resolve(); await Promise.resolve()
    expect(fetch).not.toHaveBeenCalled()
  })
  it('stops waiting at the absolute deadline without fallback or an unhandled late rejection', async () => {
    vi.useFakeTimers()
    let reject!: (e: unknown) => void
    nativeRequest.mockImplementation(() => new Promise((_yes, no) => { reject = no }))
    const task = post({ deadline: Date.now() + 5000 }); const rejected = expect(task).rejects.toMatchObject({ name: 'TimeoutError' })
    await vi.advanceTimersByTimeAsync(5000); await rejected
    reject({ code: 'UnknownHostException' }); await Promise.resolve(); await Promise.resolve()
    expect(fetch).not.toHaveBeenCalled()
    expect(nativeRequest).toHaveBeenCalledWith(expect.objectContaining({ connectTimeout: 5000, readTimeout: 5000 }))
  })
  it('checks identity again before an otherwise admissible fallback', async () => {
    let current = true
    nativeRequest.mockImplementation(async () => { current = false; throw { code: 'UnknownHostException' } })
    await expect(post({ assertRequestCurrent: () => { if (!current) throw new Error('session changed') } })).rejects.toThrow('session changed')
    expect(fetch).not.toHaveBeenCalled()
  })
  it('allows only one fallback for a pre-emission failure with the remaining time', async () => {
    vi.useFakeTimers()
    nativeRequest.mockImplementation(async () => { await new Promise(resolve => setTimeout(resolve, 10000)); throw { code: 'UnknownHostException' } })
    vi.mocked(fetch).mockResolvedValue(Response.json({ error: 'tiktok_video_limit' }, { status: 502 }))
    const task = post(); await vi.advanceTimersByTimeAsync(10000)
    expect((await task).status).toBe(502)
    expect(nativeRequest).toHaveBeenCalledOnce(); expect(fetch).toHaveBeenCalledOnce()
    expect(vi.mocked(fetch).mock.calls[0]![1]?.headers).not.toHaveProperty('Origin')
  })
  it.each(['SocketTimeoutException', 'IOException', 'UnknownError'])('never retries an ambiguous native %s', async code => {
    nativeRequest.mockRejectedValue({ code })
    await expect(post()).rejects.toEqual({ code })
    expect(fetch).not.toHaveBeenCalled()
  })
})
