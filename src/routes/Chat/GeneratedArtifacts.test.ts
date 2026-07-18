import type { LocalArtifactItem, LocalArtifactPack } from "../../../electron/chat/common.ts"
import type { ResolvedArtifactGroup } from "./artifact-resolution.ts"
import type { ArtifactSelection } from "./GeneratedArtifacts.tsx"
import type { TranslateFn } from "@/i18n/i18n"

import * as React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { htmlPreviewSrcDoc } from "./artifact-html-preview.ts"
import { artifactGroupDisplayItem, artifactKindLabel } from "./artifact-metadata.ts"
import { buildArtifactPaletteItems } from "./composer-palette-items.ts"
import { GeneratedArtifactsShelf } from "./GeneratedArtifacts.tsx"
import { I18nContext, translate } from "@/i18n/i18n"

function artifactItem(name: string, mime: string): LocalArtifactItem {
  return {
    path: `/tmp/wanta-artifacts/${name}`,
    name,
    kind: "file",
    mime,
    size: 1,
  }
}

function artifactFolder(name: string): LocalArtifactItem {
  return {
    path: `/tmp/${name}`,
    name,
    kind: "directory",
    mime: "inode/directory",
  }
}

const testTranslate: TranslateFn = (key) => (key === "artifacts.kindFolder" ? "Folder" : key)

function renderArtifactShelf(groups: ResolvedArtifactGroup[]): string {
  return renderToStaticMarkup(
    React.createElement(
      I18nContext.Provider,
      {
        value: {
          locale: "zh-CN",
          setLocale: () => undefined,
          t: (key, vars) => translate("zh-CN", key, vars),
        },
      },
      React.createElement(GeneratedArtifactsShelf, {
        groups,
        onContextMenu: () => undefined,
        onOpen: () => undefined,
      }),
    ),
  )
}

describe("htmlPreviewSrcDoc", () => {
  it("keeps an existing doctype first when injecting preview head content", () => {
    const source = "<!doctype html><html><body><h1>Preview</h1></body></html>"
    const result = htmlPreviewSrcDoc(source)

    expect(result.toLowerCase().startsWith("<!doctype html>")).toBe(true)
    expect(result).toContain("<head>")
    expect(result).toContain('http-equiv="Content-Security-Policy"')
    expect(result.indexOf("<head>")).toBeGreaterThan(result.toLowerCase().indexOf("<!doctype html>"))
  })

  it("injects preview head content into existing head elements", () => {
    const source =
      '<!doctype html><html><head><title>x</title></head><body><img src="https://example.com/x.png"></body></html>'
    const result = htmlPreviewSrcDoc(source)

    expect(result).toContain('<head><meta http-equiv="Content-Security-Policy"')
    expect(result).toContain("<title>x</title>")
  })
})

