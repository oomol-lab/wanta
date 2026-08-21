// @vitest-environment happy-dom

import type { AppContextValue } from "@/components/AppContext"
import type { Root } from "react-dom/client"

import * as React from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, expect, test, vi } from "vitest"
import { rewriteLocalImageMarkdown } from "../../../electron/chat/markdown-images.ts"
import { ImageViewerModal, localImagePreviewRetryDelay, MarkdownImage } from "./message-image.tsx"
import { MessageStreamdown } from "./message-streamdown.tsx"
import { AppContext } from "@/components/AppContext"
import { ThemeContext } from "@/components/theme-context"
import { I18nContext, translate } from "@/i18n/i18n"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mockService = {
  invoke: async () => ({ dataUrl: null }),
  serverEvents: { on: () => () => undefined },
} as unknown

function appContext(chatService: { invoke: ReturnType<typeof vi.fn> }): AppContextValue {
  return {
    attentionService: mockService,
    authService: mockService,
    browserService: mockService,
    chatService: chatService as unknown as AppContextValue["chatService"],
    connectionsService: mockService,
    gitService: mockService,
    knowledgeService: mockService,
    linkRuntimeService: mockService,
    modelsService: mockService,
    sessionService: mockService,
    settingsService: mockService,
    skillService: mockService,
    updateService: mockService,
  } as AppContextValue
}

async function renderImage(
  invoke: ReturnType<typeof vi.fn>,
  src = String.raw`C:\Users\Cheerego\artifact.png`,
  alt = "artifact",
): Promise<{
  host: HTMLDivElement
  rerender: (nextSrc: string, nextAlt?: string) => Promise<void>
  root: Root
}> {
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  const rerender = async (nextSrc: string, nextAlt = alt): Promise<void> => {
    await act(async () => {
      root.render(
        <I18nContext.Provider
          value={{ locale: "zh-CN", setLocale: () => undefined, t: (key, vars) => translate("zh-CN", key, vars) }}
        >
          <AppContext.Provider value={appContext({ invoke })}>
            <MarkdownImage src={nextSrc} alt={nextAlt} />
          </AppContext.Provider>
        </I18nContext.Provider>,
      )
      await Promise.resolve()
    })
  }
  await rerender(src)
  return { host, rerender, root }
}

async function renderViewerModal(
  invoke: ReturnType<typeof vi.fn>,
  onError: NonNullable<React.ComponentProps<"img">["onError"]>,
): Promise<{ host: HTMLDivElement; root: Root }> {
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => {
    root.render(
      <I18nContext.Provider
        value={{ locale: "zh-CN", setLocale: () => undefined, t: (key, vars) => translate("zh-CN", key, vars) }}
      >
        <AppContext.Provider value={appContext({ invoke })}>
          <ImageViewerModal
            alt="attachment"
            localPath="/tmp/attachment.png"
            onClose={() => undefined}
            onError={onError}
            src="wanta-resource://attachment/preview"
            title="attachment"
          />
        </AppContext.Provider>
      </I18nContext.Provider>,
    )
    await Promise.resolve()
  })
  return { host, root }
}

async function renderResponse(markdown: string, invoke: ReturnType<typeof vi.fn>) {
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => {
    root.render(
      <ThemeContext.Provider value={{ effectiveTheme: "light", preference: "light", setPreference: () => undefined }}>
        <I18nContext.Provider
          value={{ locale: "zh-CN", setLocale: () => undefined, t: (key, vars) => translate("zh-CN", key, vars) }}
        >
          <AppContext.Provider value={appContext({ invoke })}>
            <MessageStreamdown components={{ img: MarkdownImage }} defaultRenderers={[]}>
              {rewriteLocalImageMarkdown(markdown)}
            </MessageStreamdown>
          </AppContext.Provider>
        </I18nContext.Provider>
      </ThemeContext.Provider>,
    )
    await Promise.resolve()
    await Promise.resolve()
  })
  return { host, root }
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

test("retries a local preview that is not ready yet", async () => {
  vi.useFakeTimers()
  const invoke = vi
    .fn()
    .mockResolvedValueOnce({ dataUrl: null })
    .mockResolvedValueOnce({ resourceExpiresAt: Date.now() + 120_000, resourceUrl: "wanta-resource://artifact/image" })
  const { host, root } = await renderImage(invoke)

  expect(invoke).toHaveBeenCalledTimes(1)
  expect(host.querySelector("img")).toBeNull()

  await act(async () => {
    await vi.advanceTimersByTimeAsync(250)
  })

  expect(invoke).toHaveBeenCalledTimes(2)
  expect(host.querySelector("img")?.getAttribute("src")).toBe("wanta-resource://artifact/image")

  act(() => root.unmount())
})

test("keeps retrying a temporarily unavailable local image for a bounded window", () => {
  expect(localImagePreviewRetryDelay(0)).toBe(250)
  expect(localImagePreviewRetryDelay(3)).toBe(3_000)
  expect(localImagePreviewRetryDelay(4)).toBeNull()
})

