import { decrypt, isCryptoContextChanged } from '../crypto'
import { captureConversationForBackup } from '../storage'
import { readOwnedFileSnapshot } from '../secureFileStorage'
import { captureLocalReadScope, withReadOnlyProjectLibrary } from '../projects/store'
import { ProjectError, type Project } from '../projects/types'
import { validGeneratedImage } from '../generatedImages'
import { documentWorkspaceSignal } from '../workspaceWriter/runtime'
import { mapCapturedConversation } from './captureMapping'
import { createRecoveryCode, decodeUTF8, sha256, utf8 } from './bytes'
import { sealWorkspaceBackup, openWorkspaceBackup, type OpenedWorkspaceBackup } from './archive'
import { validateSnapshot } from './schema'
import { BACKUP_LIMITS as L, BackupError, type BackupGuard, type BackupSnapshot, type BackupFile, type BackupProject, type BackupDiagnostics } from './types'

export interface ArchiveReport {
  archiveId: string; createdAt: number; version: number; fingerprint: string
  conversations: number; messages: number; files: number; projects: number; documents: number; bytes: number
  diagnostics: BackupDiagnostics; metadataVariants: number
}
export interface PreparedConversationArchive {
  readonly archive: Blob; readonly recoveryCode: string; readonly report: ArchiveReport; readonly filename: string
  assertCurrent(): void; validate(): Promise<void>; dispose(): void
  verify(file: Blob, code: string, signal?: AbortSignal): Promise<ArchiveReport>
}
export function backupErrorCode(error: unknown): BackupError['code'] {
  if (error instanceof BackupError) return error.code
  if (isCryptoContextChanged(error)) return 'cancelled'
  if (error instanceof ProjectError) return error.code === 'locked' ? 'unreadable' : error.code === 'deleted' ? 'missing' : error.code === 'conflict' ? 'changed' : error.code === 'cancelled' ? 'cancelled' : 'unavailable'
  return 'unavailable'
}
function decodeBase64(input: string): Uint8Array {
  if (typeof input !== 'string' || input.length > Math.ceil(L.objectBytes * 4 / 3) + 1024) throw new BackupError('limit')
  const value = input.startsWith('data:') ? input.replace(/^data:[^,]{0,256};base64,/, '') : input
  if (!value.length || value.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new BackupError('format')
  const bytes = value.length / 4 * 3 - (value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0)
  if (bytes < 1 || bytes > L.objectBytes) throw new BackupError('limit')
  let binary: string
  try { binary = atob(value) } catch { throw new BackupError('format') }
  if (btoa(binary) !== value) throw new BackupError('format')
  return Uint8Array.from(binary, ch => ch.charCodeAt(0))
}
async function reportFor(opened: OpenedWorkspaceBackup, guard: BackupGuard): Promise<ArchiveReport> {
  guard.assertCurrent()
  const m = opened.manifest
  const fingerprint = await sha256(utf8.encode(JSON.stringify(m))); guard.assertCurrent()
  let metadataVariants = 0
  for (const c of m.conversations) for (const message of c.messages) for (const ref of message.files ?? []) {
    const f = m.files.find(file => file.id === ref.id)!, p = ref.presentation
    if (p && Object.entries(p).some(([key, value]) => value !== f[key as keyof BackupFile])) metadataVariants++
  }
  metadataVariants += m.files.filter(f => f.recordedSize !== undefined && f.recordedSize !== f.size).length
  return Object.freeze({ archiveId: m.archiveId, createdAt: m.createdAt, version: m.version, fingerprint,
    conversations: m.conversations.length, messages: m.conversations.reduce((n, c) => n + c.messages.length, 0), files: m.files.length,
    projects: m.projects.length, documents: m.projects.reduce((n, p) => n + p.documents.length, 0),
    bytes: m.objects.reduce((n, o) => n + o.bytes, 0), diagnostics: Object.freeze({ ...opened.diagnostics }), metadataVariants })
}

/** Select exactly one WHOLE conversation, with every structured dependency.
 * No source writes, repair, network, Markdown URI lookup or re-extraction. */
export async function prepareConversationArchive(id: string, options: {
  includeProject: boolean; isBusy(id: string): boolean; signal: AbortSignal
}): Promise<PreparedConversationArchive> {
  const scope = captureLocalReadScope(options.signal) // includes erasure; BEFORE first await
  let disposed = false
  const assertAlive = () => {
    if (disposed || options.signal.aborted || documentWorkspaceSignal.aborted) throw new BackupError('cancelled')
    scope.assertCurrent()
  }
  assertAlive()
  if (options.isBusy(id)) throw new BackupError('busy')
  const ticket = captureConversationForBackup(id, mapCapturedConversation), conversation = ticket.snapshot
  const assertCurrent = () => {
    assertAlive(); ticket.assertUnchanged()
    if (options.isBusy(id)) throw new BackupError('busy')
  }
  const guard: BackupGuard = { assertCurrent, signal: options.signal }
  const assertDelivery = () => { assertCurrent(); ticket.assertSnapshot((a, b) => JSON.stringify(a) === JSON.stringify(b)) }
  const validate = async () => { assertDelivery(); await scope.validateReadOnly(); assertDelivery() }
  const snapshot: BackupSnapshot = { conversations: [conversation], projects: [], files: [], objects: [] }
  const objects = new Map<string, Blob>()
  let total = 0
  const addObject = async (bytes: Uint8Array, kind: 'file' | 'project-source' | 'project-text') => {
    try {
      assertCurrent(); total += bytes.length
      if (bytes.length < 1 || bytes.length > L.objectBytes || total > L.plaintextBytes || objects.size >= L.objects) throw new BackupError('limit')
      const id = crypto.randomUUID(), digest = await sha256(bytes); assertCurrent()
      objects.set(id, new Blob([bytes])); snapshot.objects.push({ id, kind, bytes: bytes.length, sha256: digest })
      return id
    } finally { bytes.fill(0) }
  }
  const captureFiles = async () => {
    const ids = [...new Set(conversation.messages.flatMap(m => [...(m.files ?? []).map(f => f.id), ...m.embeddedFiles]))]
    const records = await readOwnedFileSnapshot(ids, assertCurrent, options.signal); assertCurrent()
    for (const [id, row] of records) {
      let encoded: string
      try { encoded = await decrypt(row.encryptedData) }
      catch (error) { assertCurrent(); if (isCryptoContextChanged(error)) throw new BackupError('cancelled'); throw new BackupError('unreadable') }
      assertCurrent()
      if (conversation.messages.some(m => m.embeddedFiles.includes(id)) && !validGeneratedImage(encoded, row.mimeType)) throw new BackupError('format')
      const bytes = decodeBase64(encoded), size = bytes.length
      const objectId = await addObject(bytes, 'file')
      snapshot.files.push({ id, name: row.name, type: row.mimeType, size, recordedSize: row.size, objectId,
        ...(row.width !== undefined ? { width: row.width } : {}), ...(row.height !== undefined ? { height: row.height } : {}),
        ...(row.normalizationVersion !== undefined ? { normalizationVersion: row.normalizationVersion } : {}) })
    }
  }
  try {
    await validate()
    if (options.includeProject && conversation.projectId) {
      // Pin the project's revision BEFORE the atomic file snapshot, then
      // recheck after documents. All parts coexisted at that snapshot point.
      await withReadOnlyProjectLibrary({ ...scope, assertCurrent }, async reader => {
        const summary = await reader.get(conversation.projectId!); assertCurrent()
        if (!summary || summary.status === 'deleted') throw new BackupError('missing')
        if (summary.status !== 'ready' || !summary.project) throw new BackupError('unreadable')
        const p: Project = summary.project
        await captureFiles()
        const project: BackupProject = { schema: 1, id: p.id, revision: p.revision, name: p.name, instructions: p.instructions,
          euOnly: p.euOnly, createdAt: p.createdAt, updatedAt: p.updatedAt, documents: [] }
        for (const d of p.documents) {
          const source = await reader.source(p, d.id); assertCurrent()
          const sourceObjectId = await addObject(decodeBase64(source), 'project-source')
          const text = await reader.text(p, d.id); assertCurrent()
          const textBytes = utf8.encode(text)
          // TextEncoder replaces isolated UTF-16 surrogates. Never silently
          // rewrite a historical extracted text and claim exact preservation.
          if (decodeUTF8(textBytes) !== text) { textBytes.fill(0); throw new BackupError('format') }
          const textObjectId = await addObject(textBytes, 'project-text')
          project.documents.push({ id: d.id, name: d.name, originalName: d.originalName, format: d.format, revision: d.revision,
            sourceHash: d.sourceHash, sourceBytes: d.sourceBytes, textChars: d.textChars, extractorVersion: d.extractorVersion,
            createdAt: d.createdAt, sourceObjectId, textObjectId })
        }
        const latest = await reader.get(p.id); assertCurrent()
        if (latest?.status !== 'ready' || latest.revision !== p.revision) throw new BackupError('changed')
        snapshot.projects.push(project)
      })
    } else await captureFiles()
    assertCurrent(); validateSnapshot(snapshot, 2)
    await validate()
    let recoveryCode = createRecoveryCode()
    let archive: Blob | null = await sealWorkspaceBackup(snapshot, objects, recoveryCode, guard, 2)
    objects.clear()
    const report = await reportFor(await openWorkspaceBackup(archive, recoveryCode, guard), guard)
    await validate()
    return {
      get archive() { assertDelivery(); return archive! },
      get recoveryCode() { assertDelivery(); return recoveryCode },
      get report() { assertDelivery(); return report },
      filename: `arty-${report.archiveId}.artybackup`, assertCurrent: assertDelivery, validate,
      dispose() { disposed = true; recoveryCode = ''; archive = null },
      async verify(file, code, signal) {
        // A saved snapshot remains verifiable after source edits. This does
        // NOT relax archive/download getters or their source freshness guard.
        const assertRead = () => { assertAlive(); if (signal?.aborted) throw new BackupError('cancelled') }
        const readGuard = { assertCurrent: assertRead, signal: signal ?? options.signal }
        assertRead(); await scope.validateReadOnly(); assertRead()
        const received = await reportFor(await openWorkspaceBackup(file, code, readGuard), readGuard)
        await scope.validateReadOnly(); assertRead()
        if (received.archiveId !== report.archiveId || received.fingerprint !== report.fingerprint) throw new BackupError('different')
        return received
      },
    }
  } catch (error) { try { assertAlive() } finally { disposed = true }; throw error }
  finally { objects.clear() }
}

/** Independent verifier: never import or resolve manifest IDs in local stores. */
export async function verifyWorkspaceArchive(file: Blob, code: string, signal: AbortSignal): Promise<ArchiveReport> {
  const scope = captureLocalReadScope(signal)
  const guard = { signal, assertCurrent() {
    if (signal.aborted || documentWorkspaceSignal.aborted) throw new BackupError('cancelled')
    scope.assertCurrent()
  } }
  const result = await reportFor(await openWorkspaceBackup(file, code, guard), guard)
  await scope.validateReadOnly(); guard.assertCurrent()
  return result
}
