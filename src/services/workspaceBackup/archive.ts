import { BACKUP_FEATURES, BACKUP_LIMITS as L, BackupError, checkBackupGuard, type BackupGuard,
  type BackupManifest, type BackupSnapshot, type BackupDiagnostics, type BackupSchemaVersion } from './types'
import { decodeUTF8, hex, readRecoveryCode, sha256, unhex, utf8 } from './bytes'
import { freezeManifest, parseManifest, validateGraph, validateSnapshot } from './schema'

const MAGIC = utf8.encode('ARTYBKP1'), HEADER_BYTES = 64, PREFIX_BYTES = 9, TAG_BYTES = 16
const INFO = utf8.encode('arty-workspace-backup/v1')
const uuidText = (bytes: Uint8Array): string => {
  const h = hex(bytes); return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

/** Admission calculation shared with the future preview, before allocation. */
export function calculateArchiveLayout(objectBytes: readonly number[], manifestBytes: number) {
  if (!Number.isSafeInteger(manifestBytes) || manifestBytes < 1 || !Array.isArray(objectBytes) || objectBytes.length > L.objects) throw new BackupError('limit')
  let plaintext = manifestBytes, frames = 1
  for (let i = 0; i < objectBytes.length; i++) {
    const bytes = objectBytes[i]!
    if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > L.objectBytes) throw new BackupError('limit')
    plaintext += bytes; frames += Math.ceil(bytes / L.chunkBytes)
  }
  const bytes = HEADER_BYTES + plaintext + frames * (PREFIX_BYTES + TAG_BYTES)
  if (manifestBytes < 1 || manifestBytes > L.manifestBytes || plaintext > L.plaintextBytes || frames > L.frames || bytes > L.archiveBytes) throw new BackupError('limit')
  return { plaintext, frames, bytes }
}
function prefix(index: number, length: number): Uint8Array {
  const result = new Uint8Array(PREFIX_BYTES), view = new DataView(result.buffer)
  result[0] = index === 0 ? 1 : 2; view.setUint32(1, index); view.setUint32(5, length)
  return result
}
function parameters(header: Uint8Array, pre: Uint8Array, index: number): AesGcmParams {
  const iv = new Uint8Array(12); new DataView(iv.buffer).setUint32(8, index)
  const aad = new Uint8Array(HEADER_BYTES + PREFIX_BYTES); aad.set(header); aad.set(pre, HEADER_BYTES)
  return { name: 'AES-GCM', iv, additionalData: aad, tagLength: 128 }
}
async function deriveKey(secret: string, salt: Uint8Array, guard: BackupGuard): Promise<CryptoKey> {
  checkBackupGuard(guard)
  const raw = readRecoveryCode(secret)
  try {
    const root = await crypto.subtle.importKey('raw', raw, 'HKDF', false, ['deriveKey']); checkBackupGuard(guard)
    const key = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: INFO }, root,
      { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
    checkBackupGuard(guard); return key
  } finally { raw.fill(0) }
}
async function readBlob(blob: Blob, guard: BackupGuard): Promise<Uint8Array> {
  checkBackupGuard(guard)
  const result = new Uint8Array(await blob.arrayBuffer()); checkBackupGuard(guard); return result
}
async function verifyObject(blob: Blob, expected: string, guard: BackupGuard): Promise<void> {
  const bytes = await readBlob(blob, guard)
  try { const digest = await sha256(bytes); checkBackupGuard(guard); if (digest !== expected) throw new BackupError('integrity') }
  finally { bytes.fill(0) }
}
async function verifyTextObjects(manifest: BackupManifest, objects: ReadonlyMap<string, Blob>, guard: BackupGuard): Promise<Map<string, number>> {
  const lines = new Map<string, number>()
  for (const project of manifest.projects) for (const doc of project.documents) {
    const bytes = await readBlob(objects.get(doc.textObjectId)!, guard)
    try {
      const text = decodeUTF8(bytes)
      if (text.length !== doc.textChars || !text.trim()) throw new BackupError('integrity')
      let count = 1
      for (let i = 0; i < text.length; i++) if (text[i] === '\n') count++
      lines.set(doc.textObjectId, count)
    } finally { bytes.fill(0) }
  }
  return lines
}

/** Pure local encoder. Caller must obtain immutable source Blobs and pass a
 * scope guard. No localStorage, IDB, user-session change or network effect.
 * This API does not save/deliver the file; it only prepares an encrypted Blob. */
