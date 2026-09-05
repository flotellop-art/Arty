import { PROJECT_LIMITS, validDescriptor, validProjectId, type ProjectSourceReference } from '../projects/types'
import type { ProjectTurn } from '../projects/chatPolicy'
import { BACKUP_FEATURES, BACKUP_LIMITS as L, BackupError, type BackupSnapshot, type BackupManifest, type BackupDiagnostics, type BackupSchemaVersion } from './types'
import { utf8 } from './bytes'

function fail(): never { throw new BackupError('format') }
function limit(): never { throw new BackupError('limit') }
const owns = (value: object, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key)
function object(value: unknown, required: string[], optional: string[] = []): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail()
  const allowed = new Set([...required, ...optional])
  if (required.some(key => !owns(value, key)) || Object.keys(value).some(key => !allowed.has(key))) fail()
}
function array(value: unknown, max: number): asserts value is unknown[] {
  if (!Array.isArray(value)) fail()
  if (value.length > max) limit()
}
function text(value: unknown, max: number, nonempty = false): asserts value is string {
  if (typeof value !== 'string' || (nonempty && !value.length)) fail()
  if (value.length > max) limit()
  // UTF-8 replaces lone surrogates. Refuse rather than silently change content.
  for (let i = 0; i < value.length; i++) {
    const unit = value.charCodeAt(i)
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(++i)
      if (!(next >= 0xdc00 && next <= 0xdfff)) fail()
    } else if (unit >= 0xdc00 && unit <= 0xdfff) fail()
  }
}
function integer(value: unknown, max = Number.MAX_SAFE_INTEGER, min = 0): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min) fail()
  if (value > max) limit()
}
function bool(value: unknown): asserts value is boolean { if (typeof value !== 'boolean') fail() }
function id(value: unknown): asserts value is string { text(value, 128, true); if (!/^[A-Za-z0-9._~-]+$/.test(value)) fail() }
function uuid(value: unknown): asserts value is string { if (!validProjectId(value)) fail() }
function enumeration<T extends string>(value: unknown, options: readonly T[]): asserts value is T { if (typeof value !== 'string' || !options.includes(value as T)) fail() }
function optionalBoolean(value: Record<string, unknown>, keys: string[]) { for (const key of keys) if (owns(value, key)) bool(value[key]) }
function stringArray(value: unknown, max: number, chars: number) { array(value, max); for (const item of value) text(item, chars) }

/** Before nested validation or JSON.stringify. No recursion, accessors, sparse
 * arrays, cycles, hidden properties, enormous depth or repeated object aliases. */
function boundedJSONTree(root: unknown): void {
  const stack = [{ value: root, depth: 0 }], seen = new Set<object>()
  let nodes = 0, chars = 0
  while (stack.length) {
    const { value, depth } = stack.pop()!
    if (++nodes > L.jsonNodes || depth > L.jsonDepth) limit()
    if (typeof value === 'string') { chars += value.length; if (chars > L.manifestBytes) limit(); continue }
    if (value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) continue
    if (!value || typeof value !== 'object' || seen.has(value)) fail()
    seen.add(value)
    if (Array.isArray(value)) {
      if (value.length > L.messages) limit()
      if (Object.getPrototypeOf(value) !== Array.prototype || Object.getOwnPropertyNames(value).length !== value.length + 1 || Object.getOwnPropertySymbols(value).length) fail()
      for (let i = value.length - 1; i >= 0; i--) {
        const descriptor = Object.getOwnPropertyDescriptor(value, i)
        if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) fail()
        stack.push({ value: descriptor.value, depth: depth + 1 })
      }
    } else {
      if (Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length) fail()
      const keys = Object.getOwnPropertyNames(value)
      if (keys.length > 64) limit()
      for (const key of keys) {
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') fail()
        const descriptor = Object.getOwnPropertyDescriptor(value, key)!
        if (!descriptor.enumerable || !('value' in descriptor)) fail()
        stack.push({ value: descriptor.value, depth: depth + 1 })
      }
    }
  }
}

/** A bounded data copy, not graph validation or publication authority. */
export function cloneBoundedBackupJSON<T>(value: T): T {
  boundedJSONTree(value)
  const json = JSON.stringify(value)
  if (utf8.encode(json).length > L.manifestBytes) limit()
  return JSON.parse(json) as T
}

