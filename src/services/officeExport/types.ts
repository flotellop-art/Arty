/** Export-only, structured-cloneable data. No files, DOM, tools or credentials. */
export interface ExportMessage {
  id: string; role: 'user' | 'assistant'; content: string; interrupted: boolean
  model: string; sources: string[]; attachments: number
}
export interface ExportSnapshot { title: string; messages: ExportMessage[] }
export interface ExportRun { text: string; bold?: boolean; italic?: boolean; strike?: boolean; code?: boolean }
export type ExportBlock =
  | { kind: 'paragraph'; runs: ExportRun[]; heading?: number; quote?: number; indent?: number; code?: boolean; list?: { id: string; ordered: boolean; start: number; depth: number } }
  | { kind: 'table'; id: string; rows: string[][]; message: number }
export interface ExportDocument {
  title: string
  messages: { id: string; role: 'user' | 'assistant'; model: string; interrupted: boolean; sources: string[]; blocks: ExportBlock[] }[]
  omissions: { images: number; html: number; unsupported: number; attachments: number }
  chars: number
}
export type ExportFormat = 'docx' | 'xlsx'
export interface ExportChoices { format: ExportFormat; tableIds: string[] }
export const EXPORT_LIMITS = { chars: 200_000, messages: 50, lines: 4_000, lineChars: 4_000,
  markers: 12_000, lineMarkers: 200, nodes: 20_000, depth: 24, tables: 32, columns: 16,
  rows: 1_000, cells: 10_000, cellChars: 8_192, outputBytes: 12 * 1024 * 1024 } as const
export function exportError(message: string): never { throw new Error(message) }

/** Reject XML 1.0-incompatible input, never silently replace user characters. */
export function assertExportText(text: string): void {
  for (const char of text) {
    const n = char.codePointAt(0)!
    if ((n < 32 && n !== 9 && n !== 10 && n !== 13) || (n >= 0xD800 && n <= 0xDFFF) || n === 0xFFFE || n === 0xFFFF)
      exportError('Le texte contient un caractère incompatible avec Office.')
  }
}

/** Linear PRE-parser guard: AST limits alone cannot bound micromark parsing.
 * Deliberately conservative V1 (including inside code); refuse, never truncate. */
export function preflightMarkdown(text: string): void {
  if (typeof text !== 'string' || text.length > EXPORT_LIMITS.chars) exportError('Export limité à 200 000 caractères.')
  assertExportText(text)
  let lines = 1, chars = 0, markers = 0, lineMarkers = 0, quotes = 0, indent = 0, leading = true, run = 0, previous = ''
  for (const char of text) {
    if (char === '\n') { lines++; chars = lineMarkers = quotes = indent = run = 0; leading = true; previous = ''; continue }
    chars++
    if (leading && (char === ' ' || char === '\t')) indent += char === '\t' ? 4 : 1
    else leading = false
    if ('>*_~`[]()|!#'.includes(char)) { markers++; lineMarkers++; run = char === previous ? run + 1 : 1 } else run = 0
    if (char === '>') quotes++
    if (chars > EXPORT_LIMITS.lineChars || lineMarkers > EXPORT_LIMITS.lineMarkers || quotes > 8 || indent > 32 || run > 32)
      exportError('Mise en forme trop complexe pour cet export. Simplifiez les lignes ou les imbrications.')
    previous = char
  }
  if (lines > EXPORT_LIMITS.lines || markers > EXPORT_LIMITS.markers) exportError('Mise en forme trop volumineuse pour cet export.')
  // CommonMark permits many list/quote openers on the SAME line. Leading
  // whitespace and punctuation totals do not bound '- - -' or '1. 1. 1.'.
  for (const line of text.split('\n')) {
    let pos = 0, containers = 0
    while (pos < line.length) {
      while (line[pos] === ' ' || line[pos] === '\t') pos++
      const start = pos, char = line[pos]
      if (char === '>') pos++
      else if (char && '-+*'.includes(char) && /[ \t]/.test(line[pos + 1] ?? '')) pos += 2
      else {
        let end = pos
        while (end < line.length && end - pos < 9 && /[0-9]/.test(line[end]!)) end++
        if (end > pos && (line[end] === '.' || line[end] === ')') && /[ \t]/.test(line[end + 1] ?? '')) pos = end + 2
      }
      if (pos === start) break
      if (++containers > 8) exportError('Trop de listes ou citations imbriquées sur une ligne.')
    }
  }
}
