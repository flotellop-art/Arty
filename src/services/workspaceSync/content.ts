import type { Conversation } from '../../types'
import { boundedInteger, validDescriptor, validProject, PROJECT_LIMITS, type Project, type ProjectDocument } from '../projects/types'
import { isGeneratedImageId } from '../generatedImages'
import { IMAGE_NORMALIZATION_VERSION, MAX_IMAGE_DIMENSION, MAX_NORMALIZED_IMAGE_BYTES, inspectImageHeader } from '../imageNormalization'
import { canonicalSyncJSON } from './captureContent'
import { projectSyncConversation } from './captureProjection'
import { envelopeFail as fail, envelopeFields as fields, envelopeUUID as uuid } from './envelopeFormat'
import { SYNC_LIMITS, type SyncKind } from './types'

export type SyncGalleryAlias = { messageId: string; textId: string; fileId: string }
export type SyncProjectDocument = ProjectDocument & { sourceId: string; textId: string }
export type SyncProjectContent = Omit<Project, 'owner' | 'revision' | 'documents'> & { documents: SyncProjectDocument[] }
export type SyncFileContent = { id: string; name: string; type: string; size: number; recordedSize: number; createdAt: number;
  width?: number; height?: number; normalizationVersion?: number }
export type SyncContent =
  | { kind: 'conversation'; data: { conversation: Conversation; galleryAliases: SyncGalleryAlias[] } }
  | { kind: 'project'; data: SyncProjectContent }
  | { kind: 'file'; data: SyncFileContent; binary: Blob }
  | { kind: 'project-source'; data: { projectId: string; document: ProjectDocument }; binary: Blob }
  | { kind: 'project-text'; data: { projectId: string; documentId: string; text: string } }

const descriptorKeys = ['id', 'name', 'originalName', 'format', 'revision', 'sourceHash', 'sourceBytes', 'textChars', 'extractorVersion', 'createdAt']
const nativeSlice = Blob.prototype.slice
const nativeRead = Blob.prototype.arrayBuffer
const magic = new TextEncoder().encode('ARTYSOBJ1')
function descriptor(input: unknown): ProjectDocument {
  const d = fields(input, descriptorKeys)
  uuid(d.id)
  if (!validDescriptor(d)) return fail('format')
  return d
}
function array(input: unknown, max: number): unknown[] {
  // Only JSON.parse values reach this helper; executable objects never do.
  if (!Array.isArray(input)) return fail('format')
  if (input.length > max) return fail('limit')
  return input
}

/** Business decoding only, never an authority to import, execute a model,
 * dereference a URI or open a local ID. The record is independently supplied
 * by the authenticated manifest. Identity domain/parent checks follow in the
 * whole-graph review, not in the legacy local-ID conversation projector. */
