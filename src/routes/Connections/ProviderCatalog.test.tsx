// @vitest-environment happy-dom
import * as React from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, expect, test, vi } from "vitest"
import { mergeConnectionSummary } from "../../../electron/connections/summary.ts"
import { ProviderCatalog } from "./ConnectionCatalog.tsx"
import { I18nContext, translate } from "@/i18n/i18n"

const { renders } = vi.hoisted(() => ({ renders: new Map<string, number>() }))
vi.mock("./ProviderIcon.tsx", () => ({
  ProviderIcon: ({ displayName }: { displayName: string }) => {
    renders.set(displayName, (renders.get(displayName) ?? 0) + 1)
    return <span>{displayName}</span>
  },
}))

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  document.body.replaceChildren()
  renders.clear()
})

test("selection and keyboard focus update only affected cards", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.useFakeTimers()
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(560)
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(256)
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  const scrollParentRef = { current: host }
  const providers = mergeConnectionSummary({
    apps: [],
    meta: null,
    workspace: { manageable: true, teamName: "test" },
    providers: Array.from({ length: 10 }, (_, index) => ({
      service: `app-${index}`,
      displayName: `App ${index}`,
      authTypes: ["oauth2"],
    })),
  }).providers
  const onSelect = vi.fn()
  const i18n = {
    locale: "en" as const,
    setLocale: () => undefined,
    t: (key: Parameters<typeof translate>[1], vars?: Parameters<typeof translate>[2]) => translate("en", key, vars),
  }
  const render = async (selectedService: string | null, title: string) => {
    await act(async () => {
      root.render(
        <I18nContext.Provider value={i18n}>
          <div title={title}>
            <ProviderCatalog
              canManageConnections
              providers={providers}
              scrollParentRef={scrollParentRef}
              selectedService={selectedService}
              showConnectionState
              onSelect={onSelect}
            />
          </div>
        </I18nContext.Provider>,
      )
      await vi.advanceTimersByTimeAsync(120)
    })
  }
  try {
    await render(null, "initial")
    expect(renders.size).toBeGreaterThan(2)
    renders.clear()
    await render(null, "unrelated parent update")
    expect(renders.size).toBe(0)
    await render("app-1", "selection")
    expect([...renders.keys()]).toEqual(["App 1"])
    renders.clear()
    await act(async () => host.querySelector<HTMLButtonElement>('[data-provider-index="1"]')!.focus())
    expect([...renders.keys()].sort()).toEqual(["App 0", "App 1"])
    await act(async () => {
      document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }))
      await vi.advanceTimersByTimeAsync(120)
    })
    // Index 1 is the last column; Down should move to index 3.
    await act(async () => {
      document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }))
      await vi.advanceTimersByTimeAsync(120)
    })
    expect(document.activeElement?.getAttribute("data-provider-index")).toBe("3")
  } finally {
    await act(async () => root.unmount())
  }
})
