// @vitest-environment happy-dom
import type { AppContextValue } from "@/components/AppContext"
import type { Root } from "react-dom/client"

import * as React from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, expect, test, vi } from "vitest"
import { deleteAttachmentPreviewUrl, setAttachmentPreviewUrl } from "./chat-attachment-utils.ts"
import { AttachmentList } from "./ChatAttachments.tsx"
import { attachmentPreviewRetryDelaysMs } from "./use-attachment-preview.ts"
import { AppContext } from "@/components/AppContext"
import { I18nContext, translate } from "@/i18n/i18n"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const attachment = {
  id: "input",
  path: "/snapshot/original.png",
  agentPath: "/internal/optimized.webp",
  name: "original.png",
  mime: "image/png",
  size: 512,
}
let root: Root | undefined
const result = (name = "fresh") => ({
  dataUrl: null,
  resourceUrl: `wanta-resource://${name}`,
  resourceExpiresAt: Date.now() + 900_000,
})
async function render(invoke: ReturnType<typeof vi.fn>) {
  const host = document.createElement("div")
  document.body.append(host)
  root = createRoot(host)
  await act(async () =>
    root!.render(
      <I18nContext.Provider
        value={{ locale: "zh-CN", setLocale: () => {}, t: (key, vars) => translate("zh-CN", key, vars) }}
      >
        <AppContext.Provider value={{ chatService: { invoke } } as unknown as AppContextValue}>
          <AttachmentList attachments={[attachment]} />
        </AppContext.Provider>
      </I18nContext.Provider>,
    ),
  )
  return host
}
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}
async function error(image: Element | null) {
  expect(image).not.toBeNull()
  await act(async () => {
    image!.dispatchEvent(new Event("error"))
  })
}
afterEach(() => {
  if (root) act(() => root!.unmount())
  root = undefined
  deleteAttachmentPreviewUrl(attachment.path)
  document.body.replaceChildren()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

test("recovers from an empty result and an IPC interruption without remounting", async () => {
  vi.useFakeTimers()
  const invoke = vi
    .fn()
    .mockResolvedValueOnce({ dataUrl: null })
    .mockRejectedValueOnce(new Error("IPC interrupted"))
    .mockResolvedValue(result())
  const host = await render(invoke)
  await advance(250)
  await advance(750)
  expect(host.querySelector("img")?.getAttribute("src")).toBe("wanta-resource://fresh")
  expect(invoke).toHaveBeenCalledTimes(3)
})

test("bounds retries and supports an explicit retry", async () => {
  vi.useFakeTimers()
  const invoke = vi.fn().mockResolvedValue({ dataUrl: null, reason: "read_failed" })
  const host = await render(invoke)
  await advance(10_000)
  expect(invoke).toHaveBeenCalledTimes(attachmentPreviewRetryDelaysMs.length + 1)
  expect(host.textContent).toContain("重试")
  invoke.mockResolvedValue(result())
  await act(async () => host.querySelector("button")!.click())
  expect(host.querySelector("img")).not.toBeNull()
})

test.each([
  ["too_large", "16 MB"],
  ["unsupported_type", "格式"],
])("does not retry terminal %s results", async (reason, text) => {
  vi.useFakeTimers()
  const invoke = vi.fn().mockResolvedValue({ dataUrl: null, reason })
  const host = await render(invoke)
  await advance(10_000)
  expect(invoke).toHaveBeenCalledTimes(1)
  expect(host.querySelector("button")!.title).toContain(text)
})

test("does not automatically retry access denial", async () => {
  vi.useFakeTimers()
  const invoke = vi.fn().mockRejectedValue(new Error("Local path is not available from this conversation."))
  const host = await render(invoke)
  await advance(10_000)
  expect(invoke).toHaveBeenCalledTimes(1)
  expect(host.textContent).toContain("重试")
})

test("renews an expired URL when opening the viewer and shares recovery with the thumbnail", async () => {
  vi.useFakeTimers()
  setAttachmentPreviewUrl(attachment.path, "wanta-resource://old", Date.now() + 120_000)
  const invoke = vi.fn().mockResolvedValueOnce(result("renewed")).mockResolvedValue(result("recovered"))
  const host = await render(invoke)
  expect(invoke).not.toHaveBeenCalled()
  await advance(120_000)
  await act(async () => host.querySelector("button")!.click())
  expect(document.querySelector(".oo-markdown-image-viewer-image")?.getAttribute("src")).toBe(
    "wanta-resource://renewed",
  )
  await error(document.querySelector(".oo-markdown-image-viewer-image"))
  await advance(250)
  expect(host.querySelector("img")?.getAttribute("src")).toBe("wanta-resource://recovered")
  expect(document.querySelector(".oo-markdown-image-viewer-image")?.getAttribute("src")).toBe(
    "wanta-resource://recovered",
  )
})

test("resets the retry budget only after decoding succeeds", async () => {
  vi.useFakeTimers()
  const invoke = vi.fn().mockImplementation(async () => result(String(invoke.mock.calls.length)))
  const host = await render(invoke)
  await error(host.querySelector("img"))
  await advance(250)
  await act(async () => {
    host.querySelector("img")!.dispatchEvent(new Event("load"))
  })
  await error(host.querySelector("img"))
  await advance(250)
  expect(invoke).toHaveBeenCalledTimes(3)
  expect(host.querySelector("img")).not.toBeNull()
})

test("a failed viewer stays open with an explicit retry", async () => {
  vi.useFakeTimers()
  const invoke = vi.fn().mockResolvedValueOnce(result()).mockResolvedValue({ dataUrl: null })
  const host = await render(invoke)
  await act(async () => host.querySelector("button")!.click())
  await error(document.querySelector(".oo-markdown-image-viewer-image"))
  await advance(10_000)
  expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  const retry = Array.from(document.querySelectorAll("button")).find((button) => button.textContent === "重试")!
  invoke.mockResolvedValue(result("manual"))
  await act(async () => retry.click())
  expect(document.querySelector(".oo-markdown-image-viewer-image")?.getAttribute("src")).toBe("wanta-resource://manual")
})

test("right-click copies the original snapshot even when preview is unavailable", async () => {
  const invoke = vi.fn().mockResolvedValue({ dataUrl: null, reason: "too_large" })
  const host = await render(invoke)
  await act(async () => {
    host.querySelector("button")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, button: 2 }))
  })
  const copy = Array.from(document.querySelectorAll('[role="menuitem"]')).find((item) =>
    item.textContent?.includes("复制图片"),
  ) as HTMLElement
  expect(copy).toBeDefined()
  await act(async () => copy.click())
  expect(invoke).toHaveBeenCalledWith("copyLocalImage", { path: attachment.path })
})

