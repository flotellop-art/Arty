import { describe, expect, it } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'
import { parseOfficeExport } from '../../services/officeExport/parse'
import { packOfficeExport, exportTables } from '../../services/officeExport/pack'
import { preflightMarkdown, assertExportText, type ExportSnapshot } from '../../services/officeExport/types'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

function snapshot(...texts: string[]): ExportSnapshot { return { title: 'Essai Arty — été', messages: texts.map((content, i) => ({ id: `m${i + 1}`, role: 'assistant', content, interrupted: i === 1, sources: [`[S1] document-${i + 1}.txt ; lignes 1–2 ; SHA-256 ${String(i).repeat(64)}`], model: 'modèle-test', attachments: 0 })) } }
function xmls(buffer: ArrayBuffer): Record<string, string> { return Object.fromEntries(Object.entries(unzipSync(new Uint8Array(buffer))).filter(([path]) => path.endsWith('.xml') || path.endsWith('.rels')).map(([path, bytes]) => [path, strFromU8(bytes)])) }
function safeArchive(parts: Record<string, string>) {
  for (const text of Object.values(parts)) {
    expect(text).not.toMatch(/<(?:\w+:)?(?:f|definedNames|externalLinks|altChunk|object|oleObject)\b/)
    expect(text).not.toContain('TargetMode="External"')
    expect(text).not.toMatch(/vbaProject|macroEnabled/)
    expect(new DOMParser().parseFromString(text, 'application/xml').querySelector('parsererror')).toBeNull()
  }
}
describe('editable exports: bounded source parsing and inert OOXML', () => {
  it.each(['> '.repeat(7000) + 'x', '- '.repeat(1900) + 'x', '+ '.repeat(1900) + 'x', '1. '.repeat(1200) + 'x', '2) '.repeat(1000) + 'x', '*'.repeat(201), 'x'.repeat(4001), ' '.repeat(33) + '- item', '\n'.repeat(4000)])('refuses pathological Markdown before the parser %#', text => expect(() => preflightMarkdown(text)).toThrow())
  it('accepts ordinary 200k input but refuses one char above', () => {
    const text = ('a'.repeat(1999) + '\n').repeat(100)
    expect(() => preflightMarkdown(text)).not.toThrow()
    expect(() => preflightMarkdown(text + 'x')).toThrow()
  })
  it.each(['\u0000', '\ud800', '\udfff', '\uffff'])('rejects incompatible XML character %#', char => expect(() => assertExportText(char)).toThrow())
  it('keeps emoji, accents, tabs and CR/LF', () => expect(() => assertExportText('Été 😀\t\r\n')).not.toThrow())
  it('parses each message independently and counts omissions, never rendered HTML/IDB', () => {
    const doc = parseOfficeExport(snapshot('[texte][ref]\n\n[ref]: https://one.test\n\n![secret](arty-img://secret)\n\n<div>actif</div>', '[texte][ref]\n\n[ref]: https://two.test\n\n```md\n| Faux | tableau |\n| --- | --- |\n```'))
    expect(JSON.stringify(doc.messages[0])).toContain('https://one.test'); expect(JSON.stringify(doc.messages[0])).not.toContain('two.test')
    expect(JSON.stringify(doc.messages[1])).toContain('https://two.test')
    expect(exportTables(doc)).toHaveLength(0)
    expect(doc.omissions).toMatchObject({ images: 1, html: 1 })
    expect(doc.messages[0].sources[0]).toContain('document-1'); expect(doc.messages[1].sources[0]).toContain('document-2')
  })
  it('bounds link-reference expansion before packaging', () => {
    const text = `${'[a][long]\n'.repeat(150)}\n[long]: https://example.test/${'a'.repeat(2990)}`
    expect(() => parseOfficeExport(snapshot(text))).toThrow(/développé/)
  })
  it('retains the first definition including nested definitions and nested-only list items', () => {
    const doc = parseOfficeExport(snapshot('[texte][a]\n\n> [a]: https://first.test\n\n[a]: https://second.test\n\n- - Sous-liste'))
    expect(JSON.stringify(doc)).toContain('https://first.test'); expect(JSON.stringify(doc)).not.toContain('second.test')
    const lists = doc.messages[0].blocks.filter(b => b.kind === 'paragraph' && b.list)
    expect(lists.map(b => b.kind === 'paragraph' && b.list?.depth)).toEqual([0, 1])
  })
  it('keeps original table numbers when exporting only the second table', async () => {
    const doc = parseOfficeExport(snapshot('| A |\n| --- |\n| Un |', '| B |\n| --- |\n| Deux |'))
    const parts = xmls(await packOfficeExport(doc, { format: 'xlsx', tableIds: ['table-2'] }))
    expect(parts['xl/workbook.xml']).toContain('Tableau 2 - M2')
    expect(parts['xl/worksheets/sheet2.xml']).not.toContain('document-1')
    expect(parts['xl/worksheets/sheet2.xml']).toContain('document-2')
  })
  it('keeps list restart/start, nested list and escaped table pipes/empty cells', () => {
    const doc = parseOfficeExport(snapshot('7. Sept\n8. Huit\n   - Sous-liste\n\nFin\n\n1. Nouveau\n\n| Nom | Vide |\n| --- | --- |\n| A\\|B | |'))
    const lists = doc.messages[0].blocks.filter(b => b.kind === 'paragraph' && b.list)
    expect(lists.map(b => b.kind === 'paragraph' && b.list?.start)).toEqual([7, 7, 1, 1])
    expect(exportTables(doc)[0].rows[1]).toEqual(['A|B', ''])
  })
  it('refuses an excessively wide table for Word but permits Excel', async () => {
    const row = `|${Array.from({ length: 9 }, (_, i) => ` C${i} `).join('|')}|`
    const doc = parseOfficeExport(snapshot(`${row}\n|${' --- |'.repeat(9)}\n${row}`))
    await expect(packOfficeExport(doc, { format: 'docx', tableIds: [] })).rejects.toThrow(/8 colonnes/)
    expect((await packOfficeExport(doc, { format: 'xlsx', tableIds: ['table-1'] })).byteLength).toBeGreaterThan(0)
  })
  it('requires a nonduplicate valid table selection', async () => {
    const doc = parseOfficeExport(snapshot('| A |\n| - |\n| B |'))
    for (const ids of [[], ['bad'], ['table-1', 'table-1']]) await expect(packOfficeExport(doc, { format: 'xlsx', tableIds: ids })).rejects.toThrow(/Sélectionnez/)
  })
  it('creates structurally valid DOCX/XLSX with literal dangerous cells and independent sources', async () => {
    const input = snapshot('# Résultat **éditable**\n\nÉté 😀 et *italique*.\n\n7. Sept\n8. Huit\n   - Sous-liste\n\n| Valeur | Note |\n| --- | --- |\n| =HYPERLINK("https://example.test") | littéral |\n| +33123456789 | téléphone |\n| 0012 | identifiant |\n| 1234567890123456 | long |\n| \\_x0041\\_ | échappement |\n| 1,234 | locale |\n| 1.234 | décimal |\n| 1e3 | exposant |\n| @SUM(A1) | texte |', 'Deuxième [S1].\n\n| Quantité |\n| --- |\n| 4 |')
    const doc = parseOfficeExport(input)
    const docx = await packOfficeExport(doc, { format: 'docx', tableIds: [] })
    const xlsx = await packOfficeExport(doc, { format: 'xlsx', tableIds: ['table-1', 'table-2'] })
    const word = xmls(docx), excel = xmls(xlsx)
    safeArchive(word); safeArchive(excel)
    expect(word['word/document.xml']).toContain('w:w="11906"'); expect(word['word/document.xml']).toContain('w:h="16838"')
    expect(word['word/document.xml']).toContain('Réponse interrompue')
    expect(word['word/numbering.xml']).toContain('w:start w:val="7"')
    expect(word['word/document.xml']).toContain('document-1'); expect(word['word/document.xml']).toContain('document-2')
    expect(excel['xl/worksheets/sheet1.xml']).toContain('t="inlineStr"')
    expect(excel['xl/worksheets/sheet1.xml']).toContain('_x005F_x0041_')
    expect(excel['xl/worksheets/sheet1.xml']).toContain('0012')
    expect(excel['xl/worksheets/sheet1.xml']).toContain('1234567890123456')
    if (process.env.ARTY_OFFICE_FIXTURE_DIR) {
      writeFileSync(join(process.env.ARTY_OFFICE_FIXTURE_DIR, 'input.json'), JSON.stringify(input))
      writeFileSync(join(process.env.ARTY_OFFICE_FIXTURE_DIR, 'arty-editable.docx'), new Uint8Array(docx))
      writeFileSync(join(process.env.ARTY_OFFICE_FIXTURE_DIR, 'arty-editable.xlsx'), new Uint8Array(xlsx))
    }
  })
})
