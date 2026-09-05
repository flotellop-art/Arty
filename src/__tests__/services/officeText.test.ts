import { describe, expect, it, vi } from 'vitest'
import { zipSync, strToU8, Zip, ZipDeflate, ZipPassThrough } from 'fflate'
import { extractOfficeText, officeKind } from '../../services/documents/officeText'
import { OfficeArchive, officeBudget, OFFICE_LIMITS } from '../../services/documents/officeArchive'
import type { FileAttachment } from '../../types'
import producerFixtures from '../helpers/office-producer-fixtures.json'

const wordNS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const sheetNS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const relNS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const rels = (body: string) => `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${body}</Relationships>`
const rootRel = (kind: 'docx' | 'xlsx') => rels(`<Relationship Id="main" Type="${relNS}/officeDocument" Target="${kind === 'docx' ? 'word/document.xml' : 'xl/workbook.xml'}"/>`)
function types(kind: 'docx' | 'xlsx') {
  const part = kind === 'docx' ? '/word/document.xml' : '/xl/workbook.xml'
  const content = kind === 'docx' ? 'wordprocessingml.document' : 'spreadsheetml.sheet'
  return `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="${part}" ContentType="application/vnd.openxmlformats-officedocument.${content}.main+xml"/></Types>`
}
function file(entries: Record<string, string>, name = 'document.docx', level: 0 | 6 = 6): FileAttachment {
  const bytes = zipSync(Object.fromEntries(Object.entries(entries).map(([key, value]) => [key, strToU8(value)])), { level })
  return { id: name, name, type: 'application/octet-stream', data: Buffer.from(bytes).toString('base64') }
}
function docx(body: string, extra: Record<string, string> = {}): FileAttachment {
  return file({ '[Content_Types].xml': types('docx'), '_rels/.rels': rootRel('docx'), 'word/document.xml': `<w:document xmlns:w="${wordNS}"><w:body>${body}</w:body></w:document>`, ...extra })
}
function xlsx(sheet: string, extra: Record<string, string> = {}): FileAttachment {
  return file({
    '[Content_Types].xml': types('xlsx'),
    '_rels/.rels': rootRel('xlsx'),
    'xl/workbook.xml': `<workbook xmlns="${sheetNS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Ventes été" sheetId="1" r:id="s1"/><sheet name="Détails" state="hidden" sheetId="2" r:id="s2"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': rels(`<Relationship Id="s1" Type="${relNS}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="s2" Type="${relNS}/worksheet" Target="/xl/worksheets/sheet2.xml"/>${extra['xl/sharedStrings.xml'] ? `<Relationship Id="strings" Type="${relNS}/sharedStrings" Target="sharedStrings.xml"/>` : ''}`),
    'xl/worksheets/sheet1.xml': `<worksheet xmlns="${sheetNS}"><sheetData><row>${sheet}</row></sheetData></worksheet>`,
    'xl/worksheets/sheet2.xml': `<worksheet xmlns="${sheetNS}"><sheetData><row><c r="B3" t="inlineStr"><is><t>été 🌞</t></is></c></row></sheetData></worksheet>`,
    ...extra,
  }, 'table.xlsx')
}

