import { describe, expect, it } from "vitest"
import { localFilePathFromMessageLink } from "./message-link-target.ts"

describe("localFilePathFromMessageLink", () => {
  it("recognizes and safely decodes POSIX paths", () => {
    expect(localFilePathFromMessageLink("/Users/me/Application%20Support/report.html")).toBe(
      "/Users/me/Application Support/report.html",
    )
  })

  it("recognizes file URLs and Windows paths", () => {
    expect(localFilePathFromMessageLink("file:///Users/me/report%20final.html")).toBe("/Users/me/report final.html")
    expect(localFilePathFromMessageLink("file:///C:/Users/me/report.html")).toBe("C:/Users/me/report.html")
    expect(localFilePathFromMessageLink("C:\\Users\\me\\report.html")).toBe("C:\\Users\\me\\report.html")
  })

  it("does not decode escaped path separators", () => {
    expect(localFilePathFromMessageLink("/tmp/report%2Farchive/file.html")).toBe("/tmp/report%2Farchive/file.html")
    expect(localFilePathFromMessageLink("C:\\tmp\\report%5Carchive.html")).toBe("C:\\tmp\\report%5Carchive.html")
  })

  it("does not classify external or home-relative URLs as local files", () => {
    expect(localFilePathFromMessageLink("https://example.com/report.html")).toBeNull()
    expect(localFilePathFromMessageLink("mailto:hello@example.com")).toBeNull()
    expect(localFilePathFromMessageLink("~/report.html")).toBeNull()
    expect(localFilePathFromMessageLink("file://server/share/report.html")).toBeNull()
  })
})
