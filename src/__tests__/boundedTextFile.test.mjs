// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { readBoundedText } from '../../scripts/lib/boundedTextFile.mjs'

function reader(content, { short = false, grow = false, fail = false, regular = true } = {}) {
  let bytes = Buffer.from(content), offset = 0
  const descriptor = 42, buffers = new Set()
  const io = {
    openSync: vi.fn(() => descriptor),
    fstatSync: vi.fn(() => ({ isFile: () => regular, size: bytes.length })),
    readSync: vi.fn((fd, buffer, targetOffset, length, position) => {
      expect(fd).toBe(descriptor); expect(position).toBeNull()
      expect(buffer.length).toBe(65_537); expect(length).toBe(65_537 - targetOffset)
      buffers.add(buffer)
      if (fail) throw new Error('read failed')
      // Same descriptor grows after the first partial read; initial stat is stale.
      if (grow && offset > 0) bytes = Buffer.alloc(90_000, 120)
      const count = Math.min(length, bytes.length - offset, short ? 7 : length)
      bytes.copy(buffer, targetOffset, offset, offset + count); offset += count
      return count
    }),
    closeSync: vi.fn(),
  }
  return { io, buffers, descriptor }
}

describe('fixed-buffer aggregate file reader', () => {
  it('handles partial reads using only the initially opened descriptor', () => {
    const mock = reader('a short synthetic JSON-shaped input {}', { short: true })
    expect(readBoundedText('original-path', mock.io)).toBe('a short synthetic JSON-shaped input {}')
    expect(mock.io.openSync).toHaveBeenCalledExactlyOnceWith('original-path', 'r')
    expect(mock.io.fstatSync).toHaveBeenCalledExactlyOnceWith(mock.descriptor)
    expect(mock.io.closeSync).toHaveBeenCalledExactlyOnceWith(mock.descriptor)
    expect(mock.buffers.size).toBe(1)
  })

  it('refuses growth beyond the limit with a single 65537-byte buffer', () => {
    const mock = reader('initial small content', { short: true, grow: true })
    expect(() => readBoundedText('path-replaced-after-open', mock.io)).toThrow('invalid input')
    expect(mock.io.openSync).toHaveBeenCalledTimes(1)
    expect(mock.io.closeSync).toHaveBeenCalledTimes(1)
    expect(mock.buffers.size).toBe(1)
  })

  it.each([{ fail: true }, { regular: false }])('closes the descriptor on failure %j', options => {
    const mock = reader('{}', options)
    expect(() => readBoundedText('path', mock.io)).toThrow()
    expect(mock.io.closeSync).toHaveBeenCalledExactlyOnceWith(mock.descriptor)
  })

  it('accepts exactly 64 KiB and rejects the next byte', () => {
    expect(readBoundedText('path', reader('x'.repeat(65_536)).io)).toHaveLength(65_536)
    expect(() => readBoundedText('path', reader('x'.repeat(65_537)).io)).toThrow('invalid input')
  })
})
