import { describe, expect, it } from "vitest"
import { wikiGraphCoverageReady } from "./runner.ts"

describe("wikiGraphCoverageReady", () => {
  it("requires non-zero covered and total words", () => {
    expect(wikiGraphCoverageReady({ coveredWords: 12, totalWords: 20 })).toBe(true)
    expect(wikiGraphCoverageReady({ coveredWords: 0, totalWords: 20 })).toBe(false)
    expect(wikiGraphCoverageReady(undefined)).toBe(false)
  })
})
