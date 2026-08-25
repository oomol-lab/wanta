// @vitest-environment happy-dom

import type { BrowserPageState } from "../../../electron/browser/common.ts"
import type { BrowserService } from "../../../electron/browser/common.ts"
import type { ConnectionClientService } from "@oomol/connection"
import type { Root } from "react-dom/client"

import * as React from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"
import { BrowserPanel } from "./BrowserPanel.tsx"
import { I18nContext, translate } from "@/i18n/i18n"

const state: BrowserPageState = {
  crashed: false,
  sessionId: "session-1",
  visible: true,
  zoomFactor: 1,
  navigation: {
    canGoBack: true,
    canGoForward: true,
    loading: false,
    title: "Example",
    url: "https://example.com",
  },
}

function panelElement(
  browserService: ConnectionClientService<BrowserService>,
  maximized = false,
  windowControlsOnRight = true,
  showCloseButton = true,
): React.ReactElement {
  return React.createElement(
    I18nContext.Provider,
    {
      value: {
        locale: "zh-CN",
        setLocale: () => undefined,
        t: (key, vars) => translate("zh-CN", key, vars),
      },
    },
    React.createElement(BrowserPanel, {
      browserService,
      maximized,
      sessionId: "session-1",
      state,
      windowControlsOnRight,
      showCloseButton,
      onClose: () => undefined,
      onToggleMaximized: () => undefined,
    }),
  )
}

function renderPanel(maximized = false, windowControlsOnRight = true, showCloseButton = true): string {
  return renderToStaticMarkup(
    panelElement({} as ConnectionClientService<BrowserService>, maximized, windowControlsOnRight, showCloseButton),
  )
}

