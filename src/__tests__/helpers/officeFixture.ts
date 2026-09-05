import { strToU8, zipSync } from 'fflate'
import type { FileAttachment } from '../../types'

export function officeFixture(text = 'Facture 1250 euros', id = 'office-file'): FileAttachment {
  const entries = {
    '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml': `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</w:t></w:r></w:p></w:body></w:document>`,
  }
  const zip = zipSync(Object.fromEntries(Object.entries(entries).map(([name, value]) => [name, strToU8(value)])))
  return { id, name: 'facture.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', data: Buffer.from(zip).toString('base64') }
}
