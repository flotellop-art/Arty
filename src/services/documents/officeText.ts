import type { FileAttachment } from '../../types'
import { consumeOffice, OfficeArchive, OfficeReadError, OFFICE_LIMITS, officeBudget, type OfficeBudget } from './officeArchive'

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const WORD_NS = ['http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'http://purl.oclc.org/ooxml/wordprocessingml/main']
const SHEET_NS = ['http://schemas.openxmlformats.org/spreadsheetml/2006/main', 'http://purl.oclc.org/ooxml/spreadsheetml/main']
const REL_NS = ['http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'http://purl.oclc.org/ooxml/officeDocument/relationships']
const PACKAGE_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships'

export function officeKind(file: Pick<FileAttachment, 'name' | 'type'>): 'docx' | 'xlsx' | 'unsupported' | null {
  const ext = file.name.split('.').pop()?.toLowerCase()
  const mime = file.type.toLowerCase().split(';')[0]?.trim()
  if (/^(?:doc|xls|docm|xlsm|xlsb|dotm|dotx|xltm|xltx)$/.test(ext ?? '') || /macroenabled|ms-excel|msword/.test(mime ?? '')) {
    // Older Arty versions labelled modern files with legacy MIME. The file's
    // verified OOXML content, not that historical fallback, decides support.
    if (ext !== 'docx' && ext !== 'xlsx') return 'unsupported'
  }
  if (ext === 'docx' || mime === DOCX_MIME) return 'docx'
  if (ext === 'xlsx' || mime === XLSX_MIME) return 'xlsx'
  return null
}

const namespace = (node: Document | Element): string =>
  (node.nodeType === 9 ? (node as Document) : node.ownerDocument!).documentElement.namespaceURI ?? ''
const elements = (node: Document | Element, name: string): Element[] =>
  Array.from(node.getElementsByTagNameNS(namespace(node), name))
const children = (node: Document | Element, name: string): Element[] =>
  Array.from(node.children).filter((child) => child.namespaceURI === namespace(node) && child.localName === name)
const attribute = (node: Element, name: string): string =>
  node.getAttributeNS(namespace(node), name) ?? node.getAttribute(name) ?? ''
const invalid = (): never => { throw new OfficeReadError('corrupt') }
const unsupported = (): never => { throw new OfficeReadError('unsupported') }
const relationType = (el: Element, type: string) => REL_NS.some((ns) => el.getAttribute('Type') === `${ns}/${type}`)

async function relationships(archive: OfficeArchive, path: string): Promise<Element[]> {
  const doc = await archive.xml(path)
  validateRoot(doc, 'Relationships', [PACKAGE_REL_NS])
  const relations = children(doc.documentElement, 'Relationship')
  const ids = new Set<string>()
  for (const rel of relations) {
    const id = rel.getAttribute('Id')
    if (!id || ids.has(id)) invalid()
    ids.add(id!)
  }
  return relations
}

function canonicalRelation(rels: Element[], type: string, target: string, optional = false): boolean {
  const matches = rels.filter((el) => relationType(el, type))
  if (!matches.length && optional) return false
  if (matches.length !== 1) invalid()
  const rel = matches[0]!
  if (rel.getAttribute('TargetMode') === 'External' ||
    ![target, `/${target}`].includes(rel.getAttribute('Target') ?? '')) unsupported()
  return true
}

function validateRoot(doc: Document, name: string, namespaces: string[]) {
  if (doc.documentElement.localName !== name || !namespaces.includes(doc.documentElement.namespaceURI ?? '')) invalid()
}

function readableText(node: Element): string {
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_ELEMENT, {
    acceptNode: (child) => {
      const el = child as Element
      if (el.namespaceURI !== namespace(node) || /^(?:drawing|pict|object|rt)$/.test(el.localName)) return NodeFilter.FILTER_REJECT
      if (el.localName === 'p' && node.localName === 'p') invalid()
      return NodeFilter.FILTER_ACCEPT
    },
  })
  const out: string[] = []
  let child: Node | null
  while ((child = walker.nextNode())) {
    const el = child as Element
    if (el.namespaceURI !== namespace(node)) continue
    if (el.localName === 't') {
      if (el.children.length) invalid() // OOXML t is text-only, never nested markup.
      out.push(el.textContent ?? '')
    }
    if (el.localName === 'tab') out.push('\t')
    if (el.localName === 'noBreakHyphen') out.push('\u2011')
    if (el.localName === 'br' || el.localName === 'cr') out.push('\n')
  }
  return out.join('')
}

function wordText(doc: Document, add: (s: string) => void) {
  let nonempty = false
  validateRoot(doc, 'document', WORD_NS)
  // Do not silently combine alternate renderings or old/new revisions.
  for (const el of Array.from(doc.getElementsByTagName('*'))) {
    if ((el.namespaceURI === 'http://schemas.openxmlformats.org/markup-compatibility/2006' && el.localName === 'AlternateContent') ||
      (el.namespaceURI === namespace(doc) && /^(?:altChunk|ins|del|moveFrom|moveTo|subDoc)$/.test(el.localName))) unsupported()
  }
  const body = children(doc.documentElement, 'body')[0]
  if (!body) invalid()
  const stack = Array.from(body!.children).reverse()
  while (stack.length) {
    const el = stack.pop()!
    if (el.namespaceURI !== namespace(doc) || /^(?:drawing|pict|object|rt)$/.test(el.localName)) continue
    if (el.localName === 'p') {
      const style = attribute(elements(el, 'pStyle')[0] ?? el, 'val')
      const heading = /^heading([1-6])$/i.exec(style)
      const prefix = heading ? '#'.repeat(Number(heading[1])) + ' ' : elements(el, 'numPr').length ? '• ' : ''
      const text = readableText(el)
      if (text.trim()) nonempty = true
      add(prefix + text)
    } else if (el.localName === 'tbl') {
      for (const row of children(el, 'tr')) {
        const text = children(row, 'tc').map((cell) => {
          const parts: string[] = []
          const queue = Array.from(cell.children).reverse()
          while (queue.length) {
            const part = queue.pop()!
            if (part.namespaceURI !== namespace(doc) || /^(?:drawing|pict|object|rt)$/.test(part.localName)) continue
            if (part.localName === 'p') parts.push(readableText(part))
            else for (let i = part.children.length - 1; i >= 0; i--) queue.push(part.children[i]!)
          }
          return parts.join(' / ')
        }).join('\t')
        if (text.trim()) nonempty = true
        add(text)
      }
    } else {
      for (let i = el.children.length - 1; i >= 0; i--) stack.push(el.children[i]!)
    }
  }
  if (!nonempty) unsupported()
}

function sheetString(node: Element): string {
  const text: string[] = []
  // Ignore phonetic annotations (rPh); they are not part of the cell value.
  for (const child of Array.from(node.children)) {
    if (child.namespaceURI !== namespace(node)) continue
    const parts = child.localName === 't' ? [child] : child.localName === 'r' ? children(child, 't') : []
    for (const part of parts) {
      if (part.children.length) invalid()
      text.push(part.textContent ?? '')
    }
  }
  return text.join('')
}

function internalSheetTarget(target: string): string {
  if (!target || /[\\:#?%\x00-\x1f]/.test(target)) invalid()
  const parts: string[] = target.startsWith('/') ? [] : ['xl']
  for (const part of target.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') { if (!parts.length) invalid(); parts.pop() }
    else parts.push(part)
  }
  const result = parts.join('/')
  if (!/^xl\/worksheets\/[^/]+\.xml$/.test(result)) invalid()
  return result
}

async function sheetText(archive: OfficeArchive, budget: OfficeBudget, add: (s: string) => void) {
  const workbook = await archive.xml('xl/workbook.xml')
  validateRoot(workbook, 'workbook', SHEET_NS)
  const relations = await relationships(archive, 'xl/_rels/workbook.xml.rels')
  const targets = new Map<string, string>()
  for (const relation of relations) {
    if (!relationType(relation, 'worksheet')) continue
    const id = relation.getAttribute('Id') ?? ''
    if (!id || targets.has(id) || relation.getAttribute('TargetMode') === 'External') invalid()
    targets.set(id, internalSheetTarget(relation.getAttribute('Target') ?? ''))
  }
  const shared: string[] = []
  const stringRelations = relations.filter((el) => relationType(el, 'sharedStrings'))
  if (stringRelations.length) {
    if (stringRelations.length !== 1 || stringRelations[0]!.getAttribute('TargetMode') === 'External' ||
      !['sharedStrings.xml', '/xl/sharedStrings.xml'].includes(stringRelations[0]!.getAttribute('Target') ?? '')) unsupported()
    const strings = await archive.xml('xl/sharedStrings.xml')
    validateRoot(strings, 'sst', SHEET_NS)
    for (const si of children(strings.documentElement, 'si')) {
      if (elements(si, 'si').length) invalid()
      const text = sheetString(si)
      // Shared strings are materialised before cells. Bound this intermediate
      // representation too, even when most strings are not referenced.
      consumeOffice(budget, 'textChars', text.length)
      shared.push(text)
    }
  }
  const sheetsNode = children(workbook.documentElement, 'sheets')[0]
  const sheets = sheetsNode ? children(sheetsNode, 'sheet') : []
  if (!sheets.length) invalid()
  if (sheets.length > 32) throw new OfficeReadError('limit')
  for (const sheet of sheets) {
    const id = REL_NS.map((ns) => sheet.getAttributeNS(ns, 'id')).find(Boolean) ?? ''
    const path = targets.get(id)
    if (!path) invalid()
    add(`Sheet: ${sheet.getAttribute('name') ?? ''} [${sheet.getAttribute('state') ?? 'visible'}]`)
    const xml = await archive.xml(path!)
    validateRoot(xml, 'worksheet', SHEET_NS)
    const seen = new Set<string>()
    const data = children(xml.documentElement, 'sheetData')[0]
    if (!data) invalid()
    for (const cell of children(data!, 'row').flatMap((row) => children(row, 'c'))) {
      consumeOffice(budget, 'cells', 1)
      const ref = cell.getAttribute('r') ?? ''
      if (!/^[A-Z]{1,3}[1-9][0-9]{0,6}$/.test(ref) || seen.has(ref)) invalid()
      const [letters, digits] = ref.match(/^([A-Z]+)(\d+)$/)!.slice(1)
      const column = [...letters!].reduce((n, char) => n * 26 + char.charCodeAt(0) - 64, 0)
      if (column > 16384 || Number(digits) > 1048576) invalid()
      seen.add(ref)
      const type = cell.getAttribute('t'), raw = children(cell, 'v')[0]?.textContent
      const formula = children(cell, 'f')[0]
      const hasCache = raw !== undefined && raw !== null && (raw !== '' || type === 'str')
      let value = raw ?? '[empty]'
      if (formula && !hasCache) value = '[not calculated]'
      else if (type === 's') {
        if (!raw || !/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || shared[Number(raw)] === undefined) invalid()
        value = shared[Number(raw)]!
      } else if (type === 'inlineStr') {
        const inline = children(cell, 'is')[0]
        if (!inline) invalid()
        value = sheetString(inline!)
      }
      else if (type === 'b') {
        if (raw !== '0' && raw !== '1') invalid()
        value = raw === '1' ? 'TRUE' : 'FALSE'
      } else if (type === 'e') value = `[error: ${raw ?? ''}]`
      if (formula) {
        if (formula.children.length) invalid()
        const expression = formula.textContent ?? ''
        const metadata = ['t', 'si', 'ref'].filter((key) => formula.hasAttribute(key))
          .map((key) => `${key}=${formula.getAttribute(key)}`).join(', ')
        const unresolved = expression ? `=${expression}` : '[not reconstructed]'
        value = `formula: ${unresolved}${metadata ? ` [${metadata}]` : ''}; cached result (may be stale): ${value === '' ? '[empty string]' : value}`
      }
      add(`${ref}: ${value}`)
    }
  }
}

/** Returns bounded text only. Does not persist, fetch URLs, render HTML,
 * execute macros or evaluate spreadsheet formulas. Budget belongs to request. */
export async function extractOfficeText(file: FileAttachment, budget: OfficeBudget = officeBudget()): Promise<string> {
  try {
    budget.assertCurrent()
    const kind = officeKind(file)
    if (!kind || kind === 'unsupported') throw new OfficeReadError('unsupported')
    if (!file.data) throw new OfficeReadError('unavailable')
    if (file.data.length > Math.ceil(OFFICE_LIMITS.sourceBytes / 3) * 4) throw new OfficeReadError('limit')
    const raw = atob(file.data)
    if (raw.startsWith('\xd0\xcf\x11\xe0')) throw new OfficeReadError('unsupported') // legacy or password-protected Office
    const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0))
    const archive = new OfficeArchive(bytes, budget)
    const contentTypes = await archive.xml('[Content_Types].xml')
    validateRoot(contentTypes, 'Types', ['http://schemas.openxmlformats.org/package/2006/content-types'])
    const mainPart = kind === 'docx' ? '/word/document.xml' : '/xl/workbook.xml'
    canonicalRelation(await relationships(archive, '_rels/.rels'), 'officeDocument', mainPart.slice(1))
    const expected = kind === 'docx'
      ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'
      : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml'
    const overrides = children(contentTypes.documentElement, 'Override')
    if (overrides.some((e) => /macroEnabled|vbaProject/i.test(e.getAttribute('ContentType') ?? ''))) throw new OfficeReadError('unsupported')
    const mainTypes = overrides.filter((e) => e.getAttribute('PartName') === mainPart)
    if (mainTypes.length !== 1 || mainTypes[0]!.getAttribute('ContentType') !== expected) invalid()
    const out: string[] = []
    const add = (text: string) => { consumeOffice(budget, 'textChars', text.length + 1); out.push(text) }
    add(`[Document: ${file.name} — ${kind.toUpperCase()} text extraction v1]`)
    add(kind === 'docx'
      ? 'Scope: main body text and tables only. Layout, pictures, headers, footnotes, comments and tracked revisions are not reconstructed; list numbering is represented as bullets.'
      : 'Scope: cell values and formulas, never recalculated. Cached results may be stale. Numbers are raw: date styles (1900/1904), display formats, merged cells and charts are not reconstructed. Hidden sheets are labelled and included.')
    if (kind === 'docx') wordText(await archive.xml('word/document.xml'), add)
    else await sheetText(archive, budget, add)
    budget.assertCurrent()
    return out.join('\n')
  } catch (error) {
    if (error instanceof OfficeReadError) throw new OfficeReadError(error.code, file.name)
    // Keep session/cancellation errors distinguishable from a corrupt document.
    budget.assertCurrent()
    throw new OfficeReadError('corrupt', file.name)
  }
}
