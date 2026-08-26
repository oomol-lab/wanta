import type { ChatTurnProcess } from "./chat-turns.ts"

import { describe, expect, it } from "vitest"
import { terminalTurnOutcomeStatus } from "./turn-outcome-receipt-model.ts"

function process(overrides: Partial<ChatTurnProcess> = {}): ChatTurnProcess {
  return {
    activity: null,
    authorizationIssues: [],
    errors: [],
    hasActiveTool: false,
    hasAuthorization: false,
    hasBlockingError: false,
    hasStoppedTool: false,
    hasSuccessfulConnectorCall: false,
    hasToolError: false,
    hasVisibleOutcome: false,
    tools: [{ kind: "tool", partId: "tool-1", callId: "call-1", tool: "bash", status: "completed", input: {} }],
    ...overrides,
  }
}

describe("terminalTurnOutcomeStatus", () => {
  it("reports successful tool-only completion", () => {
    expect(terminalTurnOutcomeStatus(process(), false)).toBe("completed")
  })

  it("does not promote historical tool failures into a turn-level warning", () => {
    expect(terminalTurnOutcomeStatus(process({ hasToolError: true }), false)).toBe("completed")
  })

  it("does not duplicate a visible answer or report an active turn", () => {
    expect(terminalTurnOutcomeStatus(process({ hasVisibleOutcome: true }), false)).toBeNull()
    expect(terminalTurnOutcomeStatus(process(), true)).toBeNull()
  })

  it("does not invent a receipt without process evidence", () => {
    expect(terminalTurnOutcomeStatus(process({ tools: [] }), false)).toBeNull()
  })
})
