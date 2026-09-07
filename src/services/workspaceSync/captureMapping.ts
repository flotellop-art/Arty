import type { Conversation } from '../../types'
import { assertSyncPrivateHead, parseSyncPrivateState, type SyncLocalBinding } from './privateState'
import { envelopeFail as fail } from './envelopeFormat'
import { projectLocalSyncConversation } from './localProvenance'
import { projectSyncConversation } from './captureProjection'

/** Extends only; an unselected original/peer/crop is a reference, never an
 * implicit request to read it. Document identity IS its project-source ID. */
export function createSyncCaptureMapping(prior: SyncLocalBinding[]) {
  return createMapping(prior, false)
}

/** Internal projection seam for a future materialized-target witness. It does
 * not read stores or prove B==M, and is never an authorization to write. All
 * addresses must already belong to the exact private branch; neither missing
 * identities nor reference promotions can allocate/repair anything here. */
export function createSyncReadMapping(head: unknown, bindings: SyncLocalBinding[]) {
  const state = parseSyncPrivateState({ format: 'arty-sync-private-state', version: 1, base: head, bindings })
  assertSyncPrivateHead(state, state.base)
  const mapping = createMapping(state.bindings, true)
  return Object.freeze({ lookup: mapping.bind, conversation: mapping.conversation })
}

function createMapping(prior: SyncLocalBinding[], readOnly: boolean) {
  const bindings = structuredClone(prior)
  const key = (kind: SyncLocalBinding['kind'], localId: string, parent: string | null) => JSON.stringify([kind, parent, localId])
  const byLocal = new Map(bindings.map(b => [key(b.kind, b.localId, b.parentLocalId), b]))
  function bind(kind: SyncLocalBinding['kind'], localId: string, parentLocalId: string | null = null, materialized = false): string {
    if (readOnly) {
      if (typeof kind !== 'string' || !['conversation', 'project', 'file', 'project-source', 'project-text', 'message', 'group'].includes(kind) ||
        typeof materialized !== 'boolean') return fail('format')
      const parented = kind === 'message' || kind === 'project-source' || kind === 'project-text'
      if (parented ? typeof parentLocalId !== 'string' || !parentLocalId.length || parentLocalId.length > 256 : parentLocalId !== null) return fail('format')
    }
    if (typeof localId !== 'string' || !localId.length || localId.length > 256) return fail('format')
    if (parentLocalId !== null) bind(kind === 'message' ? 'conversation' : 'project', parentLocalId)
    const k = key(kind, localId, parentLocalId), old = byLocal.get(k)
    const presence = materialized ? kind === 'message' || kind === 'group' ? 'embedded' : 'record' : 'reference'
    if (readOnly) {
      if (!old) return fail('missing')
      if (materialized && old.presence !== presence) return fail('base')
      return old.logicalId
    }
    if (old) { if (old.presence === 'reference') old.presence = presence; return old.logicalId }
    if (bindings.length >= 10_000) return fail('limit')
    const entry: SyncLocalBinding = { kind, localId, parentLocalId, logicalId: crypto.randomUUID(), presence }
    bindings.push(entry); byLocal.set(k, entry); return entry.logicalId
  }
  function conversation(c: Conversation) {
    const result = projectLocalSyncConversation(c), localId = c.id
    const galleryAliases: { messageId: string; textId: string; fileId: string }[] = []
    result.id = bind('conversation', localId, null, true)
    if (c.projectId !== undefined) result.projectId = bind('project', c.projectId)
    for (const m of result.messages) {
      const provenance = m.localSyncProvenance
      delete m.localSyncProvenance
      if (provenance?.historicalInjected) delete m.restoredArchive
      m.id = bind('message', m.id, localId, true)
      const gallery = new Map((m.generatedImages ?? []).map(id => [id, bind('file', id)]))
      if (m.generatedImages !== undefined) m.generatedImages = [...gallery.values()]
      // Keep raw text EXACT, including code/prose containing a known URI. This
      // typed alias is historical presentation data, not a local lookup grant.
      const oldAliases = new Map(provenance?.galleryAliases?.map(a => [a.fileId, a.textId]))
      const texts = new Set<string>()
      for (const [physicalId, fileId] of gallery) {
        const textId = oldAliases.get(physicalId) ?? physicalId
        if (texts.has(textId)) return fail('format')
        texts.add(textId); galleryAliases.push({ messageId: m.id, textId, fileId })
      }
      for (const f of m.files ?? []) {
        f.id = bind('file', f.id)
        if (f.visionCrop) {
          f.visionCrop.sourceFileId = bind('file', f.visionCrop.sourceFileId)
          f.visionCrop.sourceFileIds = f.visionCrop.sourceFileIds.map(id => bind('file', id))
        }
      }
      const turn = m.projectTurn
      if (turn) {
        if (turn.projectId !== undefined) turn.projectId = bind('project', turn.projectId)
        for (const s of turn.sources) {
          s.documentId = bind('project-source', s.documentId, s.projectId)
          s.projectId = bind('project', s.projectId)
        }
      }
    }
    const comparison = result.comparison
    if (comparison) {
      comparison.groupId = bind('group', comparison.groupId, null, true)
      comparison.sourceMessageId = bind('message', comparison.sourceMessageId, comparison.sourceConversationId)
      comparison.sourceConversationId = bind('conversation', comparison.sourceConversationId)
      comparison.peerId = bind('conversation', comparison.peerId)
      comparison.questionId = bind('message', comparison.questionId, localId)
      comparison.responseId = bind('message', comparison.responseId, localId)
      if (comparison.attribution?.conversationId !== undefined) comparison.attribution.conversationId = bind('conversation', comparison.attribution.conversationId)
    }
    return { conversation: projectSyncConversation(result), galleryAliases }
  }
  return { bind, conversation, bindings }
}