function source(value: unknown): asserts value is ProjectSourceReference {
  object(value, ['projectId', 'projectRevision', 'documentId', 'documentRevision', 'sourceHash', 'extractorVersion', 'name', 'format', 'startLine', 'endLine', 'partial'])
  uuid(value.projectId); uuid(value.documentId); integer(value.projectRevision, Number.MAX_SAFE_INTEGER, 1); integer(value.documentRevision, 1, 1)
  if (typeof value.sourceHash !== 'string' || !/^[0-9a-f]{64}$/.test(value.sourceHash) || value.extractorVersion !== 'arty-project-text-v1') fail()
  text(value.name, PROJECT_LIMITS.nameChars, true); enumeration(value.format, ['txt', 'md', 'csv', 'docx', 'xlsx'])
  integer(value.startLine, PROJECT_LIMITS.documentTextChars + 1, 1); integer(value.endLine, PROJECT_LIMITS.documentTextChars + 1, value.startLine); bool(value.partial)
}
function turn(value: unknown): asserts value is ProjectTurn {
  object(value, ['version', 'mode', 'euOnly', 'partial', 'sources'], ['projectId', 'projectRevision', 'projectName'])
  if (value.version !== 1) fail()
  enumeration(value.mode, ['search', 'overview', 'detached']); bool(value.euOnly); bool(value.partial)
  array(value.sources, PROJECT_LIMITS.contextChunks); value.sources.forEach(source)
  if (value.projectId !== undefined) {
    uuid(value.projectId); integer(value.projectRevision, Number.MAX_SAFE_INTEGER, 1); text(value.projectName, PROJECT_LIMITS.nameChars, true)
  } else if (value.projectRevision !== undefined || value.projectName !== undefined) fail()
}
function crop(value: unknown): void {
  object(value, ['kind', 'sourceFileId', 'sourceFileIds', 'rect'])
  if (value.kind !== 'auto') fail()
  id(value.sourceFileId); array(value.sourceFileIds, 64); value.sourceFileIds.forEach(id)
  if (!value.sourceFileIds.length || !value.sourceFileIds.includes(value.sourceFileId) || new Set(value.sourceFileIds).size !== value.sourceFileIds.length) fail()
  object(value.rect, ['x', 'y', 'width', 'height'])
  for (const [key, v] of Object.entries(value.rect)) if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1 || ((key === 'width' || key === 'height') && v === 0)) fail()
  const r = value.rect as { x: number; y: number; width: number; height: number }
  if (r.x + r.width > 1 + Number.EPSILON * 4 || r.y + r.height > 1 + Number.EPSILON * 4) fail()
}
function factCheck(value: unknown): void {
  object(value, ['overallConfidence', 'claims', 'modelLabel', 'checkedAt'], ['status', 'originalContent', 'appliedCorrections'])
  enumeration(value.overallConfidence, ['high', 'medium', 'low']); text(value.modelLabel, 2000); integer(value.checkedAt)
  if (value.status !== undefined) enumeration(value.status, ['pending', 'success-empty', 'success-with-claims', 'failed'])
  if (value.originalContent !== undefined) text(value.originalContent, L.contentChars)
  if (value.appliedCorrections !== undefined) integer(value.appliedCorrections, 1000)
  array(value.claims, 100)
  for (const claim of value.claims) {
    object(claim, ['claim', 'verdict', 'explanation'], ['originalText', 'correction', 'applied'])
    text(claim.claim, 10_000); text(claim.explanation, 20_000); enumeration(claim.verdict, ['verified', 'uncertain', 'wrong'])
    for (const key of ['originalText', 'correction']) if (claim[key] !== undefined) text(claim[key], L.contentChars)
    if (claim.applied !== undefined) bool(claim.applied)
  }
}
function uniqueIds(values: { id: string }[]): void { if (new Set(values.map(value => value.id)).size !== values.length) fail() }

