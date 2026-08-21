import { describe, expect, it } from "vitest"
import { semanticVersionIsBefore } from "./semantic-version.ts"

describe("semanticVersionIsBefore", () => {
  it.each([
    [undefined, "1.1.2", true],
    ["1.1.1", "1.1.2", true],
    ["1.1.2-beta.1", "1.1.2", true],
    ["1.1.2", "1.1.2", false],
    ["1.1.3", "1.1.2", false],
    ["1.2.0", "1.1.2", false],
    ["v2.0.0", "1.1.2", false],
  ])("compares %s against minimum %s", (current, minimum, expected) => {
    expect(semanticVersionIsBefore(current, minimum)).toBe(expected)
  })
})
