import JSZip from "jszip"
import { describe, expect, it } from "vitest"
import { archiveFormatFromPath, rtfToPlainText, zipPreviewFromBytes } from "./artifact-preview.ts"

describe("archiveFormatFromPath", () => {
  it("recognizes supported archive preview formats", () => {
    expect(archiveFormatFromPath("/tmp/result.zip", "application/octet-stream")).toBe("zip")
    expect(archiveFormatFromPath("/tmp/result.tar", "application/octet-stream")).toBe("tar")
    expect(archiveFormatFromPath("/tmp/result.tgz", "application/octet-stream")).toBe("tar")
    expect(archiveFormatFromPath("/tmp/result.tar.gz", "application/gzip")).toBe("tar")
    expect(archiveFormatFromPath("/tmp/result.gz", "application/gzip")).toBeNull()
    expect(archiveFormatFromPath("/tmp/result.rar", "application/octet-stream")).toBeNull()
  })
})

describe("zipPreviewFromBytes", () => {
  it("enumerates zip entries without service integration", async () => {
    const zip = new JSZip()
    zip.file("report.txt", "hello")
    zip.folder("assets")?.file("image.txt", "image")

    const result = await zipPreviewFromBytes(await zip.generateAsync({ type: "nodebuffer" }), "application/zip", 1)

    expect(result.kind).toBe("archive")
    expect(result.archive?.format).toBe("zip")
    expect(result.archive?.totalEntries).toBe(3)
    expect(result.archive?.entries.map((entry) => [entry.kind, entry.path])).toEqual([
      ["file", "report.txt"],
      ["directory", "assets/"],
      ["file", "assets/image.txt"],
    ])
  })
})

describe("rtfToPlainText", () => {
  it("extracts readable text from common RTF markup", () => {
    const rtf = String.raw`{\rtf1\ansi{\fonttbl{\f0 Arial;}}\b Hello\b0\par Unicode \u20320?\tab hex \'21}`

    expect(rtfToPlainText(rtf)).toBe("Hello\nUnicode 你\thex !")
  })
})
