/** Internal, RAM-only evidence. Not a field of Conversation/Message or an
 * instruction recovered from an archive. "saved" means the synchronous local
 * safety copy succeeded, not encrypted persistence or subjective usefulness. */
export type WorkflowOutcome = 'saved' | 'empty' | 'error' | 'stopped' | 'not_saved' | 'not_started'
export interface WorkflowObservation {
  settle(outcome: WorkflowOutcome): void
  discard(): void
}

/** Claim the terminal state before calling any untrusted/reentrant observer.
 * Optional measurement must never throw into the business workflow. */
export function onceWorkflowObservation(observer: WorkflowObservation): WorkflowObservation {
  let settle: WorkflowObservation['settle'], discard: WorkflowObservation['discard']
  try { settle = observer.settle.bind(observer); discard = observer.discard.bind(observer) }
  catch { return { settle() {}, discard() {} } }
  let finished = false
  return {
    settle(outcome) { if (finished) return; finished = true; try { settle(outcome) } catch { /* optional observer */ } },
    discard() { if (finished) return; finished = true; try { discard() } catch { /* optional observer */ } },
  }
}
