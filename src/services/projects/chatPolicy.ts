import type { Conversation } from '../../types'
import { hasOfficeHistory } from '../documents/prepareOfficeMessages'
import type { ProjectSourceReference } from './types'

export interface ProjectTurn {
  version: 1
  projectId?: string
  projectRevision?: number
  projectName?: string
  mode: 'search' | 'overview' | 'detached'
  euOnly: boolean
  partial: boolean
  /** [S1] always refers to sources[0] of THIS turn, never the current project. */
  sources: ProjectSourceReference[]
}

export function hasProjectHistory(conv: Pick<Conversation, 'projectId' | 'hasProjectContext' | 'messages'>): boolean {
  return !!(conv.projectId || conv.hasProjectContext || conv.messages.some(m => m.projectTurn))
}
export function isProjectEU(conv: Pick<Conversation, 'euOnly' | 'messages'>): boolean {
  return !!conv.euOnly || conv.messages.some(m => m.projectTurn?.euOnly === true)
}
export function isDocumentConversation(conv: Conversation): boolean {
  return hasProjectHistory(conv) || hasOfficeHistory(conv.messages)
}

/** A concurrent edit (including title/tags/pins) invalidates the old clone.
 * Only aggregate attribution and timestamps, updated by this invocation, are
 * excluded. Streaming placeholders are not part of the approved history. */
export function projectConversationKey(conv: Conversation): string {
  return JSON.stringify({ id: conv.id, projectId: conv.projectId, euOnly: isProjectEU(conv),
    title: conv.title, tags: conv.tags, hasGoogleData: conv.hasGoogleData, hasTrailContext: conv.hasTrailContext,
    documentary: hasProjectHistory(conv), messages: conv.messages.filter(m => m.id !== 'streaming') })
}
