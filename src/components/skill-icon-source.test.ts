import assert from "node:assert/strict"
import { describe, it } from "vitest"
import { normalizeSkillIconSource } from "@/components/skill-icon-source.ts"

describe("normalizeSkillIconSource", () => {
  it("preserves regular image URLs", () => {
    assert.equal(
      normalizeSkillIconSource("https://package-assets.oomol.com/packages/demo/1.0.0/files/package/icon.png"),
      "https://package-assets.oomol.com/packages/demo/1.0.0/files/package/icon.png",
    )
  })

  it("extracts icon tokens encoded as package asset URLs", () => {
    assert.equal(
      normalizeSkillIconSource(
        "https://package-assets.oomol.com/packages/@alwaysmavs/mineru-document-extraction/0.0.1/files/package/:lucide:file-search",
      ),
      ":lucide:file-search",
    )
  })

  it("extracts percent-encoded icon tokens from package asset URLs", () => {
    assert.equal(
      normalizeSkillIconSource(
        "https://package-assets.oomol.com/packages/demo/1.0.0/files/package/%3Alucide%3Aarchive",
      ),
      ":lucide:archive",
    )
  })

  it("trims empty icon values", () => {
    assert.equal(normalizeSkillIconSource("  "), undefined)
  })
})
