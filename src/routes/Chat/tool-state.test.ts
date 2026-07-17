import { describe, expect, it } from "vitest"
import { hasBlockingToolError, hasStoppedTool, isToolCancellationMessage } from "./tool-state.ts"

describe("isToolCancellationMessage", () => {
  it("recognizes OpenCode cancellation messages", () => {
    expect(isToolCancellationMessage("Task cancelled")).toBe(true)
    expect(isToolCancellationMessage("Task canceled.")).toBe(true)
    expect(isToolCancellationMessage("Aborted")).toBe(true)
    expect(isToolCancellationMessage("AbortError: The operation was aborted.")).toBe(true)
    expect(isToolCancellationMessage("The user dismissed this question")).toBe(true)
  })

  it("does not treat ordinary tool failures as user cancellation", () => {
    expect(isToolCancellationMessage("Task failed")).toBe(false)
    expect(isToolCancellationMessage("command cancelled by remote service")).toBe(false)
    expect(isToolCancellationMessage(undefined)).toBe(false)
  })

  it("separates user stops from blocking tool errors", () => {
    const stopped = { kind: "tool" as const, partId: "a", status: "error" as const, error: "Task cancelled" }
    const explicitlyCancelled = { kind: "tool" as const, partId: "c", status: "error" as const, cancelled: true }
    const failed = { kind: "tool" as const, partId: "b", status: "error" as const, error: "Permission denied" }

    expect(hasStoppedTool([stopped])).toBe(true)
    expect(hasStoppedTool([explicitlyCancelled])).toBe(true)
    expect(hasBlockingToolError([stopped])).toBe(false)
    expect(hasBlockingToolError([explicitlyCancelled])).toBe(false)
    expect(hasBlockingToolError([stopped, failed])).toBe(true)
  })
})
