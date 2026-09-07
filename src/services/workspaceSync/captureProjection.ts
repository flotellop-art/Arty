import type { Conversation } from '../../types'
import { isGeneratedImageId, MAX_GENERATED_IMAGES_PER_TURN } from '../generatedImages'
import { envelopeFail as fail } from './envelopeFormat'
import { SYNC_LIMITS } from './types'
import { canonicalSyncJSON } from './captureContent'
import type { SyncCaptureSelection } from './capture'

type Read = (input: unknown) => unknown
const own = (v: object, k: string) => Object.prototype.hasOwnProperty.call(v, k)

/** Freeze the explicit selection BEFORE the public adapter's first await. */
export function copySyncCaptureSelection(input: SyncCaptureSelection): SyncCaptureSelection {
  const selection = JSON.parse(canonicalSyncJSON(input)) as SyncCaptureSelection
  if (!selection || Object.keys(selection).sort().join() !== 'conversationIds,projectIds') return fail('format')
  for (const ids of [selection.conversationIds, selection.projectIds]) {
    if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string' || !id.length || id.length > 256) || new Set(ids).size !== ids.length) return fail('format')
  }
  if (selection.conversationIds.length > 100 || selection.projectIds.length > 20) return fail('limit')
  return selection
}
/** Private historical data only. No display reconstruction or archive allowlist:
 * null metrics, empty text and restrictive provenance must survive unchanged.
 * Unknown fields require an explicit schema decision, not silent data loss. */
export function projectSyncConversation(input: unknown): Conversation {
  return projectConversationShape(input, { nodes: 100_000, chars: SYNC_LIMITS.objectBytes })
}
/** Local addresses may be longer than the wire UUIDs and historical safety
 * metadata consumes extra space. Never use this entry point to decode wire:
 * the remapped result must pass projectSyncConversation and encodeSyncContent. */