describe('Office extraction without executable content', () => {
  it('lit des fichiers émis par python-docx et openpyxl, indépendamment du constructeur de tests', async () => {
    const word = await extractOfficeText({ id: 'producer-docx', name: 'producer.docx', type: '', data: producerFixtures.docx })
    expect(word).toContain('# Projet été')
    expect(word).toContain('Facture synthétique : 1250 € — 東京 🌞')
    expect(word).toContain('Client\tMontant\nExemple\t1250')
    const sheet = await extractOfficeText({ id: 'producer-xlsx', name: 'producer.xlsx', type: '', data: producerFixtures.xlsx })
    expect(sheet).toContain('Sheet: Ventes été [visible]')
    expect(sheet).toContain('A2: Exemple 東京\nB2: 1250')
    expect(sheet).toContain('B3: formula: =SUM(B2:B2); cached result (may be stale): [not calculated]')
    expect(sheet).toContain('Sheet: Notes [hidden]\nA1: Brouillon synthétique')
  })
  it('lit accents, emoji, titre, liste et tableau dans l’ordre', async () => {
    const text = await extractOfficeText(docx('<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Café 🌞</w:t></w:r></w:p><w:p><w:pPr><w:numPr/></w:pPr><w:r><w:t>Point</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Client</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>42 €</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:r><w:t>Fin</w:t></w:r></w:p>'))
    expect(text).toContain('# Café 🌞\n• Point\nClient\t42 €\nFin')
    expect(text).toContain('main body text and tables only')
  })

  it('lit feuilles, cellules clairsemées, zéro, chaînes et formules sans les calculer', async () => {
    const text = await extractOfficeText(xlsx('<c r="A1"><v>0</v></c><c r="B3" t="s"><v>0</v></c><c r="C4"><f>SUM(A1:A9)</f><v>9</v></c><c r="D5"><f>WEBSERVICE("https://example.invalid")</f></c><c r="E6" t="b"><v>1</v></c>', {
      'xl/sharedStrings.xml': `<sst xmlns="${sheetNS}"><si><t>Facturé</t></si></sst>`,
    }))
    expect(text).toContain('Sheet: Ventes été [visible]\nA1: 0\nB3: Facturé')
    expect(text).toContain('formula: =SUM(A1:A9); cached result (may be stale): 9')
    expect(text).toContain('[not calculated]')
    expect(text).toContain('E6: TRUE')
    expect(text).toContain('Sheet: Détails [hidden]\nB3: été 🌞')
    expect(text).toContain('date styles (1900/1904)')
  })

  it('accepte le MIME legacy erroné des anciens clients pour un vrai DOCX', async () => {
    const f = docx('<w:p><w:r><w:t>Bonjour</w:t></w:r></w:p>')
    expect(await extractOfficeText({ ...f, type: 'application/msword' })).toContain('Bonjour')
    expect(officeKind({ name: 'fichier', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })).toBe('xlsx')
  })

  it.each(['test.doc', 'test.xls', 'test.docm', 'test.xlsm', 'test.xlsb'])('refuse %s avant analyse', async (name) => {
    await expect(extractOfficeText({ ...docx(''), name })).rejects.toMatchObject({ code: 'unsupported', fileName: name })
  })

  it('refuse données absentes et origine OLE chiffrée', async () => {
    await expect(extractOfficeText({ id: 'a', name: 'a.docx', type: '' })).rejects.toMatchObject({ code: 'unavailable' })
    await expect(extractOfficeText({ id: 'a', name: 'a.docx', type: '', data: Buffer.from([0xd0, 0xcf, 0x11, 0xe0]).toString('base64') })).rejects.toMatchObject({ code: 'unsupported' })
  })

  it('refuse VBA caché sous une extension DOCX', async () => {
    await expect(extractOfficeText(docx('', { 'word/vbaProject.bin': 'macro' }))).rejects.toMatchObject({ code: 'unsupported' })
  })

  it('contrôle CRC et refuse une mutation du XML même valide syntaxiquement', async () => {
    const f = file({ '[Content_Types].xml': types('docx'), '_rels/.rels': rootRel('docx'), 'word/document.xml': `<w:document xmlns:w="${wordNS}"><w:body><w:p><w:r><w:t>1000</w:t></w:r></w:p></w:body></w:document>` }, 'a.docx', 0)
    const bytes = Buffer.from(f.data!, 'base64')
    bytes[bytes.indexOf(Buffer.from('1000'))] = '9'.charCodeAt(0)
    await expect(extractOfficeText({ ...f, data: bytes.toString('base64') })).rejects.toMatchObject({ code: 'corrupt' })
  })

  it('refuse une archive tronquée et des chemins traversants', async () => {
    const f = docx('')
    await expect(extractOfficeText({ ...f, data: f.data!.slice(0, -20) })).rejects.toMatchObject({ code: 'corrupt' })
    await expect(extractOfficeText(docx('', { '../escape': 'secret' }))).rejects.toMatchObject({ code: 'corrupt' })
  })

  it.each(['<!DOCTYPE x [<!ENTITY attack "evil">]>', '<?xml version="1.0" encoding="UTF-16"?>'])('refuse XML dangereux ou encodage non géré', async (prefix) => {
    await expect(extractOfficeText(file({ '[Content_Types].xml': prefix + types('docx'), 'word/document.xml': '' }))).rejects.toMatchObject({ code: 'corrupt' })
  })

  it('refuse relations worksheet externes et références de chaînes invalides', async () => {
    await expect(extractOfficeText(xlsx('', {
      'xl/_rels/workbook.xml.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="s1" Type="x/worksheet" TargetMode="External" Target="https://example.invalid/a.xml"/></Relationships>',
    }))).rejects.toMatchObject({ code: 'corrupt' })
    await expect(extractOfficeText(xlsx('<c r="A1" t="s"><v>999</v></c>'))).rejects.toMatchObject({ code: 'corrupt' })
  })

  it('refuse une bombe et un XML trop profond sans résultat partiel', async () => {
    await expect(extractOfficeText(docx('X'.repeat(OFFICE_LIMITS.xmlBytes)))).rejects.toMatchObject({ code: 'limit' })
    await expect(extractOfficeText(docx('<w:sdt>'.repeat(70) + '</w:sdt>'.repeat(70)))).rejects.toMatchObject({ code: 'limit' })
  })

  it('applique le budget agrégé de toute la requête', async () => {
    const budget = officeBudget()
    const f = docx(`<w:p><w:r><w:t>${'a'.repeat(110_000)}</w:t></w:r></w:p>`)
    await extractOfficeText(f, budget)
    await expect(extractOfficeText(f, budget)).rejects.toMatchObject({ code: 'limit' })
  })

  it.each(['word/actual.xml', 'https://example.invalid/a.xml'])('refuse un document principal non pris en charge : %s', async (target) => {
    await expect(extractOfficeText(docx('<w:p><w:r><w:t>LEURRE</w:t></w:r></w:p>', {
      '_rels/.rels': rels(`<Relationship Id="r" Type="${relNS}/officeDocument" Target="${target}"/>`),
    }))).rejects.toMatchObject({ code: 'unsupported' })
  })

  it('refuse les relations principales absentes ou ambiguës', async () => {
    await expect(extractOfficeText(docx('', { '_rels/.rels': rels('') }))).rejects.toMatchObject({ code: 'corrupt' })
    await expect(extractOfficeText(docx('', { '_rels/.rels': rels(`<Relationship Id="a" Type="${relNS}/officeDocument" Target="word/document.xml"/><Relationship Id="b" Type="${relNS}/officeDocument" Target="word/document.xml"/>`) }))).rejects.toMatchObject({ code: 'corrupt' })
  })

  it.each([
    '<w:p><mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice><w:r><w:t>CHOICE</w:t></w:r></mc:Choice><mc:Fallback><w:r><w:t>FALLBACK</w:t></w:r></mc:Fallback></mc:AlternateContent></w:p>',
    '<w:p><w:moveFrom><w:r><w:t>OLD</w:t></w:r></w:moveFrom><w:moveTo><w:r><w:t>NEW</w:t></w:r></w:moveTo></w:p>',
    '<w:altChunk/>', '',
  ])('ne produit aucun faux succès pour un corps Word ambigu ou vide', async (body) => {
    await expect(extractOfficeText(docx(body))).rejects.toMatchObject({ code: 'unsupported' })
  })

  it('ne concatène pas les annotations phonétiques aux chaînes Excel', async () => {
    const result = await extractOfficeText(xlsx('<c r="A1" t="s"><v>0</v></c>', {
      'xl/sharedStrings.xml': `<sst xmlns="${sheetNS}"><si><t>東京</t><rPh><t>とうきょう</t></rPh></si></sst>`,
    }))
    expect(result).toContain('A1: 東京')
    expect(result).not.toContain('とうきょう')
  })

  it('signale formules partagées non reconstruites et cache typé', async () => {
    const text = await extractOfficeText(xlsx('<c r="A1"><f t="shared" si="0" ref="A1:A2">B1*2</f><v>20</v></c><c r="A2" t="b"><f t="shared" si="0"/><v>1</v></c><c r="A3" t="e"><f>1/0</f><v>#DIV/0!</v></c>'))
    expect(text).toContain('formula: =B1*2 [t=shared, si=0, ref=A1:A2]')
    expect(text).toContain('formula: [not reconstructed] [t=shared, si=0]; cached result (may be stale): TRUE')
    expect(text).toContain('[error: #DIV/0!]')
  })

  it('refuse une destination sharedStrings non canonique', async () => {
    await expect(extractOfficeText(xlsx('', {
      'xl/_rels/workbook.xml.rels': rels(`<Relationship Id="str" Type="${relNS}/sharedStrings" Target="realStrings.xml"/>`),
    }))).rejects.toMatchObject({ code: 'unsupported' })
  })

  it('ignore les cellules étrangères et celles hors sheetData', async () => {
    const text = await extractOfficeText(xlsx('', {
      'xl/worksheets/sheet1.xml': `<worksheet xmlns="${sheetNS}" xmlns:evil="urn:evil"><sheetData><row><c r="A1"><v>42</v></c><evil:c r="B2"><evil:v>999</evil:v></evil:c></row></sheetData><c r="C3"><v>888</v></c></worksheet>`,
    }))
    expect(text).toContain('A1: 42')
    expect(text).not.toMatch(/999|888/)
  })

  it.each(['XFE1', 'ZZZ9999999', 'A1048577'])('refuse une cellule hors plage : %s', async (ref) => {
    await expect(extractOfficeText(xlsx(`<c r="${ref}"><v>1</v></c>`))).rejects.toMatchObject({ code: 'corrupt' })
  })

  it.each(['<si><si><t>x</t></si></si>', '<si><t><t>x</t></t></si>'])('refuse les amplifications par imbrication de chaînes', async (value) => {
    await expect(extractOfficeText(xlsx('', { 'xl/sharedStrings.xml': `<sst xmlns="${sheetNS}">${value}</sst>` }))).rejects.toMatchObject({ code: 'corrupt' })
  })

  it('borne les chaînes inutilisées avant matérialisation des cellules', async () => {
    await expect(extractOfficeText(xlsx('', { 'xl/sharedStrings.xml': `<sst xmlns="${sheetNS}"><si><t>${'a'.repeat(200001)}</t></si></sst>` }))).rejects.toMatchObject({ code: 'limit' })
  })

  it('rejette un arbre excessif avant sa création DOM', async () => {
    const parse = vi.spyOn(DOMParser.prototype, 'parseFromString')
    const before = parse.mock.calls.length
    try {
      await expect(extractOfficeText(docx('<w:r/>'.repeat(60_000)))).rejects.toMatchObject({ code: 'limit' })
      // Content types and root relationships only; main document never parsed.
      expect(parse.mock.calls.length - before).toBe(2)
    } finally { parse.mockRestore() }
  })

  it('vérifie annulation/session après chaque yield', async () => {
    let checks = 0
    const cancelled = new Error('changed-session')
    await expect(extractOfficeText(docx(''), officeBudget(() => {
      if (++checks > 3) throw cancelled
    }))).rejects.toBe(cancelled)
  })

  it('préserve tiret insécable et Ruby sans lecture phonétique ni texte des dessins', async () => {
    const text = await extractOfficeText(docx('<w:p><w:r><w:t>AB</w:t><w:noBreakHyphen/><w:t>CD </w:t></w:r><w:ruby><w:rt><w:r><w:t>とうきょう</w:t></w:r></w:rt><w:rubyBase><w:r><w:t>東京</w:t></w:r></w:rubyBase></w:ruby><w:r><w:pict><w:txbxContent><w:p><w:r><w:t>IGNORED</w:t></w:r></w:p></w:txbxContent></w:pict></w:r></w:p>'))
    expect(text).toContain('AB‑CD 東京')
    expect(text).not.toMatch(/とうきょう|IGNORED/)
  })

  it('ne considère pas un titre vide comme du texte extractible', async () => {
    await expect(extractOfficeText(docx('<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr></w:p>'))).rejects.toMatchObject({ code: 'unsupported' })
  })

  it('distingue cache de formule absent, v vide et vraie chaîne vide', async () => {
    const text = await extractOfficeText(xlsx('<c r="A1"><f>SUM(B1:B2)</f><v/></c><c r="A2" t="b"><f>1=1</f></c><c r="A3" t="str"><f>""</f><v/></c>'))
    expect(text).toContain('A1: formula: =SUM(B1:B2); cached result (may be stale): [not calculated]')
    expect(text).toContain('A2: formula: =1=1; cached result (may be stale): [not calculated]')
    expect(text).toContain('A3: formula: =""; cached result (may be stale): [empty string]')
  })
})