test("unmount cancels pending retries", async () => {
  vi.useFakeTimers()
  const invoke = vi.fn().mockResolvedValue({ dataUrl: null })
  await render(invoke)
  act(() => root!.unmount())
  root = undefined
  await advance(10_000)
  expect(invoke).toHaveBeenCalledTimes(1)
})

test("ignores late responses after the attachment is unmounted", async () => {
  let resolve!: (value: ReturnType<typeof result>) => void
  const invoke = vi.fn().mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done
      }),
  )
  await render(invoke)
  act(() => root!.unmount())
  root = undefined
  await act(async () => resolve(result("late")))
  const nextInvoke = vi.fn().mockResolvedValue(result("current"))
  const host = await render(nextInvoke)
  expect(nextInvoke).toHaveBeenCalledTimes(1)
  expect(host.querySelector("img")?.getAttribute("src")).toBe("wanta-resource://current")
})

test("recovers from a revoked draft blob through the original snapshot", async () => {
  vi.useFakeTimers()
  setAttachmentPreviewUrl(attachment.path, "blob:retired-draft")
  const invoke = vi.fn().mockResolvedValue(result())
  const host = await render(invoke)
  deleteAttachmentPreviewUrl(attachment.path)
  await error(host.querySelector("img"))
  await advance(250)
  expect(invoke).toHaveBeenCalledWith("getAttachmentPreview", { path: attachment.path, mime: attachment.mime })
  expect(host.querySelector("img")?.getAttribute("src")).toBe("wanta-resource://fresh")
})

test("repeated decode failures stop rather than cycling through fresh URLs forever", async () => {
  vi.useFakeTimers()
  const invoke = vi.fn().mockImplementation(async () => result(String(invoke.mock.calls.length)))
  const host = await render(invoke)
  for (const delay of attachmentPreviewRetryDelaysMs) {
    await error(host.querySelector("img"))
    await advance(delay)
  }
  await error(host.querySelector("img"))
  await advance(10_000)
  expect(invoke).toHaveBeenCalledTimes(attachmentPreviewRetryDelaysMs.length + 1)
  expect(host.textContent).toContain("重试")
})
