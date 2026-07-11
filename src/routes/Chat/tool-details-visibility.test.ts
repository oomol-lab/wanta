import { describe, expect, it } from "vitest"
import { shouldHideToolDetailsImmediately } from "./tool-details-visibility.ts"

describe("shouldHideToolDetailsImmediately", () => {
  it("hides closed details immediately when reduced motion disables animation", () => {
    expect(shouldHideToolDetailsImmediately(false, true)).toBe(true)
    expect(shouldHideToolDetailsImmediately(false, false)).toBe(false)
    expect(shouldHideToolDetailsImmediately(true, true)).toBe(false)
  })
})
