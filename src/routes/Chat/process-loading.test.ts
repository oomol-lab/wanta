import { describe, expect, it } from "vitest"
import { shouldShowBottomWorkingIndicator } from "./process-loading.ts"

describe("shouldShowBottomWorkingIndicator", () => {
  it("shows the bottom working indicator while generation is active", () => {
    expect(shouldShowBottomWorkingIndicator({ isGenerating: true })).toBe(true)
  })

  it("hides the bottom working indicator after generation finishes", () => {
    expect(shouldShowBottomWorkingIndicator({ isGenerating: false })).toBe(false)
  })
})
