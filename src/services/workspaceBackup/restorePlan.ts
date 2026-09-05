import type { Conversation } from '../../types'
import type { BackupFile, BackupProject, BackupSnapshot, BackupGuard, BackupDiagnostics } from './types'
import { BackupError, checkBackupGuard } from './types'
import { openWorkspaceBackup, type OpenedWorkspaceBackup } from './archive'
import { cloneBoundedBackupJSON, validateSnapshot } from './schema'
import { sha256, utf8 } from './bytes'
import { MAX_GENERATED_IMAGES_PER_TURN, validGeneratedImage, isGeneratedImageId } from '../generatedImages'

type Entity = 'conversation' | 'message' | 'file' | 'project' | 'document'
export interface RestoreId {
  kind: Entity
  source: string
  /** Required only for message/document identities, scoped by source parent. */
  parent?: string
  target: string
}
export interface RestoreMappingRecord {
  version: 1
  archiveId: string
  fingerprint: string
  ids: RestoreId[]
}
export interface RestorePlan {
  readonly publication: 'not-authorized'
  readonly messagePolicy: 'historical-inert'
  readonly mapping: RestoreMappingRecord
  // Wrappers deliberately differ from active storage records. A future writer
  // needs target admission, exact writes and a durable journal before unwrap.
  readonly conversations: readonly { conversation: Conversation }[]
  readonly projects: readonly { project: BackupProject }[]
  readonly files: readonly { file: BackupFile; recordedSize: number }[]
  readonly diagnostics: Readonly<BackupDiagnostics>
  readonly resources: {
    conversations: number; messages: number; files: number; projects: number; documents: number
    objectBytes: number; sourceBytes: number; base64Chars: number
    conversationJsonUtf8Bytes: number; conversationJsonCodeUnits: number
  }
}
export interface PreparedWorkspaceRestore {
  readonly plan: RestorePlan
  /** Archive object IDs only; never reads a destination file/project store. */
  object(id: string): Blob
  assertCurrent(): void
  dispose(): void
}

function freezeData<T>(root: T): T {
  const stack: object[] = [root as object]
  while (stack.length) {
    const value = stack.pop()!
    for (const child of Object.values(value)) if (child && typeof child === 'object') stack.push(child)
    Object.freeze(value)
  }
  return root
}
const entityKey = (kind: Entity, source: string, parent?: string) => JSON.stringify([kind, parent ?? null, source])

/** Data preparation only. No account lookup, writes, navigation, rendering,
 * target-capacity claim or durable recovery. The caller supplies its lifetime
 * guard; a future publisher must ALSO admit owner/fence/generation/collisions.
 * Replaying a record here proves archive identity and mapping, not ownership.
 */
