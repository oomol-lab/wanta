// @vitest-environment happy-dom

import type { AppContextValue } from "@/components/AppContext"
import type { Root } from "react-dom/client"

import * as React from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, expect, test, vi } from "vitest"
import { MarkdownImage } from "./message-image.tsx"
import { AppContext } from "@/components/AppContext"
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

async function renderImage(invoke: ReturnType<typeof vi.fn>): Promise<{ host: HTMLDivElement; root: Root }> {
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => {
    root.render(
      <I18nContext.Provider
        value={{ locale: "zh-CN", setLocale: () => undefined, t: (key, vars) => translate("zh-CN", key, vars) }}
      >
        <AppContext.Provider value={appContext({ invoke })}>
          <MarkdownImage src={String.raw`C:\Users\Cheerego\artifact.png`} alt="artifact" />
        </AppContext.Provider>
      </I18nContext.Provider>,
    )
    await Promise.resolve()
  })
  return { host, root }
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

test("retries a missing local preview instead of caching the empty result", async () => {
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
