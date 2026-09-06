// @vitest-environment node
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { Miniflare } from 'miniflare'

// Resolve exactly the native dependency used by Miniflare, not an unrelated
// top-level package. CI repeats this on Linux; local verification is Windows.
const runtimeRequire = createRequire(createRequire(import.meta.url).resolve('miniflare'))

async function bounded<T>(operation: Promise<T>, step: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try { return await Promise.race([operation, new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Runtime smoke stalled: ${step}`)), 4000)
  })]) } finally { clearTimeout(timer) }
}

describe('security-update runtime compatibility', () => {
  it('loads patched libvips and processes a synthetic image', async () => {
    const sharp = runtimeRequire('sharp') as typeof import('sharp')
    const [major, minor, patch] = sharp.versions.vips.split('.').map(Number)
    expect(major > 8 || (major === 8 && (minor > 18 || (minor === 18 && patch >= 3)))).toBe(true)
    const png = await sharp({ create: { width: 3, height: 2, channels: 4, background: '#ff0000' } }).png().toBuffer()
    const resized = await sharp(png).resize(1, 1).png().toBuffer({ resolveWithObject: true })
    expect(resized.info).toMatchObject({ width: 1, height: 1, format: 'png' })
    console.info('native dependency receipt', { platform: process.platform, arch: process.arch, sharp: sharp.versions.sharp, vips: sharp.versions.vips })
  })

  it('roundtrips binary HTTP and can cancel a progressive response before reusing the same worker', async () => {
    let streamController: ReadableStreamDefaultController<Uint8Array> | undefined
    const mf = new Miniflare({
      modules: true, compatibilityDate: '2026-07-01',
      script: 'export default { fetch(request, env) { return env.UPSTREAM.fetch(request); } };',
      serviceBindings: { UPSTREAM: async (request: Request) => {
        if (new URL(request.url).pathname === '/stream') return new Response(new ReadableStream<Uint8Array>({
          start(controller) { streamController = controller; controller.enqueue(new TextEncoder().encode('first-fragment')) },
        }), { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform' } })
        return new Response(await request.arrayBuffer(), { status: 201, headers: {
          'Content-Type': request.headers.get('Content-Type')!, 'X-Arty-Sentinel': request.headers.get('X-Arty-Sentinel')!,
        } })
      } },
    })
    try {
      const bytes = new Uint8Array([0, 255, 17, 195, 169, 240, 159, 140, 158])
      const echo = async () => {
        const response = await bounded(mf.dispatchFetch('http://synthetic.test/echo', { method: 'POST', body: bytes,
          headers: { 'Content-Type': 'application/octet-stream', 'X-Arty-Sentinel': 'synthetic' } }), 'echo headers')
        expect(response.status).toBe(201)
        expect(response.headers.get('Content-Type')).toBe('application/octet-stream')
        expect(response.headers.get('X-Arty-Sentinel')).toBe('synthetic')
        expect(new Uint8Array(await bounded(response.arrayBuffer(), 'echo body'))).toEqual(bytes)
      }
      await echo()
      const response = await bounded(mf.dispatchFetch('http://synthetic.test/stream'), 'stream headers')
      const reader = response.body!.getReader()
      const first = await bounded(reader.read(), 'first fragment')
      expect(first.done).toBe(false)
      expect(new TextDecoder().decode(first.value)).toBe('first-fragment')
      await bounded(reader.cancel(), 'cancel reader')
      await echo()
    } finally {
      try { streamController?.close() } catch { /* A cancelled stream may already be closed. */ }
      await mf.dispose()
    }
  }, 15_000)
})
