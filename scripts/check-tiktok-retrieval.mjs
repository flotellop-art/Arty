// Explicit live check of retrieval only. No AI key, account or model request.
// node scripts/check-tiktok-retrieval.mjs https://vm.tiktok.com/...
import { build } from 'esbuild'
import { Miniflare, NoOpLog } from 'miniflare'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const url = process.argv[2]
if (!url) throw new Error('A public TikTok video URL is required')
const bundle = await build({ stdin: { contents: `
import { retrieveTikTokVideo } from './functions/api/_lib/tiktokVideo.ts';
export default { async fetch(request) {
  try {
    const video = await retrieveTikTokVideo(new URL(request.url).searchParams.get('url'), AbortSignal.timeout(30000));
    return new Response(video.bytes, {headers:{'content-type':'video/mp4','x-duration':String(video.duration)}});
  } catch(error) { return Response.json({error:error.message}, {status:502}); }
} };`, resolveDir: process.cwd() }, bundle: true, format: 'esm', platform: 'browser', write: false })
const worker = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-07-01', log: new NoOpLog() })
try {
  const response = await worker.dispatchFetch(`https://local.test/?url=${encodeURIComponent(url)}`)
  if (!response.ok) { console.log(JSON.stringify({ ok: false, status: response.status, error: (await response.json()).error })); process.exitCode = 1 }
  else {
    const bytes = new Uint8Array(await response.arrayBuffer())
    const directory = join(tmpdir(), `arty-tiktok-integration-${Date.now()}`)
    await mkdir(directory)
    const path = join(directory, 'video.mp4')
    await writeFile(path, bytes)
    const decoded = spawnSync('ffmpeg', ['-v', 'error', '-xerror', '-i', path, '-map', '0:v:0', '-map', '0:a:0', '-f', 'null', '-'], { encoding: 'utf8', timeout: 30000, windowsHide: true })
    console.log(JSON.stringify({ ok: true, runtime: 'local-workerd', bytes: bytes.length, declaredSeconds: Number(response.headers.get('x-duration')), audioAndVideoDecoded: decoded.status === 0, path }))
    if (decoded.status !== 0) process.exitCode = 1
  }
} finally { await worker.dispose() }
