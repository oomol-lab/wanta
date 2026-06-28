import type { LocalArtifactItem, LocalArtifactPack } from "../../../electron/chat/common.ts"

import { describe, expect, it } from "vitest"
import { fileTypeDescriptor } from "./file-type-descriptor.ts"

function artifactItem(name: string, mime: string): LocalArtifactItem {
  return {
    kind: "file",
    mime,
    name,
    path: `/tmp/wanta-artifacts/${name}`,
  }
}

function artifactPack(root: LocalArtifactItem, kind: LocalArtifactPack["kind"]): LocalArtifactPack {
  return {
    display: "single",
    items: [],
    kind,
    root,
    supporting: [],
    title: root.name,
    totalItems: 1,
    truncated: false,
  }
}

describe("fileTypeDescriptor", () => {
  it.each([
    ["report.pdf", "application/octet-stream", "pdf", "pdf"],
    ["brief.doc", "application/octet-stream", "doc", "document"],
    ["brief.docx", "application/octet-stream", "docx", "document"],
    ["data.xls", "application/octet-stream", "xls", "spreadsheet"],
    ["data.xlsx", "application/octet-stream", "xls", "spreadsheet"],
    ["slides.pptx", "application/octet-stream", "ppt", "presentation"],
    ["archive.zip", "application/octet-stream", "zip", "archive"],
    ["table.csv", "application/octet-stream", "csv", "spreadsheet"],
    ["page.html", "application/octet-stream", "html", "code"],
    ["schema.json", "application/octet-stream", "json", "json"],
    ["readme.md", "application/octet-stream", "markdown", "markdown"],
    ["photo.png", "application/octet-stream", "png", "image"],
    ["photo.jpg", "application/octet-stream", "jpg", "image"],
    ["vector.svg", "application/octet-stream", "svg", "image"],
    ["module.ts", "application/octet-stream", "ts", "code"],
    ["view.tsx", "application/octet-stream", "tsx", "code"],
  ] as const)("resolves %s by extension", (name, mime, iconKey, tone) => {
    expect(fileTypeDescriptor({ name, mime })).toMatchObject({ iconKey, tone })
  })

  it.each([
    ["download", "application/pdf", "pdf", "pdf"],
    ["download", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx", "document"],
    ["download", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xls", "spreadsheet"],
    ["download", "application/vnd.openxmlformats-officedocument.presentationml.presentation", "ppt", "presentation"],
    ["download", "text/csv", "csv", "spreadsheet"],
  ] as const)("resolves %s by mime", (name, mime, iconKey, tone) => {
    expect(fileTypeDescriptor({ name, mime })).toMatchObject({ iconKey, tone })
  })

  it("keeps web page packs visually distinct from standalone html files", () => {
    const item = artifactItem("index.html", "text/html")
    expect(fileTypeDescriptor(item, artifactPack(item, "web_page"))).toMatchObject({
      iconKey: "web_page",
      tone: "web_page",
    })
  })

  it("keeps directories visually distinct from regular files", () => {
    expect(
      fileTypeDescriptor({
        kind: "directory",
        mime: "inode/directory",
        name: "folder",
      }),
    ).toMatchObject({
      iconKey: "directory",
      tone: "directory",
    })
  })
})
