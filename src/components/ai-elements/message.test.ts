import type { AppContextValue } from "@/components/AppContext"

import * as React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import {
  clampImageViewerOffset,
  imageViewerFitScale,
  imageViewerWheelAction,
  MarkdownImage,
  panImageViewerState,
  zoomImageViewerState,
} from "./message-image.tsx"
import {
  compactLocalPath,
  MarkdownTable,
  messageResponseControls,
  nextSmoothedText,
  normalizeSingleLocalPathCodeFences,
  smoothedTextRevealStep,
} from "./message.tsx"
import { AppContext } from "@/components/AppContext"
import { I18nContext, translate } from "@/i18n/i18n"

const mockService = {
  invoke: async () => ({ dataUrl: null }),
  serverEvents: { on: () => () => undefined },
} as unknown

const appContext = {
  authService: mockService,
  chatService: mockService,
  connectionsService: mockService,
  gitService: mockService,
  modelsService: mockService,
  sessionService: mockService,
  settingsService: mockService,
  skillService: mockService,
  updateService: mockService,
} as AppContextValue

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

describe("MarkdownTable", () => {
  it("fits tables inside the message width instead of forcing horizontal scroll", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        MarkdownTable,
        null,
        React.createElement(
          "tbody",
          null,
          React.createElement(
            "tr",
            null,
            React.createElement("td", null, "Tailwind CSS 项目的动画时长、排版比例、组件可访问性等设计一致性检查"),
          ),
        ),
      ),
    )

    expect(html).toContain("overflow-hidden")
    expect(html).toContain("table-fixed")
    expect(html).not.toContain("overflow-x-auto")
    expect(html).not.toContain("min-w-max")
  })
})

describe("MarkdownImage", () => {
  it("renders image previews as clickable buttons with a download action", () => {
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
    expect(html).toContain('download="output.png"')
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
