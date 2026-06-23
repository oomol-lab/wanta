import type { LocalArtifactItem, LocalArtifactPack } from "../../../electron/chat/common.ts"
import type { ResolvedArtifactPayload } from "./artifact-filter.ts"

import { describe, expect, it } from "vitest"
import { parseCsvPreview } from "./artifact-csv-preview.ts"
import { dedupeArtifactPayloadsAcrossSources, filterArtifactPayloads } from "./artifact-filter.ts"
import { htmlPreviewSrcDoc } from "./artifact-html-preview.ts"

function artifactItem(name: string, mime: string): LocalArtifactItem {
  return {
    path: `/tmp/wanta-artifacts/${name}`,
    name,
    kind: "file",
    mime,
    size: 1,
  }
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

describe("parseCsvPreview", () => {
  it("parses quoted commas, escaped quotes, and CRLF rows", () => {
    expect(parseCsvPreview('name,note\r\n"Wanta, app","said ""hi"""\r\nplain,value').rows).toEqual([
      ["name", "note"],
      ["Wanta, app", 'said "hi"'],
      ["plain", "value"],
    ])
  })

  it("caps rows and columns while reporting truncation", () => {
    expect(parseCsvPreview("a,b,c\n1,2,3\n4,5,6", { maxRows: 2, maxColumns: 2 })).toEqual({
      rows: [
        ["a", "b"],
        ["1", "2"],
      ],
      truncated: true,
    })
  })

  it("does not add an empty row for a trailing newline", () => {
    expect(parseCsvPreview("a,b\n", { maxRows: 10, maxColumns: 10 }).rows).toEqual([["a", "b"]])
  })
})

describe("filterArtifactPayloads", () => {
  it("keeps manifest-declared HTML deliverables for non-code requests", () => {
    const item = artifactItem("report.html", "text/html")
    const pack: LocalArtifactPack = {
      root: {
        path: "/tmp/wanta-artifacts",
        name: "wanta-artifacts",
        kind: "directory",
        mime: "inode/directory",
      },
      title: "Report",
      kind: "web_page",
      display: "document",
      items: [{ ...item, role: "primary", order: 1 }],
      supporting: [],
      totalItems: 1,
      truncated: false,
    }
    const payloads: ResolvedArtifactPayload[] = [
      {
        group: {
          root: pack.root,
          items: [item],
          totalItems: 1,
          truncated: false,
        },
        pack,
      },
    ]

    expect(
      filterArtifactPayloads(payloads, {
        messageId: "assistant-1",
        requestText: "Analyze the PostHog data",
        text: "Done",
        artifactRoot: "/tmp/wanta-artifacts",
        sourcePaths: [],
      })[0]?.group.items.map((artifact) => artifact.name),
    ).toEqual(["report.html"])
  })

  it("still filters unmanifested intermediate HTML from non-code requests", () => {
    const item = artifactItem("scratch.html", "text/html")
    const payloads: ResolvedArtifactPayload[] = [
      {
        group: {
          items: [item],
          totalItems: 1,
          truncated: false,
        },
      },
    ]

    expect(
      filterArtifactPayloads(payloads, {
        messageId: "assistant-1",
        requestText: "Analyze the data",
        text: "Output: `/tmp/wanta-artifacts/scratch.html`",
        sourcePaths: [],
      }),
    ).toEqual([])
  })

  it("keeps manifest-declared supporting artifacts with primary items", () => {
    const primary = artifactItem("report.html", "text/html")
    const supporting = artifactItem("summary.md", "text/markdown")
    const pack: LocalArtifactPack = {
      root: {
        path: "/tmp/wanta-artifacts",
        name: "wanta-artifacts",
        kind: "directory",
        mime: "inode/directory",
      },
      title: "Report",
      kind: "web_page",
      display: "document",
      items: [{ ...primary, role: "primary", order: 1 }],
      supporting: [{ ...supporting, role: "summary", order: 1 }],
      totalItems: 2,
      truncated: false,
    }
    const payloads: ResolvedArtifactPayload[] = [
      {
        group: {
          root: pack.root,
          items: [primary],
          totalItems: 1,
          truncated: false,
        },
        pack,
      },
    ]

    const [result] = filterArtifactPayloads(payloads, {
      messageId: "assistant-1",
      requestText: "Analyze the PostHog data",
      text: "Done",
      artifactRoot: "/tmp/wanta-artifacts",
      sourcePaths: [],
    })

    expect(result?.pack?.items.map((artifact) => artifact.name)).toEqual(["report.html"])
    expect(result?.pack?.supporting.map((artifact) => artifact.name)).toEqual(["summary.md"])
    expect(result?.pack?.totalItems).toBe(2)
  })

  it("dedupes the same artifact discovered from an artifact root and later text", () => {
    const item = artifactItem("report.html", "text/html")
    const pack: LocalArtifactPack = {
      root: {
        path: "/tmp/wanta-artifacts",
        name: "wanta-artifacts",
        kind: "directory",
        mime: "inode/directory",
      },
      title: "Report",
      kind: "web_page",
      display: "document",
      items: [{ ...item, role: "primary", order: 1 }],
      supporting: [],
      totalItems: 1,
      truncated: false,
    }
    const payloads: ResolvedArtifactPayload[] = [
      {
        group: {
          root: pack.root,
          items: [item],
          totalItems: 1,
          truncated: false,
        },
        pack,
      },
      {
        group: {
          items: [item],
          totalItems: 1,
          truncated: false,
        },
      },
    ]

    expect(dedupeArtifactPayloadsAcrossSources(payloads)).toEqual([payloads[0]])
  })
})
