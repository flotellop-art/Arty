import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, ShadingType, LevelFormat, AlignmentType, HeadingLevel, TableLayoutType } from 'docx'
import { zipSync, strToU8 } from 'fflate'
import { EXPORT_LIMITS as L, assertExportText, exportError, type ExportDocument, type ExportBlock, type ExportChoices, type ExportRun } from './types'

const WIDTH = 9026
export const EXPORT_NOTICE = 'Export local des échanges conservés, sans nouvelle génération IA. Images, HTML actif et pièces jointes non incorporés. Sources historiques non certifiées ; les repères [S1] sont propres à chaque message.'
export function exportTables(doc: ExportDocument): Extract<ExportBlock, { kind: 'table' }>[] {
  return doc.messages.flatMap(m => m.blocks.filter((b): b is Extract<ExportBlock, { kind: 'table' }> => b.kind === 'table'))
}
function textRuns(runs: ExportRun[]): TextRun[] {
  return runs.flatMap(run => run.text.split('\n').map((text, i) => new TextRun({ text, break: i ? 1 : undefined,
    bold: run.bold, italics: run.italic, strike: run.strike, font: run.code ? 'Courier New' : 'Arial' })))
}
async function packDocx(doc: ExportDocument): Promise<ArrayBuffer> {
  const configs: NonNullable<ConstructorParameters<typeof Document>[0]['numbering']>['config'][number][] = []
  const listIds = new Set<string>()
  const children: (Paragraph | Table)[] = [new Paragraph({ text: doc.title, heading: HeadingLevel.TITLE }), new Paragraph(EXPORT_NOTICE)]
  doc.messages.forEach((message, index) => {
    children.push(new Paragraph({ text: `Message ${index + 1} — ${message.role === 'user' ? 'Vous' : 'Arty'}${message.interrupted ? ' — Réponse interrompue' : ''}`, heading: HeadingLevel.HEADING_1 }))
    if (message.model) children.push(new Paragraph(`Modèle indiqué dans l'historique : ${message.model}`))
    if (message.outputNotice) children.push(new Paragraph(message.outputNotice))
    for (const block of message.blocks) {
      if (block.kind === 'paragraph') {
        if (block.list && !listIds.has(block.list.id)) {
          listIds.add(block.list.id)
          configs.push({ reference: block.list.id, levels: Array.from({ length: block.list.depth + 1 }, (_, level) => ({ level, start: block.list!.start,
            format: block.list!.ordered ? LevelFormat.DECIMAL : LevelFormat.BULLET,
            text: block.list!.ordered ? `%${level + 1}.` : '•', alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 480 * (level + 1), hanging: 240 } } } })) })
        }
        const heading = block.heading ? [HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6, HeadingLevel.HEADING_6][block.heading - 1] : undefined
        children.push(new Paragraph({ children: textRuns(block.runs), heading,
          numbering: block.list ? { reference: block.list.id, level: block.list.depth } : undefined,
          indent: !block.list && (block.quote || block.indent) ? { left: (block.indent ?? 0) + Math.min(block.quote ?? 0, 6) * 240 } : undefined,
          spacing: { after: block.code ? 0 : 120 } }))
      } else {
        const columns = block.rows[0]!.length
        if (columns > 8) exportError('Word est limité à 8 colonnes par tableau ; choisissez Excel pour ce tableau.')
        const widths = Array.from({ length: columns }, (_, i) => Math.floor(WIDTH / columns) + (i < WIDTH % columns ? 1 : 0))
        children.push(new Table({ width: { size: WIDTH, type: WidthType.DXA }, columnWidths: widths, layout: TableLayoutType.FIXED,
          rows: block.rows.map((row, ri) => new TableRow({ tableHeader: ri === 0, children: row.map((cell, ci) => new TableCell({
            width: { size: widths[ci]!, type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 120, right: 120 },
            shading: { type: ShadingType.CLEAR, fill: ri === 0 ? 'E8EDF2' : 'FFFFFF' },
            children: cell.split('\n').map(text => new Paragraph({ children: [new TextRun({ text, bold: ri === 0, size: 20 })] })),
          })) })) }))
        children.push(new Paragraph(''))
      }
    }
    if (message.sources.length) {
      children.push(new Paragraph({ text: `Sources historiques — message ${index + 1} (${message.id})`, heading: HeadingLevel.HEADING_2 }))
      message.sources.forEach(source => children.push(new Paragraph(source)))
    }
  })
  const omitted = doc.omissions
  children.push(new Paragraph(`Éléments non incorporés : ${omitted.images} image(s), ${omitted.html} bloc(s) HTML, ${omitted.unsupported} autre(s), ${omitted.attachments} pièce(s) jointe(s).`))
  return Packer.toArrayBuffer(new Document({ creator: 'Arty', title: doc.title, description: EXPORT_NOTICE,
    styles: { default: { document: { run: { font: 'Arial', size: 22 } } }, paragraphStyles: Array.from({ length: 6 }, (_, i) => ({
      id: `Heading${i + 1}`, name: `Heading ${i + 1}`, basedOn: 'Normal', next: 'Normal', quickFormat: true,
      run: { font: 'Arial', bold: true, size: i === 0 ? 30 : 26 }, paragraph: { outlineLevel: i, spacing: { before: 200, after: 120 } },
    })) }, numbering: { config: configs },
    sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } }, children }],
  }))
}
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const PKG = 'http://schemas.openxmlformats.org/package/2006/relationships'
function xml(text: string): string { assertExportText(text); return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\r/g, '&#13;') }
/** ST_Xstring escapes are themselves escaped so `_x0041_` stays literal. */
function xstring(text: string): string { return xml(text.replace(/_x[0-9a-fA-F]{4}_/g, value => `_x005F_${value.slice(1)}`)) }
function columnName(index: number): string { let out = ''; for (let n = index + 1; n; n = Math.floor((n - 1) / 26)) out = String.fromCharCode(65 + (n - 1) % 26) + out; return out }
function sheet(rows: string[][]): string {
  return `${XML}<worksheet xmlns="${NS}"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="${rows[0]?.length ?? 1}" width="26" customWidth="1"/></cols><sheetData>${rows.map((row, ri) => `<row r="${ri + 1}">${row.map((text, ci) => {
    if (text.length > L.cellChars) exportError('Une cellule dépasse 8 192 caractères.')
    // All strings by design: no locale guessing, lost zeroes or Excel's 15-digit rounding.
    return `<c r="${columnName(ci)}${ri + 1}" t="inlineStr" s="${ri === 0 ? 1 : 0}"><is><t xml:space="preserve">${xstring(text)}</t></is></c>`
  }).join('')}</row>`).join('')}</sheetData></worksheet>`
}
function packXlsx(doc: ExportDocument, tableIds: string[]): ArrayBuffer {
  const all = exportTables(doc), ids = new Set(tableIds)
  if (!ids.size || ids.size !== tableIds.length || tableIds.some(id => !all.some(t => t.id === id))) exportError('Sélectionnez au moins un tableau reconnu.')
  const chosen = all.filter(t => ids.has(t.id))
  const sheets = chosen.map(t => ({ name: `Tableau ${t.id.slice(6)} - M${t.message}`, rows: t.rows }))
  const info: string[][] = [['Export Arty', doc.title], ['Périmètre', 'Tableaux sélectionnés uniquement. Toutes les cellules sont du texte modifiable, sans formule ni conversion numérique.'], ['Limites', EXPORT_NOTICE]]
  chosen.forEach(t => info.push([`Tableau ${t.id.slice(6)}`, `Message ${t.message} (${doc.messages[t.message - 1]!.id}), ${t.rows.length} lignes, ${t.rows[0]!.length} colonnes`]))
  doc.messages.forEach((m, i) => {
    if (!chosen.some(t => t.message === i + 1)) return
    info.push([`Message ${i + 1}`, `${m.role} ; modèle historique : ${m.model || 'non indiqué'} ; ${m.interrupted ? 'réponse interrompue' : 'message conservé'}`])
    if (m.outputNotice) info.push([`Statut message ${i + 1}`, m.outputNotice])
    m.sources.forEach(s => info.push([`Sources message ${i + 1}`, s]))
  })
  sheets.push({ name: 'Informations', rows: info })
  const files: Record<string, Uint8Array> = {}
  const add = (path: string, body: string) => { files[path] = strToU8(body) }
  add('[Content_Types].xml', `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`)
  add('_rels/.rels', `${XML}<Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`)
  add('xl/workbook.xml', `${XML}<workbook xmlns="${NS}" xmlns:r="${REL}"><sheets>${sheets.map((s, i) => `<sheet name="${xml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`)
  add('xl/_rels/workbook.xml.rels', `${XML}<Relationships xmlns="${PKG}">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rIdStyles" Type="${REL}/styles" Target="styles.xml"/></Relationships>`)
  add('xl/styles.xml', `${XML}<styleSheet xmlns="${NS}"><fonts count="2"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="11"/><name val="Arial"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="49" fontId="1" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`)
  sheets.forEach((s, i) => add(`xl/worksheets/sheet${i + 1}.xml`, sheet(s.rows)))
  const zipped = zipSync(files, { level: 6 })
  return zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer
}
export async function packOfficeExport(doc: ExportDocument, choices: ExportChoices): Promise<ArrayBuffer> {
  const result = choices.format === 'docx' ? await packDocx(doc) : packXlsx(doc, choices.tableIds)
  if (result.byteLength > L.outputBytes) exportError('Le fichier généré dépasse 12 Mio.')
  return result
}
