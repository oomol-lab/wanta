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
    ["9007199254740992.0.0", "9007199254740993.0.0", true],
    ["9007199254740993.0.0", "9007199254740992.0.0", false],
    ["1.0.0-alpha.2", "1.0.0-alpha.10", true],
    ["1.0.0-alpha.9007199254740992", "1.0.0-alpha.9007199254740993", true],
    ["1.0.0-1", "1.0.0-alpha", true],
    ["1.0.0-alpha", "1.0.0-1", false],
    ["1.0.0-Alpha", "1.0.0-alpha", true],
    ["1.0.0-alpha", "1.0.0-alpha.1", true],
    ["1.0.0-alpha.1", "1.0.0-alpha", false],
    ["1.1.2+build.99", "1.1.2+build.1", false],
  ])("compares %s against minimum %s", (current, minimum, expected) => {
    expect(semanticVersionIsBefore(current, minimum)).toBe(expected)
  })
})
