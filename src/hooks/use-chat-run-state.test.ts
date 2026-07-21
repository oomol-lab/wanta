import type { ChatActiveRun } from "../../electron/chat/common.ts"

import { describe, expect, it } from "vitest"
import { reduceChatRunSessions } from "./use-chat-run-state.ts"

function activeRun(overrides: Partial<ChatActiveRun> = {}): ChatActiveRun {
  return {
    activeToolPartIds: [],
    blockingRequestIds: [],
    generationId: "generation-1",
    runId: "run-1",
    sessionId: "session-1",
    startedAt: 1_000,
    phase: "thinking",
    updatedAt: 1_000,
    workspace: { kind: "team", teamId: "team-1", teamName: "team" },
    ...overrides,
  }
}

describe("reduceChatRunSessions", () => {
  it("keeps status, activity, and start time in one per-session state", () => {
    const state = reduceChatRunSessions({}, { run: activeRun(), sessionId: "session-1", type: "apply_run" })

    expect(state).toEqual({
      "session-1": {
        activity: { phase: "thinking", sessionId: "session-1" },
        startedAt: 1_000,
        status: "streaming",
      },
    })
  })

  it("removes completed ready sessions instead of retaining default state", () => {
    const running = reduceChatRunSessions(
      {},
      {
        run: activeRun({ phase: "submitted" }),
        sessionId: "session-1",
        type: "apply_run",
      },
    )

    expect(reduceChatRunSessions(running, { run: null, sessionId: "session-1", type: "apply_run" })).toEqual({})
  })

  it("retains failures until the caller explicitly clears them", () => {
    const failed = reduceChatRunSessions(
      {},
      {
        sessionId: "session-1",
        status: "error",
        type: "set_status",
      },
    )

    expect(failed["session-1"]?.status).toBe("error")
    expect(reduceChatRunSessions(failed, { sessionId: "session-1", type: "forget_session" })).toEqual({})
  })
})
