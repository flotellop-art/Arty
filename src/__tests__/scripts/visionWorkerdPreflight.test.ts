// @vitest-environment node
import { Buffer } from 'node:buffer'
import { inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
// @ts-expect-error The executable benchmark intentionally stays plain ESM.
import {
  aggregateRuns,
  crc32,
  percentile,
  pngFixture,
  visionPayload,
} from '../../../scripts/bench-vision-workerd-memory.mjs'

function readU32(bytes: Buffer, offset: number): number {
  return bytes.readUInt32BE(offset)
}

describe('préflight mémoire vision — fixtures et agrégation', () => {
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
