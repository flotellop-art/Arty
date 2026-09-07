import type { Conversation, Message } from '../../types'
import { isGeneratedImageId, MAX_GENERATED_IMAGES_PER_TURN } from '../generatedImages'
import { envelopeFail as fail, envelopeFields as fields } from './envelopeFormat'
import { canonicalSyncJSON } from './captureContent'
import { projectLocalSyncConversationShape, SYNC_LOCAL_CONVERSATION_LIMITS } from './captureProjection'

// A bounded local witness has room for provenance on 5,000 messages and up to
// four aliases each. These are NOT wire limits: encodeSyncContent still checks
// the original 100k-node / 10 MiB framed payload after local metadata removal.
export const localSyncConversationWitness = (input: Conversation) => canonicalSyncJSON(input, SYNC_LOCAL_CONVERSATION_LIMITS)

/** Account-history metadata, not a remote capability. Keep the network grammar
 * closed: only this LOCAL projection accepts it. Read descriptors before any
 * clone, so accessors, sparse lists and unknown members cannot run or disappear. */
export function copyLocalSyncProvenance(input: unknown): NonNullable<Message['localSyncProvenance']> {
  const raw = input && typeof input === 'object' ? input : fail('format')
  const optional = ['historicalInjected', 'galleryAliases'].filter(k => Object.prototype.hasOwnProperty.call(raw, k))
  const p = fields(raw, ['version', ...optional])
  if (p.version !== 1 || !optional.length || optional.includes('historicalInjected') && p.historicalInjected !== true) return fail('format')
  const result: NonNullable<Message['localSyncProvenance']> = { version: 1 }
  if (p.historicalInjected === true) result.historicalInjected = true
  if (optional.includes('galleryAliases')) {
    const aliases = p.galleryAliases
    if (!Array.isArray(aliases) || Object.getPrototypeOf(aliases) !== Array.prototype || Object.getOwnPropertySymbols(aliases).length) return fail('format')
    if (!aliases.length || aliases.length > MAX_GENERATED_IMAGES_PER_TURN || Object.getOwnPropertyNames(aliases).length !== aliases.length + 1) return fail('limit')
    const files = new Set<string>(), texts = new Set<string>()
    result.galleryAliases = Array.from({ length: aliases.length }, (_, i) => {
      const d = Object.getOwnPropertyDescriptor(aliases, String(i))
      if (!d?.enumerable || !('value' in d)) return fail('format')
      const a = fields(d.value, ['fileId', 'textId'])
      if (!isGeneratedImageId(a.fileId) || !isGeneratedImageId(a.textId) || files.has(a.fileId) || texts.has(a.textId)) return fail('format')
      files.add(a.fileId); texts.add(a.textId)
      return { fileId: a.fileId, textId: a.textId }
    })
  }
  return result
}

/** The returned snapshot includes local provenance in the source ticket's
 * equality witness. It is stripped ONLY at wire projection, never before the
 * final comparison with the live cache. No old message DTO is replayed. */
export function projectLocalSyncConversation(input: Conversation): Conversation {
  // Validate the complete object graph before JSON serialization (no toJSON or
  // getters), keeping the same bounded, lossless UTF-16 semantics as capture.
  localSyncConversationWitness(input)
  const local = structuredClone(input)
  const provenance = new Map<string, NonNullable<Message['localSyncProvenance']>>()
  if (!Array.isArray(local.messages)) return fail('format')
  for (const m of local.messages) {
    if (!m || typeof m !== 'object') return fail('format')
    if (Object.prototype.hasOwnProperty.call(m, 'localSyncProvenance')) {
      const p = copyLocalSyncProvenance(m.localSyncProvenance)
      if (m.restoredArchive !== true) return fail('integrity')
      provenance.set(m.id, p)
      delete m.localSyncProvenance
      if (p.historicalInjected) delete m.restoredArchive
    }
  }
  const result = projectLocalSyncConversationShape(local)
  for (const m of result.messages) {
    const p = provenance.get(m.id)
    if (p) { m.localSyncProvenance = p; m.restoredArchive = true }
  }
  return result
}

/** Explicit branch transfer, independent nested aliases. New generated replies
 * must not call this on their parent: it describes copied historical messages. */
export function copyMessageSyncProvenance(message: Message): Pick<Message, 'localSyncProvenance'> {
  return message.localSyncProvenance === undefined ? {} : { localSyncProvenance: copyLocalSyncProvenance(message.localSyncProvenance) }
}