/** Validates only; never reads application storage to resolve a foreign ID. */
export function validateSnapshot(value: unknown, version: BackupSchemaVersion = 1): asserts value is BackupSnapshot {
  if (version !== 1 && version !== 2) fail()
  boundedJSONTree(value)
  object(value, ['conversations', 'projects', 'files', 'objects'])
  array(value.objects, L.objects); array(value.files, L.files); array(value.projects, PROJECT_LIMITS.projects); array(value.conversations, L.conversations)
  let objectBytes = 0, sourceBytes = 0, documents = 0, messages = 0
  for (const item of value.objects) {
    object(item, ['id', 'kind', 'bytes', 'sha256']); uuid(item.id)
    enumeration(item.kind, ['file', 'project-source', 'project-text']); integer(item.bytes, L.objectBytes, 1)
    if (typeof item.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(item.sha256)) fail()
    objectBytes += item.bytes; if (objectBytes > L.plaintextBytes) limit()
  }
  for (const file of value.files) {
    object(file, ['id', 'name', 'type', 'size', 'objectId', ...(version === 2 ? ['recordedSize'] : [])], ['width', 'height', 'normalizationVersion'])
    id(file.id); uuid(file.objectId); text(file.name, 255, true); text(file.type, 160, version === 1)
    if (!(version === 2 && file.type === '') && !/^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/.test(file.type)) fail()
    if (version === 2) integer(file.recordedSize)
    integer(file.size, L.objectBytes, 1)
    for (const key of ['width', 'height']) if (file[key] !== undefined) integer(file[key], 100_000, 1)
    if (file.normalizationVersion !== undefined) {
      // Preserve historical v1 and current v2 metadata, never recompress.
      integer(file.normalizationVersion, 2, 1); integer(file.width, 4096, 1); integer(file.height, 4096, 1)
      enumeration(file.type, ['image/jpeg', 'image/png'])
    }
  }
  for (const p of value.projects) {
    object(p, ['schema', 'id', 'revision', 'name', 'instructions', 'euOnly', 'documents', 'createdAt', 'updatedAt'])
    if (p.schema !== 1) fail()
    uuid(p.id); integer(p.revision, Number.MAX_SAFE_INTEGER, 1); text(p.name, PROJECT_LIMITS.nameChars, true); text(p.instructions, PROJECT_LIMITS.instructionsChars)
    bool(p.euOnly); integer(p.createdAt); integer(p.updatedAt); array(p.documents, PROJECT_LIMITS.documentsPerProject)
    let projectChars = 0
    for (const d of p.documents) {
      object(d, ['id', 'name', 'originalName', 'format', 'revision', 'sourceHash', 'sourceBytes', 'textChars', 'extractorVersion', 'createdAt', 'sourceObjectId', 'textObjectId'])
      if (!validDescriptor(d)) fail()
      uuid(d.sourceObjectId); uuid(d.textObjectId); text(d.name, PROJECT_LIMITS.nameChars, true); text(d.originalName, 255, true)
      sourceBytes += d.sourceBytes; projectChars += d.textChars
      if (++documents > PROJECT_LIMITS.documentsPerOwner || sourceBytes > PROJECT_LIMITS.ownerSourceBytes || projectChars > PROJECT_LIMITS.projectTextChars) limit()
    }
    uniqueIds(p.documents as { id: string }[])
  }
  for (const c of value.conversations) {
    object(c, ['id', 'title', 'messages', 'createdAt', 'updatedAt'], ['usedModels', 'euOnly', 'hasGoogleData', 'hasTrailContext', 'projectId', 'hasProjectContext', 'tags'])
    id(c.id); text(c.title, 500); integer(c.createdAt); integer(c.updatedAt)
    optionalBoolean(c, ['euOnly', 'hasGoogleData', 'hasTrailContext', 'hasProjectContext'])
    if (c.projectId !== undefined) uuid(c.projectId)
    if (c.tags !== undefined) stringArray(c.tags, 100, 200)
    if (c.usedModels !== undefined) stringArray(c.usedModels, 100, 200)
    array(c.messages, L.messages)
    for (const m of c.messages) {
      if (++messages > L.messages) limit()
      object(m, ['id', 'role', 'content', 'timestamp', 'embeddedFiles'], ['files', 'pinned', 'interrupted', 'model', 'requestedModel', 'modelSource', 'reasonCode', 'subModelReasonCode', 'projectTurn', 'quickAction', 'factCheck'])
      id(m.id); if (m.id === 'streaming') fail()
      enumeration(m.role, ['user', 'assistant']); text(m.content, L.contentChars); integer(m.timestamp)
      optionalBoolean(m, ['pinned', 'interrupted'])
      array(m.embeddedFiles, L.files); m.embeddedFiles.forEach(id)
      if (new Set(m.embeddedFiles).size !== m.embeddedFiles.length) fail()
      for (const key of ['model', 'requestedModel', 'reasonCode', 'subModelReasonCode']) if (m[key] !== undefined) text(m[key], 200, true)
      if (m.modelSource !== undefined) enumeration(m.modelSource, ['requested', 'proxy', 'provider'])
      if (m.projectTurn !== undefined) turn(m.projectTurn)
      if (m.factCheck !== undefined) factCheck(m.factCheck)
      if (m.quickAction !== undefined) {
        object(m.quickAction, ['id', 'locale'])
        enumeration(m.quickAction.id, ['brief', 'writeEmail', 'summarizeText', 'translateToEn', 'summarize', 'write', 'translate', 'explain'])
        enumeration(m.quickAction.locale, ['fr', 'en'])
      }
      if (m.files !== undefined) {
        array(m.files, 64)
        for (const file of m.files) {
          object(file, version === 2 ? ['id', 'presentation'] : ['id'], ['visionCrop'])
          id(file.id); if (file.visionCrop !== undefined) crop(file.visionCrop)
          if (version === 2) {
            const p = file.presentation
            object(p, ['name', 'type'], ['size', 'width', 'height', 'normalizationVersion'])
            text(p.name, 255); text(p.type, 160)
            // Historical hints can be absent, zero, or larger than the stored
            // optimized asset. Never use them for allocation or MIME routing.
            for (const key of ['size', 'width', 'height', 'normalizationVersion']) if (owns(p, key)) integer(p[key])
          }
        }
        uniqueIds(m.files as { id: string }[])
      }
    }
    uniqueIds(c.messages as { id: string }[])
  }
  const snapshot = value as unknown as BackupSnapshot
  for (const values of [snapshot.conversations, snapshot.projects, snapshot.files, snapshot.objects]) uniqueIds(values)
  validateGraph(snapshot)
}

