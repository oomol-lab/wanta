import { describe, expect, test } from "vitest"
import { ToolStartDiagnostics } from "./tool-start-diagnostics.ts"

describe("ToolStartDiagnostics", () => {
  test("deduplicates one call across repeated and interleaved progress updates", () => {
    const diagnostics = new ToolStartDiagnostics()
    diagnostics.begin("session-1", "generation-1")

    expect(diagnostics.first("session-1", "generation-1", "call-a")).toBe(true)
    expect(diagnostics.first("session-1", "generation-1", "call-b")).toBe(true)
    expect(diagnostics.first("session-1", "generation-1", "call-a")).toBe(false)
    expect(diagnostics.first("session-1", "generation-1", "call-b")).toBe(false)
  })

  test("allows reused call ids only after the generation changes", () => {
    const diagnostics = new ToolStartDiagnostics()
    diagnostics.begin("session-1", "generation-1")
    expect(diagnostics.first("session-1", "generation-1", "call-a")).toBe(true)
    expect(diagnostics.first("session-1", "generation-1", "call-a")).toBe(false)

    diagnostics.begin("session-1", "generation-2")
    expect(diagnostics.first("session-1", "generation-2", "call-a")).toBe(true)
  })

  test("does not clear a newer generation through stale cleanup", () => {
    const diagnostics = new ToolStartDiagnostics()
    diagnostics.begin("session-1", "generation-2")
    diagnostics.clear("session-1", "generation-1")

    expect(diagnostics.first("session-1", "generation-2", "call-a")).toBe(true)
    expect(diagnostics.first("session-1", "generation-2", "call-a")).toBe(false)
  })

  test("rejects a stale event without replacing the active generation", () => {
    const diagnostics = new ToolStartDiagnostics()
    diagnostics.begin("session-1", "generation-2")
    expect(diagnostics.first("session-1", "generation-2", "call-a")).toBe(true)

    expect(diagnostics.first("session-1", "generation-1", "stale-call")).toBe(false)
    expect(diagnostics.first("session-1", "generation-2", "call-a")).toBe(false)
    expect(diagnostics.first("session-1", "generation-2", "call-b")).toBe(true)
  })
})