describe("artifact group display", () => {
  it("uses the root folder as the cover for file-list artifact packs", () => {
    const pdf = artifactItem("sample.pdf", "application/pdf")
    const spreadsheet = artifactItem("sample.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    const root = artifactFolder("wanta-artifacts")
    const pack: LocalArtifactPack = {
      root,
      title: "Generated documents",
      kind: "mixed",
      display: "file_list",
      items: [
        { ...pdf, role: "primary", order: 1 },
        { ...spreadsheet, role: "primary", order: 2 },
      ],
      supporting: [],
      totalItems: 2,
      truncated: false,
    }

    const displayItem = artifactGroupDisplayItem(
      {
        root,
        items: [pdf, spreadsheet],
        totalItems: 2,
        truncated: false,
      },
      pack,
    )

    expect(displayItem).toBe(root)
    expect(artifactKindLabel(testTranslate, displayItem, pack)).toBe("Folder")
  })

  it("keeps single document packs represented by their primary file", () => {
    const pdf = artifactItem("report.pdf", "application/pdf")
    const root = artifactFolder("report")
    const pack: LocalArtifactPack = {
      root,
      title: "Report",
      kind: "document",
      display: "document",
      items: [{ ...pdf, role: "primary", order: 1 }],
      supporting: [],
      totalItems: 1,
      truncated: false,
    }

    expect(
      artifactGroupDisplayItem(
        {
          root,
          items: [pdf],
          totalItems: 1,
          truncated: false,
        },
        pack,
      ),
    ).toBe(pdf)
  })

  it("uses the root folder for unmanifested directory groups with multiple files", () => {
    const pdf = artifactItem("sample.pdf", "application/pdf")
    const document = artifactItem(
      "sample.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )
    const root = artifactFolder("exports")

    expect(
      artifactGroupDisplayItem({
        root,
        items: [pdf, document],
        totalItems: 2,
        truncated: false,
      }),
    ).toBe(root)
  })

  it("uses the first image as the cover for a generated image set", () => {
    const first = artifactItem("first.png", "image/png")
    const second = artifactItem("second.png", "image/png")
    const root = artifactFolder("generated-images")

    expect(
      artifactGroupDisplayItem({
        root,
        items: [first, second],
        totalItems: 2,
        truncated: false,
      }),
    ).toBe(first)
  })
})

describe("GeneratedArtifactsShelf", () => {
  it("renders one meaningful collection card without a duplicate view-all action", () => {
    const internalFolderName = "1783659231256-c0b6cdb5-b417-4ffc-87d9-9b32e68fa1c1"
    const html = renderArtifactShelf([
      {
        messageId: "assistant-1",
        group: {
          root: artifactFolder(internalFolderName),
          items: [
            artifactItem("项目任务清单.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
            artifactItem("员工通讯录.pdf", "application/pdf"),
            artifactItem("故障复盘报告.pdf", "application/pdf"),
          ],
          totalItems: 3,
          truncated: false,
        },
        status: "ready",
      },
    ])

    expect(html).toContain("3 个制成品")
    expect(html).toContain("点击查看和预览全部文件")
    expect(html).not.toContain("查看所有产物")
    expect(html).not.toContain(internalFolderName)
    expect(html.match(/<button/g)).toHaveLength(1)
  })

  it("renders a visible failure instead of silently omitting an unpersisted image", () => {
    const html = renderArtifactShelf([
      {
        messageId: "assistant-1",
        group: { items: [], totalItems: 0, truncated: false },
        status: "failed",
        failure: "generated_preview_not_persisted",
      },
    ])

    expect(html).toContain("制成品保存失败")
    expect(html).toContain("没有保存为可重新打开的本地文件")
  })

  it("keeps persisted items visible while warning about a partial image set", () => {
    const image = artifactItem("001.png", "image/png")
    const html = renderArtifactShelf([
      {
        messageId: "assistant-1",
        group: { root: artifactFolder("generated-images"), items: [image], totalItems: 1, truncated: false },
        status: "partial",
        failure: "generated_preview_not_persisted",
      },
    ])

    expect(html).toContain("部分制成品未保存")
    expect(html).toContain("001")
  })

  it("falls back to the latest displayable group when a newer group is empty", () => {
    const html = renderArtifactShelf([
      {
        messageId: "assistant-1",
        group: {
          items: [artifactItem("earlier-report.pdf", "application/pdf")],
          totalItems: 1,
          truncated: false,
        },
        status: "ready",
      },
      {
        messageId: "assistant-2",
        group: { items: [], totalItems: 0, truncated: false },
        status: "ready",
      },
    ])

    expect(html).toContain("earlier report")
    expect(html).toContain("<button")
  })
})

describe("artifact composer palette", () => {
  it("includes the full artifact selection context", () => {
    const earlier = artifactItem("earlier.png", "image/png")
    const latest = artifactItem("latest.pdf", "application/pdf")
    const selection: ArtifactSelection = {
      messageId: "assistant-2",
      group: {
        items: [latest],
        totalItems: 1,
        truncated: false,
      },
      groups: [
        {
          messageId: "assistant-1",
          group: {
            items: [earlier],
            totalItems: 1,
            truncated: false,
          },
        },
        {
          messageId: "assistant-2",
          group: {
            items: [latest],
            totalItems: 1,
            truncated: false,
          },
        },
      ],
      selectedPath: latest.path,
    }

    expect(buildArtifactPaletteItems(selection, testTranslate).map((item) => item.title)).toEqual([
      "latest.pdf",
      "earlier.png",
    ])
  })

  it("offers the root folder for multi-file artifact packs", () => {
    const pdf = artifactItem("report.pdf", "application/pdf")
    const spreadsheet = artifactItem("data.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    const root = artifactFolder("analysis-output")
    const pack: LocalArtifactPack = {
      root,
      title: "Analysis output",
      kind: "mixed",
      display: "file_list",
      items: [
        { ...pdf, role: "primary", order: 1 },
        { ...spreadsheet, role: "primary", order: 2 },
      ],
      supporting: [],
      totalItems: 2,
      truncated: false,
    }
    const selection: ArtifactSelection = {
      messageId: "assistant-1",
      group: {
        root,
        items: [pdf, spreadsheet],
        totalItems: 2,
        truncated: false,
      },
      groups: [
        {
          messageId: "assistant-1",
          group: {
            root,
            items: [pdf, spreadsheet],
            totalItems: 2,
            truncated: false,
          },
          pack,
        },
      ],
      pack,
      selectedPath: root.path,
    }

    const items = buildArtifactPaletteItems(selection, testTranslate)

    expect(items.map((item) => item.title)).toEqual(["analysis-output", "data.xlsx", "report.pdf"])
    expect(items[0]?.artifact.kind).toBe("directory")
    expect(items[0]?.meta).toBe("folder")
  })
})
