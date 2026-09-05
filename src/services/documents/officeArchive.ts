import { Inflate } from 'fflate'

// A deliberately bounded subset of ZIP/OOXML, not a general archive service.
// ZIP layout: PKWARE APPNOTE 6.3.10, sections 4.3.7, 4.3.12, 4.3.16.
// Stream DEFLATE in small chunks: never unzipSync before checking output size.
export const OFFICE_LIMITS = {
  sourceBytes: 10 * 1024 * 1024,
  requestSourceBytes: 20 * 1024 * 1024,
  xmlBytes: 2 * 1024 * 1024,
  requestXmlBytes: 6 * 1024 * 1024,
  entries: 1000,
  nodes: 100_000,
  textChars: 200_000,
  cells: 20_000,
} as const

export type OfficeErrorCode = 'unsupported' | 'corrupt' | 'limit' | 'unavailable' | 'cancelled'
export class OfficeReadError extends Error {
  constructor(public readonly code: OfficeErrorCode, public readonly fileName = '') {
    super(`office_${code}`)
  }
}

export interface OfficeBudget {
  sourceBytes: number
  xmlBytes: number
  nodes: number
  textChars: number
  cells: number
  assertCurrent: () => void
}

export function officeBudget(assertCurrent: () => void = () => {}): OfficeBudget {
  return { sourceBytes: 0, xmlBytes: 0, nodes: 0, textChars: 0, cells: 0, assertCurrent }
}

export async function officeYield(budget: OfficeBudget): Promise<void> {
  budget.assertCurrent()
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  budget.assertCurrent()
}

export function consumeOffice(budget: OfficeBudget, key: 'sourceBytes' | 'xmlBytes' | 'nodes' | 'textChars' | 'cells', amount: number): void {
  const limit = key === 'sourceBytes' ? OFFICE_LIMITS.requestSourceBytes
    : key === 'xmlBytes' ? OFFICE_LIMITS.requestXmlBytes : OFFICE_LIMITS[key]
  budget[key] += amount
  if (budget[key] > limit) throw new OfficeReadError('limit')
}

interface Entry { name: string; offset: number; compressed: number; original: number; crc: number; method: number; start: number; end: number }

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1
  return n >>> 0
})

const utf8 = new TextDecoder('utf-8', { fatal: true })
const corrupt = (): never => { throw new OfficeReadError('corrupt') }

// Conservative allocation guard BEFORE DOMParser. This is not an XML parser:
// DOMParser still validates syntax. Count markup/text upper bounds and nesting,
// skipping quoted attributes, comments and CDATA to avoid unbounded DOM trees.
async function preflightXml(xml: string, budget: OfficeBudget): Promise<void> {
  let depth = 0, nodesUpperBound = 1, lastYield = 0
  for (let p = 0; p < xml.length; p++) {
    if (xml[p] !== '<') continue
    nodesUpperBound += 2 // markup node and a possible preceding text node
    if (budget.nodes + nodesUpperBound > OFFICE_LIMITS.nodes) throw new OfficeReadError('limit')
    let end: number
    if (xml.startsWith('<!--', p) || xml.startsWith('<![CDATA[', p) || xml.startsWith('<?', p)) {
      const marker = xml.startsWith('<!--', p) ? '-->' : xml.startsWith('<?', p) ? '?>' : ']]>'
      end = xml.indexOf(marker, p + 2)
      if (end < 0) corrupt()
      p = end + marker.length - 1
    } else {
      if (xml[p + 1] === '!') corrupt()
      let quote = '', attributes = 0
      for (end = p + 1; end < xml.length; end++) {
        const char = xml[end]!
        if (quote) { if (char === quote) quote = '' }
        else if (char === '"' || char === "'") {
          quote = char
          attributes++
          nodesUpperBound++
          if (attributes > 256 || budget.nodes + nodesUpperBound > OFFICE_LIMITS.nodes) throw new OfficeReadError('limit')
        }
        else if (char === '>') break
      }
      if (end >= xml.length) corrupt()
      if (xml[p + 1] === '/') depth--
      else if (xml[end - 1] !== '/') depth++
      // Reserve a level for the document and leaf text nodes.
      if (depth > 62) throw new OfficeReadError('limit')
      if (depth < 0) corrupt()
      p = end
    }
    if (p - lastYield >= 65536) { await officeYield(budget); lastYield = p }
  }
  if (depth !== 0) corrupt()
  await officeYield(budget)
}

export class OfficeArchive {
  readonly entries = new Map<string, Entry>()

