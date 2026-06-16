import { describe, expect, it } from "vitest"
import { extractLocalPathCandidates, isBroadLocalArtifactPath, normalizeLocalPathCandidate } from "./artifacts.ts"

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

  it("extracts plain Windows paths without spaces", () => {
    expect(extractLocalPathCandidates("Result: C:\\Users\\wushuang\\Desktop\\out.png, done")).toEqual([
      "C:\\Users\\wushuang\\Desktop\\out.png",
    ])
  })

  it("extracts plain Windows paths with spaces", () => {
    expect(extractLocalPathCandidates("Result: C:\\Program Files\\Lumo\\out file.png is ready")).toEqual([
      "C:\\Program Files\\Lumo\\out file.png",
    ])
  })

  it("rejects bare roots and slash-like prose fragments", () => {
    expect(extractLocalPathCandidates("Use `/` as the separator")).toEqual([])
    expect(extractLocalPathCandidates("Use ` / ` as the separator")).toEqual([])
    expect(extractLocalPathCandidates("Check CI/CD status")).toEqual([])
  })

  it("keeps adjacent Chinese prose paths", () => {
    expect(extractLocalPathCandidates("结果保存到/Users/wushuang/Desktop/out.png")).toEqual([
      "/Users/wushuang/Desktop/out.png",
    ])
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

  it("rejects filesystem roots", () => {
    expect(normalizeLocalPathCandidate("/", "/Users/wushuang")).toBeNull()
    expect(normalizeLocalPathCandidate("~", "/Users/wushuang")).toBeNull()
    expect(normalizeLocalPathCandidate("~/", "/Users/wushuang")).toBeNull()
    expect(normalizeLocalPathCandidate("file:///", "/Users/wushuang")).toBeNull()
    expect(normalizeLocalPathCandidate("C:\\", "/Users/wushuang")).toBeNull()
  })
})

describe("isBroadLocalArtifactPath", () => {
  it("rejects system-level directories and the home directory", () => {
    expect(isBroadLocalArtifactPath("/", "/Users/wushuang")).toBe(true)
    expect(isBroadLocalArtifactPath("/Applications", "/Users/wushuang")).toBe(true)
    expect(isBroadLocalArtifactPath("/Users/wushuang", "/Users/wushuang")).toBe(true)
  })

  it("compares the Windows home directory case-insensitively", () => {
    expect(isBroadLocalArtifactPath("C:\\Users\\Alice", "c:\\users\\alice")).toBe(true)
  })

  it("allows specific output descendants", () => {
    expect(isBroadLocalArtifactPath("/Users/wushuang/Desktop/out.png", "/Users/wushuang")).toBe(false)
    expect(isBroadLocalArtifactPath("/tmp/lumo-artifacts/out.png", "/Users/wushuang")).toBe(false)
  })
})
