import { describe, expect, it } from "vitest"
import { hasBlockingToolError, hasStoppedTool, isToolCancellationMessage } from "./tool-state.ts"

describe("isToolCancellationMessage", () => {
  it("recognizes OpenCode cancellation messages", () => {
    expect(isToolCancellationMessage("Task cancelled")).toBe(true)
    expect(isToolCancellationMessage("Task canceled.")).toBe(true)
  })

  it("does not treat ordinary tool failures as user cancellation", () => {
    expect(isToolCancellationMessage("Task failed")).toBe(false)
    expect(isToolCancellationMessage("command cancelled by remote service")).toBe(false)
    expect(isToolCancellationMessage(undefined)).toBe(false)
  })

  it("separates user stops from blocking tool errors", () => {
    const stopped = { kind: "tool" as const, partId: "a", status: "error" as const, error: "Task cancelled" }
    const failed = { kind: "tool" as const, partId: "b", status: "error" as const, error: "Permission denied" }

    expect(hasStoppedTool([stopped])).toBe(true)
    expect(hasBlockingToolError([stopped])).toBe(false)
    expect(hasBlockingToolError([stopped, failed])).toBe(true)
  })
})
