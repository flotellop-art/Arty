import { decrypt, isCryptoContextChanged } from '../crypto'
import { captureConversationForBackup, ensureDurableConversationIdentities } from '../storage'
import { hasActiveConversationWork } from '../conversationWork'
import { readOwnedFileSnapshot } from '../secureFileStorage'
import { captureLocalReadScope, withReadOnlyProjectLibrary } from '../projects/store'
import type { Project } from '../projects/types'
import { validGeneratedImage } from '../generatedImages'
import { BackupError } from '../workspaceBackup/types'
import { sha256 } from '../workspaceBackup/bytes'
import { copySyncCaptureSelection } from './captureProjection'
import { projectLocalSyncConversation, localSyncConversationWitness } from './localProvenance'
import { decodeSyncSourceBase64, encodeSyncContent } from './captureContent'
import { createSyncCaptureMapping } from './captureMapping'
import { assertSyncPrivateHead, assertSyncMappingExtension, parseSyncPrivateState, type SyncLocalBinding } from './privateState'
import { parseSyncManifest, recordHeads } from './schema'
import { stageSyncChange } from './causal'
import { envelopeFail as fail, envelopeFields, SYNC_ENVELOPE_LIMITS } from './envelopeFormat'
import type { SyncKind } from './types'

export interface SyncCaptureSelection { conversationIds: readonly string[]; projectIds: readonly string[] }
export interface SyncCaptureReport {
  historical: true; conversations: number; files: number; projects: number
  capturedObjects: number; capturedBytes: number; changedObjects: number; unresolvedReferences: number
}

/** Capture real stores, not caller-provided entities or crypto/account guards.
 * The result is an explicitly HISTORICAL snapshot, not an atomic transaction
 * across LS and two IDBs. Conversation tickets stay fresh until return; files
 * are from ONE earlier IDB snapshot (a replacement is found on the NEXT scan).
 * These immutable bytes remain usable after ordinary chat edits, but never after
 * owner/crypto/fence/document retirement. No deletions or conflict resolution. */
