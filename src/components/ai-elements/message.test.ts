import type { AppContextValue } from "@/components/AppContext"

import * as React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { normalizeLocalImageMarkdown } from "../../../electron/chat/markdown-images.ts"
import {
  attachmentPreviewSource,
  clampImageViewerOffset,
  imageViewerFitScale,
  imageViewerWheelAction,
  localImagePathFromSrc,
  MarkdownImage,
  panImageViewerState,
  zoomImageViewerState,
} from "./message-image.tsx"
import {
  compactLocalPath,
  markdownCodeLanguage,
  markdownCodeRendererLanguages,
  markdownCodeText,
  messageClassName,
  messageResponseControls,
  nextSmoothedText,
  normalizeSingleLocalPathCodeFences,
  normalizeUnlabeledCodeFences,
  smoothedTextRevealStep,
} from "./message.tsx"
import { AppContext } from "@/components/AppContext"
import { I18nContext, translate } from "@/i18n/i18n"

const mockService = {
  invoke: async () => ({ dataUrl: null }),
  serverEvents: { on: () => () => undefined },
} as unknown

const appContext = {
  attentionService: mockService,
  authService: mockService,
  chatService: mockService,
  connectionsService: mockService,
  gitService: mockService,
  knowledgeService: mockService,
  modelsService: mockService,
  sessionService: mockService,
  settingsService: mockService,
  skillService: mockService,
  updateService: mockService,
} as AppContextValue

describe("Message", () => {
  it("allows message rows to shrink when a side panel reduces the chat width", () => {
    expect(messageClassName("assistant")).toContain("min-w-0")
  })
})

describe("MarkdownCodeBlock", () => {
  it("normalizes fenced code languages and falls back to text", () => {
    expect(markdownCodeLanguage("language-ts")).toBe("ts")
    expect(markdownCodeLanguage("foo language-JSON bar")).toBe("json")
    expect(markdownCodeLanguage(undefined)).toBe("text")
  })

  it("preserves line breaks across highlighted child fragments", () => {
    expect(markdownCodeText(["first\n", React.createElement("span", { key: "second" }, "second"), "\nthird"])).toBe(
      "first\nsecond\nthird",
    )
  })

  it("leaves Mermaid fences to the dedicated diagram renderer", () => {
    expect(markdownCodeRendererLanguages).not.toContain("mermaid")
    expect(markdownCodeRendererLanguages).toContain("text")
  })
})

describe("normalizeUnlabeledCodeFences", () => {
  it("labels bare fences as text so the AI Elements renderer can match them", () => {
    expect(normalizeUnlabeledCodeFences(["```", "first line", "second line", "```"].join("\n"))).toBe(
      ["```text", "first line", "second line", "```"].join("\n"),
    )
  })

  it("does not rewrite Mermaid or explicitly labeled code fences", () => {
    const markdown = ["```mermaid", "flowchart LR", "A --> B", "```", "", "```ts", "const value = 1", "```"].join("\n")

    expect(normalizeUnlabeledCodeFences(markdown)).toBe(markdown)
  })
})

describe("messageResponseControls", () => {
  it("keeps code blocks copyable but disables text downloads by default", () => {
    expect(messageResponseControls(undefined)).toEqual({
      table: false,
      code: {
        copy: true,
        download: false,
      },
    })
  })

  it("preserves explicit controls overrides", () => {
    expect(messageResponseControls({ code: { download: true } })).toEqual({
      table: false,
      code: {
        copy: true,
        download: true,
      },
    })
    expect(messageResponseControls({ table: true, code: false })).toEqual({
      table: true,
      code: false,
    })
  })
})

describe("normalizeSingleLocalPathCodeFences", () => {
  it("turns a path-only fenced block into inline code", () => {
    expect(
      normalizeSingleLocalPathCodeFences(
        ["文件路径：", "```", "/Users/me/Library/Application Support/wanta/agent/artifacts/turn/image.png", "```"].join(
          "\n",
        ),
      ),
    ).toBe("文件路径：\n`/Users/me/Library/Application Support/wanta/agent/artifacts/turn/image.png`")
  })

  it("leaves real code blocks unchanged", () => {
    const markdown = ["```ts", "const path = '/tmp/image.png'", "console.log(path)", "```"].join("\n")

    expect(normalizeSingleLocalPathCodeFences(markdown)).toBe(markdown)
  })
})

