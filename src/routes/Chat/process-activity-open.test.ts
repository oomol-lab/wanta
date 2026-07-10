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
        hasFinalAnswer: true,
        preference: "auto",
        status: "completed",
      }),
    ).toBe(false)
  })

  it("keeps a completed process open after the user explicitly opened it", () => {
    expect(
      processOpenAfterStatusChange({
        hasFinalAnswer: true,
        preference: "user_open",
        status: "completed",
      }),
    ).toBe(true)
  })

  it("keeps an active process closed after the user explicitly closed it", () => {
    expect(
      processOpenAfterStatusChange({
        hasFinalAnswer: false,
        preference: "user_closed",
        status: "running",
      }),
    ).toBe(false)
  })

  it("opens states that require attention even after a manual collapse", () => {
    expect(processRequiresAttention("needsAction", true)).toBe(true)
    expect(processRequiresAttention("error", false)).toBe(true)
    expect(
      processOpenAfterStatusChange({
        hasFinalAnswer: true,
        preference: "user_closed",
        status: "needsAction",
      }),
    ).toBe(true)
  })

  it("keeps terminal turns without a final answer visible", () => {
    expect(processShouldOpenAutomatically("completed", false)).toBe(true)
    expect(processShouldOpenAutomatically("stopped", false)).toBe(true)
  })

  it("collapses errors with a final answer when the user has not overridden the state", () => {
    expect(processRequiresAttention("error", true)).toBe(false)
    expect(processShouldOpenAutomatically("error", true)).toBe(false)
  })
})
