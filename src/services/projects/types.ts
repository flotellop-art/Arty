export const PROJECT_LIMITS = {
  projects: 20,
  documentsPerProject: 16,
  documentsPerOwner: 64,
  ownerSourceBytes: 50 * 1024 * 1024,
  sourceBytes: 10 * 1024 * 1024,
  documentTextChars: 200_000,
  projectTextChars: 500_000,
  contextChars: 20_000,
  contextChunks: 20,
  queryChars: 2000,
  instructionsChars: 4000,
  nameChars: 120,
  localTombstones: 100,
} as const

export type ProjectFormat = 'txt' | 'md' | 'csv' | 'docx' | 'xlsx'
export const PROJECT_EXTRACTOR_VERSION = 'arty-project-text-v1' as const
export interface ProjectDocument {
  id: string
  name: string
  originalName: string
  format: ProjectFormat
  revision: 1 // immutable document; replacement is a new ID, not an overwrite
  sourceHash: string
  sourceBytes: number
  textChars: number
  extractorVersion: typeof PROJECT_EXTRACTOR_VERSION
  createdAt: number
}
export interface Project {
  schema: 1
  owner: string
  id: string
  revision: number
  name: string
  instructions: string
  /** Fixed at creation; association inherits this restriction monotonically. */
  euOnly: boolean
  documents: ProjectDocument[]
  createdAt: number
  updatedAt: number
}
export interface ProjectSummary {
  id: string
  revision: number
  euOnly: boolean
  status: 'ready' | 'locked' | 'deleted'
  project?: Project
}
export type ProjectErrorCode = 'unavailable' | 'locked' | 'conflict' | 'limit' | 'unsupported' | 'corrupt' | 'deleted' | 'cancelled'
export class ProjectError extends Error {
  constructor(public readonly code: ProjectErrorCode) { super(`project_${code}`); this.name = 'ProjectError' }
}
export interface PreparedProjectDocument {
  descriptor: ProjectDocument
  base64: string
  text: string
}
export interface ProjectSourceReference {
  projectId: string
  projectRevision: number
  documentId: string
  documentRevision: number
  sourceHash: string
  extractorVersion: typeof PROJECT_EXTRACTOR_VERSION
  name: string
  format: ProjectFormat
  /** Lines in this version of the extracted text, never invented Word pages. */
  startLine: number
  endLine: number
  partial: boolean
}

export function validProjectId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}
export function boundedInteger(value: unknown, max = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max
}
export function validDescriptor(value: unknown): value is ProjectDocument {
  if (!value || typeof value !== 'object') return false
  const d = value as ProjectDocument
  return validProjectId(d.id) && typeof d.name === 'string' && d.name.length > 0 && d.name.length <= PROJECT_LIMITS.nameChars &&
    typeof d.originalName === 'string' && d.originalName.length > 0 && d.originalName.length <= 255 &&
    ['txt', 'md', 'csv', 'docx', 'xlsx'].includes(d.format) && d.revision === 1 &&
    typeof d.sourceHash === 'string' && /^[0-9a-f]{64}$/.test(d.sourceHash) &&
    boundedInteger(d.sourceBytes, PROJECT_LIMITS.sourceBytes) && d.sourceBytes > 0 &&
    boundedInteger(d.textChars, PROJECT_LIMITS.documentTextChars) &&
    d.extractorVersion === PROJECT_EXTRACTOR_VERSION && boundedInteger(d.createdAt)
}
export function validProject(value: unknown): value is Project {
  if (!value || typeof value !== 'object') return false
  const p = value as Project
  return p.schema === 1 && typeof p.owner === 'string' && p.owner.length > 0 && p.owner.length <= 128 &&
    validProjectId(p.id) && boundedInteger(p.revision) && p.revision > 0 &&
    typeof p.name === 'string' && p.name.length > 0 && p.name.length <= PROJECT_LIMITS.nameChars &&
    typeof p.instructions === 'string' && p.instructions.length <= PROJECT_LIMITS.instructionsChars &&
    typeof p.euOnly === 'boolean' && Array.isArray(p.documents) && p.documents.length <= PROJECT_LIMITS.documentsPerProject &&
    p.documents.every(validDescriptor) && new Set(p.documents.map(d => d.id)).size === p.documents.length &&
    p.documents.reduce((sum, d) => sum + d.textChars, 0) <= PROJECT_LIMITS.projectTextChars &&
    boundedInteger(p.createdAt) && boundedInteger(p.updatedAt)
}
