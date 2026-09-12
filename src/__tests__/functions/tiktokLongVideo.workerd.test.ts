// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { build } from 'esbuild'
import { Miniflare, NoOpLog } from 'miniflare'

let runtime: Miniflare
let total = 32, declared: number | undefined = 32, duration = 274, googleDuration = 274
let rejectUpload = false, brokenSource = false, splitPrefix = false
let slowUpload = false
let starts = 0, deleted = 0
let uploaded: number[] = []
const google = 'https://generativelanguage.googleapis.com'
const magic = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109])

beforeAll(async () => {
  const bundle = await build({ bundle: true, write: false, format: 'esm', platform: 'browser', stdin: {
    resolveDir: process.cwd(), contents: `
      import { prepareTikTokForGemini } from './functions/api/_lib/tiktokVideo.ts';
      const realFetch = globalThis.fetch;
      let abortNextUpload;
      globalThis.fetch = async (...args) => {
        if (abortNextUpload && String(args[0]).includes('/upload/') && String(args[0]).includes('?')) {
          const abort = abortNextUpload; abortNextUpload = undefined;
          setTimeout(() => abort.abort(), 20);
        }
        const response = await realFetch(...args);
        if (response.headers.has('x-test-broken')) {
          let chunks = 0;
          return new Response(response.body.pipeThrough(new TransformStream({transform(chunk, controller) {
            if (++chunks > 1) throw new Error('source interrupted');
            controller.enqueue(chunk);
          }, flush() { throw new Error('source interrupted'); }})), {headers: response.headers});
        }
        // Inject a lying header after the HTTP bridge, which otherwise
        // truncates/waits for that length before the application can see EOF.
        const length = response.headers.get('x-test-declared');
        if (length === null) return response;
        const headers = new Headers(response.headers); headers.set('content-length', length);
        return new Response(response.body, {headers});
      };
      export default { async fetch(request) {
        let cleanup;
        const abort = new AbortController();
        if (new URL(request.url).searchParams.has('abort')) abortNextUpload = abort;
        try {
          await prepareTikTokForGemini('https://www.tiktok.com/@test/video/7683978418702011670',
            'synthetic-key', AbortSignal.any([abort.signal, AbortSignal.timeout(20000)]), fn => { cleanup = fn });
          return Response.json({ ok: true });
        } catch(error) { return Response.json({ error: error.message }, {status:422}); }
        finally { if (cleanup) await cleanup(); }
      }};`,
  } })
  runtime = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-07-01', log: new NoOpLog(),
    outboundService: async request => {
      const url = new URL(request.url)
      if (url.hostname === 'www.tiktok.com') return new Response(`<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__">${JSON.stringify({ __DEFAULT_SCOPE__: { 'webapp.video-detail': { statusCode: 0, itemInfo: { itemStruct: { id: '7683978418702011670', video: { duration, playAddr: 'https://v19-webapp-prime.tiktok.com/video/test' } } } } } })}</script>`)
      if (url.hostname === 'v19-webapp-prime.tiktok.com') {
        let sent = 0
        return new Response(new ReadableStream({ pull(controller) {
          if (sent === total) { controller.close(); return }
          const size = Math.min(splitPrefix && sent < 12 ? 3 : 65536, total - sent)
          const chunk = new Uint8Array(size)
          for (let i = 0; i < size && sent + i < 12; i++) chunk[i] = magic[sent + i]!
          sent += size; controller.enqueue(chunk)
        } }), { headers: { 'content-type': 'video/mp4', ...(brokenSource ? { 'x-test-broken': '1' } : {}), ...(declared === undefined ? {} : declared === total
          ? { 'content-length': String(declared) } : { 'x-test-declared': String(declared) }) } })
      }
      expect(url.origin).toBe(google)
      expect(request.headers.get('x-goog-api-key')).toBe('synthetic-key')
      if (request.method === 'DELETE') { deleted++; return new Response(null, { status: 204 }) }
      if (!url.search) {
        starts++
        const name = (await request.json() as { file: { name: string } }).file.name
        return new Response(null, { headers: { 'x-goog-upload-url': `${google}/upload/v1beta/files?name=${name}` } })
      }
      if (rejectUpload) return new Response(null, { status: 503 })
      // Read incrementally on both sides: never materialize the large body.
      expect(Number(request.headers.get('content-length'))).toBe(declared ?? total)
      const reader = request.body!.getReader()
      let received = 0
      try {
        if (slowUpload) await new Promise(resolve => setTimeout(resolve, 200))
        while (true) {
          const next = await reader.read()
          if (next.done) break
          for (let i = 0; i < next.value.length && received + i < 12; i++) expect(next.value[i]).toBe(magic[received + i])
          received += next.value.length
        }
      } catch { return new Response(null, { status: 400 }) }
      finally { reader.releaseLock() }
      uploaded.push(received)
      const name = url.searchParams.get('name')
      return Response.json({ file: { name, uri: `${google}/v1beta/${name}`, state: 'ACTIVE', mimeType: 'video/mp4', videoMetadata: { videoDuration: `${googleDuration}s` } } })
    },
  })
})
beforeEach(() => { total = 32; declared = 32; duration = 274; googleDuration = 274; rejectUpload = false; brokenSource = false; splitPrefix = false; slowUpload = false; starts = 0; deleted = 0; uploaded = [] })
afterAll(async () => { await runtime.dispose() })

