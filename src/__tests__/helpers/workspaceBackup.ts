import { webcrypto, randomUUID } from 'node:crypto'
import { Blob as NodeBlob } from 'node:buffer'
import type { BackupSnapshot, BackupManifest } from '../../services/workspaceBackup/types'
import { BACKUP_FEATURES, BACKUP_LIMITS } from '../../services/workspaceBackup/types'
import { sha256 } from '../../services/workspaceBackup/bytes'

export const guard = { assertCurrent() {} }
export const ids = { file: randomUUID(), crop: randomUUID(), fileObj: randomUUID(), cropObj: randomUUID(),
  sourceObj: randomUUID(), textObj: randomUUID(), project: randomUUID(), doc: randomUUID(), conv: randomUUID(), old: randomUUID() }
export const code = 'ARTY1-00112233-44556677-8899AABB-CCDDEEFF-00112233-44556677-8899AABB-CCDDEEFF'
export function emptySnapshot(): BackupSnapshot { return { conversations: [], projects: [], files: [], objects: [] } }
export async function fixture(large = false) {
  const bytes = new Uint8Array(large ? BACKUP_LIMITS.chunkBytes + 13 : 13).fill(127)
  bytes[0] = 137; bytes[1] = 80; bytes[2] = 78; bytes[3] = 71
  const source = new Uint8Array([0, 1, 2, 255, 60, 10]), text = new TextEncoder().encode('Été\nLigne deux 😀\r\n')
  const objects = new Map<string, Blob>([
    [ids.fileObj, new Blob([bytes])], [ids.cropObj, new Blob([new Uint8Array([7, 8, 9])])],
    [ids.sourceObj, new Blob([source])], [ids.textObj, new Blob([text])],
  ])
  const descriptors = await Promise.all([...objects].map(async ([id, blob]) => ({ id,
    kind: id === ids.sourceObj ? 'project-source' as const : id === ids.textObj ? 'project-text' as const : 'file' as const,
    bytes: blob.size, sha256: await sha256(new Uint8Array(await blob.arrayBuffer())) })))
  const sourceHash = descriptors.find(o => o.id === ids.sourceObj)!.sha256
  const snapshot: BackupSnapshot = {
    objects: descriptors,
    files: [{ id: ids.file, name: 'été.png', type: 'image/png', size: bytes.length, objectId: ids.fileObj, width: 1, height: 1, normalizationVersion: 2 },
      { id: ids.crop, name: 'détail.png', type: 'image/png', size: 3, objectId: ids.cropObj, width: 1, height: 1, normalizationVersion: 2 }],
    projects: [{ schema: 1, id: ids.project, revision: 7, name: 'Dossier privé', instructions: 'Ne pas divulguer', euOnly: true,
      createdAt: 1, updatedAt: 7, documents: [{ id: ids.doc, revision: 1, name: 'Contrat', originalName: 'contrat.docx', format: 'docx',
        sourceHash, sourceBytes: source.length, textChars: new TextDecoder().decode(text).length, extractorVersion: 'arty-project-text-v1',
        createdAt: 2, sourceObjectId: ids.sourceObj, textObjectId: ids.textObj }] }],
    conversations: [{ id: ids.conv, title: 'Travail confidentiel', createdAt: 3, updatedAt: 8, euOnly: true, hasProjectContext: true, hasGoogleData: true,
      projectId: ids.project, tags: ['privé'], usedModels: ['unknown-historical-model'], messages: [
        { id: 'user-one', role: 'user', content: 'Analyse mon document', timestamp: 3, embeddedFiles: [], files: [{ id: ids.file }], quickAction: { id: 'summarize', locale: 'fr' } },
        { id: 'reply', role: 'assistant', content: `![résultat](arty-img://${ids.file})\n[S1] texte\n<div data-action="view_trail" data-trail-id="legacy">Historique</div>`,
          timestamp: 4, embeddedFiles: [ids.file], interrupted: true, pinned: true, model: 'unknown-historical-model', requestedModel: 'historical', modelSource: 'provider',
          factCheck: { overallConfidence: 'medium', modelLabel: 'Ancien modèle', checkedAt: 4, status: 'success-with-claims', originalContent: 'texte original', appliedCorrections: 1,
            claims: [{ claim: 'Affirmation', verdict: 'wrong', explanation: 'Explication', originalText: 'avant', correction: 'après', applied: true }] },
          projectTurn: { version: 1, projectId: ids.project, projectRevision: 7, projectName: 'Dossier privé', mode: 'search', euOnly: true, partial: true,
            sources: [{ projectId: ids.project, projectRevision: 6, documentId: ids.doc, documentRevision: 1, sourceHash, extractorVersion: 'arty-project-text-v1',
              name: 'Contrat', format: 'docx', startLine: 1, endLine: 2, partial: true }] } },
        { id: 'user-two', role: 'user', content: 'Le détail', timestamp: 6, embeddedFiles: [], files: [{ id: ids.crop,
          visionCrop: { kind: 'auto', sourceFileId: ids.file, sourceFileIds: [ids.file], rect: { x: 0, y: 0, width: 1, height: 1 } } }] },
      ] }],
  }
  return { snapshot, objects }
}
export function manifest(snapshot: BackupSnapshot = emptySnapshot()): BackupManifest {
  return { ...snapshot, format: 'arty-workspace', version: 1, minReader: 1, features: BACKUP_FEATURES, archiveId: randomUUID(), createdAt: 1 }
}

/** Independent test producer: builds VALID GCM tags around intentionally bad
 * application data. Does not call the production encoder/decoder/schema. */
export async function forgeArchive(rawManifest: unknown | Uint8Array, chunks: Uint8Array[] = [], options: { secret?: string; headerId?: string } = {}): Promise<Blob> {
  const raw = rawManifest instanceof Uint8Array ? rawManifest : new TextEncoder().encode(JSON.stringify(rawManifest))
  const uuid = options.headerId ?? (rawManifest as BackupManifest)?.archiveId ?? randomUUID()
  const header = new Uint8Array(64), dv = new DataView(header.buffer)
  header.set(new TextEncoder().encode('ARTYBKP1')); header.set(Buffer.from(uuid.replace(/-/g, ''), 'hex'), 8)
  header.set(webcrypto.getRandomValues(new Uint8Array(32)), 24); dv.setUint32(56, chunks.length + 1); dv.setUint32(60, raw.length)
  const keyBytes = Buffer.from((options.secret ?? code).slice(6).replace(/-/g, ''), 'hex')
  const root = await webcrypto.subtle.importKey('raw', keyBytes, 'HKDF', false, ['deriveKey'])
  const key = await webcrypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: header.slice(24, 56), info: new TextEncoder().encode('arty-workspace-backup/v1') },
    root, { name: 'AES-GCM', length: 256 }, false, ['encrypt'])
  const parts: BlobPart[] = [header]
  for (const [index, plain] of [raw, ...chunks].entries()) {
    const pre = new Uint8Array(9), v = new DataView(pre.buffer); pre[0] = index === 0 ? 1 : 2; v.setUint32(1, index); v.setUint32(5, plain.length)
    const iv = new Uint8Array(12); new DataView(iv.buffer).setUint32(8, index)
    const aad = new Uint8Array(73); aad.set(header); aad.set(pre, 64)
    parts.push(pre, await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad, tagLength: 128 }, key, plain))
  }
  return new NodeBlob(parts) as Blob
}
