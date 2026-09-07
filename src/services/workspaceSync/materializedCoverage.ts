import { decrypt, isCryptoContextChanged } from '../crypto'
import { decodeProjectSnapshot, decodeDocumentSnapshot, type ProjectRow, type DocumentRow } from '../projects/snapshotDecoding'
import { ProjectError, boundedInteger, type Project } from '../projects/types'
import { BackupError } from '../workspaceBackup/types'
import { sha256 } from '../workspaceBackup/bytes'
import { createSyncReadMapping } from './captureMapping'
import { captureMaterializedRows } from './materializedRows'
import { decodeSyncSourceBase64, encodeSyncContent } from './captureContent'
import { decodeSyncContent } from './content'
import { projectLocalSyncConversation } from './localProvenance'
import { parseSyncManifest, recordHeads } from './schema'
import { envelopeFail as fail, envelopeFields as fields, SyncEnvelopeError, SYNC_ENVELOPE_LIMITS } from './envelopeFormat'
import type { SyncLocalBinding } from './privateState'
import type { SyncDispatchGuard } from './clientTransport'
import type { SyncRecord } from './types'

type Status = 'equal' | 'different' | 'missing' | 'unreadable' | 'not-inspected'
const descriptorKeys = ['id', 'name', 'originalName', 'format', 'revision', 'sourceHash', 'sourceBytes', 'textChars', 'extractorVersion', 'createdAt']

/** Internal B-versus-M inspection, owned by the receipt actor, never supplied
 * from a UI DTO. M and bindings are its PRIVATE materialized branch, NOT T/R
 * and NOT selection. A report cannot grant write authority. Remote R closure,
 * conflicts and BEFORE/CAS publication must be checked separately. */
