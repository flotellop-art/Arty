import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('../../services/googleAuth', () => ({ getValidAccessToken: vi.fn() }))
vi.mock('../../services/activeApiKey', () => ({ getOpenAIKey: vi.fn(() => 'key-a') }))
import { getValidAccessToken } from '../../services/googleAuth'
import { getOpenAIKey } from '../../services/activeApiKey'
import { generateImage, validGeneratedImage, type ImageRequestContext } from '../../services/imageClient'

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a9sAAAAASUVORK5CYII='
function deferred<T>() { let resolve!: (value: T) => void; return { promise: new Promise<T>(r => { resolve = r }), resolve: (value: T) => resolve(value) } }
describe('image client — fixed request scope', () => {
  let valid: boolean, controller: AbortController, context: ImageRequestContext
  const fetchMock = vi.fn()
  beforeEach(() => {
    vi.clearAllMocks(); vi.stubGlobal('fetch', fetchMock)
    valid = true; controller = new AbortController()
    context = { signal: controller.signal, assertCurrent() { if (!valid) throw new DOMException('cancelled', 'AbortError') }, beforeRequest: vi.fn(async () => {}) }
    vi.mocked(getValidAccessToken).mockResolvedValue('token-a')
    vi.mocked(getOpenAIKey).mockReturnValue('key-a')
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ b64: png, mimeType: 'image/png' }) })
  })
  afterEach(() => vi.unstubAllGlobals())
  it('captures BYOK before waiting for auth, passes signal, checks durable boundary', async () => {
    const token = deferred<string | null>(); vi.mocked(getValidAccessToken).mockReturnValue(token.promise)
    const result = generateImage('logo', 'openai', context)
    vi.mocked(getOpenAIKey).mockReturnValue('key-b'); token.resolve('token-a')
    expect(await result).toEqual({ ok: true, base64: png, mimeType: 'image/png' })
    expect(context.beforeRequest).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ signal: controller.signal, headers: expect.objectContaining({ 'x-openai-key': 'key-a', 'x-google-token': 'token-a' }) }))
  })
  it.each(['initial', 'auth', 'fence', 'fetch', 'json'] as const)('invalidates at %s without releasing image data', async stage => {
    const gate = deferred<unknown>()
    if (stage === 'initial') valid = false
    if (stage === 'auth') vi.mocked(getValidAccessToken).mockImplementation(async () => { await gate.promise; return 'token-a' })
    if (stage === 'fence') context.beforeRequest = async () => { await gate.promise }
    if (stage === 'fetch') fetchMock.mockImplementation(async () => { await gate.promise; return { ok: true, json: async () => ({ b64: png }) } })
    if (stage === 'json') fetchMock.mockResolvedValue({ ok: true, json: async () => { await gate.promise; return { b64: png } } })
    const result = generateImage('logo', 'openai', context)
    // Advance to each designated await, without timers or real HTTP.
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    valid = false; gate.resolve(undefined)
    await expect(result).rejects.toMatchObject({ name: 'AbortError' })
    if (['initial', 'auth', 'fence'].includes(stage)) expect(fetchMock).not.toHaveBeenCalled()
  })
  it('Stop during fetch rejects instead of becoming a fallback-eligible failed result', async () => {
    fetchMock.mockImplementation(async () => { controller.abort(); throw new DOMException('abort', 'AbortError') })
    await expect(generateImage('photo', 'flux', context)).rejects.toMatchObject({ name: 'AbortError' })
  })
  it.each([401, 403, 429, 503, 500])('preserves current non-cancellation status %i', async status => {
    fetchMock.mockResolvedValue({ ok: false, status })
    expect(await generateImage('logo', 'openai', context)).toEqual({ ok: false, code: ({ 401: 'auth', 403: 'plan_locked', 429: 'cap_reached', 503: 'unavailable', 500: 'failed' } as Record<number, string>)[status] })
  })
  it('rejects an invalid response', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ b64: png, mimeType: 'image/svg+xml' }) })
    expect(await generateImage('logo', 'openai', context)).toEqual({ ok: false, code: 'failed' })
  })
})
describe('generated image envelope bounds', () => {
  it('accepts the PNG signature, not arbitrary types/base64 or oversized payloads', () => {
    expect(validGeneratedImage(png, 'image/png')).toBe(true)
    for (const [data, mime] of [[png, 'image/svg+xml'], [png, 'image/jpeg'], ['A'.repeat(16), 'image/png'], [png + '\n', 'image/png'], [png.replace('V', '='), 'image/png'], ['A'.repeat(13_981_020), 'image/png']]) expect(validGeneratedImage(data, mime)).toBe(false)
  })
  it('does not recurse in a base64 regexp for a bounded large payload', () => {
    expect(validGeneratedImage(png.slice(0, 16) + 'A'.repeat(4 * 1024 * 1024), 'image/png')).toBe(true)
  })
})
