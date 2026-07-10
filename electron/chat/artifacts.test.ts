import { describe, expect, it } from "vitest"
import { mimeFromPath, normalizeLocalPathCandidate } from "./artifacts.ts"

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

describe("mimeFromPath", () => {
  it("recognizes common generated audio and video files", () => {
    expect(mimeFromPath("/tmp/result.mp3")).toBe("audio/mpeg")
    expect(mimeFromPath("/tmp/result.wav")).toBe("audio/wav")
    expect(mimeFromPath("/tmp/result.mp4")).toBe("video/mp4")
    expect(mimeFromPath("/tmp/result.mov")).toBe("video/quicktime")
  })

  it("recognizes common document and archive files", () => {
    expect(mimeFromPath("/tmp/report.doc")).toBe("application/msword")
    expect(mimeFromPath("/tmp/report.docx")).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )
    expect(mimeFromPath("/tmp/report.rtf")).toBe("application/rtf")
    expect(mimeFromPath("/tmp/archive.gz")).toBe("application/gzip")
    expect(mimeFromPath("/tmp/archive.tar")).toBe("application/x-tar")
    expect(mimeFromPath("/tmp/archive.tgz")).toBe("application/gzip")
  })
})
