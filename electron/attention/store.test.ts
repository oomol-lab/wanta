import { describe, expect, it } from "vitest"
import { normalizeAttentionState } from "./store.ts"

describe("attention state normalization", () => {
  it("keeps only valid unread session entries", () => {
    const entries = normalizeAttentionState({
      unreadSessions: {
        empty: { createdAt: 2, runId: "" },
        invalid: { createdAt: 0, runId: "run-2" },
        legacy: { createdAt: 1, runId: "run-1" },
        valid: { createdAt: 2, organizationId: " org-1 ", runId: "run-2" },
      },
      version: 1,
    })
    expect([...entries]).toEqual([
      ["legacy", { createdAt: 1, runId: "run-1" }],
      ["valid", { createdAt: 2, organizationId: "org-1", runId: "run-2" }],
    ])
  })
})