  constructor(private readonly bytes: Uint8Array, private readonly budget: OfficeBudget) {
    budget.assertCurrent()
    if (bytes.length > OFFICE_LIMITS.sourceBytes) throw new OfficeReadError('limit')
    consumeOffice(budget, 'sourceBytes', bytes.length)
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const u16 = (p: number) => view.getUint16(p, true)
    const u32 = (p: number) => view.getUint32(p, true)
    let end = bytes.length - 22
    for (; end >= Math.max(0, bytes.length - 65557); end--) {
      if (u32(end) === 0x06054b50 && end + 22 + u16(end + 20) === bytes.length) break
    }
    if (end < 0 || end < bytes.length - 65557) corrupt()
    if (u16(end + 4) || u16(end + 6) || u16(end + 8) !== u16(end + 10)) corrupt()
    const count = u16(end + 10), central = u32(end + 16)
    if (count > OFFICE_LIMITS.entries) throw new OfficeReadError('limit')
    if (!count || central + u32(end + 12) !== end) corrupt()
    let p = central
    for (let i = 0; i < count; i++) {
      if (p + 46 > end || u32(p) !== 0x02014b50) corrupt()
      const flags = u16(p + 8), method = u16(p + 10)
      const nameSize = u16(p + 28), extraSize = u16(p + 30), commentSize = u16(p + 32)
      const offset = u32(p + 42), compressed = u32(p + 20), original = u32(p + 24), crc = u32(p + 16)
      if (flags & ~0x080e || (method !== 0 && method !== 8) || u16(p + 34) ||
        compressed === 0xffffffff || original === 0xffffffff || offset === 0xffffffff) {
        throw new OfficeReadError('unsupported')
      }
      if (p + 46 + nameSize + extraSize + commentSize > end || offset + 30 > central) corrupt()
      const name = utf8.decode(bytes.subarray(p + 46, p + 46 + nameSize))
      // No alternate normalisations, ZIP slip, NUL names, or duplicate parts.
      if (!name || /[\\\x00-\x1f:]/.test(name) || name.startsWith('/') ||
        name.split('/').some((part) => part === '.' || part === '..') || this.entries.has(name)) corrupt()
      if (u32(offset) !== 0x04034b50 || u16(offset + 6) !== flags || u16(offset + 8) !== method) corrupt()
      const localNameSize = u16(offset + 26), localExtraSize = u16(offset + 28)
      const start = offset + 30 + localNameSize + localExtraSize
      if (start + compressed > central || utf8.decode(bytes.subarray(offset + 30, offset + 30 + localNameSize)) !== name) corrupt()
      if (!(flags & 8) && (u32(offset + 14) !== crc || u32(offset + 18) !== compressed || u32(offset + 22) !== original)) corrupt()
      let entryEnd = start + compressed
      if (flags & 8) {
        // Streaming ZIP writers put CRC/sizes in a mandatory descriptor.
        if ([14, 18, 22].some((field, index) => u32(offset + field) !== 0 && u32(offset + field) !== [crc, compressed, original][index])) corrupt()
        if (entryEnd + 12 > central) corrupt()
        const descriptor = entryEnd + (u32(entryEnd) === 0x08074b50 ? 4 : 0)
        if (descriptor + 12 > central || u32(descriptor) !== crc || u32(descriptor + 4) !== compressed || u32(descriptor + 8) !== original) corrupt()
        entryEnd = descriptor + 12
      }
      if (method === 0 && compressed !== original) corrupt()
      // ZIP64 is intentionally unsupported, including redundant extra records.
      for (const [base, length] of [[p + 46 + nameSize, extraSize], [offset + 30 + localNameSize, localExtraSize]]) {
        let e = base!
        while (e < base! + length!) {
          if (e + 4 > base! + length!) corrupt()
          if (u16(e) === 1) throw new OfficeReadError('unsupported')
          e += 4 + u16(e + 2)
        }
        if (e !== base! + length!) corrupt()
      }
      this.entries.set(name, { name, offset, compressed, original, crc, method, start, end: entryEnd })
      p += 46 + nameSize + extraSize + commentSize
    }
    if (p !== end) corrupt()
    let previousEnd = 0
    for (const entry of [...this.entries.values()].sort((a, b) => a.offset - b.offset)) {
      if (entry.offset < previousEnd) corrupt()
      previousEnd = entry.end
    }
    if ([...this.entries.keys()].some((name) => /(?:vbaProject\.bin|encryptionInfo|encryptedPackage)$/i.test(name))) {
      throw new OfficeReadError('unsupported')
    }
  }

  async xml(name: string): Promise<Document> {
    const entry = this.entries.get(name)
    if (!entry) return corrupt()
    this.budget.assertCurrent()
    if (entry.original > OFFICE_LIMITS.xmlBytes) throw new OfficeReadError('limit')
    let size = 0, crc = 0xffffffff
    const chunks: Uint8Array[] = []
    const ondata = (chunk: Uint8Array) => {
      size += chunk.length
      consumeOffice(this.budget, 'xmlBytes', chunk.length)
      if (size > OFFICE_LIMITS.xmlBytes) throw new OfficeReadError('limit')
      for (const byte of chunk) crc = CRC_TABLE[(crc ^ byte) & 255]! ^ (crc >>> 8)
      chunks.push(chunk)
    }
    const inflater = entry.method === 8 ? new Inflate(ondata) : null
    for (let p = 0; p < entry.compressed; p += 1024) {
      const chunk = this.bytes.subarray(entry.start + p, entry.start + Math.min(p + 1024, entry.compressed))
      if (inflater) inflater.push(chunk, p + 1024 >= entry.compressed)
      else ondata(chunk)
      if (p % 16384 === 0) await officeYield(this.budget)
    }
    if (size !== entry.original || ((crc ^ 0xffffffff) >>> 0) !== entry.crc) corrupt()
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
    chunks.length = 0
    const xml = utf8.decode(bytes)
    // Reject DTD/entity declarations, including encodings other than UTF-8.
    if (/<!DOCTYPE|<!ENTITY/i.test(xml) || /<\?xml[^>]*encoding\s*=\s*["'](?!utf-8["'])/i.test(xml)) corrupt()
    await preflightXml(xml, this.budget)
    const doc = new DOMParser().parseFromString(xml, 'application/xml')
    if (doc.getElementsByTagName('parsererror').length) corrupt()
    const stack: Array<[Node, number]> = [[doc, 0]]
    while (stack.length) {
      const [node, depth] = stack.pop()!
      consumeOffice(this.budget, 'nodes', 1 + (node.nodeType === 1 ? (node as Element).attributes.length : 0))
      if (depth > 64) throw new OfficeReadError('limit')
      for (let child = node.lastChild; child; child = child.previousSibling) stack.push([child, depth + 1])
    }
    await officeYield(this.budget)
    return doc
  }
}
