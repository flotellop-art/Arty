import { validGeneratedImage } from '../generatedImages'
import { canonicalSyncJSON } from './captureContent'
import { decodeSyncContent, type SyncContent } from './content'
import { envelopeFail as fail, envelopeUUID as uuid, assertEnvelopeScope } from './envelopeFormat'
import type { ReceivedSyncChain } from './reception'
import { parseSyncManifest, recordHeads } from './schema'
import { SYNC_TRANSPORT_LIMITS } from './transportFormat'
import type { SyncKind, SyncRevision } from './types'
import type { SyncManifest } from './types'
import type { SyncLocalBinding } from './privateState'
import { createSyncReceiveMapping } from './receiveMapping'

type IdentityKind = SyncKind | 'message' | 'group'
type Dependency = { recordId: string; revisionId: string; targetId: string; relation: 'attachment' | 'gallery' | 'project-source' | 'project-text' }
export type SyncDependencyIssue = Dependency & { reason: 'missing' | 'deleted' | 'ambiguous' }
export interface SyncContentReport {
  status: 'content-reviewed-not-applied'
  content: 'maximal-variants-validated'
  anchor: ReceivedSyncChain['publication']
  records: number
  liveVariants: number
  deletedVariants: number
  conflicts: number
  decodedPayloads: number
  decodedBytes: number
  identities: number
  orphanDocumentRecords: number
  dependencyIssues: SyncDependencyIssue[]
}
// A refusal, never truncation. Distinct from the retained historical ciphertext
// budget, future device storage quota and peak JS/browser memory consumption.
export const SYNC_CONTENT_LIMITS = { bytes: SYNC_TRANSPORT_LIMITS.vaultBytes, identities: 10_000, references: 100_000 } as const
type Variant = { recordId: string; revisionId: string; payloadId: string; content: SyncContent }

/** Internal capability built from the actor's real received chain. No writer,
 * ACK, local-ID lookup, URI fetch or extractor. All maximal live variants are
 * decoded once per payload; no cross product or arbitrary conflict winner.
 * Dominated payloads remain authenticated opaque bytes in the received chain. */
