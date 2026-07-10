import { describe, expect, it } from "vitest";

import { classifyIdleDisposition } from "./anthropic-session";

describe("classifyIdleDisposition", () => {
  it("delivers only a completed end_turn", () => {
    expect(classifyIdleDisposition("idle", {
      type: "session.status_idle",
      stop_reason: { type: "end_turn" },
    })).toEqual({ kind: "deliver" });
  });

  it("keeps requires_action sessions pending", () => {
    expect(classifyIdleDisposition("idle", {
      type: "session.status_idle",
      stop_reason: { type: "requires_action", event_ids: ["evt_1", "evt_2"] },
    })).toEqual({ kind: "requires_action", eventIds: ["evt_1", "evt_2"] });
  });

  it("marks retries_exhausted as failed", () => {
    expect(classifyIdleDisposition("idle", {
      type: "session.status_idle",
      stop_reason: { type: "retries_exhausted" },
    })).toEqual({ kind: "failed" });
  });

  it.each(["running", "rescheduling"])("ignores a stale webhook when status is %s", (status) => {
    expect(classifyIdleDisposition(status, null)).toEqual({ kind: "stale" });
  });

  it("fails closed when the stop reason is unavailable", () => {
    expect(classifyIdleDisposition("idle", null)).toEqual({ kind: "retry" });
  });

  it("fails closed when requires_action has no usable event ids", () => {
    expect(classifyIdleDisposition("idle", {
      type: "session.status_idle",
      stop_reason: { type: "requires_action", event_ids: [] },
    })).toEqual({ kind: "retry" });
  });
});
