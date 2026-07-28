import { describe, expect, it } from "vitest"
import { browserBackgroundTheme, browserLocatorSelector } from "./page.ts"

describe("browser locator selector", () => {
  it("maps top-level and frame-prefixed AI snapshot refs to Playwright aria refs", () => {
    expect(browserLocatorSelector("e36")).toBe("aria-ref=e36")
    expect(browserLocatorSelector("f1e36")).toBe("aria-ref=f1e36")
    expect(browserLocatorSelector("f24e908")).toBe("aria-ref=f24e908")
  })

  it("preserves explicit Playwright selectors", () => {
    expect(browserLocatorSelector('input[name="wd"]')).toBe('input[name="wd"]')
    expect(browserLocatorSelector("aria-ref=f1e36")).toBe("aria-ref=f1e36")
  })

  it("rejects an empty target", () => {
    expect(() => browserLocatorSelector("  ")).toThrow("A browser target is required.")
  })
})

describe("browser background theme", () => {
  it("uses a light backing surface for pages that explicitly support only light mode", () => {
    expect(browserBackgroundTheme("light", "dark")).toBe("light")
    expect(browserBackgroundTheme("only light", "dark")).toBe("light")
  })

  it("keeps the app theme for dark-capable and unspecified pages", () => {
    expect(browserBackgroundTheme("light dark", "dark")).toBe("dark")
    expect(browserBackgroundTheme("normal", "dark")).toBe("dark")
    expect(browserBackgroundTheme(null, "light")).toBe("light")
  })
})