export const SYNC_LOCAL_CONVERSATION_LIMITS = { nodes: 200_000, chars: 16 * 1024 * 1024 } as const
export function projectLocalSyncConversationShape(input: unknown): Conversation {
  return projectConversationShape(input, SYNC_LOCAL_CONVERSATION_LIMITS)
}
function projectConversationShape(input: unknown, limits: { nodes: number; chars: number }): Conversation {
  let nodes = 0, chars = 0
  const count = () => { if (++nodes > limits.nodes) fail('limit') }
  const text: Read = v => {
    count(); if (typeof v !== 'string') return fail('format')
    chars += v.length; if (chars > limits.chars) fail('limit'); return v
  }
  const number: Read = v => { count(); if (typeof v !== 'number' || !Number.isFinite(v) || Object.is(v, -0)) return fail('format'); return v }
  const integer: Read = v => { number(v); if (!Number.isSafeInteger(v) || (v as number) < 0) return fail('format'); return v }
  const bool: Read = v => { count(); if (typeof v !== 'boolean') return fail('format'); return v }
  const one = (...values: unknown[]): Read => v => { count(); if (!values.includes(v)) return fail('format'); return v }
  const nullable: Read = v => v === null ? null : number(v)
  const id: Read = v => { text(v); if (!(v as string).length || (v as string).length > 256) return fail('format'); return v }
  const list = (max: number, read: Read): Read => v => {
    count()
    if (!Array.isArray(v) || Object.getPrototypeOf(v) !== Array.prototype || Object.getOwnPropertySymbols(v).length) return fail('format')
    if (v.length > max) return fail('limit')
    if (Object.getOwnPropertyNames(v).length !== v.length + 1) return fail('format')
    return Array.from({ length: v.length }, (_, i) => {
      const d = Object.getOwnPropertyDescriptor(v, String(i))
      if (!d?.enumerable || !('value' in d)) return fail('format')
      return read(d.value)
    })
  }
  const shape = (required: Record<string, Read>, optional: Record<string, Read> = {}): Read => v => {
    count()
    if (!v || typeof v !== 'object' || Object.getPrototypeOf(v) !== Object.prototype || Object.getOwnPropertySymbols(v).length) return fail('format')
    const rules = { ...required, ...optional }, output: Record<string, unknown> = {}
    if (Object.getOwnPropertyNames(v).some(k => !own(rules, k))) return fail('format')
    for (const [k, read] of Object.entries(rules)) {
      const d = Object.getOwnPropertyDescriptor(v, k)
      if (!d) { if (own(required, k)) fail('format'); continue }
      if (!d.enumerable || !('value' in d)) return fail('format')
      if (d.value === undefined && !own(required, k)) {
        if (k === 'generatedImages') return fail('format')
        continue
      }
      output[k] = read(d.value)
    }
    return output
  }
  const crop = shape({ kind: one('auto'), sourceFileId: id, sourceFileIds: list(64, id), rect: shape({ x: number, y: number, width: number, height: number }) })
  const source = shape({ projectId: id, projectRevision: integer, documentId: id, documentRevision: integer, sourceHash: text,
    extractorVersion: text, name: text, format: one('txt', 'md', 'csv', 'docx', 'xlsx'), startLine: integer, endLine: integer, partial: bool })
  const turn = shape({ version: one(1), mode: one('search', 'overview', 'detached'), euOnly: bool, partial: bool, sources: list(100, source) },
    { projectId: id, projectRevision: integer, projectName: text })
  const fact = shape({ overallConfidence: one('high', 'medium', 'low'), modelLabel: text, checkedAt: integer,
    claims: list(100, shape({ claim: text, verdict: one('verified', 'uncertain', 'wrong'), explanation: text }, { originalText: text, correction: text, applied: bool })) },
    { status: one('pending', 'success-empty', 'success-with-claims', 'failed'), originalContent: text, appliedCorrections: integer })
  const attribution = shape({ model: text, provider: one('claude', 'mistral', 'gemini', 'openai') }, { invocationId: text, requestedModel: text,
    source: one('requested', 'proxy', 'provider'), reason: text, subModelReason: text, reflecting: bool, background: bool, conversationId: id, confirmed: bool })
  const comparison = shape({ version: one(1), groupId: id, sourceConversationId: id, sourceMessageId: id, peerId: id, questionId: id, responseId: id,
    provider: one('anthropic', 'mistral'), requestedModel: text, status: one('pending', 'streaming', 'done', 'error', 'aborted') },
    { error: text, binaryBytes: integer, attribution, metrics: shape({ firstTokenMs: nullable, totalMs: nullable, inputTokens: integer, outputTokens: integer, costEur: nullable }) })
  const file = shape({ id, name: text, type: text }, { size: integer, width: integer, height: integer, normalizationVersion: integer, visionCrop: crop,
    // Inline data is not a durable owned receipt. Even a valid base64 value is
    // refused; the normal send/persist path must first commit it to file storage.
    data: () => fail('missing') })
  const message = shape({ id, role: one('user', 'assistant'), content: text, timestamp: integer }, { restoredArchive: one(true),
    files: list(64, file), generatedImages: list(MAX_GENERATED_IMAGES_PER_TURN, id), pinned: bool, interrupted: bool, factCheck: fact,
    quickAction: shape({ id: one('brief', 'writeEmail', 'summarizeText', 'translateToEn', 'summarize', 'write', 'translate', 'explain'), locale: one('fr', 'en') }),
    model: text, requestedModel: text, modelSource: one('requested', 'proxy', 'provider'), reasonCode: text, subModelReasonCode: text, projectTurn: turn })
  const result = shape({ id, title: text, messages: list(5000, message), createdAt: integer, updatedAt: integer }, { comparison,
    outputRestriction: one('client-reply-draft-v1'), usedModels: list(100, text), tags: list(100, text), euOnly: bool,
    hasGoogleData: bool, hasTrailContext: bool, hasProjectContext: bool, projectId: id })(input) as Conversation
  const messages = new Set<string>()
  if (result.outputRestriction && result.hasProjectContext !== true) return fail('format')
  for (const m of result.messages) {
    if (m.id === 'streaming' || messages.has(m.id)) fail('format')
    messages.add(m.id)
    if (m.generatedImages !== undefined && (m.role !== 'assistant' || !m.generatedImages.every(isGeneratedImageId) || new Set(m.generatedImages).size !== m.generatedImages.length)) fail('format')
  }
  return result
}
