import type { Conversation, Message } from '../../types'
import { buildApiMessages, buildMistralMessages, detectMimeType } from '../../hooks/useFileAttachments'
import { getFile } from '../secureFileStorage'
import * as storage from '../storage'
import type { DocumentPreparation } from '../documents/prepareOfficeMessages'
import { DOCUMENT_READ_ONLY_RULES } from '../documents/documentPolicy'
import { beginProjectOperation, getProject, assertProjectOperation } from './store'
import { buildProjectContext, projectContextText, type ProjectContext } from './context'
import { ProjectError, type Project } from './types'
import { isProjectEU, projectConversationKey, type ProjectTurn } from './chatPolicy'

export const PROJECT_REQUEST_TEXT_LIMIT = 200_000
export const PROJECT_REQUEST_BINARY_LIMIT = 20 * 1024 * 1024
// Conservative space for rules/date/instructions appended inside the clients.
export const PROJECT_CLIENT_RESERVE = 32_000
export interface ProjectSelection { mode: 'search' | 'overview'; documentIds: string[] }
export type ProjectReview = { kind: 'select'; project: Project } | {
  kind: 'confirm'; context: ProjectContext | null; provider: 'claude' | 'mistral';
  question: string; textChars: number; binaryBytes: number; historyMessages: number;
  files: string[]; systemPrompt: string
}
export type ReviewProjectRequest = (review: ProjectReview, signal: AbortSignal) => Promise<ProjectSelection | boolean | null>
type ClaudeMessages = Awaited<ReturnType<typeof buildApiMessages>>
type MistralMessages = Awaited<ReturnType<typeof buildMistralMessages>>

/** Count the real built representation, not just Message.content. Binary data
 * has a separate byte ceiling: it is not represented as an invented token count. */
export function projectPayloadBudget(messages: unknown, systemPrompt: string): { textChars: number; binaryBytes: number } {
  let textChars = systemPrompt.length + PROJECT_CLIENT_RESERVE, binaryBytes = 0
  const visit = (value: unknown, binary = false): void => {
    if (typeof value === 'string') {
      const dataUrl = binary ? /^data:[^;,]+;base64,/.exec(value) : null
      if (binary) {
        const base64 = dataUrl ? value.slice(dataUrl[0].length) : value
        binaryBytes += Math.ceil(base64.length * 3 / 4)
      } else textChars += value.length
    } else if (Array.isArray(value)) value.forEach(item => visit(item))
    else if (value && typeof value === 'object') {
      const object = value as Record<string, unknown>
      Object.entries(object).forEach(([k, v]) => {
        textChars += k.length + 4
        if (k === 'source' && (object.type === 'image' || object.type === 'document') && v && typeof v === 'object') {
          Object.entries(v).forEach(([sourceKey, sourceValue]) => visit(sourceValue, sourceKey === 'data'))
        } else if (k === 'image_url' && object.type === 'image_url' && v && typeof v === 'object') {
          Object.entries(v).forEach(([imageKey, imageValue]) => visit(imageValue, imageKey === 'url'))
        } else visit(v)
      })
    }
  }
  visit(messages)
  if (textChars > PROJECT_REQUEST_TEXT_LIMIT || binaryBytes > PROJECT_REQUEST_BINARY_LIMIT) throw new ProjectError('limit')
  return { textChars, binaryBytes }
}

export interface PreparedProjectChat {
  provider: 'claude' | 'mistral'
  claudeMessages?: ClaudeMessages
  mistralMessages?: MistralMessages
  systemPrompt: string
  turn: ProjectTurn
  assertCurrent(): void
  validate(): Promise<void>
  /** Exactly once, after the atomic local commit; not a provider receipt. */
  acceptPersisted(conversation: Conversation): void
  beforeFirstRequest(): Promise<void>
}