describe("normalizeLocalImageMarkdown", () => {
  it("wraps a local image destination containing spaces in angle brackets", () => {
    const path =
      "/Users/me/Library/Application Support/wanta/agent/artifacts/ses_example/1783833651476-turn/mucha-corgi.png"

    expect(normalizeLocalImageMarkdown(`![穆夏风柯基](${path})`)).toBe(`![穆夏风柯基](<${path}>)`)
  })

  it("keeps valid local image destinations unchanged", () => {
    expect(normalizeLocalImageMarkdown("![image](</Users/me/output files/image.png>)")).toBe(
      "![image](</Users/me/output files/image.png>)",
    )
    expect(normalizeLocalImageMarkdown("![image](/tmp/output.png)")).toBe("![image](/tmp/output.png)")
  })

  it("supports Windows local image destinations containing spaces", () => {
    expect(normalizeLocalImageMarkdown(String.raw`![image](C:\Users\me\output files\image.png)`)).toBe(
      String.raw`![image](<C:\Users\me\output files\image.png>)`,
    )
  })

  it("does not rewrite image examples inside code", () => {
    const inline = "Use `![image](/Users/me/output files/image.png)` in the response."
    const fenced = ["```md", "![image](/Users/me/output files/image.png)", "```"].join("\n")

    expect(normalizeLocalImageMarkdown(inline)).toBe(inline)
    expect(normalizeLocalImageMarkdown(fenced)).toBe(fenced)
  })

  it("leaves remote image destinations unchanged", () => {
    expect(normalizeLocalImageMarkdown("![image](https://example.com/output image.png)")).toBe(
      "![image](https://example.com/output image.png)",
    )
  })
})

describe("compactLocalPath", () => {
  it("keeps short paths readable", () => {
    expect(compactLocalPath("/tmp/image.png")).toBe("/tmp/image.png")
  })

  it("middle-truncates long local paths", () => {
    expect(compactLocalPath("/Users/me/Library/Application Support/wanta/agent/artifacts/turn/image.png", 32)).toBe(
      "/Users/me/Libr.../turn/image.png",
    )
  })

  it("decodes file URLs before compacting", () => {
    expect(compactLocalPath("file:///Users/me/output%20files/report.pdf")).toBe("/Users/me/output files/report.pdf")
  })

  it("normalizes Windows file URLs before compacting", () => {
    expect(compactLocalPath("file:///C:/Users/me/output%20files/report.pdf")).toBe(
      "C:/Users/me/output files/report.pdf",
    )
  })
})

describe("MarkdownImage", () => {
  it("prefers streamed resource URLs for local image previews", () => {
    expect(
      attachmentPreviewSource({
        dataUrl: null,
        resourceExpiresAt: Date.now() + 60_000,
        resourceUrl: "wanta-artifact://resource/image",
      }),
    ).toBe("wanta-artifact://resource/image")
    expect(attachmentPreviewSource({ dataUrl: "data:image/png;base64,AAAA" })).toBe("data:image/png;base64,AAAA")
  })

  it("decodes percent-encoded local paths from markdown image URLs", () => {
    expect(localImagePathFromSrc("/Users/me/Library/Application%20Support/wanta/agent/artifacts/turn/001.png")).toBe(
      "/Users/me/Library/Application Support/wanta/agent/artifacts/turn/001.png",
    )
  })

  it("keeps malformed percent escapes readable instead of rejecting local paths", () => {
    expect(localImagePathFromSrc("/tmp/100% legit/image.png")).toBe("/tmp/100% legit/image.png")
  })

  it("accepts case-insensitive file URL schemes", () => {
    expect(localImagePathFromSrc("FILE:///Users/me/output%20files/image.png")).toBe("/Users/me/output files/image.png")
  })

  it("does not treat home-relative image paths as absolute local paths", () => {
    expect(localImagePathFromSrc("~/output/image.png")).toBeNull()
  })

  it("does not decode escaped path separators inside local path segments", () => {
    expect(localImagePathFromSrc("/tmp/output%23final/a%2Fb.png")).toBe("/tmp/output#final/a%2Fb.png")
  })

  it("renders remote image previews without a broken browser download action", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        I18nContext.Provider,
        {
          value: {
            locale: "zh-CN",
            setLocale: () => undefined,
            t: (key, vars) => translate("zh-CN", key, vars),
          },
        },
        React.createElement(
          AppContext.Provider,
          { value: appContext },
          React.createElement(MarkdownImage, { src: "https://example.com/output.png", alt: "output" }),
        ),
      ),
    )

    expect(html).toContain('aria-label="预览图片：output"')
    expect(html).not.toContain("download=")
  })
})

