import { describe, expect, it } from "vitest"
import { isWikiGraphFileName, wikiGraphDropCandidates } from "./knowledge-route-model.ts"

describe("knowledge route model", () => {
  it("recognizes WikiGraph archives case-insensitively", () => {
    expect(isWikiGraphFileName("西游记.wikg")).toBe(true)
    expect(isWikiGraphFileName("Knowledge.WIKG")).toBe(true)
    expect(isWikiGraphFileName("Knowledge.wkig")).toBe(false)
  })

  it("keeps only supported files from a drop", () => {
    expect(
      wikiGraphDropCandidates([{ name: "one.wikg" }, { name: "notes.txt" }, { name: "two.WIKG" }]).map(
        (file) => file.name,
      ),
    ).toEqual(["one.wikg", "two.WIKG"])
  })
})
