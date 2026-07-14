import { describe, expect, it } from "vitest"
import { normalizeAttentionState } from "./store.ts"

describe("attention state normalization", () => {
  it("keeps only valid unread session entries", () => {
    const entries = normalizeAttentionState({
      unreadSessions: {
        empty: { createdAt: 2, runId: "" },
        invalid: { createdAt: 0, runId: "run-2" },
        valid: { createdAt: 1, runId: "run-1" },
      },
      version: 1,
    })
    expect([...entries]).toEqual([["valid", { createdAt: 1, runId: "run-1" }]])
  })
})
