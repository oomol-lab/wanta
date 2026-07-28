// @vitest-environment happy-dom

import type { AppContextValue } from "@/components/AppContext"
import type { Root } from "react-dom/client"
import type { DiagramPlugin } from "streamdown"

import * as React from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  MessageStreamdown,
  mermaidRendererControls,
  messageStreamdownControls,
  messageStreamdownLinkSafety,
  nativeMessageStreamdownControls,
  wrapMermaidPluginWithValidation,
} from "./message-streamdown.tsx"
import { AppContext } from "@/components/AppContext"
import { ThemeContext } from "@/components/theme-context"
import { I18nContext, translate } from "@/i18n/i18n"

function withTestProviders(
  children: React.ReactNode,
  invoke: ReturnType<typeof vi.fn> = vi.fn(async () => undefined),
): React.ReactElement {
  return React.createElement(
    AppContext.Provider,
    { value: { chatService: { invoke } } as unknown as AppContextValue },
    React.createElement(
      ThemeContext.Provider,
      { value: { effectiveTheme: "light", preference: "light", setPreference: () => undefined } },
      React.createElement(
        I18nContext.Provider,
        {
          value: {
            locale: "zh-CN",
            setLocale: () => undefined,
            t: (key, vars) => translate("zh-CN", key, vars),
          },
        },
        children,
      ),
    ),
  )
}

function renderMessageStreamdown(markdown: string): string {
  return renderToStaticMarkup(
    withTestProviders(React.createElement(MessageStreamdown, { defaultRenderers: [] }, markdown)),
  )
}

interface RenderedLinkSafetyModal {
  onClose: ReturnType<typeof vi.fn>
  onConfirm: ReturnType<typeof vi.fn>
  invoke: ReturnType<typeof vi.fn>
  render: (url: string) => Promise<void>
  root: Root
}

async function renderLinkSafetyModal(url = "https://example.com/first"): Promise<RenderedLinkSafetyModal> {
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  const onClose = vi.fn()
  const onConfirm = vi.fn()
  const invoke = vi.fn(async () => undefined)
  const renderModal = messageStreamdownLinkSafety().renderModal
  if (!renderModal) {
    throw new Error("Expected the product-owned link safety modal renderer")
  }
  const render = async (nextUrl: string): Promise<void> => {
    await act(async () => {
      root.render(withTestProviders(renderModal({ isOpen: true, onClose, onConfirm, url: nextUrl }), invoke))
    })
  }
  await render(url)
  return { invoke, onClose, onConfirm, render, root }
}

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe("messageStreamdownControls", () => {
  it("adds compact product-owned Mermaid controls without changing existing code controls", () => {
    expect(
      messageStreamdownControls({
        table: false,
        code: { copy: true, download: false },
      }),
    ).toEqual({
      table: false,
      code: { copy: true, download: false },
      mermaid: {
        copy: true,
        download: false,
        fullscreen: true,
        panZoom: false,
      },
    })
  })

  it("respects callers that explicitly disable Mermaid controls", () => {
    expect(messageStreamdownControls({ table: true, code: true, mermaid: false })).toEqual({
      table: true,
      code: true,
      mermaid: false,
    })
  })

  it("routes Mermaid controls to the Wanta renderer and disables the native fullscreen portal", () => {
    const controls = messageStreamdownControls({
      table: false,
      code: { copy: true, download: false },
      mermaid: { copy: false, fullscreen: true, panZoom: false },
    })

    expect(mermaidRendererControls(controls)).toEqual({ copy: false, fullscreen: true })
    expect(nativeMessageStreamdownControls(controls)).toEqual({
      table: false,
      code: { copy: true, download: false },
      mermaid: false,
    })
  })

  it("validates Mermaid source for caller-provided plugins", async () => {
    const render = vi.fn(async () => ({ diagramType: "flowchart", svg: "<svg />" }))
    const plugin = {
      getMermaid: vi.fn(() => ({ render })),
    } as unknown as DiagramPlugin
    const wrapped = wrapMermaidPluginWithValidation(plugin)
    const instance = wrapped.getMermaid({} as never)

    await expect(instance.render("diagram", "flowchart TD\nclick A https://example.com")).rejects.toThrow(
      "Mermaid click actions are not supported",
    )
    expect(render).not.toHaveBeenCalled()
  })

  it("keeps Mermaid fences on the dedicated Wanta renderer", () => {
    const html = renderMessageStreamdown(["```mermaid", "flowchart LR", "A[Start] --> B[Done]", "```"].join("\n"))

    expect(html).toContain("oo-mermaid-loading")
    expect(html).not.toContain('data-streamdown="code-block"')
  })

  it("keeps an unfinished Mermaid fence in the incomplete loading state", () => {
    const html = renderMessageStreamdown(["```mermaid", "flowchart LR", "A[Start] --> B[Unfinished"].join("\n"))

    expect(html).toContain('data-mermaid-state="incomplete"')
    expect(html).not.toContain("oo-mermaid-error")
  })
})

