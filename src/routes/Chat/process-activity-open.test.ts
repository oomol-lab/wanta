import { describe, expect, it } from "vitest"
import {
  processOpenAfterStatusChange,
  processRequiresAttention,
  processShouldOpenAutomatically,
} from "./process-activity-open.ts"

describe("process activity open state", () => {
  it("opens an active process and auto-collapses after a normal final answer", () => {
    expect(processShouldOpenAutomatically("running", false)).toBe(true)
    expect(
      processOpenAfterStatusChange({
        hasVisibleOutcome: true,
        preference: "auto",
        status: "completed",
      }),
    ).toBe(false)
  })

  it("keeps a completed process open after the user explicitly opened it", () => {
    expect(
      processOpenAfterStatusChange({
        hasVisibleOutcome: true,
        preference: "user_open",
        status: "completed",
      }),
    ).toBe(true)
  })

  it("keeps an active process closed after the user explicitly closed it", () => {
    expect(
      processOpenAfterStatusChange({
        hasVisibleOutcome: false,
        preference: "user_closed",
        status: "running",
      }),
    ).toBe(false)
  })

  it("opens states that require attention even after a manual collapse", () => {
    expect(processRequiresAttention("needsAction")).toBe(true)
    expect(processRequiresAttention("error")).toBe(true)
    expect(
      processOpenAfterStatusChange({
        hasVisibleOutcome: true,
        preference: "user_closed",
        status: "needsAction",
      }),
    ).toBe(true)
  })

  it("keeps terminal turns without a visible outcome open", () => {
    expect(processShouldOpenAutomatically("completed", false)).toBe(true)
    expect(processShouldOpenAutomatically("completedWithIssues", false)).toBe(true)
    expect(processShouldOpenAutomatically("stopped", false)).toBe(true)
  })

  it("collapses completed work with non-blocking issues when a visible outcome exists", () => {
    expect(processRequiresAttention("completedWithIssues")).toBe(false)
    expect(processShouldOpenAutomatically("completedWithIssues", true)).toBe(false)
  })
})
