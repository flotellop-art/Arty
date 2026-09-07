import type { Conversation } from '../../types'
import type { SyncLocalBinding } from './privateState'
import { envelopeFail as fail } from './envelopeFormat'

/** Extends only; an unselected original/peer/crop is a reference, never an
 * implicit request to read it. Document identity IS its project-source ID. */
export function createSyncCaptureMapping(prior: SyncLocalBinding[]) {
  const bindings = structuredClone(prior)
  const key = (kind: SyncLocalBinding['kind'], localId: string, parent: string | null) => JSON.stringify([kind, parent, localId])
  const byLocal = new Map(bindings.map(b => [key(b.kind, b.localId, b.parentLocalId), b]))
  function bind(kind: SyncLocalBinding['kind'], localId: string, parentLocalId: string | null = null, materialized = false): string {
    if (typeof localId !== 'string' || !localId.length || localId.length > 256) return fail('format')
    if (parentLocalId !== null) bind(kind === 'message' ? 'conversation' : 'project', parentLocalId)
    const k = key(kind, localId, parentLocalId), old = byLocal.get(k)
    const presence = materialized ? kind === 'message' || kind === 'group' ? 'embedded' : 'record' : 'reference'
    if (old) { if (old.presence === 'reference') old.presence = presence; return old.logicalId }
    if (bindings.length >= 10_000) return fail('limit')
    const entry: SyncLocalBinding = { kind, localId, parentLocalId, logicalId: crypto.randomUUID(), presence }
    bindings.push(entry); byLocal.set(k, entry); return entry.logicalId
  }
  function conversation(c: Conversation) {
    const result = structuredClone(c), localId = c.id
    const galleryAliases: { messageId: string; textId: string; fileId: string }[] = []
    result.id = bind('conversation', localId, null, true)
    if (c.projectId !== undefined) result.projectId = bind('project', c.projectId)
    for (const m of result.messages) {
      m.id = bind('message', m.id, localId, true)
      const gallery = new Map((m.generatedImages ?? []).map(id => [id, bind('file', id)]))
      if (m.generatedImages !== undefined) m.generatedImages = [...gallery.values()]
      // Keep raw text EXACT, including code/prose containing a known URI. This
      // typed alias is historical presentation data, not a local lookup grant.
      for (const [textId, fileId] of gallery) galleryAliases.push({ messageId: m.id, textId, fileId })
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
    return { conversation: result, galleryAliases }
  }
  return { bind, conversation, bindings }
}
