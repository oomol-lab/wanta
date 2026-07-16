import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { mimeFromFile, mimeFromPath, normalizeLocalPathCandidate } from "./artifacts.ts"

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
    expect(mimeFromPath("/tmp/slides.ppt")).toBe("application/vnd.ms-powerpoint")
    expect(mimeFromPath("/tmp/slides.pptx")).toBe(
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    )
    expect(mimeFromPath("/tmp/archive.gz")).toBe("application/gzip")
    expect(mimeFromPath("/tmp/archive.tar")).toBe("application/x-tar")
    expect(mimeFromPath("/tmp/archive.tgz")).toBe("application/gzip")
  })

  it("recognizes structured and common plain-text data files", () => {
    expect(mimeFromPath("/tmp/data.tsv")).toBe("text/tab-separated-values")
    expect(mimeFromPath("/tmp/events.jsonl")).toBe("application/x-ndjson")
    expect(mimeFromPath("/tmp/config.yaml")).toBe("application/yaml")
    expect(mimeFromPath("/tmp/config.yml")).toBe("application/yaml")
    expect(mimeFromPath("/tmp/config.toml")).toBe("application/toml")
    expect(mimeFromPath("/tmp/document.xml")).toBe("application/xml")
    expect(mimeFromPath("/tmp/query.sql")).toBe("text/plain")
    expect(mimeFromPath("/tmp/application.log")).toBe("text/plain")
  })
})

describe("mimeFromFile", () => {
  it("recognizes extensionless UTF-8 text without treating binary data as text", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "wanta-mime-sniff-"))
    try {
      const textPath = path.join(directory, "LICENSE")
      const binaryPath = path.join(directory, "unknown")
      await writeFile(textPath, "plain UTF-8 text\n第二行\n")
      await writeFile(binaryPath, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff]))

      expect(await mimeFromFile(textPath)).toBe("text/plain")
      expect(await mimeFromFile(binaryPath)).toBe("application/octet-stream")
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