describe('long TikTok streaming through real workerd', () => {
  it.each([274, 600])('accepts the entire %s-second file and a split MP4 header', async seconds => {
    duration = googleDuration = seconds; splitPrefix = true
    expect((await runtime.dispatchFetch('https://arty.test')).status).toBe(200)
    expect(uploaded).toEqual([total]); expect(deleted).toBe(1)
  })
  it('transfers the reported 32,614,135 bytes without the old buffered limit', async () => {
    total = declared = 32_614_135
    expect((await runtime.dispatchFetch('https://arty.test')).status).toBe(200)
    expect(uploaded).toEqual([total])
  })
  it('streams two simultaneous files at the 128 MiB ceiling', async () => {
    total = declared = 128 * 1024 * 1024
    const responses = await Promise.all([runtime.dispatchFetch('https://arty.test'), runtime.dispatchFetch('https://arty.test')])
    expect(responses.map(r => r.status)).toEqual([200, 200])
    expect(uploaded).toEqual([total, total]); expect(deleted).toBe(2)
  }, 30_000)
  it.each(['duration', 'bytes'])('refuses excessive %s before any Google upload', async field => {
    if (field === 'duration') duration = 601
    else declared = 128 * 1024 * 1024 + 1
    expect((await runtime.dispatchFetch('https://arty.test')).status).toBe(422)
    expect(starts).toBe(0)
  })
  it('retains the bounded fallback for an absent length', async () => {
    declared = undefined
    expect((await runtime.dispatchFetch('https://arty.test')).status).toBe(200)
    expect(uploaded).toEqual([total])
  })
  it('stops an upload already started, cleans up, and never accepts a late result', async () => {
    total = declared = 128 * 1024 * 1024; slowUpload = true
    const response = await runtime.dispatchFetch('https://arty.test?abort')
    expect(response.status).toBe(422)
    expect(starts).toBe(1); expect(deleted).toBe(1)
    await new Promise(resolve => setTimeout(resolve, 250))
    // The destination may receive a prefix and even reply 200 after Stop.
    // It must not receive the whole file or turn the settled refusal into success.
    expect(uploaded.every(bytes => bytes < total)).toBe(true)
    expect(await response.json()).not.toHaveProperty('ok')
    expect(starts).toBe(1); expect(deleted).toBe(1)
  })
  it.each(['short', 'long', 'interrupted', 'refused', 'duration mismatch'])('rejects %s and cleans its temporary file', async failure => {
    if (failure === 'short') declared = total + 1
    if (failure === 'long') declared = total - 1
    if (failure === 'interrupted') { brokenSource = true; splitPrefix = true }
    if (failure === 'refused') rejectUpload = true
    if (failure === 'duration mismatch') googleDuration = 16
    const response = await runtime.dispatchFetch('https://arty.test')
    expect(response.status).toBe(422)
    if (failure === 'long') expect(await response.json()).toEqual({ error: 'tiktok_video_limit' })
    expect(deleted).toBe(1)
  })
})