export async function decodeSyncContent(input: Blob, record: { id: string; kind: SyncKind }, assertCurrent: () => void): Promise<SyncContent> {
  assertCurrent(); uuid(record.id)
  let blob: Blob
  try { blob = nativeSlice.call(input, 0) } catch { return fail('format') }
  if (blob.size > SYNC_LIMITS.objectBytes) return fail('limit')
  if (blob.size < 13) return fail('format')
  const header = new Uint8Array(await nativeRead.call(nativeSlice.call(blob, 0, 13))); assertCurrent()
  if (!magic.every((b, i) => b === header[i])) return fail('format')
  const length = new DataView(header.buffer).getUint32(9)
  if (!length || length > blob.size - 13) return fail('format')
  const bytes = await nativeRead.call(nativeSlice.call(blob, 13, 13 + length)); assertCurrent()
  let json: string, value: unknown
  try { json = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); value = JSON.parse(json) }
  catch { return fail('format') }
  // Reject duplicate members, BOM prefix, whitespace, alternate escapes and
  // number spellings. UTF-16 string contents (including lone surrogates) stay exact.
  if (canonicalSyncJSON(value) !== json) return fail('format')
  const frame = fields(value, ['kind', 'version', 'data']), binary = nativeSlice.call(blob, 13 + length)
  if (frame.version !== 1 || frame.kind !== record.kind) return fail('format')
  if (record.kind !== 'file' && record.kind !== 'project-source' && binary.size) return fail('format')
  switch (record.kind) {
    case 'conversation': {
      const d = fields(frame.data, ['conversation', 'galleryAliases']), conversation = projectSyncConversation(d.conversation)
      if (conversation.id !== record.id) return fail('format')
      const aliases = array(d.galleryAliases, 20_000).map(item => {
        const a = fields(item, ['messageId', 'textId', 'fileId'])
        if (!isGeneratedImageId(a.textId)) return fail('format')
        return { messageId: uuid(a.messageId), textId: a.textId, fileId: uuid(a.fileId) }
      })
      const expected = conversation.messages.flatMap(m => (m.generatedImages ?? []).map(fileId => ({ messageId: m.id, fileId })))
      if (expected.length !== aliases.length || expected.some((e, i) => e.messageId !== aliases[i]!.messageId || e.fileId !== aliases[i]!.fileId)) return fail('format')
      const byMessage = new Map<string, Set<string>>()
      for (const a of aliases) {
        const ids = byMessage.get(a.messageId) ?? new Set<string>()
        if (ids.has(a.textId)) return fail('format')
        ids.add(a.textId); byMessage.set(a.messageId, ids)
      }
      return { kind: record.kind, data: { conversation, galleryAliases: aliases } }
    }
    case 'file': {
      const optional = ['width', 'height', 'normalizationVersion']
      const raw = frame.data as Record<string, unknown> | null
      const present = optional.filter(k => raw && Object.prototype.hasOwnProperty.call(raw, k))
      const d = fields(raw, ['id', 'name', 'type', 'size', 'recordedSize', 'createdAt', ...present])
      if (uuid(d.id) !== record.id || typeof d.name !== 'string' || typeof d.type !== 'string' || d.size !== binary.size ||
        !boundedInteger(d.recordedSize) || !Number.isSafeInteger(d.createdAt) || present.some(k => !boundedInteger(d[k]))) return fail('format')
      if (present.includes('normalizationVersion')) {
        if (d.normalizationVersion !== IMAGE_NORMALIZATION_VERSION || !boundedInteger(d.width, MAX_IMAGE_DIMENSION) || !d.width ||
          !boundedInteger(d.height, MAX_IMAGE_DIMENSION) || !d.height || !['image/png', 'image/jpeg'].includes(d.type) ||
          !binary.size || binary.size > MAX_NORMALIZED_IMAGE_BYTES) return fail('format')
        // A canonical marker is an assertion about bytes, not just arbitrary
        // historical presentation. Inspect a bounded header, never DOM/Canvas.
        let header
        try { header = await inspectImageHeader(binary, d.type) } catch { assertCurrent(); return fail('format') }
        assertCurrent()
        if (header.width !== d.width || header.height !== d.height) return fail('integrity')
      }
      // Raw length, historical row size and per-message presentation size are
      // different facts. Capture allows arbitrary bounded strings/empty MIME.
      return { kind: record.kind, data: d as SyncFileContent, binary }
    }
    case 'project': {
      const d = fields(frame.data, ['schema', 'id', 'name', 'instructions', 'euOnly', 'createdAt', 'updatedAt', 'documents'])
      if (uuid(d.id) !== record.id) return fail('format')
      const documents = array(d.documents, PROJECT_LIMITS.documentsPerProject).map(item => {
        const { sourceId, textId, ...doc } = fields(item, [...descriptorKeys, 'sourceId', 'textId'])
        const parsed = descriptor(doc)
        if (uuid(sourceId) !== parsed.id || uuid(textId) === sourceId) return fail('format')
        return { ...parsed, sourceId, textId: textId as string }
      })
      // The dummy owner/revision only reuse the local business validator;
      // these local CAS fields never enter the returned shared content.
      if (!validProject({ ...d, documents, owner: 'validation-only', revision: 1 })) return fail('format')
      return { kind: record.kind, data: { ...d, documents } as SyncProjectContent }
    }
    case 'project-source': {
      const d = fields(frame.data, ['projectId', 'document']), projectId = uuid(d.projectId), document = descriptor(d.document)
      if (document.id !== record.id || document.sourceBytes !== binary.size) return fail('format')
      const raw = await nativeRead.call(binary); assertCurrent()
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', raw)); assertCurrent()
      if ([...digest].map(b => b.toString(16).padStart(2, '0')).join('') !== document.sourceHash) return fail('integrity')
      return { kind: record.kind, data: { projectId, document }, binary }
    }
    case 'project-text': {
      const d = fields(frame.data, ['projectId', 'documentId', 'text'])
      if (typeof d.text !== 'string') return fail('format')
      if (d.text.length > PROJECT_LIMITS.documentTextChars) return fail('limit')
      return { kind: record.kind, data: { projectId: uuid(d.projectId), documentId: uuid(d.documentId), text: d.text } }
    }
  }
}
