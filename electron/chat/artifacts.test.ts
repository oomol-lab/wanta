import { describe, expect, it } from "vitest"
import { extractLocalPathCandidates, normalizeLocalPathCandidate } from "./artifacts.ts"

describe("extractLocalPathCandidates", () => {
  it("extracts inline-code and plain macOS paths", () => {
    expect(
      extractLocalPathCandidates(
        "保存到 `/Users/wushuang/Desktop/2606_images/`，也可以打开 /Users/wushuang/Desktop/page_001.png 查看。",
      ),
    ).toEqual(["/Users/wushuang/Desktop/2606_images/", "/Users/wushuang/Desktop/page_001.png"])
  })

  it("extracts file URLs and home-relative paths", () => {
    expect(
      extractLocalPathCandidates("结果在 file:///Users/wushuang/Desktop/out.png，源文件在 ~/Desktop/source.pdf"),
    ).toEqual(["file:///Users/wushuang/Desktop/out.png", "~/Desktop/source.pdf"])
  })
})

describe("normalizeLocalPathCandidate", () => {
  it("normalizes file URLs and home-relative paths", () => {
    expect(normalizeLocalPathCandidate("file:///Users/wushuang/Desktop/out.png", "/Users/wushuang")).toBe(
      "/Users/wushuang/Desktop/out.png",
    )
    expect(normalizeLocalPathCandidate("~/Desktop/out.png", "/Users/wushuang")).toBe("/Users/wushuang/Desktop/out.png")
  })

  it("rejects non-local paths", () => {
    expect(normalizeLocalPathCandidate("https://example.com/file.png", "/Users/wushuang")).toBeNull()
    expect(normalizeLocalPathCandidate("relative/file.png", "/Users/wushuang")).toBeNull()
  })
})
