import { describe, expect, it } from "vitest"
import { normalizeAttentionState } from "./store.ts"

describe("attention state normalization", () => {
  it("keeps only valid unread session entries", () => {
    const entries = normalizeAttentionState({
      unreadSessions: {
        empty: { createdAt: 2, runId: "" },
        invalid: { createdAt: 0, runId: "run-2" },
        legacy: { createdAt: 1, runId: "run-1" },
        legacyTeam: { createdAt: 3, organizationId: " team-legacy ", runId: "run-3" },
        valid: { createdAt: 2, teamId: " team-1 ", runId: "run-2" },
      },
      version: 1,
    })
    expect([...entries]).toEqual([
      ["legacy", { createdAt: 1, runId: "run-1" }],
      ["legacyTeam", { createdAt: 3, teamId: "team-legacy", runId: "run-3" }],
      ["valid", { createdAt: 2, teamId: "team-1", runId: "run-2" }],
    ])
  })
})
