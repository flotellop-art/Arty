import { closeSync, fstatSync, openSync, readSync } from 'node:fs'

// CLI-only fixed-size reader. The optional IO seam exercises short reads and
// concurrent growth without racing real files or using a second pathname read.
export function readBoundedText(path, io = { closeSync, fstatSync, openSync, readSync }) {
  const descriptor = io.openSync(path, 'r'), buffer = Buffer.alloc(65_537)
  let length = 0
  try {
    if (!io.fstatSync(descriptor).isFile()) throw new Error('invalid input')
    while (length < buffer.length) {
      const count = io.readSync(descriptor, buffer, length, buffer.length - length, null)
      if (!Number.isInteger(count) || count < 0 || count > buffer.length - length) throw new Error('invalid read')
      if (count === 0) break
      length += count
    }
    if (length > 65_536) throw new Error('invalid input')
    return buffer.subarray(0, length).toString('utf8')
  } finally { io.closeSync(descriptor) }
}
