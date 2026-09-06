import type { Conversation } from '../../types'
import { generateId } from '../../utils/generateId'
import * as storage from '../storage'
import { captureLocalReadScope } from '../projects/store'
import { isProjectEU, projectConversationKey } from '../projects/chatPolicy'
import { prepareProjectPayload, type ReviewProjectRequest } from '../projects/chatPreparation'
import { ProjectError } from '../projects/types'
import { prepareOfficeMessages } from '../documents/prepareOfficeMessages'
import { detectMimeType } from '../../hooks/useFileAttachments'
import { getMessageTextForModel } from '../quickActions'
import { findModel, type PanelConfig } from './providerCatalog'

/** Local grouping only. Never route, fetch a file, or resume an HTTP request
 * using imported grouping metadata. A branch remains documentary without it. */
export interface ContextualComparison {
  version: 1
  groupId: string
  sourceConversationId: string
  sourceMessageId: string
  peerId: string
  questionId: string
  responseId: string
  provider: 'anthropic' | 'mistral'
  requestedModel: string
  status: 'pending' | 'streaming' | 'done' | 'error' | 'aborted'
}

/** Capture before the first await. The original conversation is never edited.
 * All confidentiality flags are retained, even when later than the prefix. */
export function captureContextualComparison(args: {
  sourceId: string; messageId: string; signal: AbortSignal
  isBusy(id: string): boolean
  getAccess(config: PanelConfig): string | null
}) {
  const { sourceId, messageId, signal, isBusy, getAccess } = args
  const scope = captureLocalReadScope(signal)
  if (!storage.isCacheReady() || isBusy(sourceId)) throw new ProjectError('unavailable')
  const source = storage.getConversation(sourceId)
  if (!source || source.messages.some(message => message.id === 'streaming')) throw new ProjectError('conflict')
  const original = structuredClone(source), originalKey = projectConversationKey(original)
  const index = original.messages.findIndex(message => message.id === messageId && message.role === 'user')
  if (index < 0) throw new ProjectError('unavailable')
  const prefix: Conversation = { ...original, euOnly: isProjectEU(original), messages: original.messages.slice(0, index + 1) }
  // Legacy JSON may contain inline bytes instead of an owned durable asset.
  // Never multiply those bytes into two new localStorage history copies.
  if (prefix.messages.some(m => m.files?.some(f => f.data !== undefined) ||
      (Object.prototype.hasOwnProperty.call(m, 'generatedImages') &&
        (!Array.isArray(m.generatedImages) || m.generatedImages.length !== 0)))) throw new ProjectError('unsupported')
  const provider = prefix.euOnly ? 'mistral' as const : 'anthropic' as const
  const assertSource = () => {
    scope.assertCurrent()
    const current = storage.getConversation(original.id)
    if (!storage.isCacheReady() || !current || current.messages.some(m => m.id === 'streaming') || projectConversationKey(current) !== originalKey) throw new ProjectError('conflict')
  }
  assertSource()
  let started = false
  return { provider, question: prefix.messages.at(-1)!.content,
    async prepare(selected: readonly PanelConfig[], review: ReviewProjectRequest) {
      assertSource()
      if (started) throw new ProjectError('conflict')
      started = true
      const configs = structuredClone(selected)
      const descriptors = configs.map(config => findModel(config.provider, config.modelId))
      if (configs.length !== 2 || configs.some(config => config.provider !== provider) ||
          descriptors.some(model => !model) || new Set(descriptors.map(model => model?.modelId)).size !== 2) throw new ProjectError('unsupported')
      const assertAccess = () => {
        scope.assertCurrent()
        for (const config of configs) {
          const error = getAccess(config)
          if (error) throw new Error(error)
        }
      }
      assertAccess()
      // The text catalogue does not attest two vision-capable Mistral models.
      // Do not silently discard pixels to manufacture an EU comparison.
      if (provider === 'mistral' && prefix.messages.some(m => m.files?.some(f => detectMimeType(f.name, f.type).startsWith('image/')))) throw new ProjectError('unsupported')
      const preparation = { ...scope, assertCurrent: assertSource }
      const messages = await prepareOfficeMessages(prefix.messages, preparation)
      assertSource()
      const payload = await prepareProjectPayload({
        conversation: prefix, messages, query: prefix.messages.at(-1)!.content,
        effectiveQuestion: getMessageTextForModel(prefix.messages.at(-1)!),
        provider: provider === 'anthropic' ? 'claude' : 'mistral', preparation, signal,
        assertConversationCurrent: assertSource,
        review: (value, signal) => review(value.kind === 'confirm'
          ? { ...value, comparisonModels: [descriptors[0]!.label, descriptors[1]!.label] }
          : value, signal),
      })
      assertSource(); assertAccess()
      const groupId = generateId(), branchIds = [generateId(), generateId()] as const
      const branches = configs.map((config, panel): Conversation => {
        const now = Date.now(), branch = structuredClone(prefix)
        // No binary copy to localStorage: references keep the original assets
        // alive in shared-file GC; prepared Office text stays ephemeral.
        branch.messages = branch.messages.map(message => {
          const { factCheck, ...rest } = message
          const pending = message.restoredArchive !== true && factCheck &&
            (factCheck.status === 'pending' || factCheck.modelLabel === 'Vérification en cours…')
          return { ...rest, id: generateId(), ...(factCheck && !pending ? { factCheck } : {}) }
        })
        branch.messages.at(-1)!.projectTurn = structuredClone(payload.turn)
        branch.id = branchIds[panel]!; branch.title = `${original.title.slice(0, 160)} · ${descriptors[panel]!.label}`
        branch.createdAt = now; branch.updatedAt = now
        branch.hasProjectContext = true // durable read-only behavior, not group metadata
        branch.comparison = { version: 1, groupId, sourceConversationId: original.id, sourceMessageId: messageId,
          peerId: branchIds[1 - panel]!, questionId: branch.messages.at(-1)!.id, responseId: generateId(),
          provider, requestedModel: config.modelId, status: 'pending' }
        return branch
      })
      let committed = false
      const taken = new Set<number>()
      const assertBranch = (panel: number, full = false) => {
        scope.assertCurrent()
        const expected = branches[panel], current = expected && storage.getConversation(expected.id)
        if (!committed || !expected || !current || !storage.isCacheReady() ||
            current.comparison?.groupId !== groupId || current.comparison.questionId !== expected.comparison!.questionId ||
            current.comparison.responseId !== expected.comparison!.responseId ||
            current.messages[expected.messages.length - 1]?.id !== expected.comparison!.questionId ||
            current.hasGoogleData !== expected.hasGoogleData || current.hasTrailContext !== expected.hasTrailContext ||
            current.projectId !== prefix.projectId || isProjectEU(current) !== prefix.euOnly || !current.hasProjectContext ||
            (full && (current.messages.length !== expected.messages.length || JSON.stringify(current.messages) !== JSON.stringify(expected.messages)))) throw new ProjectError('conflict')
      }
      return { groupId, branchIds,
        /** Call after reserving both slots in the shared streaming manager.
         * No await between this final guard and the single local commit. */
        commit() {
          assertSource(); assertAccess(); payload.assertCurrent()
          if (committed) throw new ProjectError('conflict')
          storage.insertConversationsAtomically(branches, assertSource)
          committed = true
        },
        /** One acquisition per panel, after durable reservation. Every client
         * must call beforeRequest AFTER its async auth and BEFORE HTTP. */
        takeRequest(panel: 0 | 1) {
          assertBranch(panel)
          if (taken.has(panel)) throw new ProjectError('conflict')
          taken.add(panel)
          return { branchId: branchIds[panel], config: structuredClone(configs[panel]!),
            provider: payload.provider, claudeMessages: structuredClone(payload.claudeMessages),
            mistralMessages: structuredClone(payload.mistralMessages), systemPrompt: payload.systemPrompt,
            turn: structuredClone(payload.turn), assertCurrent: () => assertBranch(panel),
            async beforeRequest() {
              assertBranch(panel, true); assertAccess(); await payload.validate()
              assertBranch(panel, true); assertAccess()
            },
          }
        },
      }
    },
  }
}
