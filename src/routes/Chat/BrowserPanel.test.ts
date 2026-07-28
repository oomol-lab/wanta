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
  navigation: {
    canGoBack: true,
    canGoForward: true,
    loading: false,
    title: "Example",
    url: "https://example.com",
  },
}

function panelElement(browserService: ConnectionClientService<BrowserService>): React.ReactElement {
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
      sessionId: "session-1",
      state,
      onClose: () => undefined,
    }),
  )
}

function renderPanel(): string {
  return renderToStaticMarkup(panelElement({} as ConnectionClientService<BrowserService>))
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
})

describe("BrowserPanel titlebar drag regions", () => {
  it("makes toolbar whitespace draggable while keeping every control interactive", () => {
    const html = renderPanel()

    expect(html).toMatch(/oo-titlebar[^"]*\[-webkit-app-region:drag\]/u)
    expect(html.match(/\[-webkit-app-region:no-drag\]/gu)).toHaveLength(6)
    expect(html).toMatch(/<form class="[^"]*\[-webkit-app-region:no-drag\]/u)
  })
})
