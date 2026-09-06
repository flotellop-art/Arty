import type { Conversation } from '../../types'
import type { WorkflowPolicy, ReviewProjectRequest } from '../projects/chatPreparation'
import type { captureLocalReadScope } from '../projects/store'
import { ProjectError } from '../projects/types'

export interface WorkflowCallbacks {
  signal: AbortSignal; assertDraft(): void; assertAccess(): void;
  review: ReviewProjectRequest; onAdopted(id: string): void
}

/** RAM-only admission. Form lifetime ends at commit, data ownership does not. */
export function captureWorkflowInvocation<P extends WorkflowPolicy>(args: WorkflowCallbacks & {
  scope: ReturnType<typeof captureLocalReadScope>; conversation: Conversation;
  policy: P; objective: string; question: string
}) {
  const { scope, signal, assertDraft, assertAccess, review, onAdopted, conversation, policy, objective, question } = args
  let adopted = false, notified = false, unbind = () => {}
  const assertCurrent = () => {
    scope.assertCurrent()
    if (!adopted) {
      if (signal.aborted) throw new ProjectError('cancelled')
      assertDraft(); assertAccess()
      scope.assertCurrent()
      if (signal.aborted) throw new ProjectError('cancelled')
    }
  }
  assertCurrent()
  return { conversation, policy, objective, question, review,
    preparation: { ...scope, assertCurrent }, assertCurrent,
    bindCancellation(cancel: () => void) {
      assertCurrent()
      signal.addEventListener('abort', cancel, { once: true })
      unbind = () => signal.removeEventListener('abort', cancel)
    },
    acceptPersisted() {
      // Never call reentrant UI/access callbacks inside publication.
      scope.assertCurrent()
      if (adopted || signal.aborted) throw new ProjectError('conflict')
      adopted = true; unbind()
    },
    notifyAdopted() {
      if (!adopted || notified) throw new ProjectError('conflict')
      notified = true
      try { onAdopted(conversation.id) } catch { /* durable chat remains accessible */ }
    },
    dispose() { unbind() },
  }
}