/** Metadata checks only unless verified text-line counts are supplied. A2 must
 * separately attest that embeddedFiles matches actual rendered dependencies. */
export function validateGraph(snapshot: BackupSnapshot, textLines?: ReadonlyMap<string, number>): BackupDiagnostics {
  const files = new Map(snapshot.files.map(f => [f.id, f])), projects = new Map(snapshot.projects.map(p => [p.id, p]))
  const objects = new Map(snapshot.objects.map(o => [o.id, o])), usedObjects = new Set<string>()
  const diagnostics: BackupDiagnostics = { unavailableAssociatedProjects: 0, unavailableHistoricalSources: 0, unavailableCropSources: 0 }
  function useObject(id: string, kind: string, bytes?: number, hash?: string) {
    const obj = objects.get(id)
    if (!obj) throw new BackupError('missing')
    if (usedObjects.has(id) || obj.kind !== kind || (bytes !== undefined && obj.bytes !== bytes) || (hash !== undefined && obj.sha256 !== hash)) fail()
    usedObjects.add(id)
  }
  for (const file of snapshot.files) useObject(file.objectId, 'file', file.size)
  for (const project of snapshot.projects) for (const doc of project.documents) {
    useObject(doc.sourceObjectId, 'project-source', doc.sourceBytes, doc.sourceHash)
    useObject(doc.textObjectId, 'project-text')
    // UTF-8 length is verified exactly after decryption, but an impossible
    // ratio is rejected here before any object allocation.
    if (!doc.textChars || objects.get(doc.textObjectId)!.bytes > doc.textChars * 3) fail()
  }
  if (usedObjects.size !== objects.size) fail() // no hidden/orphan payloads
  for (const conv of snapshot.conversations) {
    const project = conv.projectId ? projects.get(conv.projectId) : undefined
    if (conv.projectId && !project) diagnostics.unavailableAssociatedProjects++
    const documentary = !!conv.projectId || conv.messages.some(m => !!m.projectTurn)
    const eu = project?.euOnly || conv.messages.some(m => m.projectTurn && (m.projectTurn.euOnly ||
      (m.projectTurn.projectId && projects.get(m.projectTurn.projectId)?.euOnly) ||
      m.projectTurn.sources.some(ref => projects.get(ref.projectId)?.euOnly)))
    if ((documentary && conv.hasProjectContext !== true) || (eu && conv.euOnly !== true)) fail()
    const previousFiles = new Set<string>()
    for (const msg of conv.messages) {
      for (const id of msg.embeddedFiles) if (!files.has(id)) throw new BackupError('missing')
      for (const file of msg.files ?? []) {
        if (!files.has(file.id)) throw new BackupError('missing')
        if (file.visionCrop) {
          if (file.visionCrop.sourceFileIds.includes(file.id)) fail()
          for (const id of file.visionCrop.sourceFileIds) if (files.get(id)?.normalizationVersion !== 2 || !previousFiles.has(id)) diagnostics.unavailableCropSources++
        }
      }
      for (const file of msg.files ?? []) previousFiles.add(file.id)
      for (const ref of msg.projectTurn?.sources ?? []) {
        const p = projects.get(ref.projectId), d = p?.documents.find(doc => doc.id === ref.documentId)
        if (!d || d.revision !== ref.documentRevision || d.sourceHash !== ref.sourceHash || d.extractorVersion !== ref.extractorVersion ||
          ref.endLine > (textLines?.get(d.textObjectId) ?? d.textChars + 1)) diagnostics.unavailableHistoricalSources++
      }
    }
  }
  return diagnostics
}

