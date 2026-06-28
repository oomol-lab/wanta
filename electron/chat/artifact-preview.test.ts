import { describe, expect, it } from "vitest"
import { archiveFormatFromPath, rtfToPlainText } from "./artifact-preview.ts"

describe("archiveFormatFromPath", () => {
  it("recognizes supported archive preview formats", () => {
    expect(archiveFormatFromPath("/tmp/result.zip", "application/octet-stream")).toBe("zip")
    expect(archiveFormatFromPath("/tmp/result.tar", "application/octet-stream")).toBe("tar")
    expect(archiveFormatFromPath("/tmp/result.tgz", "application/octet-stream")).toBe("tar")
    expect(archiveFormatFromPath("/tmp/result.rar", "application/octet-stream")).toBeNull()
  })
})

describe("rtfToPlainText", () => {
  it("extracts readable text from common RTF markup", () => {
    const rtf = String.raw`{\rtf1\ansi{\fonttbl{\f0 Arial;}}\b Hello\b0\par Unicode \u20320?\tab hex \'21}`

    expect(rtfToPlainText(rtf)).toBe("Hello\nUnicode 你\thex !")
  })
})
