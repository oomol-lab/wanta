import type { I18nContextValue } from "./i18n.ts"
import type { Root } from "react-dom/client"

// @vitest-environment happy-dom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { localeStorageKey, useI18n } from "./i18n.ts"
import { I18nProvider } from "./I18nProvider.tsx"

let root: Root
let container: HTMLDivElement
let current: I18nContextValue
function Probe() {
  current = useI18n()
  return <input aria-label={current.t("settings.language")} defaultValue="draft survives language changes" />
}
async function mount() {
  await act(async () => {
    root.render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    )
  })
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.stubEnv("VITE_WANTA_LOCALE", "")
  localStorage.clear()
  vi.spyOn(navigator, "languages", "get").mockReturnValue(["en-US"])
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})
it("migrates legacy preference and preserves mounted input when switching", async () => {
  const setAppLocale = vi.fn()
  vi.stubGlobal("wanta", { getAppLocalePreference: async () => null, setAppLocale })
  localStorage.setItem(localeStorageKey, "zh-CN")
  await mount()
  expect(setAppLocale).toHaveBeenLastCalledWith("zh-CN", "zh-CN")
  const input = container.querySelector("input")!
  input.value = "unfinished draft"
  await act(async () => current.setLocale("fr"))
  expect(document.documentElement.lang).toBe("fr")
  expect(container.querySelector("input")).toBe(input)
  expect(input.value).toBe("unfinished draft")
  expect(localStorage.getItem(localeStorageKey)).toBe("fr")
  expect(setAppLocale).toHaveBeenLastCalledWith("fr", "fr")
})
it("uses native persisted preference over the startup cache", async () => {
  vi.stubGlobal("wanta", { getAppLocalePreference: async () => "ja", setAppLocale: vi.fn() })
  localStorage.setItem(localeStorageKey, "en")
  await mount()
  expect(current.locale).toBe("ja")
  expect(current.preference).toBe("ja")
})
it("follows system language changes only in system mode", async () => {
  vi.stubGlobal("wanta", { getAppLocalePreference: async () => "system", setAppLocale: vi.fn() })
  await mount()
  vi.spyOn(navigator, "languages", "get").mockReturnValue(["zh-Hant-HK"])
  await act(async () => window.dispatchEvent(new Event("languagechange")))
  expect(current.locale).toBe("zh-TW")
  await act(async () => current.setLocale("ru"))
  vi.spyOn(navigator, "languages", "get").mockReturnValue(["ko-KR"])
  await act(async () => window.dispatchEvent(new Event("languagechange")))
  expect(current.locale).toBe("ru")
})
it("does not overwrite a selection made while native preferences load", async () => {
  let resolve!: (locale: string) => void
  vi.stubGlobal("wanta", {
    getAppLocalePreference: () =>
      new Promise<string>((done) => {
        resolve = done
      }),
    setAppLocale: vi.fn(),
  })
  await mount()
  await act(async () => current.setLocale("es"))
  await act(async () => resolve("ja"))
  expect(current.locale).toBe("es")
})

it("does not persist a development locale override", async () => {
  vi.stubEnv("VITE_WANTA_LOCALE", "ko")
  const setAppLocale = vi.fn()
  vi.stubGlobal("wanta", { getAppLocalePreference: async () => "ja", setAppLocale })
  localStorage.setItem(localeStorageKey, "ja")
  await mount()
  expect(current.locale).toBe("ko")
  expect(localStorage.getItem(localeStorageKey)).toBe("ja")
  expect(setAppLocale).toHaveBeenLastCalledWith("ko", undefined)
})
