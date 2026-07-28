import { describe, expect, it } from "vitest"
import { processActivityScrollState } from "./process-activity-scroll.ts"

describe("processActivityScrollState", () => {
  it("treats short content as fully visible", () => {
    expect(processActivityScrollState({ clientHeight: 320, scrollHeight: 240, scrollTop: 0 })).toEqual({
      atBottom: true,
      atTop: true,
      hasOverflow: false,
      remaining: 0,
    })
  })

  it("shows only the bottom edge when an overflowing viewport is at the start", () => {
    expect(processActivityScrollState({ clientHeight: 320, scrollHeight: 800, scrollTop: 0 })).toEqual({
      atBottom: false,
      atTop: true,
      hasOverflow: true,
      remaining: 480,
    })
  })

  it("shows both edges while the viewport is in the middle", () => {
    expect(processActivityScrollState({ clientHeight: 320, scrollHeight: 800, scrollTop: 200 })).toEqual({
      atBottom: false,
      atTop: false,
      hasOverflow: true,
      remaining: 280,
    })
  })

  it("allows for subpixel rounding at the bottom edge", () => {
    expect(processActivityScrollState({ clientHeight: 320, scrollHeight: 800, scrollTop: 479 })).toEqual({
      atBottom: true,
      atTop: false,
      hasOverflow: true,
      remaining: 1,
    })
  })
})