export async function reviewReceivedSyncContent(received: ReceivedSyncChain) {
  let disposed = false, report: SyncContentReport | null = null
  const contents = new Map<string, SyncContent>(), variants: Variant[] = []
  const dispose = () => { disposed = true; contents.clear(); variants.length = 0; report = null; received.signal.removeEventListener('abort', dispose) }
  const assertCurrent = () => {
    try { if (disposed) return fail('cancelled'); received.assertCurrent() }
    catch (error) { dispose(); throw error }
  }
  const validate = async () => {
    assertCurrent()
    try { await received.validate(); assertCurrent() } catch (error) { dispose(); throw error }
  }
  received.signal.addEventListener('abort', dispose, { once: true })
  try {
    await validate()
    const manifest = received.manifest, records = new Map(manifest.records.map(r => [r.id, { ...r, heads: recordHeads(r) }]))
    const identities = new Map<string, { kind: IdentityKind; parent: string | null | undefined }>()
    let references = 0, decodedBytes = 0, liveVariants = 0, deletedVariants = 0
    const identity = (id: string, kind: IdentityKind, parent: string | null | undefined) => {
      uuid(id)
      const old = identities.get(id)
      if (old && (old.kind !== kind || old.parent !== undefined && parent !== undefined && old.parent !== parent)) return fail('format')
      if (!old && identities.size >= SYNC_CONTENT_LIMITS.identities) return fail('limit')
      identities.set(id, { kind, parent: parent === undefined ? old?.parent : parent })
    }
    const reference = (id: string, kind: IdentityKind, parent: string | null = null) => {
      if (++references > SYNC_CONTENT_LIMITS.references) return fail('limit')
      identity(id, kind, parent)
    }
    // Even a deleted/unselected record reserves its domain; a message cannot
    // impersonate a file. The parent of an opaque old source is not invented.
    for (const r of records.values()) identity(r.id, r.kind, r.kind === 'project-source' || r.kind === 'project-text' ? undefined : null)
    // Preflight cumulative body bytes before parsing any payload.
    const needed = new Map<string, number>()
    for (const r of records.values()) for (const head of r.heads) {
      if (head.value.state === 'deleted') { deletedVariants++; continue }
      liveVariants++
      if (!needed.has(head.value.payloadId)) { decodedBytes += head.value.bytes; needed.set(head.value.payloadId, head.value.bytes) }
    }
    if (decodedBytes > SYNC_CONTENT_LIMITS.bytes) return fail('limit')
    for (const r of records.values()) for (const head of r.heads) {
      assertCurrent()
      if (head.value.state === 'deleted') continue
      const payloadId = head.value.payloadId
      let content = contents.get(payloadId)
      if (!content) {
        content = await decodeSyncContent(received.payload(payloadId), r, assertCurrent); assertCurrent()
        contents.set(payloadId, content)
      }
      variants.push({ recordId: r.id, revisionId: head.id, payloadId, content })
    }
    const issues: SyncDependencyIssue[] = [], attached = new Set<string>(), galleries = new Set<string>(), referencedFiles = new Set<string>()
    const textDocuments = new Map<string, string>(), documentTexts = new Map<string, string>()
    const documentPair = (projectId: string, sourceId: string, textId: string) => {
      // The two record kinds address the SAME immutable document. Their stable
      // mapping is an identity invariant, not a winner selected from content.
      // Missing/conflicting targets must not bypass this association check.
      const source = JSON.stringify([projectId, sourceId]), oldSource = textDocuments.get(textId), oldText = documentTexts.get(source)
      if (oldSource !== undefined && oldSource !== source || oldText !== undefined && oldText !== textId) return fail('format')
      textDocuments.set(textId, source); documentTexts.set(source, textId)
    }
    const dependency = (v: Variant, targetId: string, relation: Dependency['relation']): SyncContent | null => {
      if (relation === 'attachment' || relation === 'gallery') referencedFiles.add(targetId)
      reference(targetId, relation === 'attachment' || relation === 'gallery' ? 'file' : relation,
        relation === 'project-source' || relation === 'project-text' ? v.recordId : null)
      const target = records.get(targetId)
      const reason = !target ? 'missing' : target.heads.length > 1 ? 'ambiguous' : target.heads[0]!.value.state === 'deleted' ? 'deleted' : null
      if (reason) { issues.push({ recordId: v.recordId, revisionId: v.revisionId, targetId, relation, reason }); return null }
      const value = target!.heads[0]!.value as Extract<SyncRevision['value'], { state: 'live' }>
      return contents.get(value.payloadId)!
    }
    for (const v of variants) {
      const c = v.content
      if (c.kind === 'file') continue
      if (c.kind === 'conversation') {
        const chat = c.data.conversation
        if (chat.projectId !== undefined) reference(chat.projectId, 'project')
        for (const m of chat.messages) {
          identity(m.id, 'message', chat.id)
          for (const f of m.files ?? []) {
            dependency(v, f.id, 'attachment')
            if (f.visionCrop) { reference(f.visionCrop.sourceFileId, 'file'); for (const id of f.visionCrop.sourceFileIds) reference(id, 'file') }
          }
          for (const id of m.generatedImages ?? []) { dependency(v, id, 'gallery'); galleries.add(id) }
          if (m.projectTurn) {
            if (m.projectTurn.projectId !== undefined) reference(m.projectTurn.projectId, 'project')
            for (const s of m.projectTurn.sources) { reference(s.projectId, 'project'); reference(s.documentId, 'project-source', s.projectId) }
          }
        }
        const compare = chat.comparison
        if (compare) {
          identity(compare.groupId, 'group', null); reference(compare.sourceConversationId, 'conversation'); reference(compare.peerId, 'conversation')
          reference(compare.sourceMessageId, 'message', compare.sourceConversationId)
          reference(compare.questionId, 'message', chat.id); reference(compare.responseId, 'message', chat.id)
          if (compare.attribution?.conversationId !== undefined) reference(compare.attribution.conversationId, 'conversation')
        }
      } else if (c.kind === 'project-source' || c.kind === 'project-text') {
        reference(c.data.projectId, 'project'); identity(v.recordId, c.kind, c.data.projectId)
        if (c.kind === 'project-text') { documentPair(c.data.projectId, c.data.documentId, v.recordId); reference(c.data.documentId, 'project-source', c.data.projectId) }
      } else {
        for (const doc of c.data.documents) {
          documentPair(v.recordId, doc.sourceId, doc.textId)
          const source = dependency(v, doc.sourceId, 'project-source'), text = dependency(v, doc.textId, 'project-text')
          attached.add(doc.sourceId); attached.add(doc.textId)
          const { sourceId: _source, textId: _text, ...descriptor } = doc
          if (source && (source.kind !== 'project-source' || source.data.projectId !== v.recordId ||
            canonicalSyncJSON(source.data.document) !== canonicalSyncJSON(descriptor))) return fail('integrity')
          if (text && (text.kind !== 'project-text' || text.data.projectId !== v.recordId || text.data.documentId !== doc.sourceId ||
            text.data.text.length !== doc.textChars)) return fail('integrity')
        }
      }
    }
    // Check every live maximal gallery variant, including when ambiguous.
    // This mirrors capture's bounded signature policy, NOT full image decoding
    // or dimension-bomb protection. No data/URI interpretation of raw chat text.
    for (const id of galleries) for (const head of records.get(id)?.heads ?? []) {
      if (head.value.state === 'deleted') continue
      const c = contents.get(head.value.payloadId)!
      if (c.kind !== 'file') return fail('format')
      const prefix = new Uint8Array(await c.binary.slice(0, 12).arrayBuffer()); assertCurrent()
      if (!validGeneratedImage(btoa(String.fromCharCode(...prefix)), c.data.type)) return fail('format')
    }
    await validate()
    report = { status: 'content-reviewed-not-applied', content: 'maximal-variants-validated', anchor: received.publication,
      records: records.size, liveVariants, deletedVariants, conflicts: [...records.values()].filter(r => r.heads.length > 1).length,
      decodedPayloads: contents.size, decodedBytes, identities: identities.size,
      orphanDocumentRecords: [...records.values()].filter(r => (r.kind === 'project-source' || r.kind === 'project-text') &&
        !attached.has(r.id) && r.heads.some(h => h.value.state === 'live')).length, dependencyIssues: issues }
    return Object.freeze({ dispose, assertCurrent, validate,
      get report() { assertCurrent(); return structuredClone(report!) },
      // Only an internal future applicator can use these reviewed DTOs. This
      // detached snapshot is not itself a storage/adoption capability.
      get variants() { assertCurrent(); return structuredClone(variants) },
      /** Internal preparation seam, never exposed by the client actor to UI.
       * All conflicts/deletions/strong gaps refuse this first projection; no
       * partial winner is selected. Orphan source/text bodies stay in T and
       * are explicitly reported as NOT materialized. This is still not a
       * journal, quota admission, freshness proof or permission to overwrite. */
      projectLocal(head: SyncManifest, bindings: SyncLocalBinding[], reserve: () => string) {
        assertCurrent()
        if (report!.conflicts || report!.deletedVariants || report!.dependencyIssues.length) return fail('base')
        const local = parseSyncManifest(head)
        assertEnvelopeScope(manifest, local)
        const mapping = createSyncReceiveMapping(local, bindings, () => { assertCurrent(); return reserve() })
        const selected = variants.filter(v => v.content.kind === 'file' ? referencedFiles.has(v.recordId)
          : v.content.kind !== 'project-source' && v.content.kind !== 'project-text' || attached.has(v.recordId))
        for (const v of selected) if (v.content.kind === 'project') for (const d of v.content.data.documents)
          mapping.documentPair(v.recordId, d.sourceId, d.textId)
        const projected = selected.map(v => ({ recordId: v.recordId, revisionId: v.revisionId, content: mapping.projectContent(v.recordId, v.content) }))
        assertCurrent()
        return { projected, bindings: mapping.bindings, retainedNotMaterialized: variants.filter(v => !selected.includes(v)).map(v => v.recordId) }
      },
    })
  } catch (error) { dispose(); throw error }
}
export type ReviewedSyncContent = Awaited<ReturnType<typeof reviewReceivedSyncContent>>