describe("image viewer geometry", () => {
  it("fits large images into the viewer stage", () => {
    expect(imageViewerFitScale({ width: 1200, height: 800 }, { width: 2400, height: 1600 })).toBeCloseTo(0.42, 2)
  })

  it("lets smaller images move within the empty stage area", () => {
    expect(
      clampImageViewerOffset({ x: 80, y: -40 }, 1, { width: 300, height: 200 }, { width: 1200, height: 800 }),
    ).toEqual({ x: 80, y: -40 })
  })

  it("keeps smaller images fully inside the viewer stage", () => {
    expect(
      clampImageViewerOffset({ x: 900, y: -500 }, 1, { width: 300, height: 200 }, { width: 1200, height: 800 }),
    ).toEqual({ x: 450, y: -300 })
  })

  it("limits panning to the scaled image overflow", () => {
    expect(
      clampImageViewerOffset({ x: 900, y: -500 }, 1, { width: 2400, height: 1600 }, { width: 1200, height: 800 }),
    ).toEqual({ x: 600, y: -400 })
  })

  it("zooms while keeping the offset inside image bounds", () => {
    expect(
      zoomImageViewerState(
        { offset: { x: 900, y: 0 }, scale: 1 },
        0.5,
        { width: 1200, height: 800 },
        { width: 800, height: 600 },
      ),
    ).toEqual({ offset: { x: 500, y: 0 }, scale: 1.5 })
  })

  it("maps trackpad scroll deltas to bounded panning", () => {
    expect(
      panImageViewerState(
        { offset: { x: 0, y: 0 }, scale: 1 },
        -120,
        90,
        { width: 1200, height: 800 },
        { width: 800, height: 600 },
      ),
    ).toEqual({ offset: { x: 120, y: -90 }, scale: 1 })
  })

  it("treats mouse wheel steps as zoom for Windows and mouse users", () => {
    expect(imageViewerWheelAction({ deltaMode: 0, deltaX: 0, deltaY: 120 })).toEqual({
      deltaX: 0,
      deltaY: 1,
      kind: "zoom",
    })
  })

  it("keeps precise trackpad scrolling as panning", () => {
    expect(imageViewerWheelAction({ deltaMode: 0, deltaX: -8, deltaY: 12 })).toEqual({
      deltaX: -8,
      deltaY: 12,
      kind: "pan",
    })
  })

  it("supports horizontal mouse panning with shift wheel", () => {
    expect(imageViewerWheelAction({ deltaMode: 0, deltaX: 0, deltaY: 120, shiftKey: true })).toEqual({
      deltaX: 120,
      deltaY: 0,
      kind: "pan",
    })
  })
})

describe("nextSmoothedText", () => {
  it("reveals a prefix incrementally", () => {
    expect(nextSmoothedText("", "Wanta 正在处理一段较长的回复")).toBe("Wan")
  })

  it("jumps to target when text is replaced instead of appended", () => {
    expect(nextSmoothedText("old answer", "new answer")).toBe("new answer")
  })

  it("uses larger steps for large pending chunks", () => {
    expect(smoothedTextRevealStep(1300)).toBeGreaterThan(smoothedTextRevealStep(80))
  })
})
