import type { Conversation } from '../../types'
import { generateId } from '../../utils/generateId'
import { captureLocalReadScope } from '../projects/store'
import { ProjectError, PROJECT_LIMITS, type Project } from '../projects/types'
import type { ProjectSynthesisPolicy, ReviewProjectRequest } from '../projects/chatPreparation'

// Leave room for the visible application instructions, including on chat retry.
export const SYNTHESIS_OBJECTIVE_LIMIT = PROJECT_LIMITS.queryChars - 400
export function synthesisQuestion(objective: string, locale: string): string {
  if (!objective.trim() || objective.length > SYNTHESIS_OBJECTIVE_LIMIT) throw new ProjectError('limit')
  return locale.startsWith('fr')
    ? `Prépare une synthèse des extraits sélectionnés, pas du projet entier. Structure : faits sourcés, points de vigilance, informations manquantes et prochaines vérifications. Distingue les déductions des faits.\n\nObjectif exprimé par l’utilisateur :\n${objective}`
    : `Prepare a synthesis of the selected excerpts, not the entire project. Structure: sourced facts, issues, missing information and next checks. Distinguish inferences from facts.\n\nUser's objective:\n${objective}`
}

/** Ephemeral invocation, never serialized or reconstructed from an archive.
 * Form cancellation stops admission only. The stream keeps its own local scope. */
export function captureProjectSynthesis(args: {
  project: Project; objective: string; locale: string; signal: AbortSignal;
  assertDraft(): void; assertAccess(): void; review: ReviewProjectRequest; onAdopted(id: string): void
}) {
  const { signal, assertDraft, assertAccess, review, onAdopted } = args
  const scope = captureLocalReadScope()
  const project = structuredClone(args.project), objective = args.objective
  const question = synthesisQuestion(objective, args.locale)
  if (project.owner !== scope.owner) throw new ProjectError('conflict')
  const now = Date.now()
  const conversation: Conversation = { id: generateId(), title: project.name, createdAt: now, updatedAt: now,
    messages: [], projectId: project.id, hasProjectContext: true, euOnly: project.euOnly }
  const policy: ProjectSynthesisPolicy = { kind: 'project-synthesis', projectId: project.id, projectRevision: project.revision }
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
      // The last insertion guard already checked callbacks. Do not call UI or
      // access callbacks again inside the irreversible publication transition.
      scope.assertCurrent()
      if (adopted || signal.aborted) throw new ProjectError('conflict')
      adopted = true; unbind()
    },
    notifyAdopted() {
      if (!adopted || notified) throw new ProjectError('conflict')
      notified = true
      // UI errors cannot undo the durable commit or masquerade as storage errors.
      try { onAdopted(conversation.id) } catch { /* the saved chat remains accessible */ }
    },
    dispose() { unbind() },
  }
}
export type ProjectSynthesisInvocation = ReturnType<typeof captureProjectSynthesis>
