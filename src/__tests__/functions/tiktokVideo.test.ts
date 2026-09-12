// @vitest-environment node
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { normalizeTikTokUrl, extractTikTokUrls, TIKTOK_MAX_BYTES } from '../../services/tiktokVideoTypes'
import { retrieveTikTokVideo, prepareTikTokForGemini, readVideoResponse, tikTokAnalysisBody } from '../../../functions/api/_lib/tiktokVideo'
import { estimateInputTokens } from '../../../functions/api/_lib/walletBilling'

const url = 'https://www.tiktok.com/@test/video/7683978418702011670'
const mediaUrl = 'https://v19-webapp-prime.tiktok.com/video/test'
const bytes = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0])
function page(overrides: Record<string, unknown> = {}, media = mediaUrl, cookies = 'ttwid=public-session; Domain=.tiktok.com; Path=/; Secure') {
  const item = { id: '7683978418702011670', privateItem: false, video: { duration: 178, playAddr: media }, ...overrides }
  return new Response(`<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify({ __DEFAULT_SCOPE__: { 'webapp.video-detail': { statusCode: 0, itemInfo: { itemStruct: item } } } })}</script>`, { headers: { 'set-cookie': cookies } })
}
const mp4 = () => new Response(bytes, { headers: { 'content-type': 'video/mp4', 'content-length': String(bytes.length) } })
const activeFile = { name: 'files/a-00000000-0000-4000-8000-000000000000', uri: 'https://generativelanguage.googleapis.com/v1beta/files/a-00000000-0000-4000-8000-000000000000', state: 'ACTIVE', mimeType: 'video/mp4', videoMetadata: { videoDuration: '178s' } }
beforeEach(() => { vi.spyOn(crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000000000') })
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('TikTok public video retrieval', () => {
  it('recognizes only supported HTTPS video links and deduplicates without tracking', () => {
    expect(extractTikTokUrls(`${url}?tracking=1 et ${url}. https://vm.tiktok.com/ZN8jJBpVS/`)).toEqual([url, 'https://vm.tiktok.com/ZN8jJBpVS/'])
    for (const invalid of ['http://vm.tiktok.com/abcd/', 'https://tiktok.com.evil.test/@x/video/7683978418702011670', 'https://u:p@vm.tiktok.com/abcd/', 'https://www.tiktok.com/login', 'https://vm.tiktok.com:444/abcd/', 'https://vm.tiktok.com./abcd/']) expect(normalizeTikTokUrl(invalid)).toBeNull()
  })
  it('keeps the fresh public cookie between page and media, with no account credentials', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: url } })).mockResolvedValueOnce(page()).mockResolvedValueOnce(mp4())
    vi.stubGlobal('fetch', fetcher)
    const result = await retrieveTikTokVideo('https://vm.tiktok.com/ZN8jJBpVS/', new AbortController().signal)
    expect(result).toEqual({ bytes, duration: 178, url })
    expect(fetcher.mock.calls[0]![1].headers.Cookie).toBeUndefined()
    expect(fetcher.mock.calls[2]![1].headers.Cookie).toBe('ttwid=public-session')
    expect(fetcher.mock.calls.every(([, init]) => !init.headers.Authorization && init.redirect === 'manual')).toBe(true)
  })
  it.each(['https://127.0.0.1/private', 'https://www.tiktok.com.evil.test/@x/video/7683978418702011670'])('rejects a page redirect to %s before fetching it', async location => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location } }))
    vi.stubGlobal('fetch', fetcher)
    await expect(retrieveTikTokVideo(url, new AbortController().signal)).rejects.toThrow('tiktok_video_unavailable')
    expect(fetcher).toHaveBeenCalledOnce()
  })
  it('checks media redirects and never sends TikTok cookies to a CDN on another domain', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(page()).mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://v16.tiktokcdn.com/test' } })).mockResolvedValueOnce(mp4())
    vi.stubGlobal('fetch', fetcher)
    await retrieveTikTokVideo(url, new AbortController().signal)
    expect(fetcher.mock.calls[1]![1].headers.Cookie).toBe('ttwid=public-session')
    expect(fetcher.mock.calls[2]![1].headers.Cookie).toBeUndefined()
  })
  it('rejects a malicious media address and a mismatched/private/long video', async () => {
    for (const fixture of [page({}, 'https://evil.test/video'), page({ id: '9999999999999999999' }), page({ privateItem: true }), page({ video: { duration: 181, playAddr: mediaUrl } })]) {
      const fetcher = vi.fn().mockResolvedValue(fixture); vi.stubGlobal('fetch', fetcher)
      await expect(retrieveTikTokVideo(url, new AbortController().signal)).rejects.toThrow(/tiktok_video_/)
      expect(fetcher).toHaveBeenCalledOnce()
    }
  })
  it('does not substitute HTML or a mere description for a video', async () => {
    for (const response of [new Response('denied', { status: 403 }), new Response('login', { headers: { 'content-type': 'video/mp4' } }), new Response('html', { headers: { 'content-type': 'text/html' } })]) {
      const fetcher = vi.fn().mockResolvedValueOnce(page()).mockResolvedValueOnce(response); vi.stubGlobal('fetch', fetcher)
      await expect(retrieveTikTokVideo(url, new AbortController().signal)).rejects.toThrow('tiktok_video_unavailable')
      expect(fetcher).toHaveBeenCalledTimes(2)
    }
  })
  it('enforces streamed limits even with no length header and cancels the reader', async () => {
    const cancel = vi.fn()
    const stream = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(5)) }, cancel })
    await expect(readVideoResponse(new Response(stream), 8)).rejects.toThrow('tiktok_video_limit')
    expect(cancel).toHaveBeenCalled()
    await expect(readVideoResponse(new Response(bytes, { headers: { 'content-length': String(TIKTOK_MAX_BYTES + 1) } }), TIKTOK_MAX_BYTES)).rejects.toThrow('tiktok_video_limit')
  })
  it('does not fetch after cancellation', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    const abort = new AbortController(); abort.abort()
    await expect(retrieveTikTokVideo(url, abort.signal)).rejects.toThrow()
    expect(fetcher).not.toHaveBeenCalled()
  })
})

