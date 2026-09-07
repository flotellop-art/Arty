import type { Conversation } from '../../types'
import { validDescriptor, validProject, validProjectId, type Project, type ProjectDocument } from '../projects/types'
import type { SyncContent, SyncProjectContent } from './content'
import { envelopeFail as fail, envelopeUUID as uuid } from './envelopeFormat'
import { assertSyncPrivateHead, parseSyncPrivateState, type SyncLocalBinding } from './privateState'
import type { SyncManifest } from './types'
import { projectLocalSyncConversation } from './localProvenance'

type Kind = SyncLocalBinding['kind']
export type LocalSyncContent =
  | { kind: 'conversation'; conversation: Conversation }
  | { kind: 'file'; file: Extract<SyncContent, { kind: 'file' }>['data']; binary: Blob }
  | { kind: 'project'; project: Omit<Project, 'owner' | 'revision'> }
  | { kind: 'project-source'; projectId: string; document: ProjectDocument; binary: Blob }
  | { kind: 'project-text'; projectId: string; documentId: string; text: string }

/** Pure inverse of capture, fed only after whole-graph review. This does NOT
 * authorize any storage write. The warm owner must supply a collision-checked
 * allocator over ALL real stores; cold replay never allocates identities.
 * Existing typed bindings win; remote UUIDs/old text aliases are never local
 * addresses. Weak references reserve addresses without creating any rows. */
