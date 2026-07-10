export type AnthropicSessionStatus =
  | "idle"
  | "running"
  | "rescheduling"
  | "terminated";

export type IdleStopReason =
  | { type: "end_turn" }
  | { type: "requires_action"; event_ids: string[] }
  | { type: "retries_exhausted" };

export interface SessionStatusIdleEvent {
  type: "session.status_idle";
  stop_reason?: IdleStopReason;
}

export type IdleDisposition =
  | { kind: "deliver" }
  | { kind: "requires_action"; eventIds: string[] }
  | { kind: "failed" }
  | { kind: "stale" }
  | { kind: "retry" };

/**
 * Classifie un webhook `session.status_idled` a partir de l'etat courant de la
 * session et de son dernier evenement persiste `session.status_idle`.
 *
 * Le webhook signifie "la session attend une entree", pas necessairement
 * "le tour est termine". Toute valeur inconnue reste fail-closed et demande
 * un retry plutot que de livrer un resultat potentiellement partiel.
 */
export function classifyIdleDisposition(
  status: AnthropicSessionStatus | string | undefined,
  idleEvent: SessionStatusIdleEvent | null,
): IdleDisposition {
  if (status === "running" || status === "rescheduling") {
    return { kind: "stale" };
  }
  if (status === "terminated") {
    return { kind: "failed" };
  }
  if (status !== "idle" || idleEvent?.type !== "session.status_idle" || !idleEvent.stop_reason) {
    return { kind: "retry" };
  }

  switch (idleEvent.stop_reason.type) {
    case "end_turn":
      return { kind: "deliver" };
    case "requires_action":
      if (
        !Array.isArray(idleEvent.stop_reason.event_ids)
        || idleEvent.stop_reason.event_ids.length === 0
        || idleEvent.stop_reason.event_ids.some((id) => typeof id !== "string" || !id)
      ) {
        return { kind: "retry" };
      }
      return {
        kind: "requires_action",
        eventIds: idleEvent.stop_reason.event_ids,
      };
    case "retries_exhausted":
      return { kind: "failed" };
    default:
      return { kind: "retry" };
  }
}
