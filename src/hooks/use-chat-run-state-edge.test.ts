// @vitest-environment happy-dom
import type { ChatActiveRun } from "../../electron/chat/common.ts"
import type { ChatRunState } from "./use-chat-run-state.ts"

import * as React from "react"
import { createRoot } from "react-dom/client"
import { describe, expect, it } from "vitest"
import { reduceChatRunSessions, useChatRunState } from "./use-chat-run-state.ts"

// Adversarial edge tests for the renderer run/activity state:
// 1) pure reducer transitions (phase walk, isolation, identity), and
// 2) hook-level cleared-run tombstones and echo-event interleavings, rendered
//    through a real React root so useReducer/useRef semantics are the real ones.

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function run(overrides: Partial<ChatActiveRun> = {}): ChatActiveRun {
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

describe("reduceChatRunSessions: phase walk and interleaved activity", () => {
  it("walks sending -> submitted -> thinking -> answering with the right status/activity", () => {
    let state = reduceChatRunSessions({}, { run: run({ phase: "sending" }), sessionId: "session-1", type: "apply_run" })
    expect(state["session-1"]).toEqual({
      activity: { phase: "thinking", sessionId: "session-1" },
      startedAt: 1_000,
      status: "submitted",
    })

    state = reduceChatRunSessions(state, {
      run: run({ phase: "submitted" }),
      sessionId: "session-1",
      type: "apply_run",
    })
    expect(state["session-1"]?.status).toBe("submitted")
    expect(state["session-1"]?.activity).toBeDefined()

    state = reduceChatRunSessions(state, { run: run({ phase: "thinking" }), sessionId: "session-1", type: "apply_run" })
    expect(state["session-1"]?.status).toBe("streaming")
    expect(state["session-1"]?.activity).toEqual({ phase: "thinking", sessionId: "session-1" })

    // Interleaved echo: a visible delta clears the indicator mid-run.
    state = reduceChatRunSessions(state, { activity: undefined, sessionId: "session-1", type: "set_activity" })
    expect(state["session-1"]?.activity).toBeUndefined()
    expect(state["session-1"]?.status).toBe("streaming")

    // A run snapshot re-apply restores the indicator (echo-kill recovery path).
    state = reduceChatRunSessions(state, { run: run({ phase: "thinking" }), sessionId: "session-1", type: "apply_run" })
    expect(state["session-1"]?.activity).toEqual({ phase: "thinking", sessionId: "session-1" })

    state = reduceChatRunSessions(state, {
      run: run({ phase: "answering" }),
      sessionId: "session-1",
      type: "apply_run",
    })
    expect(state["session-1"]?.status).toBe("streaming")
    // Answering means visible output; the synthetic thinking indicator must drop.
    expect(state["session-1"]?.activity).toBeUndefined()

    state = reduceChatRunSessions(state, { run: null, sessionId: "session-1", type: "apply_run" })
    expect(state).toEqual({})
  })

  it("awaiting_permission maps to streaming without a synthetic thinking activity", () => {
    const state = reduceChatRunSessions(
      {},
      { run: run({ phase: "awaiting_permission" }), sessionId: "session-1", type: "apply_run" },
    )
    expect(state["session-1"]).toEqual({ startedAt: 1_000, status: "streaming" })
  })

  it("carries activeAssistantMessageId into the synthesized activity", () => {
    const state = reduceChatRunSessions(
      {},
      { run: run({ activeAssistantMessageId: "msg-9" }), sessionId: "session-1", type: "apply_run" },
    )
    expect(state["session-1"]?.activity).toEqual({ messageId: "msg-9", phase: "thinking", sessionId: "session-1" })
  })
})

describe("reduceChatRunSessions: session isolation and identity", () => {
  it("ending a run for one session never touches another session's activity", () => {
    let state = reduceChatRunSessions({}, { run: run(), sessionId: "session-1", type: "apply_run" })
    state = reduceChatRunSessions(state, {
      activity: { phase: "compacting", sessionId: "session-2" },
      sessionId: "session-2",
      type: "set_activity",
    })
    const before = state["session-1"]
    state = reduceChatRunSessions(state, { run: null, sessionId: "session-2", type: "apply_run" })
    // session-1 view must be untouched (same object), session-2 gone.
    expect(state["session-1"]).toBe(before)
    expect(state["session-2"]?.activity).toBeUndefined()
  })

  it("apply_run(null) for a never-seen session returns the identical state object", () => {
    const state = reduceChatRunSessions({}, { run: run(), sessionId: "session-1", type: "apply_run" })
    expect(reduceChatRunSessions(state, { run: null, sessionId: "ghost", type: "apply_run" })).toBe(state)
  })

  it("re-applying an identical run returns the identical state object", () => {
    const state = reduceChatRunSessions({}, { run: run(), sessionId: "session-1", type: "apply_run" })
    expect(reduceChatRunSessions(state, { run: run(), sessionId: "session-1", type: "apply_run" })).toBe(state)
  })

  it("set_activity with an equal activity returns the identical state object", () => {
    const state = reduceChatRunSessions({}, { run: run(), sessionId: "session-1", type: "apply_run" })
    expect(
      reduceChatRunSessions(state, {
        activity: { phase: "thinking", sessionId: "session-1" },
        sessionId: "session-1",
        type: "set_activity",
      }),
    ).toBe(state)
    // Clearing an already-absent activity on an unknown session is identity too.
    expect(reduceChatRunSessions(state, { activity: undefined, sessionId: "ghost", type: "set_activity" })).toBe(state)
  })

  it("run end clears activity/startedAt but preserves a sticky error status", () => {
    let state = reduceChatRunSessions({}, { run: run(), sessionId: "session-1", type: "apply_run" })
    state = reduceChatRunSessions(state, { sessionId: "session-1", status: "error", type: "set_status" })
    state = reduceChatRunSessions(state, { run: null, sessionId: "session-1", type: "apply_run" })
    expect(state["session-1"]).toEqual({ status: "error" })
  })
})

// ---------------------------------------------------------------------------
// Hook-level tests: cleared-run tombstones live in a ref inside the hook, so
// they need a real render.
// ---------------------------------------------------------------------------

function renderRunState() {
  const container = document.createElement("div")
  const root = createRoot(container)
  let latest: ChatRunState | undefined
  function Probe(): null {
    latest = useChatRunState()
    return null
  }
  React.act(() => {
    root.render(React.createElement(Probe))
  })
  return {
    get state(): ChatRunState {
      if (!latest) throw new Error("hook state not captured")
      return latest
    },
    act: (op: (state: ChatRunState) => void): void => {
      React.act(() => op(latest as ChatRunState))
    },
    unmount: (): void => {
      React.act(() => root.unmount())
    },
  }
}

describe("useChatRunState: cleared-run tombstones", () => {
  it("a run update arriving after its run was cleared stays cleared", () => {
    const harness = renderRunState()
    try {
      // End-of-run event first (out-of-order delivery), stale run replay second.
      harness.act((s) => s.applyActiveRun("session-1", null, "run-1"))
      harness.act((s) => s.applyActiveRun("session-1", run({ runId: "run-1" })))
      expect(harness.state.statuses).toEqual({})
      expect(harness.state.activities).toEqual({})
      expect(harness.state.getSessionStatus("session-1")).toBe("ready")
      expect(harness.state.getSessionRunStartedAt("session-1")).toBeNull()
    } finally {
      harness.unmount()
    }
  })

  it("a stale snapshot replay of an ended run stays cleared", () => {
    const harness = renderRunState()
    try {
      harness.act((s) => s.applyActiveRun("session-1", run({ runId: "run-1" })))
      expect(harness.state.getSessionStatus("session-1")).toBe("streaming")
      harness.act((s) => s.applyActiveRun("session-1", null, "run-1"))
      // A snapshot fetched before the run ended resolves late and replays it.
      harness.act((s) => s.applyActiveRun("session-1", run({ runId: "run-1" })))
      expect(harness.state.statuses).toEqual({})
      expect(harness.state.activities).toEqual({})
    } finally {
      harness.unmount()
    }
  })

  it("ending session B's run does not disturb session A's live run", () => {
    const harness = renderRunState()
    try {
      harness.act((s) => s.applyActiveRun("session-a", run({ runId: "run-a", sessionId: "session-a" })))
      harness.act((s) => s.applyActiveRun("session-b", run({ runId: "run-b", sessionId: "session-b" })))
      harness.act((s) => s.applyActiveRun("session-b", null, "run-b"))
      expect(harness.state.getSessionStatus("session-a")).toBe("streaming")
      expect(harness.state.activities["session-a"]).toEqual({ phase: "thinking", sessionId: "session-a" })
      expect(harness.state.getSessionStatus("session-b")).toBe("ready")
      // The tombstone protects run-b but must not block run-a updates.
      harness.act((s) => s.applyActiveRun("session-a", run({ runId: "run-a", sessionId: "session-a", updatedAt: 2 })))
      expect(harness.state.getSessionStatus("session-a")).toBe("streaming")
    } finally {
      harness.unmount()
    }
  })

  it("a run keyed by the event sessionId still lands on the run's own sessionId", () => {
    const harness = renderRunState()
    try {
      // Defensive: the dispatch must use run.sessionId, not the event's field.
      harness.act((s) => s.applyActiveRun("session-envelope", run({ sessionId: "session-real" })))
      expect(harness.state.getSessionStatus("session-real")).toBe("streaming")
      expect(harness.state.getSessionStatus("session-envelope")).toBe("ready")
    } finally {
      harness.unmount()
    }
  })

  it("an activity echo delivered after the run ended must not resurrect the indicator", () => {
    const harness = renderRunState()
    try {
      harness.act((s) => s.applyActiveRun("session-1", run({ runId: "run-1" })))
      expect(harness.state.activities["session-1"]).toBeDefined()
      harness.act((s) => s.applyActiveRun("session-1", null, "run-1"))
      expect(harness.state.activities["session-1"]).toBeUndefined()
      // Buffered/echoed thinking event flushes after the run-ended event: the
      // run is over, so no indicator may come back for it.
      harness.act((s) => s.setActivity("session-1", { phase: "thinking", sessionId: "session-1" }))
      expect(harness.state.activities["session-1"]).toBeUndefined()
    } finally {
      harness.unmount()
    }
  })
})