export function parseManifest(json: string): BackupManifest {
  if (json.length > L.manifestBytes || utf8.encode(json).length > L.manifestBytes) limit()
  preflightJSON(json)
  let raw: unknown
  try { raw = JSON.parse(json) } catch { throw new BackupError('format') }
  boundedJSONTree(raw)
  object(raw, ['format', 'version', 'minReader', 'features', 'archiveId', 'createdAt', 'conversations', 'projects', 'files', 'objects'])
  if (raw.format !== 'arty-workspace' || (raw.version !== 1 && raw.version !== 2) || raw.minReader !== raw.version || JSON.stringify(raw.features) !== JSON.stringify(BACKUP_FEATURES)) fail()
  uuid(raw.archiveId); integer(raw.createdAt)
  validateSnapshot({ conversations: raw.conversations, projects: raw.projects, files: raw.files, objects: raw.objects }, raw.version)
  return raw as unknown as BackupManifest
}

/** Linear lexical budget BEFORE JSON.parse allocates a deep/wide tree. String
 * escapes keep brackets/commas in content inert. This is not a JSON parser:
 * syntax/keys/types are still checked by JSON.parse and the strict schema. */
function preflightJSON(json: string): void {
  let depth = -1, tokens = 0, quoted = false, escaped = false, primitive = false
  const token = () => { if (++tokens > L.jsonNodes) limit() }
  for (let i = 0; i < json.length; i++) {
    const c = json[i]!
    if (quoted) {
      if (escaped) escaped = false
      else if (c === '\\') escaped = true
      else if (c === '"') quoted = false
      continue
    }
    if (c === '"') { token(); quoted = true; primitive = false }
    else if (c === '[' || c === '{') { token(); if (++depth > L.jsonDepth) limit(); primitive = false }
    else if (c === ']' || c === '}') { if (--depth < -1) fail(); primitive = false }
    else if (c === ',' || c === ':' || c === ' ' || c === '\n' || c === '\r' || c === '\t') primitive = false
    else if (!primitive) { token(); primitive = true }
  }
}

/** Freeze the validated decoded graph before giving it to later preview/staging.
 * Blobs are immutable; no partially verified or caller-mutable manifest escapes. */
export function freezeManifest(manifest: BackupManifest): BackupManifest {
  const pending: object[] = [manifest]
  while (pending.length) {
    const obj = pending.pop()!
    for (const child of Object.values(obj)) if (child && typeof child === 'object') pending.push(child)
    Object.freeze(obj)
  }
  return manifest
}