export async function sealWorkspaceBackup(snapshot: BackupSnapshot, inputObjects: ReadonlyMap<string, Blob>, secret: string, guard: BackupGuard, version: BackupSchemaVersion = 1): Promise<Blob> {
  checkBackupGuard(guard); validateSnapshot(snapshot, version)
  // Clone allowlisted metadata synchronously BEFORE the first await.
  const archiveId = crypto.randomUUID()
  // ARTYBKP1/HKDF /v1 identify the unchanged envelope, not the manifest schema.
  const json = JSON.stringify({ ...snapshot, format: 'arty-workspace', version, minReader: version,
    features: BACKUP_FEATURES, archiveId, createdAt: Date.now() })
  const manifest = parseManifest(json), plainManifest = utf8.encode(json), shape = calculateArchiveLayout(manifest.objects.map(o => o.bytes), plainManifest.length)
  const objects = new Map<string, Blob>()
  if (inputObjects.size !== manifest.objects.length) throw new BackupError('missing')
  for (const obj of manifest.objects) {
    const blob = inputObjects.get(obj.id)
    if (!(blob instanceof Blob) || blob.size !== obj.bytes) throw new BackupError('missing')
    // Native Blob is immutable; sever the caller's mutable Map before await.
    objects.set(obj.id, blob.slice())
  }
  const header = new Uint8Array(HEADER_BYTES), view = new DataView(header.buffer)
  header.set(MAGIC); header.set(unhex(archiveId.replace(/-/g, '')), 8)
  header.set(crypto.getRandomValues(new Uint8Array(32)), 24)
  view.setUint32(56, shape.frames); view.setUint32(60, plainManifest.length)
  const key = await deriveKey(secret, header.slice(24, 56), guard)
  const parts: BlobPart[] = [header]
  let index = 0
  const encryptFrame = async (bytes: Uint8Array) => {
    checkBackupGuard(guard)
    const pre = prefix(index, bytes.length)
    const cipher = await crypto.subtle.encrypt(parameters(header, pre, index), key, bytes)
    checkBackupGuard(guard); parts.push(pre, cipher); index++
  }
  try {
    await encryptFrame(plainManifest)
    for (const obj of manifest.objects) {
      const blob = objects.get(obj.id)!
      await verifyObject(blob, obj.sha256, guard)
      for (let offset = 0; offset < blob.size; offset += L.chunkBytes) {
        const bytes = await readBlob(blob.slice(offset, offset + L.chunkBytes), guard)
        try { await encryptFrame(bytes) } finally { bytes.fill(0) }
      }
    }
    await verifyTextObjects(manifest, objects, guard); checkBackupGuard(guard)
    const result = new Blob(parts, { type: 'application/octet-stream' })
    if (index !== shape.frames || result.size !== shape.bytes) throw new BackupError('integrity')
    return result
  } finally { plainManifest.fill(0); parts.length = 0 }
}

export interface OpenedWorkspaceBackup {
  readonly manifest: BackupManifest
  readonly diagnostics: Readonly<BackupDiagnostics>
  /** Immutable bytes only; an ID here is not authority to read application IDB. */
  object(id: string): Blob
}
/** Nothing is published until every frame, digest and graph edge is verified.
 * The input remains untouched on wrong code/corruption/cancellation. */
export async function openWorkspaceBackup(input: Blob, secret: string, guard: BackupGuard): Promise<OpenedWorkspaceBackup> {
  checkBackupGuard(guard)
  if (!(input instanceof Blob) || input.size < HEADER_BYTES + PREFIX_BYTES + TAG_BYTES + 1) throw new BackupError('format')
  if (input.size > L.archiveBytes) throw new BackupError('limit')
  const archive = input.slice(), header = await readBlob(archive.slice(0, HEADER_BYTES), guard)
  if (!MAGIC.every((byte, i) => byte === header[i])) throw new BackupError('format')
  const view = new DataView(header.buffer), frames = view.getUint32(56), manifestLength = view.getUint32(60)
  if (frames < 1 || frames > L.frames || manifestLength < 1 || manifestLength > L.manifestBytes) throw new BackupError('limit')
  if (HEADER_BYTES + manifestLength + frames * (PREFIX_BYTES + TAG_BYTES) > archive.size) throw new BackupError('format')
  const key = await deriveKey(secret, header.slice(24, 56), guard)
  let offset = HEADER_BYTES, index = 0
  const decryptFrame = async (expectedLength: number): Promise<Uint8Array> => {
    if (offset + PREFIX_BYTES + expectedLength + TAG_BYTES > archive.size) throw new BackupError('format')
    const pre = await readBlob(archive.slice(offset, offset + PREFIX_BYTES), guard)
    const v = new DataView(pre.buffer)
    if (pre[0] !== (index === 0 ? 1 : 2) || v.getUint32(1) !== index || v.getUint32(5) !== expectedLength) throw new BackupError('format')
    offset += PREFIX_BYTES
    const cipher = await readBlob(archive.slice(offset, offset + expectedLength + TAG_BYTES), guard)
    let plain: ArrayBuffer
    try { plain = await crypto.subtle.decrypt(parameters(header, pre, index), key, cipher) }
    catch { checkBackupGuard(guard); throw new BackupError('integrity') }
    checkBackupGuard(guard); offset += cipher.length; index++
    return new Uint8Array(plain)
  }
  const manifestBytes = await decryptFrame(manifestLength)
  let manifest: BackupManifest
  try { manifest = parseManifest(decodeUTF8(manifestBytes)) }
  finally { manifestBytes.fill(0) }
  if (manifest.archiveId !== uuidText(header.slice(8, 24))) throw new BackupError('integrity')
  const shape = calculateArchiveLayout(manifest.objects.map(o => o.bytes), manifestLength)
  if (shape.frames !== frames || shape.bytes !== archive.size) throw new BackupError('format')
  const objects = new Map<string, Blob>()
  for (const obj of manifest.objects) {
    const chunks: Blob[] = []
    try {
      for (let remaining = obj.bytes; remaining > 0; remaining -= L.chunkBytes) {
        const plain = await decryptFrame(Math.min(remaining, L.chunkBytes))
        // Blob copies these bytes synchronously, then the temporary is zeroed.
        try { chunks.push(new Blob([plain])) } finally { plain.fill(0) }
      }
      const blob = new Blob(chunks)
      await verifyObject(blob, obj.sha256, guard); objects.set(obj.id, blob)
    } finally { chunks.length = 0 }
  }
  if (offset !== archive.size || index !== frames) throw new BackupError('format')
  const textLines = await verifyTextObjects(manifest, objects, guard); checkBackupGuard(guard)
  const diagnostics = Object.freeze(validateGraph(manifest, textLines))
  const frozen = freezeManifest(manifest)
  return Object.freeze({ get manifest() { checkBackupGuard(guard); return frozen },
    get diagnostics() { checkBackupGuard(guard); return diagnostics },
    object(id: string) { checkBackupGuard(guard); const blob = objects.get(id); if (!blob) throw new BackupError('missing'); return blob } })
}
