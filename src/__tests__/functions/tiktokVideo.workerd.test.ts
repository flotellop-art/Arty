// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { build } from 'esbuild'
import { Miniflare, NoOpLog } from 'miniflare'

let runtime: Miniflare
let rejectStage = ''
let fileName = ''
let calls: string[] = []
const google = 'https://generativelanguage.googleapis.com'
const bytes = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0])
const activeFile = () => ({ name: fileName, uri: `${google}/v1beta/${fileName}`, state: 'ACTIVE', mimeType: 'video/mp4', videoMetadata: { videoDuration: '16s' } })
beforeAll(async () => {
  const bundle = await build({ bundle: true, write: false, format: 'esm', platform: 'browser', stdin: {
    resolveDir: process.cwd(), contents: `
      import { prepareTikTokForGemini } from './functions/api/_lib/tiktokVideo.ts';
      export default { async fetch() {
        let cleanup;
        try {
          const body = await prepareTikTokForGemini('https://www.tiktok.com/@test/video/7683978418702011670',
            'synthetic-google-key', AbortSignal.timeout(10000), fn => { cleanup = fn });
          return Response.json({ body });
        } catch(error) { return Response.json({ error: error.message }, {status:502}); }
        finally { if (cleanup) await cleanup(); }
      }};
    `,
  } })
  runtime = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-07-01', log: new NoOpLog(),
    outboundService: async request => {
      // Actual workerd Request construction, streams and redirects; every
      // outbound request is handled here, with no public network or API key.
      const url = new URL(request.url)
      calls.push(`${request.method} ${url.origin}${url.pathname}`)
      if (url.hostname === 'www.tiktok.com') return new Response(`<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__">${JSON.stringify({ __DEFAULT_SCOPE__: { 'webapp.video-detail': { statusCode: 0, itemInfo: { itemStruct: { id: '7683978418702011670', video: { duration: 16, playAddr: 'https://v19-webapp-prime.tiktok.com/video/test' } } } } } })}</script>`)
      if (url.hostname === 'v19-webapp-prime.tiktok.com') return new Response(bytes, { headers: { 'content-type': 'video/mp4' } })
      expect(url.origin).toBe(google)
      expect(request.headers.get('x-goog-api-key')).toBe('synthetic-google-key')
      const stage = request.method === 'DELETE' ? 'delete' : request.method === 'GET' ? 'poll' : url.search ? 'upload' : 'start'
      if (stage === rejectStage) return new Response(null, { status: 302, headers: { location: 'https://untrusted.invalid/steal' } })
      if (stage === 'start') {
        fileName = (await request.json() as { file: { name: string } }).file.name
        return new Response(null, { headers: { 'x-goog-upload-url': `${google}/upload/v1beta/files?upload_id=synthetic` } })
      }
      if (stage === 'upload') {
        expect(new Uint8Array(await request.arrayBuffer())).toEqual(bytes)
        return Response.json({ file: { ...activeFile(), state: 'PROCESSING' } })
      }
      if (stage === 'poll') return Response.json(activeFile())
      return new Response(null, { status: 204 })
    },
  })
})
beforeEach(() => { rejectStage = ''; fileName = ''; calls = [] })
afterAll(async () => { await runtime.dispose() })

describe('TikTok upload under the deployed workerd fetch implementation', () => {
  it('uploads, polls and deletes the same file without a runtime redirect-mode error', async () => {
    const response = await runtime.dispatchFetch('https://arty.test')
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ body: { contents: [{ parts: [{ fileData: { fileUri: `${google}/v1beta/${fileName}` } }, {}] }] } })
    expect(calls.slice(2)).toEqual([`POST ${google}/upload/v1beta/files`, `POST ${google}/upload/v1beta/files`, `GET ${google}/v1beta/${fileName}`, `DELETE ${google}/v1beta/${fileName}`])
  })
  it.each(['start', 'upload', 'poll', 'delete'])('never follows a Google %s redirect with the video or key', async stage => {
    rejectStage = stage
    const response = await runtime.dispatchFetch('https://arty.test')
    expect(response.status).toBe(stage === 'delete' ? 200 : 502)
    if (stage !== 'delete') expect(await response.json()).toEqual({ error: 'tiktok_analysis_unavailable' })
    expect(calls.some(call => call.includes('untrusted.invalid'))).toBe(false)
    expect(calls.filter(call => call.startsWith('DELETE '))).toHaveLength(1)
  })
})
