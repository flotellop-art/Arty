import { decrypt } from '../crypto'
import { ProjectError, boundedInteger, validProject, validProjectId, validDescriptor, type Project, type ProjectDocument } from './types'

export type ProjectRow = {
  key: [string, string]; owner: string; id: string; revision: number; state: 'live' | 'deleted'
  euOnly: boolean; createdAt: number; updatedAt: number; cipher: string | null
}
export type DocumentRow = {
  key: [string, string, string, 'source' | 'text' | 'tombstone']; owner: string; projectId: string; id: string
  kind: 'source' | 'text' | 'tombstone'; state: 'live' | 'deleted'; sourceBytes: number; textChars: number
  updatedAt: number; cipher: string | null
}
export type DocumentPayload = { schema: 1; owner: string; projectId: string; kind: 'source' | 'text'; descriptor: ProjectDocument; content: string }

export function validProjectRow(row: ProjectRow, owner: string, id: string): boolean {
  return row.owner === owner && row.id === id && Array.isArray(row.key) && row.key.length === 2 && row.key[0] === owner && row.key[1] === id &&
    validProjectId(id) && boundedInteger(row.revision) && row.revision > 0 && typeof row.euOnly === 'boolean' &&
    boundedInteger(row.createdAt) && boundedInteger(row.updatedAt) && ['live', 'deleted'].includes(row.state)
}
export function snapshotDescriptor(d: ProjectDocument): ProjectDocument {
  if (!validDescriptor(d)) throw new ProjectError('corrupt')
  return { id: d.id, name: d.name, originalName: d.originalName, format: d.format, revision: d.revision,
    sourceHash: d.sourceHash, sourceBytes: d.sourceBytes, textChars: d.textChars, extractorVersion: d.extractorVersion, createdAt: d.createdAt }
}
function sameDescriptor(a: ProjectDocument, b: ProjectDocument): boolean {
  return JSON.stringify(snapshotDescriptor(a)) === JSON.stringify(snapshotDescriptor(b))
}
export async function verifyOriginal(base64: string, descriptor: ProjectDocument): Promise<void> {
  if (base64.length !== 4 * Math.ceil(descriptor.sourceBytes / 3) || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) throw new ProjectError('corrupt')
  let bytes: Uint8Array
  try { bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0)) } catch { throw new ProjectError('corrupt') }
  try {
    if (bytes.length !== descriptor.sourceBytes) throw new ProjectError('corrupt')
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('')
    if (hash !== descriptor.sourceHash) throw new ProjectError('corrupt')
  } finally { bytes.fill(0) }
}
/** Internal decoder of an already owned, pinned IDB clone. No database lookup,
 * write token, freshness claim or fallback. Its caller owns lifetime checks and
 * must revalidate this EXACT row, not merely its revision, before using it. */
export async function decodeProjectSnapshot(owner: string, row: ProjectRow, assertCurrent: () => void): Promise<Project> {
  assertCurrent()
  if (!validProjectRow(row, owner, row.id)) throw new ProjectError('corrupt')
  if (row.state === 'deleted') throw new ProjectError('deleted')
  if (typeof row.cipher !== 'string' || row.cipher.length > 100_000) throw new ProjectError('locked')
  const payload = JSON.parse(await decrypt(row.cipher)) as Project
  assertCurrent()
  if (!validProject(payload) || payload.owner !== owner || payload.id !== row.id || payload.revision !== row.revision ||
    payload.euOnly !== row.euOnly || payload.createdAt !== row.createdAt || payload.updatedAt !== row.updatedAt) throw new ProjectError('locked')
  return payload
}
export async function decodeDocumentSnapshot(owner: string, project: Project, documentId: string, kind: 'source' | 'text', row: DocumentRow | undefined, assertCurrent: () => void): Promise<string> {
  assertCurrent()
  const descriptor = project.documents.find(d => d.id === documentId)
  if (!descriptor) throw new ProjectError('deleted')
  const key = [owner, project.id, documentId, kind]
  const maxPlainChars = (kind === 'source' ? 4 * Math.ceil(descriptor.sourceBytes / 3) : descriptor.textChars * 6) + 5000
  if (!row || row.owner !== owner || row.projectId !== project.id || row.id !== documentId || row.kind !== kind || row.state !== 'live' ||
    JSON.stringify(row.key) !== JSON.stringify(key) || row.sourceBytes !== descriptor.sourceBytes || row.textChars !== descriptor.textChars ||
    typeof row.cipher !== 'string' || row.cipher.length > maxPlainChars * 2) throw new ProjectError('locked')
  const plain = await decrypt(row.cipher); assertCurrent()
  if (plain.length > maxPlainChars) throw new ProjectError('locked')
  const payload = JSON.parse(plain) as DocumentPayload
  if (payload.schema !== 1 || payload.owner !== owner || payload.projectId !== project.id || payload.kind !== kind ||
    !sameDescriptor(payload.descriptor, descriptor) || typeof payload.content !== 'string') throw new ProjectError('locked')
  if (kind === 'text' && payload.content.length !== descriptor.textChars) throw new ProjectError('locked')
  if (kind === 'source') await verifyOriginal(payload.content, descriptor)
  assertCurrent(); return payload.content
}