async function renderInteractivePanel(invoke: ReturnType<typeof vi.fn>): Promise<Root> {
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => {
    root.render(
      panelElement({
        invoke,
      } as unknown as ConnectionClientService<BrowserService>),
    )
  })
  return root
}

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe("BrowserPanel native view visibility", () => {
  it("hides the native page behind a modal and restores it after the modal closes", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      bottom: 500,
      height: 400,
      left: 600,
      right: 1100,
      top: 100,
      width: 500,
      x: 600,
      y: 100,
      toJSON: () => undefined,
    })
    const previewDataUrl = "data:image/png;base64,cHJldmlldw=="
    const invoke = vi.fn(async (action: string) => (action === "capturePreview" ? previewDataUrl : undefined))
    const overlay = document.createElement("div")
    overlay.setAttribute("aria-modal", "true")
    document.body.append(overlay)
    const root = await renderInteractivePanel(invoke)

    expect(invoke).toHaveBeenCalledWith("hide", "session-1")
    expect(document.querySelector(`img[src="${previewDataUrl}"]`)).not.toBeNull()
    const initialActions = invoke.mock.calls.map(([action]) => action)
    const initialHideIndex = initialActions.indexOf("hide")
    expect(initialActions.slice(initialHideIndex + 1)).toContain("capturePreview")

    overlay.remove()
    await act(async () => {
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
    })

    expect(invoke).toHaveBeenCalledWith("show", {
      bounds: { height: 400, width: 500, x: 600, y: 100 },
      sessionId: "session-1",
    })

    act(() => root.unmount())
  })

  it("hides after an in-flight show when a modal opens", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      bottom: 500,
      height: 400,
      left: 600,
      right: 1100,
      top: 100,
      width: 500,
      x: 600,
      y: 100,
      toJSON: () => undefined,
    })
    let resolveShow!: () => void
    const pendingShow = new Promise<void>((resolve) => {
      resolveShow = resolve
    })
    const invoke = vi.fn((action: string) => {
      if (action === "show") return pendingShow
      return Promise.resolve(null)
    })
    const root = await renderInteractivePanel(invoke)

    await act(async () => {
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
    })
    expect(invoke).toHaveBeenCalledWith("show", {
      bounds: { height: 400, width: 500, x: 600, y: 100 },
      sessionId: "session-1",
    })

    const overlay = document.createElement("div")
    overlay.setAttribute("aria-modal", "true")
    await act(async () => {
      document.body.append(overlay)
      await Promise.resolve()
    })

    resolveShow()
    await act(async () => {
      await pendingShow
      await Promise.resolve()
    })

    const visibilityActions = invoke.mock.calls
      .map(([action]) => action)
      .filter((action) => action === "show" || action === "hide")
    expect(visibilityActions.at(-1)).toBe("hide")

    act(() => root.unmount())
  })

  it("does not let a pending hidden-page preview block restoring the native page", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      bottom: 500,
      height: 400,
      left: 600,
      right: 1100,
      top: 100,
      width: 500,
      x: 600,
      y: 100,
      toJSON: () => undefined,
    })
    const pendingCapture = new Promise<string | null>(() => undefined)
    const invoke = vi.fn((action: string) =>
      action === "capturePreview" ? pendingCapture : Promise.resolve(undefined),
    )
    const overlay = document.createElement("div")
    overlay.setAttribute("aria-modal", "true")
    document.body.append(overlay)
    const root = await renderInteractivePanel(invoke)

    expect(invoke).toHaveBeenCalledWith("hide", "session-1")

    overlay.remove()
    await act(async () => {
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
    })

    expect(invoke).toHaveBeenCalledWith("show", {
      bounds: { height: 400, width: 500, x: 600, y: 100 },
      sessionId: "session-1",
    })

    act(() => root.unmount())
  })

  it("does not capture a preview for ordinary native-view layout updates", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      bottom: 500,
      height: 400,
      left: 600,
      right: 1100,
      top: 100,
      width: 500,
      x: 600,
      y: 100,
      toJSON: () => undefined,
    })
    const invoke = vi.fn(async (_action: string) => undefined)
    const root = await renderInteractivePanel(invoke)

    await act(async () => {
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
      await Promise.resolve()
    })
    expect(invoke).toHaveBeenCalledWith("show", {
      bounds: { height: 400, width: 500, x: 600, y: 100 },
      sessionId: "session-1",
    })
    expect(invoke.mock.calls.map(([action]) => action)).not.toContain("capturePreview")

    act(() => root.unmount())
  })

  it("ignores ordinary streamed DOM mutations when no modal state changed", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      bottom: 500,
      height: 400,
      left: 600,
      right: 1100,
      top: 100,
      width: 500,
      x: 600,
      y: 100,
      toJSON: () => undefined,
    })
    const invoke = vi.fn(async (_action: string) => undefined)
    const root = await renderInteractivePanel(invoke)
    await act(async () => {
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
    })
    invoke.mockClear()

    await act(async () => {
      document.body.append(document.createElement("p"))
      await Promise.resolve()
    })

    expect(invoke).not.toHaveBeenCalled()
    act(() => root.unmount())
  })
})

describe("BrowserPanel titlebar drag regions", () => {
  it("can hide the panel-local close button on Windows", () => {
    expect(renderPanel(false, true, false)).not.toContain('aria-label="关闭浏览器"')
    expect(renderPanel(false, true, true)).toContain('aria-label="关闭浏览器"')
  })

  it("makes toolbar whitespace draggable while keeping every control interactive", () => {
    const html = renderPanel()

    expect(html).toMatch(/oo-titlebar[^"]*\[-webkit-app-region:drag\]/u)
    expect(html.match(/\[-webkit-app-region:no-drag\]/gu)).toHaveLength(7)
    expect(html).toMatch(/<form class="[^"]*\[-webkit-app-region:no-drag\]/u)
  })

  it("reserves the native window-control area only while it owns the window edge", () => {
    expect(renderPanel()).toContain("oo-titlebar-window-controls")
    expect(renderPanel(false, false)).not.toContain("oo-titlebar-window-controls")
  })

  it("keeps compact controls usable and reveals manual zoom when maximized", () => {
    const compact = renderPanel()
    expect(compact).toContain('aria-label="最大化浏览器"')
    expect(compact).not.toContain('aria-label="放大"')

    const maximized = renderPanel(true)
    expect(maximized).toContain('aria-label="放大"')
    expect(maximized).toContain('aria-label="缩小"')
    expect(maximized).toContain('aria-label="恢复到 100%"')
    expect(maximized).toContain('aria-label="恢复浏览器面板"')
  })
})
