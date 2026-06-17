import { describe, expect, it } from "vitest"
import { normalizeServiceSlug } from "./tool-display.ts"

describe("tool display", () => {
  it("normalizes service slugs before dropping the oo prefix", () => {
    expect(normalizeServiceSlug("OO-gmail")).toBe("gmail")
    expect(normalizeServiceSlug(" oo-slack ")).toBe("slack")
  })
})