describe('Gemini video preparation and cleanup', () => {
  function setup(file = activeFile, uploadUrl = 'https://generativelanguage.googleapis.com/upload/v1beta/files?upload_id=test') {
    const fetcher = vi.fn().mockResolvedValueOnce(page()).mockResolvedValueOnce(mp4())
      .mockResolvedValueOnce(new Response(null, { headers: { 'x-goog-upload-url': uploadUrl } }))
      .mockResolvedValueOnce(Response.json({ file })).mockResolvedValueOnce(new Response(null))
    vi.stubGlobal('fetch', fetcher)
    return fetcher
  }
  it('uploads raw bytes, uses a fixed prompt, reserves media before retrieval, and deletes its file', async () => {
    const fetcher = setup(); let cleanup: (() => Promise<void>) | undefined
    const body = await prepareTikTokForGemini(url, 'synthetic-key', new AbortController().signal, fn => { cleanup = fn })
    expect(estimateInputTokens('gemini', tikTokAnalysisBody(url))).toBeGreaterThan(128_000)
    expect(estimateInputTokens('gemini', body)).toBeLessThanOrEqual(estimateInputTokens('gemini', tikTokAnalysisBody(url)) + 100)
    expect(JSON.stringify(body)).not.toContain('public-session')
    expect(JSON.stringify(body)).not.toContain('synthetic-key')
    expect(fetcher.mock.calls[3]![1].body).toEqual(bytes)
    expect(body).not.toHaveProperty('tools')
    expect(fetcher.mock.calls[2]![1].headers.Cookie).toBeUndefined()
    await cleanup!()
    expect(fetcher.mock.calls.at(-1)![1].method).toBe('DELETE')
  })
  it('registers deletion even when the uploaded video fails duration verification', async () => {
    setup({ ...activeFile, videoMetadata: { videoDuration: '999s' } }); const registered = vi.fn()
    await expect(prepareTikTokForGemini(url, 'synthetic-key', new AbortController().signal, registered)).rejects.toThrow('tiktok_analysis_unavailable')
    expect(registered).toHaveBeenCalledOnce()
  })
  it('does not upload the video or key to an unexpected upload host', async () => {
    const fetcher = setup(activeFile, 'https://evil.test/upload/file')
    await expect(prepareTikTokForGemini(url, 'synthetic-key', new AbortController().signal, vi.fn())).rejects.toThrow('tiktok_analysis_unavailable')
    expect(fetcher).toHaveBeenCalledTimes(3)
  })
  it('registers deletion before an upload response is lost or malformed', async () => {
    for (const malformed of [false, true]) {
      const fetcher = setup(); const registered = vi.fn()
      fetcher.mockReset().mockResolvedValueOnce(page()).mockResolvedValueOnce(mp4())
        .mockResolvedValueOnce(new Response(null, { headers: { 'x-goog-upload-url': 'https://generativelanguage.googleapis.com/upload/v1beta/files?upload_id=test' } }))
      if (malformed) fetcher.mockResolvedValueOnce(new Response('{broken'))
      else fetcher.mockRejectedValueOnce(new Error('Network lost'))
      await expect(prepareTikTokForGemini(url, 'synthetic-key', new AbortController().signal, registered)).rejects.toThrow()
      expect(registered).toHaveBeenCalledOnce()
    }
  })
})