export async function prepareWorkspaceRestore(
  file: Blob,
  code: string,
  guard: BackupGuard,
  options: { idFactory?: () => string; replay?: RestoreMappingRecord } = {},
): Promise<PreparedWorkspaceRestore> {
  let disposed = false
  const assertCurrent = () => {
    if (disposed) throw new BackupError('cancelled')
    checkBackupGuard(guard)
  }
  const lifetime = { assertCurrent, signal: guard.signal }
  assertCurrent()
  // Sever the caller's mutable replay record before the first await.
  const replay = options.replay === undefined ? undefined : cloneBoundedBackupJSON(options.replay)
  const idFactory = options.idFactory ?? (() => crypto.randomUUID())
  let opened: OpenedWorkspaceBackup | undefined = await openWorkspaceBackup(file, code, lifetime)
  const manifest = opened.manifest
  const fingerprint = await sha256(utf8.encode(JSON.stringify(manifest)))
  assertCurrent()
  const snapshot: BackupSnapshot = cloneBoundedBackupJSON({
    conversations: manifest.conversations, projects: manifest.projects, files: manifest.files, objects: manifest.objects,
  })

  // A1's graph is wider than the actual gallery. Reject, never truncate it.
  const fileById = new Map(snapshot.files.map(item => [item.id, item]))
  const checkedImages = new Set<string>()
  for (const conversation of snapshot.conversations) for (const message of conversation.messages) {
    if (!message.embeddedFiles.length) continue
    if (message.role !== 'assistant' || message.embeddedFiles.length > MAX_GENERATED_IMAGES_PER_TURN) throw new BackupError('format')
    for (const id of message.embeddedFiles) {
      if (checkedImages.has(id)) continue
      const descriptor = fileById.get(id)!
      const blob = opened.object(descriptor.objectId)
      const prefix = new Uint8Array(await blob.slice(0, 12).arrayBuffer())
      assertCurrent()
      // The full blob size/digest were already verified by the reader. This
      // signature is only render admission, not a complete image decoder.
      const encoded = btoa(String.fromCharCode(...prefix))
      if (!validGeneratedImage(encoded, descriptor.type)) throw new BackupError('format')
      checkedImages.add(id)
    }
  }

  // First inventory every declared AND missing historical identity. No source
  // identifier may survive as accidental authority over pre-existing records.
  const identities = new Map<string, Omit<RestoreId, 'target'>>()
  const add = (kind: Entity, source: string, parent?: string) => {
    identities.set(entityKey(kind, source, parent), { kind, source, ...(parent === undefined ? {} : { parent }) })
  }
  for (const f of snapshot.files) add('file', f.id)
  for (const p of snapshot.projects) {
    add('project', p.id)
    for (const d of p.documents) add('document', d.id, p.id)
  }
  for (const c of snapshot.conversations) {
    add('conversation', c.id)
    if (c.projectId !== undefined) add('project', c.projectId)
    for (const m of c.messages) {
      add('message', m.id, c.id)
      for (const id of m.embeddedFiles) add('file', id)
      for (const f of m.files ?? []) {
        add('file', f.id)
        for (const id of f.visionCrop?.sourceFileIds ?? []) add('file', id)
      }
      if (m.projectTurn?.projectId !== undefined) add('project', m.projectTurn.projectId)
      for (const ref of m.projectTurn?.sources ?? []) {
        add('project', ref.projectId); add('document', ref.documentId, ref.projectId)
      }
    }
  }
  const reserved = new Set([...identities.values()].map(entry => entry.source.toLowerCase()))
  for (const object of snapshot.objects) reserved.add(object.id.toLowerCase())
  reserved.add(manifest.archiveId.toLowerCase())
  const targets = new Set<string>(), mapping = new Map<string, string>()
  const ids: RestoreId[] = []
  if (replay !== undefined) {
    if (!replay || typeof replay !== 'object' || Array.isArray(replay)) throw new BackupError('format')
    if (Object.keys(replay).sort().join() !== 'archiveId,fingerprint,ids,version' || replay.version !== 1 ||
      replay.archiveId !== manifest.archiveId || replay.fingerprint !== fingerprint || !Array.isArray(replay.ids) || replay.ids.length !== identities.size) throw new BackupError('different')
    for (const entry of replay.ids) {
      if (!entry || typeof entry !== 'object' || Object.keys(entry).sort().join() !== (entry.parent === undefined ? 'kind,source,target' : 'kind,parent,source,target') ||
        typeof entry.source !== 'string' || (entry.parent !== undefined && typeof entry.parent !== 'string')) throw new BackupError('format')
      const key = entityKey(entry.kind, entry.source, entry.parent)
      if (!identities.has(key) || mapping.has(key)) throw new BackupError('format')
      mapping.set(key, entry.target)
    }
  }
  for (const [key, identity] of identities) {
    assertCurrent()
    const target = replay !== undefined ? mapping.get(key)! : idFactory()
    if (!isGeneratedImageId(target) || reserved.has(target) || targets.has(target)) throw new BackupError('format')
    targets.add(target); mapping.set(key, target); ids.push({ ...identity, target })
  }
  const mapped = (kind: Entity, source: string, parent?: string): string => {
    const value = mapping.get(entityKey(kind, source, parent))
    if (!value) throw new BackupError('missing')
    return value
  }
  for (const f of snapshot.files) f.id = mapped('file', f.id)
  for (const p of snapshot.projects) {
    const source = p.id
    p.id = mapped('project', source)
    for (const d of p.documents) d.id = mapped('document', d.id, source)
  }
  for (const c of snapshot.conversations) {
    const source = c.id
    c.id = mapped('conversation', source)
    if (c.projectId !== undefined) c.projectId = mapped('project', c.projectId)
    for (const m of c.messages) {
      m.id = mapped('message', m.id, source)
      m.embeddedFiles = m.embeddedFiles.map(id => mapped('file', id))
      for (const f of m.files ?? []) {
        f.id = mapped('file', f.id)
        if (f.visionCrop) {
          f.visionCrop.sourceFileId = mapped('file', f.visionCrop.sourceFileId)
          f.visionCrop.sourceFileIds = f.visionCrop.sourceFileIds.map(id => mapped('file', id))
        }
      }
      if (m.projectTurn?.projectId !== undefined) m.projectTurn.projectId = mapped('project', m.projectTurn.projectId)
      for (const ref of m.projectTurn?.sources ?? []) {
        const parent = ref.projectId
        ref.projectId = mapped('project', parent)
        ref.documentId = mapped('document', ref.documentId, parent)
      }
    }
  }
  validateSnapshot(snapshot, manifest.version)
  const destinationFiles = new Map(snapshot.files.map(f => [f.id, f]))
  const conversations = snapshot.conversations.map(c => ({ conversation: { ...c,
    messages: c.messages.map(({ embeddedFiles, files, ...m }) => ({ ...m, restoredArchive: true as const,
      ...(embeddedFiles.length ? { generatedImages: embeddedFiles } : {}),
      ...(files === undefined ? {} : { files: files.map(ref => {
        const { objectId: _object, recordedSize: _recorded, ...global } = destinationFiles.get(ref.id)!
        return { ...(ref.presentation ?? global), id: ref.id, ...(ref.visionCrop ? { visionCrop: ref.visionCrop } : {}) }
      }) }),
    })),
  } }))
  const serialized = JSON.stringify(conversations.map(c => c.conversation))
  // Also bound the expanded UUIDs/presentation/marker destination representation.
  cloneBoundedBackupJSON(conversations)
  const record = cloneBoundedBackupJSON({ version: 1 as const, archiveId: manifest.archiveId, fingerprint, ids })
  let plan: RestorePlan | undefined = freezeData({
    publication: 'not-authorized' as const, messagePolicy: 'historical-inert' as const,
    mapping: record,
    conversations, projects: snapshot.projects.map(project => ({ project })),
    files: snapshot.files.map(file => ({ file, recordedSize: file.recordedSize ?? file.size })),
    diagnostics: { ...opened.diagnostics },
    resources: {
      conversations: conversations.length, messages: conversations.reduce((n, c) => n + c.conversation.messages.length, 0),
      files: snapshot.files.length, projects: snapshot.projects.length,
      documents: snapshot.projects.reduce((n, p) => n + p.documents.length, 0),
      objectBytes: snapshot.objects.reduce((n, o) => n + o.bytes, 0),
      sourceBytes: snapshot.objects.filter(o => o.kind === 'project-source').reduce((n, o) => n + o.bytes, 0),
      base64Chars: snapshot.objects.reduce((n, o) => n + Math.ceil(o.bytes / 3) * 4, 0),
      conversationJsonUtf8Bytes: utf8.encode(serialized).length, conversationJsonCodeUnits: serialized.length,
    },
  })
  assertCurrent()
  return Object.freeze({ get plan() { assertCurrent(); return plan! },
    object(id: string) { assertCurrent(); return opened!.object(id) }, assertCurrent,
    dispose() { disposed = true; plan = undefined; opened = undefined },
  })
}
