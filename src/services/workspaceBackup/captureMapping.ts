import type { Conversation } from '../../types'
import { isGeneratedImageId, MAX_GENERATED_IMAGES_PER_TURN } from '../generatedImages'
import { BACKUP_LIMITS as L, BackupError, type BackupConversation } from './types'

/** Fixed allowlisted tree, not JSON serialization of live objects. Unknown
 * executable/settings fields are excluded. Accessors are never invoked. */
export function mapCapturedConversation(source: Conversation): BackupConversation {
  let chars = 0, nodes = 0
  const fail = (): never => { throw new BackupError('format') }
  const primitive = (value: unknown): unknown => {
    if (++nodes > L.jsonNodes) throw new BackupError('limit')
    if (typeof value === 'string') { chars += value.length; if (chars > L.manifestBytes) throw new BackupError('limit'); return value }
    if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return value
    return fail()
  }
  const field = (value: object, key: string, required: boolean): unknown => {
    const d = Object.getOwnPropertyDescriptor(value, key)
    if (!d) { if (required) fail(); return undefined }
    if (!d.enumerable || !('value' in d)) fail()
    if (required && d.value === undefined) fail()
    return d.value
  }
  type Mapper = (value: unknown) => unknown
  const shape = (value: unknown, required: string[], optional: string[] = [], children: Record<string, Mapper> = {}) => {
    if (++nodes > L.jsonNodes) throw new BackupError('limit')
    if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return fail()
    const output: Record<string, unknown> = {}
    for (const key of [...required, ...optional]) {
      const v = field(value, key, required.includes(key))
      if (v !== undefined) output[key] = children[key] ? children[key]!(v) : primitive(v)
    }
    return output
  }
  const list = (max: number, map: Mapper = primitive): Mapper => value => {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return fail()
    if (value.length > max) throw new BackupError('limit')
    if (Object.getOwnPropertyNames(value).length !== value.length + 1 || Object.getOwnPropertySymbols(value).length) return fail()
    return Array.from({ length: value.length }, (_, i) => map(field(value, String(i), true)))
  }
  const crop: Mapper = v => shape(v, ['kind', 'sourceFileId', 'sourceFileIds', 'rect'], [], {
    sourceFileIds: list(64), rect: r => shape(r, ['x', 'y', 'width', 'height']),
  })
  const sourceRef: Mapper = v => shape(v, ['projectId', 'projectRevision', 'documentId', 'documentRevision', 'sourceHash', 'extractorVersion', 'name', 'format', 'startLine', 'endLine', 'partial'])
  const turn: Mapper = v => shape(v, ['version', 'mode', 'euOnly', 'partial', 'sources'], ['projectId', 'projectRevision', 'projectName'], { sources: list(100, sourceRef) })
  const fact: Mapper = v => shape(v, ['overallConfidence', 'claims', 'modelLabel', 'checkedAt'], ['status', 'originalContent', 'appliedCorrections'], {
    claims: list(100, c => shape(c, ['claim', 'verdict', 'explanation'], ['originalText', 'correction', 'applied'])),
  })
  const file: Mapper = v => {
    const ref = shape(v, ['id'], ['visionCrop'], { visionCrop: crop })
    ref.presentation = shape(v, ['name', 'type'], ['size', 'width', 'height', 'normalizationVersion'])
    return ref
  }
  const message: Mapper = v => {
    const m = shape(v, ['id', 'role', 'content', 'timestamp'], ['files', 'pinned', 'interrupted', 'model', 'requestedModel', 'modelSource', 'reasonCode', 'subModelReasonCode', 'projectTurn', 'quickAction', 'factCheck'], {
      files: list(64, file), projectTurn: turn, factCheck: fact, quickAction: q => shape(q, ['id', 'locale']),
    })
    const gallery = field(v as object, 'generatedImages', false)
    // A present undefined/malformed field cannot silently become no images.
    if (Object.prototype.hasOwnProperty.call(v, 'generatedImages')) {
      if (m.role !== 'assistant') fail()
      const copied = list(MAX_GENERATED_IMAGES_PER_TURN)(gallery) as unknown[]
      if (!copied.every(isGeneratedImageId) || new Set(copied).size !== copied.length) fail()
      m.embeddedFiles = copied
    } else m.embeddedFiles = []
    return m
  }
  return shape(source, ['id', 'title', 'messages', 'createdAt', 'updatedAt'], ['usedModels', 'euOnly', 'hasGoogleData', 'hasTrailContext', 'projectId', 'hasProjectContext', 'outputRestriction', 'tags'], {
    messages: list(L.messages, message), usedModels: list(100), tags: list(100),
  }) as unknown as BackupConversation
}