test("does not retry rejected local paths", async () => {
  vi.useFakeTimers()
  const invoke = vi.fn().mockRejectedValue(new Error("Local path is not available from this conversation."))
  const { root } = await renderImage(invoke)

  await act(async () => {
    await vi.advanceTimersByTimeAsync(10_000)
  })

  expect(invoke).toHaveBeenCalledTimes(1)
  act(() => root.unmount())
})

test("replaces a failed remote preview with a visible error state", async () => {
  const invoke = vi.fn()
  const { host, root } = await renderImage(invoke, "https://example.com/expired-output.png", "generated output")
  const image = host.querySelector("img")

  expect(image).not.toBeNull()
  await act(async () => {
    image?.dispatchEvent(new Event("error"))
  })

  expect(host.querySelector("img")).toBeNull()
  expect(host.querySelector('[role="status"]')?.textContent).toBe("图片预览不可用：generated output")
  expect(invoke).not.toHaveBeenCalled()
  act(() => root.unmount())
})

test("clears a failed remote preview when the source changes", async () => {
  const invoke = vi.fn()
  const { host, rerender, root } = await renderImage(invoke, "https://example.com/expired-output.png", "first output")

  await act(async () => {
    host.querySelector("img")?.dispatchEvent(new Event("error"))
  })
  expect(host.querySelector('[role="status"]')?.textContent).toBe("图片预览不可用：first output")

  await rerender("https://example.com/replacement-output.png", "replacement output")

  expect(host.querySelector('[role="status"]')).toBeNull()
  expect(host.querySelector("img")?.getAttribute("src")).toBe("https://example.com/replacement-output.png")
  expect(host.querySelector("img")?.getAttribute("alt")).toBe("replacement output")
  expect(invoke).not.toHaveBeenCalled()
  act(() => root.unmount())
})

test("replaces a remote preview that fails only after opening the viewer", async () => {
  const invoke = vi.fn()
  const { host, root } = await renderImage(invoke, "https://example.com/expiring-output.png", "generated output")

  await act(async () => {
    host.querySelector<HTMLButtonElement>(".oo-markdown-image-open")?.click()
  })
  const viewerImage = document.body.querySelector<HTMLImageElement>(".oo-markdown-image-viewer-image")
  expect(viewerImage).not.toBeNull()

  await act(async () => {
    viewerImage?.dispatchEvent(new Event("error"))
  })

  expect(document.body.querySelector(".oo-markdown-image-viewer")).toBeNull()
  expect(host.querySelector("img")).toBeNull()
  expect(host.querySelector('[role="status"]')?.textContent).toBe("图片预览不可用：generated output")
  expect(invoke).not.toHaveBeenCalled()
  act(() => root.unmount())
})

test("renders an unavailable state when a standalone viewer image fails", async () => {
  const invoke = vi.fn()
  const onError = vi.fn()
  const { root } = await renderViewerModal(invoke, onError)
  const viewerImage = document.body.querySelector<HTMLImageElement>(".oo-markdown-image-viewer-image")
  expect(viewerImage).not.toBeNull()

  await act(async () => {
    viewerImage?.dispatchEvent(new Event("error"))
  })

  expect(onError).toHaveBeenCalledTimes(1)
  expect(document.body.querySelector(".oo-markdown-image-viewer")).not.toBeNull()
  expect(
    document.body
      .querySelector(".oo-markdown-image-viewer-image")
      ?.closest(".oo-markdown-image-viewer-center")
      ?.classList.contains("hidden"),
  ).toBe(true)
  expect(document.body.querySelector('[role="status"]')?.textContent).toBe("图片预览不可用：attachment")
  expect(document.body.querySelector(".oo-markdown-image-viewer-zoom")).toBeNull()
  expect(invoke).not.toHaveBeenCalled()
  act(() => root.unmount())
})

test("revalidates the local path when a preview remounts", async () => {
  const firstInvoke = vi
    .fn()
    .mockResolvedValue({ resourceExpiresAt: Date.now() + 120_000, resourceUrl: "wanta-resource://first" })
  const first = await renderImage(firstInvoke)
  act(() => first.root.unmount())

  const secondInvoke = vi
    .fn()
    .mockResolvedValue({ resourceExpiresAt: Date.now() + 120_000, resourceUrl: "wanta-resource://second" })
  const second = await renderImage(secondInvoke)

  expect(firstInvoke).toHaveBeenCalledTimes(1)
  expect(secondInvoke).toHaveBeenCalledTimes(1)
  expect(second.host.querySelector("img")?.getAttribute("src")).toBe("wanta-resource://second")
  act(() => second.root.unmount())
})

test("keeps a Windows Markdown image at its authored position", async () => {
  const invoke = vi
    .fn()
    .mockResolvedValue({ resourceExpiresAt: Date.now() + 120_000, resourceUrl: "wanta-resource://inline" })
  const { host, root } = await renderResponse(
    String.raw`before ![artifact](C:\Users\Cheerego\artifact.png) after`,
    invoke,
  )

  const paragraph = host.querySelector("p")
  expect(paragraph?.textContent).toContain("before")
  expect(paragraph?.textContent).toContain("after")
  expect(paragraph?.querySelector('img[src="wanta-resource://inline"]')).not.toBeNull()
  expect(invoke).toHaveBeenCalledTimes(1)
  act(() => root.unmount())
})