export async function captureLocalSyncSnapshot(headInput: unknown, bindingsInput: SyncLocalBinding[], selectionInput: SyncCaptureSelection, signal?: AbortSignal) {
  const scope = captureLocalReadScope(signal)
  const head = parseSyncManifest(headInput)
  const prior = parseSyncPrivateState({ format: 'arty-sync-private-state', version: 1, base: head, bindings: bindingsInput })
  assertSyncPrivateHead(prior, head)
  const selection = copySyncCaptureSelection(selectionInput)
  const assertAlive = () => scope.assertCurrent()
  assertAlive()
  if (hasActiveConversationWork()) throw new BackupError('busy')
  // Only this explicit legacy normalization may write a source. It precedes
  // every capture ticket and cannot silently succeed on a denied safety net.
  if (selection.conversationIds.length) await ensureDurableConversationIdentities(signal)
  assertAlive()
  const tickets = selection.conversationIds.map(id => captureConversationForBackup(id, projectLocalSyncConversation))
  const conversations = tickets.map(t => t.snapshot)
  const assertFresh = () => {
    assertAlive()
    if (hasActiveConversationWork()) throw new BackupError('busy')
    for (const ticket of tickets) { ticket.assertUnchanged(); ticket.assertSnapshot((a, b) => localSyncConversationWitness(a) === localSyncConversationWitness(b)) }
  }
  const validateFresh = async () => { assertFresh(); await scope.validateReadOnly(); assertFresh() }
  const mapping = createSyncCaptureMapping(prior.bindings)
  const captured = new Map<string, { kind: SyncKind; blob: Blob }>()
  let bytes = 0
  const add = (id: string, kind: SyncKind, data: unknown, binary?: Uint8Array) => {
    assertFresh()
    const blob = encodeSyncContent(kind, data, binary)
    bytes += blob.size
    if (captured.has(id)) return fail('format')
    if (bytes > SYNC_ENVELOPE_LIMITS.plaintextBytes || captured.size >= SYNC_ENVELOPE_LIMITS.payloads) return fail('limit')
    captured.set(id, { kind, blob })
  }
  const fileIds = [...new Set(conversations.flatMap(c => c.messages.flatMap(m => [...(m.files ?? []).map(f => f.id), ...(m.generatedImages ?? [])])))]
  const galleries = new Set(conversations.flatMap(c => c.messages.flatMap(m => m.generatedImages ?? [])))
  const captureFiles = async () => {
    const rows = await readOwnedFileSnapshot(fileIds, assertFresh, signal); assertFresh()
    for (const [id, row] of rows) {
      let encoded: string
      try { encoded = await decrypt(row.encryptedData) }
      catch (error) { assertFresh(); if (isCryptoContextChanged(error)) throw new BackupError('cancelled'); throw new BackupError('unreadable') }
      assertFresh()
      if (galleries.has(id) && !validGeneratedImage(encoded, row.mimeType)) return fail('format')
      if (typeof row.name !== 'string' || typeof row.mimeType !== 'string' || !Number.isSafeInteger(row.size) || row.size < 0 || !Number.isSafeInteger(row.createdAt)) return fail('format')
      for (const value of [row.width, row.height, row.normalizationVersion]) if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) return fail('format')
      const binary = decodeSyncSourceBase64(encoded, true)
      try {
        const logicalId = mapping.bind('file', id, null, true)
        add(logicalId, 'file', { id: logicalId, name: row.name, type: row.mimeType, size: binary.length, recordedSize: row.size,
          createdAt: row.createdAt, width: row.width, height: row.height, normalizationVersion: row.normalizationVersion }, binary)
      } finally { binary.fill(0) }
    }
  }
  await validateFresh()
  if (selection.projectIds.length) await withReadOnlyProjectLibrary({ ...scope, assertCurrent: assertFresh }, async reader => {
    // Pin ALL selected revisions before the single atomic file transaction.
    const projects: Project[] = []
    for (const id of selection.projectIds) {
      const summary = await reader.get(id); assertFresh()
      if (!summary || summary.status === 'deleted') throw new BackupError('missing')
      if (summary.status !== 'ready' || !summary.project) throw new BackupError('unreadable')
      envelopeFields(summary.project, ['schema', 'owner', 'id', 'revision', 'name', 'instructions', 'euOnly', 'documents', 'createdAt', 'updatedAt'])
      for (const doc of summary.project.documents) envelopeFields(doc,
        ['id', 'name', 'originalName', 'format', 'revision', 'sourceHash', 'sourceBytes', 'textChars', 'extractorVersion', 'createdAt'])
      projects.push(summary.project)
    }
    await captureFiles()
    for (const project of projects) {
      const projectId = mapping.bind('project', project.id, null, true), documents = []
      for (const doc of project.documents) {
        const documentId = mapping.bind('project-source', doc.id, project.id, true), textId = mapping.bind('project-text', doc.id, project.id, true)
        const descriptor = { ...doc, id: documentId }
        const binary = decodeSyncSourceBase64(await reader.source(project, doc.id)); assertFresh()
        try { add(documentId, 'project-source', { projectId, document: descriptor }, binary) } finally { binary.fill(0) }
        const text = await reader.text(project, doc.id); assertFresh()
        // JSON framing preserves even empty/BOM/CRLF/lone-surrogate UTF-16 text.
        add(textId, 'project-text', { projectId, documentId, text })
        documents.push({ ...descriptor, sourceId: documentId, textId })
      }
      // owner and top-level revision are device-local ownership/CAS, not shared
      // semantic data. Per-turn/document historical revisions remain untouched.
      add(projectId, 'project', { schema: 1, id: projectId, name: project.name, instructions: project.instructions, euOnly: project.euOnly,
        createdAt: project.createdAt, updatedAt: project.updatedAt, documents })
    }
    for (const project of projects) {
      const latest = await reader.get(project.id); assertFresh()
      if (latest?.status !== 'ready' || latest.revision !== project.revision) throw new BackupError('changed')
    }
  })
  else await captureFiles()
  for (const conversation of conversations) {
    const projected = mapping.conversation(conversation)
    add(projected.conversation.id, 'conversation', projected)
  }
  let next = head
  const payloads = new Map<string, Blob>()
  // Compare canonical content BEFORE allocating a new revision or payload ID.
  // Preserve unselected records and ancestry. Missing data is never a tombstone.
  for (const [id, item] of captured) {
    const record = head.records.find(r => r.id === id), heads = record ? recordHeads(record) : []
    if (heads.length > 1 || heads[0]?.value.state === 'deleted') return fail('base')
    const digest = await sha256(new Uint8Array(await item.blob.arrayBuffer())); assertFresh()
    const old = heads[0]?.value
    if (old?.state === 'live' && old.sha256 === digest && old.bytes === item.blob.size) continue
    const payloadId = crypto.randomUUID()
    next = stageSyncChange(next, { vaultId: head.vaultId, epoch: head.epoch, recordId: id, kind: item.kind,
      revision: { id: crypto.randomUUID(), intent: record ? 'edit' : 'create', parents: heads.map(h => h.id),
        value: { state: 'live', payloadId, sha256: digest, bytes: item.blob.size } } })
    payloads.set(payloadId, item.blob)
  }
  const state = parseSyncPrivateState({ ...prior, bindings: mapping.bindings })
  assertSyncMappingExtension(prior.bindings, state.bindings); assertSyncPrivateHead(state, next)
  await validateFresh()
  return { next, bindings: state.bindings, payloads, changed: payloads.size > 0,
    report: Object.freeze({ historical: true as const, conversations: conversations.length, files: fileIds.length, projects: selection.projectIds.length,
      capturedObjects: captured.size, capturedBytes: bytes, changedObjects: payloads.size,
      unresolvedReferences: state.bindings.filter(b => b.presence === 'reference').length }),
    assertCurrent: assertAlive, async validate() { assertAlive(); await scope.validateReadOnly(); assertAlive() } }
}
