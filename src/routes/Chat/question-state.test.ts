import { describe, expect, it } from "vitest"
import { questionPromptBusy, shouldStopBeforeDiscardingQuestion } from "./question-state.ts"

describe("question-state", () => {
  it("keeps stopped question prompts interactive while the session is running", () => {
    expect(questionPromptBusy("stopped", "submitted")).toBe(false)
    expect(questionPromptBusy("stopped", "streaming")).toBe(false)
  })

  it("blocks active question prompts only during initial submit", () => {
    expect(questionPromptBusy("active", "submitted")).toBe(true)
    expect(questionPromptBusy("active", "streaming")).toBe(false)
    expect(questionPromptBusy("active", "ready")).toBe(false)
  })

  it("stops the running session before discarding a stopped question", () => {
    expect(shouldStopBeforeDiscardingQuestion("stopped", true)).toBe(true)
    expect(shouldStopBeforeDiscardingQuestion("stopped", false)).toBe(false)
    expect(shouldStopBeforeDiscardingQuestion("active", true)).toBe(false)
  })
})