export function createSyncReceiveMapping(head: SyncManifest, input: SyncLocalBinding[], reserve: () => string) {
  const prior = parseSyncPrivateState({ format: 'arty-sync-private-state', version: 1, base: head, bindings: input })
  assertSyncPrivateHead(prior, prior.base)
  const bindings = prior.bindings
  const byLogical = new Map(bindings.map(b => [b.logicalId, b]))
  const localKey = (kind: Kind, parent: string | null, id: string) => JSON.stringify([kind, parent, id])
  const byLocal = new Set(bindings.map(b => localKey(b.kind, b.parentLocalId, b.localId)))
  const occupied = new Set(bindings.flatMap(b => [b.localId, ...(b.parentLocalId ? [b.parentLocalId] : [])]))
  function fresh() {
    const id = uuid(reserve())
    if (occupied.has(id)) return fail('integrity')
    occupied.add(id); return id
  }
  function existing(kind: Kind, logicalId: string, parentLocalId: string | null) {
    uuid(logicalId)
    const b = byLogical.get(logicalId)
    if (b && (b.kind !== kind || b.parentLocalId !== parentLocalId)) return fail('integrity')
    return b
  }
  function install(kind: Kind, logicalId: string, parentLocalId: string | null, materialized: boolean, localId?: string) {
    const old = existing(kind, logicalId, parentLocalId)
    const presence = materialized ? kind === 'message' || kind === 'group' ? 'embedded' : 'record' : 'reference'
    if (old) {
      if (localId !== undefined && localId !== old.localId) return fail('integrity')
      if (old.presence === 'reference') old.presence = presence
      return old.localId
    }
    if (bindings.length >= 10_000) return fail('limit')
    const b: SyncLocalBinding = { kind, logicalId, parentLocalId, localId: localId ?? fresh(), presence }
    // An explicit localId is permitted ONLY for the other half of a document.
    const key = localKey(kind, parentLocalId, b.localId)
    if (byLocal.has(key)) return fail('integrity')
    bindings.push(b); byLogical.set(logicalId, b); byLocal.add(key); return b.localId
  }
  function bind(kind: Kind, logicalId: string, parentLogicalId: string | null = null, materialized = false): string {
    const parented = kind === 'message' || kind === 'project-source' || kind === 'project-text'
    if (parented !== (parentLogicalId !== null)) return fail('format')
    const parent = parentLogicalId === null ? null : bind(kind === 'message' ? 'conversation' : 'project', parentLogicalId)
    return install(kind, logicalId, parent, materialized)
  }
  const documentSources = new Map<string, string>(), documentTexts = new Map<string, string>()
  function documentPair(projectId: string, sourceId: string, textId: string) {
    const parent = bind('project', projectId), source = existing('project-source', sourceId, parent), text = existing('project-text', textId, parent)
    if (sourceId === textId || source && text && source.localId !== text.localId) return fail('integrity')
    const key = JSON.stringify([projectId, sourceId])
    if (documentTexts.has(key) && documentTexts.get(key) !== textId || documentSources.has(textId) && documentSources.get(textId) !== key) return fail('integrity')
    documentTexts.set(key, textId); documentSources.set(textId, key)
    const local = source?.localId ?? text?.localId ?? fresh()
    install('project-source', sourceId, parent, false, local)
    install('project-text', textId, parent, false, local)
  }
  function conversation(data: Extract<SyncContent, { kind: 'conversation' }>['data']): Conversation {
    const c = structuredClone(data.conversation), logicalId = c.id
    const aliases = new Map(data.galleryAliases.map(a => [JSON.stringify([a.messageId, a.fileId]), a.textId]))
    c.id = bind('conversation', logicalId, null, true)
    if (c.projectId !== undefined) c.projectId = bind('project', c.projectId)
    for (const m of c.messages) {
      const messageId = m.id
      m.id = bind('message', messageId, logicalId, true)
      const galleryAliases = (m.generatedImages ?? []).map(fileId => {
        const textId = aliases.get(JSON.stringify([messageId, fileId]))
        if (textId === undefined) return fail('missing')
        return { fileId: bind('file', fileId), textId }
      })
      if (m.generatedImages !== undefined) m.generatedImages = galleryAliases.map(a => a.fileId)
      const injected = m.restoredArchive !== true
      m.restoredArchive = true
      if (injected || galleryAliases.length) m.localSyncProvenance = { version: 1,
        ...(injected ? { historicalInjected: true } : {}), ...(galleryAliases.length ? { galleryAliases } : {}) }
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
    const comparison = c.comparison
    if (comparison) {
      comparison.groupId = bind('group', comparison.groupId, null, true)
      comparison.sourceMessageId = bind('message', comparison.sourceMessageId, comparison.sourceConversationId)
      comparison.sourceConversationId = bind('conversation', comparison.sourceConversationId)
      comparison.peerId = bind('conversation', comparison.peerId)
      comparison.questionId = bind('message', comparison.questionId, logicalId)
      comparison.responseId = bind('message', comparison.responseId, logicalId)
      if (comparison.attribution?.conversationId !== undefined) comparison.attribution.conversationId = bind('conversation', comparison.attribution.conversationId)
    }
    // Old weak bindings can be legal references but illegal physical gallery
    // or message identities. Refuse materialization; never silently rebind.
    return projectLocalSyncConversation(c)
  }
  function project(data: SyncProjectContent): Omit<Project, 'owner' | 'revision'> {
    const p = structuredClone(data)
    const id = bind('project', p.id, null, true)
    const projected = { ...p, id, documents: p.documents.map(({ sourceId, textId, ...d }) => {
      documentPair(p.id, sourceId, textId)
      return { ...d, id: bind('project-source', sourceId, p.id) }
    }) }
    // These validation-only fields are not publication authority or output.
    if (!validProject({ ...projected, owner: 'validation-only', revision: 1 })) return fail('format')
    return projected
  }
  return {
    /** Preflight all pairs before projecting any record, including weak source
     * references in conversations. No allocation depends on payload order. */
    documentPair,
    projectContent(recordId: string, content: SyncContent): LocalSyncContent {
      uuid(recordId)
      const declaredId = content.kind === 'conversation' ? content.data.conversation.id : content.kind === 'project-source'
        ? content.data.document.id : content.kind === 'project-text' ? recordId : content.data.id
      if (declaredId !== recordId) return fail('integrity')
      switch (content.kind) {
        case 'conversation': return { kind: content.kind, conversation: conversation(content.data) }
        case 'project': return { kind: content.kind, project: project(content.data) }
        case 'file': {
          const id = bind('file', recordId, null, true)
          // Exact physical-address contract of readOwnedFileSnapshot. Weak
          // vision/history references alone retain their broader ID grammar.
          if (id.length > 128 || !/^[A-Za-z0-9._~-]+$/.test(id)) return fail('format')
          return { kind: content.kind, file: { ...content.data, id }, binary: content.binary }
        }
        case 'project-source': {
          const projectId = bind('project', content.data.projectId)
          const document = { ...content.data.document, id: bind('project-source', recordId, content.data.projectId, true) }
          if (!validProjectId(projectId) || !validDescriptor(document)) return fail('format')
          return { kind: content.kind, projectId, document, binary: content.binary }
        }
        case 'project-text': {
          documentPair(content.data.projectId, content.data.documentId, recordId)
          const projectId = bind('project', content.data.projectId), documentId = bind('project-text', recordId, content.data.projectId, true)
          if (!validProjectId(projectId) || !validProjectId(documentId)) return fail('format')
          return { kind: content.kind, projectId, documentId, text: content.data.text }
        }
      }
    },
    get bindings() { return structuredClone(bindings).sort((a, b) => a.logicalId < b.logicalId ? -1 : 1) },
  }
}
