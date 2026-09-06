// @vitest-environment node
import { Buffer } from 'node:buffer'
import { inflateSync } from 'node:zlib'
import { describe, expect, it, vi } from 'vitest'
// @ts-expect-error The executable benchmark intentionally stays plain ESM.
import {
  aggregateRuns,
  crc32,
  percentile,
  pngFixture,
  runScenario,
  visionPayload,
} from '../../../scripts/bench-vision-workerd-memory.mjs'

function readU32(bytes: Buffer, offset: number): number {
  return bytes.readUInt32BE(offset)
}

describe('préflight mémoire vision — fixtures et agrégation', () => {
  it('stops the refusal polling loop and retains the original cause when a transport ignores abort', async () => {
    vi.useFakeTimers()
    try {
      let calls = 0
      const runtime = {
        inspector: { command: async () => ({ usedSize: 1, embedderHeapUsedSize: 1, backingStorageSize: 1 }) },
        firstUpstream: Promise.resolve(), releaseUpstreams: vi.fn(), stats: () => ({}),
        miniflare: { dispatchFetch: async () => {
          if (calls++ === 0) { await new Promise(resolve => setTimeout(resolve, 10)); throw new Error('original transport error') }
          return new Promise(() => {}) // deliberately ignores AbortSignal
        } },
      }
      const outcome = runScenario({ runtime, makePayload: () => '{}', concurrency: 2,
        pathName: 'byok', gateBytes: 1000, sampleDuring: true }).then(() => null, (error: Error) => error)
      await vi.advanceTimersByTimeAsync(30_011)
      const error = await outcome
      expect(error).toBeInstanceOf(AggregateError)
      expect((error as AggregateError).errors.map((e: Error) => e.message)).toEqual([
        'original transport error', 'Scenario cleanup timed out after 30000 ms',
      ])
      expect(vi.getTimerCount()).toBe(0)
    } finally { vi.useRealTimers() }
  })

  it.each(['transport', 'identity', 'inspector'])('propagates an early %s failure without waiting for an impossible upstream and drains pending work', async failure => {
    let calls = 0, drained = 0
    const releaseUpstreams = vi.fn()
    const heap = { usedSize: 1, embedderHeapUsedSize: 1, backingStorageSize: 1 }
    const command = vi.fn(async () => {
      if (failure === 'inspector' && command.mock.calls.length > 1) throw new Error('synthetic inspector error')
      return heap
    })
    const runtime = { inspector: { command }, releaseUpstreams,
      firstUpstream: new Promise(() => {}), stats: () => ({}),
      miniflare: { dispatchFetch: async (_url: string, { signal }: { signal: AbortSignal }) => {
        if (calls++ === 0 && failure !== 'inspector') {
          if (failure === 'identity') return new Response('verified identity missing', { status: 401 })
          throw new Error('synthetic transport error')
        }
        return new Promise((_, reject) => signal.addEventListener('abort', () => {
          expect(releaseUpstreams).toHaveBeenCalled(); drained++; reject(new Error('synthetic drained'))
        }, { once: true }))
      } },
    }
    await expect(runScenario({ runtime, makePayload: () => '{}', concurrency: 2,
      pathName: 'byok', gateBytes: 1000, sampleDuring: true })).rejects.toThrow(
      failure === 'identity' ? 'Proxy returned 401: verified identity missing' : `synthetic ${failure} error`)
    expect(drained).toBe(failure === 'inspector' ? 2 : 1)
    expect(releaseUpstreams).toHaveBeenCalled()
  })

  it('produit un PNG 4096² décodable, à CRC valides et taille exacte', () => {
    const expectedBytes = 64 * 1024
    const bytes = Buffer.from(pngFixture(expectedBytes, 7), 'base64')
    expect(bytes.length).toBe(expectedBytes)
    expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

    const idat: Buffer[] = []
    let offset = 8
    let sawIend = false
    while (offset < bytes.length) {
      const length = readU32(bytes, offset)
      const typeBytes = bytes.subarray(offset + 4, offset + 8)
      const data = bytes.subarray(offset + 8, offset + 8 + length)
      const storedCrc = readU32(bytes, offset + 8 + length)
      expect(storedCrc).toBe(crc32(typeBytes, data))
      const type = typeBytes.toString('ascii')
      if (type === 'IHDR') {
        expect(readU32(data, 0)).toBe(4096)
        expect(readU32(data, 4)).toBe(4096)
      }
      if (type === 'IDAT') idat.push(data)
      if (type === 'IEND') sawIend = true
      offset += 12 + length
    }
    expect(offset).toBe(bytes.length)
    expect(sawIend).toBe(true)

    const pixels = inflateSync(Buffer.concat(idat))
    expect(pixels.length).toBe((4096 + 1) * 4096)
    expect(pixels[0]).toBe(0)
    expect(pixels[1]).toBe(7)
    expect(pixels[4097]).toBe(0)
  })

  it('construit quatre data URLs distinctes sous la borne JSON', () => {
    const images = [1, 2, 3, 4].map((fill) => pngFixture(64 * 1024, fill))
    const payload = JSON.parse(visionPayload(images, 'nonce'.padEnd(40, '0'))) as {
      messages: Array<{ content: Array<{ image_url?: { url: string } }> }>
    }
    const urls = payload.messages[0].content
      .map((block) => block.image_url?.url)
      .filter((url): url is string => !!url)
    expect(urls).toHaveLength(4)
    expect(new Set(urls).size).toBe(4)
  })

  it('calcule médiane, p95 et verdict sur toutes les répétitions', () => {
    expect(percentile([10, 30, 20, 50, 40], 0.5)).toBe(30)
    expect(percentile([10, 30, 20, 50, 40], 0.95)).toBe(50)
    const runs = [10, 20, 30, 40, 50].map((peakBytes) => ({
      peakBytes,
      durationMs: peakBytes,
      localPreflightPassed: peakBytes < 50,
      statuses: [200],
      baselineBytes: 1,
      peakDeltaBytes: peakBytes - 1,
      upstreamBytes: 2,
      upstreamCalls: 1,
      maxActiveUpstreams: 1,
      contractPassed: true,
    }))
    const aggregate = aggregateRuns(runs)
    expect(aggregate.repetitions).toBe(5)
    expect(aggregate.localPreflightPassed).toBe(false)
    expect(aggregate.runs).toHaveLength(5)
  })
})