export async function attestMaterializedTargets(args: {
  materialized: unknown; bindings: SyncLocalBinding[]; targetIds: readonly string[]; authority: SyncDispatchGuard
}) {
  // Validate the complete identity graph even when only one target is requested.
  const head = parseSyncManifest(args.materialized), mapping = createSyncReadMapping(head, args.bindings)
  const records = new Map(head.records.map(r => [r.id, r])), bindings = new Map(structuredClone(args.bindings).map(b => [b.logicalId, b]))
  if (!Array.isArray(args.targetIds) || args.targetIds.length > SYNC_ENVELOPE_LIMITS.payloads) return fail('limit')
  if (Object.getPrototypeOf(args.targetIds) !== Array.prototype || Object.getOwnPropertySymbols(args.targetIds).length ||
    Object.getOwnPropertyNames(args.targetIds).length !== args.targetIds.length + 1) return fail('format')
  const queue = Array.from({ length: args.targetIds.length }, (_, i) => {
    const d = Object.getOwnPropertyDescriptor(args.targetIds, String(i))
    if (!d?.enumerable || !('value' in d) || typeof d.value !== 'string') return fail('format')
    return d.value as string
  }), requested = new Set(queue)
  if (requested.size !== queue.length || queue.some(id => typeof id !== 'string' || !records.has(id))) return fail('format')
  for (const record of head.records) if (recordHeads(record).length !== 1) return fail('base')
  const rows = await captureMaterializedRows(args.authority)
  let disposed = false, bytes = 0
  const statuses = new Map<string, Status>(), missingDependencies = new Set<string>(), projects = new Map<string, Project | null>()
  const dispose = () => { if (disposed) return; disposed = true; rows.dispose(); statuses.clear(); missingDependencies.clear(); projects.clear(); bindings.clear(); records.clear(); queue.length = 0 }
  rows.signal.addEventListener('abort', dispose, { once: true })
  const assertCurrent = () => { if (disposed) return fail('cancelled'); rows.assertCurrent() }
  const terminal = (error: unknown): void => {
    // Row admission/budget failures already retired the source. Preserve that
    // actionable error instead of replacing it with a generic cancellation.
    if (disposed || rows.signal.aborted) throw error
    assertCurrent()
    if (isCryptoContextChanged(error) || error instanceof ProjectError && error.code === 'cancelled' ||
      error instanceof SyncEnvelopeError && ['cancelled', 'scope', 'limit'].includes(error.code) ||
      error instanceof BackupError && ['cancelled', 'changed', 'busy', 'limit', 'unavailable'].includes(error.code)) throw error
  }
  const dependency = (logicalId: string, kind: SyncRecord['kind']) => {
    const record = records.get(logicalId), binding = bindings.get(logicalId)
    if (!record || record.kind !== kind || binding?.presence !== 'record' || recordHeads(record)[0]!.value.state !== 'live') {
      missingDependencies.add(logicalId); return
    }
    if (!queue.includes(logicalId)) queue.push(logicalId)
  }
  const projectAt = async (id: string): Promise<Project | null> => {
    if (projects.has(id)) return projects.get(id)!
    const pinned = await rows.read('projects', [rows.owner, id]); assertCurrent()
    if (!pinned.present) { projects.set(id, null); return null }
    const raw = fields(pinned.value, ['key', 'owner', 'id', 'revision', 'state', 'euOnly', 'createdAt', 'updatedAt', 'cipher'])
    if (raw.id !== id) return fail('format')
    const project = await decodeProjectSnapshot(rows.owner, raw as ProjectRow, assertCurrent)
    fields(project, ['schema', 'owner', 'id', 'revision', 'name', 'instructions', 'euOnly', 'documents', 'createdAt', 'updatedAt'])
    for (const d of project.documents) fields(d, descriptorKeys)
    projects.set(id, project); return project
  }
  const compare = async (record: SyncRecord, data: unknown, binary?: Uint8Array) => {
    assertCurrent()
    const blob = encodeSyncContent(record.kind, data, binary)
    bytes += blob.size
    if (bytes > SYNC_ENVELOPE_LIMITS.plaintextBytes) return fail('limit')
    // In particular, a canonical-image marker must describe the actual bytes.
    await decodeSyncContent(blob, record, assertCurrent)
    const buffer = new Uint8Array(await blob.arrayBuffer()); assertCurrent()
    let hash: string
    try { hash = await sha256(buffer) } finally { buffer.fill(0) }
    assertCurrent()
    const expected = recordHeads(record)[0]!.value
    return expected.state === 'live' && expected.bytes === blob.size && expected.sha256 === hash ? 'equal' : 'different'
  }
  const inspect = async (record: SyncRecord): Promise<Status> => {
    const binding = bindings.get(record.id)!
    if (recordHeads(record)[0]!.value.state === 'deleted') return 'different' // no deletion inference
    try {
      if (record.kind === 'conversation') {
        const matches = rows.conversations(binding.localId)
        if (!matches.length) return 'missing'
        if (matches.length !== 1) return 'unreadable'
        const conversation = projectLocalSyncConversation(matches[0]!)
        const projected = mapping.conversation(conversation), status = await compare(record, projected)
        if (status === 'equal') for (const m of projected.conversation.messages) {
          for (const f of m.files ?? []) dependency(f.id, 'file')
          for (const id of m.generatedImages ?? []) dependency(id, 'file')
        }
        // comparison/projectTurn/visionCrop/raw URI prose are weak references.
        return status
      }
      if (record.kind === 'file') {
        const pinned = await rows.read('files', binding.localId); assertCurrent()
        if (!pinned.present) return 'missing'
        const raw = pinned.value as Record<string, unknown> | null
        const optional = ['width', 'height', 'normalizationVersion'].filter(k => raw && Object.prototype.hasOwnProperty.call(raw, k))
        const f = fields(raw, ['fileId', 'ownerKey', 'name', 'mimeType', 'size', 'encryptedData', 'createdAt', ...optional])
        if (f.fileId !== binding.localId || f.ownerKey !== `arty-${rows.owner}` || typeof f.encryptedData !== 'string' ||
          typeof f.name !== 'string' || typeof f.mimeType !== 'string' || !boundedInteger(f.size) || !Number.isSafeInteger(f.createdAt) ||
          optional.some(k => f[k] !== undefined && !boundedInteger(f[k]))) return 'unreadable'
        const encoded = await decrypt(f.encryptedData); assertCurrent()
        const binary = decodeSyncSourceBase64(encoded, true)
        try { return await compare(record, { id: record.id, name: f.name, type: f.mimeType, size: binary.length, recordedSize: f.size,
          createdAt: f.createdAt, width: f.width, height: f.height, normalizationVersion: f.normalizationVersion }, binary) }
        finally { binary.fill(0) }
      }
      if (record.kind === 'project') {
        const p = await projectAt(binding.localId)
        if (!p) return 'missing'
        const documents = p.documents.map(d => {
          const sourceId = mapping.lookup('project-source', d.id, p.id, true), textId = mapping.lookup('project-text', d.id, p.id, true)
          return { ...d, id: sourceId, sourceId, textId }
        })
        const status = await compare(record, { schema: 1, id: record.id, name: p.name, instructions: p.instructions, euOnly: p.euOnly,
          createdAt: p.createdAt, updatedAt: p.updatedAt, documents })
        if (status === 'equal') for (const d of documents) { dependency(d.sourceId, 'project-source'); dependency(d.textId, 'project-text') }
        return status
      }
      const kind = record.kind === 'project-source' ? 'source' : 'text', parent = binding.parentLocalId!
      // Probe the exact document address FIRST: a removed catalogue descriptor
      // must not disguise a still-present (possibly orphaned) physical row.
      const pinned = await rows.read('documents', [rows.owner, parent, binding.localId, kind]); assertCurrent()
      if (!pinned.present) return 'missing'
      const project = await projectAt(parent)
      if (!project) return 'unreadable'
      const descriptor = project.documents.find(d => d.id === binding.localId)
      if (!descriptor) return 'different'
      const raw = fields(pinned.value, ['key', 'owner', 'projectId', 'id', 'kind', 'state', 'sourceBytes', 'textChars', 'updatedAt', 'cipher'])
      const content = await decodeDocumentSnapshot(rows.owner, project, binding.localId, kind, raw as DocumentRow, assertCurrent)
      const projectId = mapping.lookup('project', parent, null, true), documentId = mapping.lookup('project-source', binding.localId, parent, true)
      // Both physical halves must be bound to the SAME document and parent.
      mapping.lookup('project-text', binding.localId, parent, true)
      if (kind === 'text') return await compare(record, { projectId, documentId, text: content })
      const binary = decodeSyncSourceBase64(content)
      try { return await compare(record, { projectId, document: { ...descriptor, id: documentId } }, binary) }
      finally { binary.fill(0) }
    } catch (error) {
      terminal(error)
      // A new message/document identity in a valid local B is a local edit,
      // not evidence that its containing conversation/project has vanished.
      if (error instanceof SyncEnvelopeError && ['missing', 'base'].includes(error.code)) return 'different'
      if (error instanceof ProjectError && error.code === 'deleted') return 'different'
      return 'unreadable'
    }
  }
  try {
    assertCurrent()
    for (let i = 0; i < queue.length; i++) {
      if (queue.length > SYNC_ENVELOPE_LIMITS.payloads) return fail('limit')
      const id = queue[i]!
      statuses.set(id, await inspect(records.get(id)!)); assertCurrent()
    }
    await rows.validateFresh(); assertCurrent()
    const report = Object.freeze({ requested: requested.size, inspected: statuses.size,
      equal: [...statuses.values()].filter(s => s === 'equal').length,
      different: [...statuses.values()].filter(s => s === 'different').length,
      missing: [...statuses.values()].filter(s => s === 'missing').length,
      unreadable: [...statuses.values()].filter(s => s === 'unreadable').length,
      notInspected: records.size - statuses.size, missingDependencies: missingDependencies.size,
      remoteClosureChecked: false as const, writeAuthorized: false as const })
    return Object.freeze({ report, dispose,
      assertCurrent,
      status(id: string): Status { assertCurrent(); if (!records.has(id)) return fail('missing'); return statuses.get(id) ?? 'not-inspected' },
      assertEqual() {
        assertCurrent()
        if (!requested.size || missingDependencies.size || [...statuses.values()].some(s => s !== 'equal')) return fail('base')
      },
      async validateFresh() { try { await rows.validateFresh(); assertCurrent() } catch (error) { dispose(); throw error } },
    })
  } catch (error) { dispose(); throw error }
}