function streamingArchive(text: string, stored = false): Buffer {
  const chunks: Uint8Array[] = []
  const zip = new Zip((err, chunk) => { if (err) throw err; chunks.push(chunk) })
  const entry = stored ? new ZipPassThrough('test.xml') : new ZipDeflate('test.xml')
  zip.add(entry)
  entry.push(strToU8(text), true)
  zip.end()
  return Buffer.concat(chunks)
}

describe('ZIP réel streaming et budgets avant DOM', () => {
  it.each([false, true])('valide un data descriptor réel, stored=%s', async (stored) => {
    const zip = streamingArchive('<root>1000</root>', stored)
    expect((await new OfficeArchive(zip, officeBudget()).xml('test.xml')).documentElement.textContent).toBe('1000')
    const central = zip.readUInt32LE(zip.length - 6)
    const unsigned = Buffer.concat([zip.subarray(0, central - 16), zip.subarray(central - 12)])
    unsigned.writeUInt32LE(central - 4, unsigned.length - 6)
    expect((await new OfficeArchive(unsigned, officeBudget()).xml('test.xml')).documentElement.textContent).toBe('1000')
  })

  it.each([4, 8, 12])('rejette CRC/tailles contradictoires dans le descriptor : +%s', (field) => {
    const zip = streamingArchive('<root>1000</root>')
    const central = zip.readUInt32LE(zip.length - 6)
    zip.writeUInt32LE(123456, central - 16 + field)
    expect(() => new OfficeArchive(zip, officeBudget())).toThrow('office_corrupt')
  })

  it('refuse un descriptor absent malgré le flag de streaming', () => {
    const zip = streamingArchive('<root/>')
    const central = zip.readUInt32LE(zip.length - 6)
    const missing = Buffer.concat([zip.subarray(0, central - 16), zip.subarray(central)])
    missing.writeUInt32LE(central - 16, missing.length - 6)
    expect(() => new OfficeArchive(missing, officeBudget())).toThrow('office_corrupt')
  })

  it('borne la décompression réelle malgré une petite taille déclarée mensongère', async () => {
    const zip = streamingArchive(`<root>${'X'.repeat(3 * 1024 * 1024)}</root>`)
    const central = zip.readUInt32LE(zip.length - 6)
    zip.writeUInt32LE(100, central + 24)
    zip.writeUInt32LE(100, central - 4)
    const parse = vi.spyOn(DOMParser.prototype, 'parseFromString')
    try {
      await expect(new OfficeArchive(zip, officeBudget()).xml('test.xml')).rejects.toMatchObject({ code: 'limit' })
      expect(parse).not.toHaveBeenCalled()
    } finally { parse.mockRestore() }
  })

  it('borne les attributs avant DOM, puis les agrège entre parties', async () => {
    const attrs = Array.from({ length: 257 }, (_, i) => `a${i}=""`).join(' ')
    const parse = vi.spyOn(DOMParser.prototype, 'parseFromString')
    try {
      await expect(new OfficeArchive(streamingArchive(`<root ${attrs}/>`), officeBudget()).xml('test.xml')).rejects.toMatchObject({ code: 'limit' })
      expect(parse).not.toHaveBeenCalled()
      const budget = officeBudget()
      await new OfficeArchive(streamingArchive('<root a="1" b="2"/>'), budget).xml('test.xml')
      expect(budget.nodes).toBe(4) // document, root, two attributes
    } finally { parse.mockRestore() }
  })
})