describe("messageStreamdownLinkSafety", () => {
  it("installs the product-owned link safety modal renderer", () => {
    const linkSafety = messageStreamdownLinkSafety()

    expect(linkSafety.enabled).toBe(true)
    expect(linkSafety.renderModal).toBeTypeOf("function")
  })

  it("preserves explicit link checks, disabling, and custom modals", () => {
    const onLinkCheck = vi.fn(() => true)
    const renderModal = vi.fn(() => null)

    expect(messageStreamdownLinkSafety({ enabled: false, onLinkCheck, renderModal })).toEqual({
      enabled: false,
      onLinkCheck,
      renderModal,
    })
  })

  it("copies the current URL, resets copied state, and clears pending timers", async () => {
    vi.useFakeTimers()
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    })
    const clearTimeout = vi.spyOn(window, "clearTimeout")
    const modal = await renderLinkSafetyModal()
    const copyButton = [...document.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("复制链接"),
    )

    await act(async () => copyButton?.click())

    expect(writeText).toHaveBeenCalledWith("https://example.com/first")
    expect(copyButton?.textContent).toContain("复制成功")

    await modal.render("https://example.com/second")

    expect(document.body.textContent).toContain("https://example.com/second")
    expect(document.body.textContent).toContain("复制链接")
    expect(clearTimeout).toHaveBeenCalled()

    act(() => modal.root.unmount())
    expect(clearTimeout).toHaveBeenCalled()
  })

  it("wires confirm and close while initially focusing the safe close action", async () => {
    const modal = await renderLinkSafetyModal()
    await act(async () => {
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
    })
    const closeButton = document.querySelector<HTMLButtonElement>('button[aria-label="关闭"]')
    const openButton = [...document.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("打开链接"),
    )

    expect(document.activeElement).toBe(closeButton)

    act(() => openButton?.click())
    expect(modal.onConfirm).toHaveBeenCalledOnce()
    expect(modal.invoke).not.toHaveBeenCalled()
    expect(modal.onClose).toHaveBeenCalledOnce()

    act(() => closeButton?.click())
    expect(modal.onClose).toHaveBeenCalledTimes(2)

    act(() => modal.root.unmount())
  })

  it("opens encoded local paths through the trusted local-file service", async () => {
    const nativeWriteText = vi.fn(async () => undefined)
    vi.stubGlobal("wanta", { writeClipboardText: nativeWriteText })
    const browserWriteText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: browserWriteText },
    })
    const modal = await renderLinkSafetyModal("/Users/me/Library/Application%20Support/wanta/report.html")
    const copyButton = [...document.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("复制文件路径"),
    )
    const openButton = [...document.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("打开文件"),
    )

    expect(document.body.textContent).toContain("打开本地文件？")
    expect(document.body.textContent).toContain("/Users/me/Library/Application Support/wanta/report.html")

    await act(async () => copyButton?.click())
    expect(nativeWriteText).toHaveBeenCalledWith("/Users/me/Library/Application Support/wanta/report.html")
    expect(browserWriteText).not.toHaveBeenCalled()

    await act(async () => openButton?.click())
    expect(modal.invoke).toHaveBeenCalledWith("openLocalPath", {
      path: "/Users/me/Library/Application Support/wanta/report.html",
    })
    expect(modal.onConfirm).not.toHaveBeenCalled()
    expect(modal.onClose).toHaveBeenCalledOnce()

    act(() => modal.root.unmount())
  })
})