export async function prepareProjectChat(args: {
  conversation: Conversation; messages: Message[]; query: string; effectiveQuestion?: string; provider: 'claude' | 'mistral';
  preparation: DocumentPreparation; signal: AbortSignal; review: ReviewProjectRequest
}): Promise<PreparedProjectChat> {
  const { preparation, signal, review } = args
  preparation.assertCurrent()
  const original = structuredClone(args.conversation), messages = structuredClone(args.messages)
  let expectedConversation = projectConversationKey(original), persisted = false, engaged = false
  let committedMessages = 0, committedLastId: string | undefined
  const operation = await beginProjectOperation()
  const assertCurrent = () => {
    preparation.assertCurrent(); operation.assertCurrent()
    if (signal.aborted) throw new ProjectError('cancelled')
    const current = storage.getConversation(original.id)
    if (!current) throw new ProjectError('conflict')
    if (!engaged) {
      if (projectConversationKey(current) !== expectedConversation) throw new ProjectError('conflict')
    } else {
      // Once HTTP is engaged, the payload is immutable. Harmless title/tag/pin
      // changes must not cancel an answer or serialize the full history at
      // every token. Content edits/association changes are blocked while a
      // stream is active; deletion/session changes still fail closed here.
      const history = current.messages.filter(m => m.id !== 'streaming')
      if (current.projectId !== original.projectId || isProjectEU(current) !== euOnly ||
        history.length !== committedMessages || history.at(-1)?.id !== committedLastId) throw new ProjectError('conflict')
    }
  }
  assertCurrent()
  const euOnly = isProjectEU(original)
  if ((euOnly ? 'mistral' : 'claude') !== args.provider) throw new ProjectError('unsupported')
  let context: ProjectContext | null = null
  if (original.projectId) {
    const summary = await getProject(operation, original.projectId); assertCurrent()
    if (!summary || summary.status === 'deleted') throw new ProjectError('deleted')
    if (!summary.project || summary.status !== 'ready') throw new ProjectError('locked')
    if (summary.euOnly && !euOnly) throw new ProjectError('conflict')
    const selection = await review({ kind: 'select', project: structuredClone(summary.project) }, signal)
    assertCurrent()
    if (!selection || typeof selection !== 'object') throw new ProjectError('cancelled')
    if (!['search', 'overview'].includes(selection.mode) || !Array.isArray(selection.documentIds) || (summary.project.documents.length > 0 && !selection.documentIds.length)) throw new ProjectError('unsupported')
    context = await buildProjectContext(operation, summary.project, args.query, selection)
    assertCurrent()
  }
  // Fully hydrate once before the preview. No lost asset silently becomes a
  // placeholder. Office files in this array have already been extracted locally.
  let sourceBytes = 0
  for (const message of messages) for (const file of message.files ?? []) {
    assertCurrent()
    const hydrated = file.data ? file : await getFile(file.id, preparation.owner)
    assertCurrent()
    if (!hydrated?.data) throw new ProjectError('unavailable')
    file.data = hydrated.data
    sourceBytes += Math.ceil(file.data.length * 3 / 4)
    if (sourceBytes > PROJECT_REQUEST_BINARY_LIMIT) throw new ProjectError('limit')
    file.type = detectMimeType(file.name, file.type)
    if (file.type === 'application/json' || file.type === 'application/xml') file.type = 'text/plain'
    if (file.type === 'application/x-pdf') file.type = 'application/pdf'
    const isPdf = file.type === 'application/pdf'
    const supported = file.type.startsWith('image/') || file.type.startsWith('text/') || (args.provider === 'claude' && isPdf)
    if (!supported || (args.provider === 'mistral' && isPdf)) throw new ProjectError('unsupported')
    try {
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(file.data)) throw new Error('Invalid base64')
      const raw = atob(file.data)
      if (btoa(raw).replace(/=+$/, '') !== file.data.replace(/=+$/, '')) throw new Error('Noncanonical base64')
      if (file.type.startsWith('text/')) new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(raw, c => c.charCodeAt(0)))
    } catch { throw new ProjectError('corrupt') }
  }
  const systemPrompt = [
    'You are Arty. Answer in the language of the user. Analyse only the supplied conversation and excerpts. No personal memory or connected account data is available.',
    'Cite [S1], [S2], etc. only for the CURRENT turn excerpts, with their extracted line ranges. Previous turn labels are not current sources. Never claim a full library review. Distinguish evidence, inference and missing information.',
    DOCUMENT_READ_ONLY_RULES,
    context?.instructions ? `Project owner preferences (subordinate to read-only policy):\n${context.instructions}` : '',
  ].filter(Boolean).join('\n\n')
  const sourceText = context ? projectContextText(context) : 'No library attached to this turn. Earlier conversation text is still supplied; do not claim to have reread its sources.'
  let claudeMessages: ClaudeMessages | undefined, mistralMessages: MistralMessages | undefined
  if (args.provider === 'claude') {
    claudeMessages = await buildApiMessages(messages, preparation)
    const last = claudeMessages.at(-1)
    if (!last || last.role !== 'user') throw new ProjectError('corrupt')
    last.content = [...(typeof last.content === 'string' ? [{ type: 'text', text: last.content }] : last.content), { type: 'text', text: sourceText }]
  } else {
    mistralMessages = await buildMistralMessages(messages, preparation)
    const last = mistralMessages.at(-1)
    if (!last || last.role !== 'user') throw new ProjectError('corrupt')
    last.content = [...(typeof last.content === 'string' ? [{ type: 'text' as const, text: last.content }] : last.content), { type: 'text', text: sourceText }]
  }
  assertCurrent()
  const budget = projectPayloadBudget(claudeMessages ?? mistralMessages, systemPrompt)
  const validate = async () => {
    assertCurrent(); await assertProjectOperation(operation); assertCurrent()
    if (context) {
      const latest = await getProject(operation, context.projectId); assertCurrent()
      if (!latest || latest.status === 'deleted') throw new ProjectError('deleted')
      if (latest.status !== 'ready' || latest.revision !== context.projectRevision) throw new ProjectError('conflict')
    }
  }
  await validate()
  if (await review({ kind: 'confirm', context: context ? structuredClone(context) : null, provider: args.provider,
    question: args.effectiveQuestion ?? args.query, ...budget, historyMessages: Math.max(0, messages.length - 1),
    files: messages.flatMap(m => m.files?.map(f => f.name) ?? []), systemPrompt }, signal) !== true) throw new ProjectError('cancelled')
  await validate()
  return { provider: args.provider, claudeMessages, mistralMessages, systemPrompt,
    turn: { version: 1, ...(context ? { projectId: context.projectId, projectRevision: context.projectRevision, projectName: context.name } : {}),
      mode: context?.mode ?? 'detached', euOnly, partial: context?.truncated ?? false,
      sources: context?.excerpts.map(e => ({ ...e.reference })) ?? [] },
    assertCurrent, validate,
    acceptPersisted(conversation) {
      // Caller has just saved this snapshot without an intervening await.
      preparation.assertCurrent(); operation.assertCurrent()
      if (persisted || conversation.id !== original.id || conversation.projectId !== original.projectId || isProjectEU(conversation) !== euOnly) throw new ProjectError('conflict')
      expectedConversation = projectConversationKey(conversation)
      const history = conversation.messages.filter(m => m.id !== 'streaming')
      committedMessages = history.length; committedLastId = history.at(-1)?.id
      persisted = true; assertCurrent()
    },
    async beforeFirstRequest() {
      if (!persisted) throw new ProjectError('conflict')
      if (!engaged) { await validate(); engaged = true }
      preparation.assertCurrent(); operation.assertCurrent()
    },
  }
}
