import type { Conversation, FileAttachment, Message } from '../../types'
import type { Project, ProjectDocument } from '../projects/types'

export const BACKUP_LIMITS = {
  manifestBytes: 4 * 1024 * 1024,
  objectBytes: 10 * 1024 * 1024,
  plaintextBytes: 60 * 1024 * 1024,
  archiveBytes: 64 * 1024 * 1024,
  chunkBytes: 256 * 1024,
  objects: 256,
  frames: 512,
  files: 128,
  conversations: 2000,
  messages: 20_000,
  contentChars: 2_000_000,
  jsonDepth: 24,
  jsonNodes: 100_000,
} as const

/** Format v1 deliberately excludes credentials, settings, memory, reports and
 * executable state. Content is data, NOT permission to rehydrate HTML actions. */
export const BACKUP_FEATURES = ['additive-restore', 'inert-restore', 'eu-monotone'] as const
export type BackupObjectKind = 'file' | 'project-source' | 'project-text'
export interface BackupObject { id: string; kind: BackupObjectKind; bytes: number; sha256: string }
export interface BackupFile extends Omit<FileAttachment, 'data' | 'visionCrop' | 'size'> {
  size: number
  objectId: string
  /** Required in v2 only. The legacy record may have counted base64 characters. */
  recordedSize?: number
}
/** v3 adds a closed, monotone conversation output restriction; v2 files unchanged. */
export type BackupSchemaVersion = 1 | 2 | 3
/** Historical display metadata, NEVER authority over object decoding or limits. */
export type BackupFilePresentation = Pick<FileAttachment, 'name' | 'type' | 'size' | 'width' | 'height' | 'normalizationVersion'>
export interface BackupFileReference {
  id: string
  visionCrop?: FileAttachment['visionCrop']
  /** Required in manifest v2; forbidden in v1. Preserves per-message variants. */
  presentation?: BackupFilePresentation
}
export interface BackupMessage extends Pick<Message, 'id' | 'role' | 'content' | 'timestamp' | 'pinned' | 'interrupted' |
  'model' | 'requestedModel' | 'modelSource' | 'reasonCode' | 'subModelReasonCode' | 'projectTurn' | 'quickAction' | 'factCheck'> {
  files?: BackupFileReference[]
  /** Declared render dependencies, NOT every URI mentioned as text/code. A2
   * capture must collect actual images; restore must resolve ONLY this remapped
   * allowlist, never an arbitrary source ID through the destination's getFile. */
  embeddedFiles: string[]
}
export interface BackupConversation extends Omit<Conversation, 'messages'> { messages: BackupMessage[] }
export interface BackupDocument extends ProjectDocument { sourceObjectId: string; textObjectId: string }
export interface BackupProject extends Omit<Project, 'owner' | 'documents'> { documents: BackupDocument[] }
export interface BackupSnapshot {
  conversations: BackupConversation[]
  projects: BackupProject[]
  files: BackupFile[]
  objects: BackupObject[]
}
export interface BackupManifest extends BackupSnapshot {
  format: 'arty-workspace'
  version: BackupSchemaVersion
  minReader: BackupSchemaVersion
  features: typeof BACKUP_FEATURES
  archiveId: string
  createdAt: number
}
export interface BackupDiagnostics {
  unavailableAssociatedProjects: number
  unavailableHistoricalSources: number
  unavailableCropSources: number
}
export class BackupError extends Error {
  constructor(public readonly code: 'format' | 'limit' | 'integrity' | 'secret' | 'cancelled' | 'missing' | 'busy' | 'unreadable' | 'unavailable' | 'changed' | 'different') {
    super(`backup_${code}`); this.name = 'BackupError'
  }
}
export interface BackupGuard { assertCurrent(): void; signal?: AbortSignal }
export function checkBackupGuard(guard: BackupGuard): void {
  if (guard.signal?.aborted) throw new BackupError('cancelled')
  guard.assertCurrent()
}
