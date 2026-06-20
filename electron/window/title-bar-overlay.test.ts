import { describe, expect, it } from "vitest"
import {
  buildWindowsTitleBarOverlay,
  resolveWindowsTitleBarTheme,
  shouldApplyWindowsTitleBarTheme,
  windowBackgroundColorForTheme,
  windowsTitleBarOverlayHeight,
} from "./title-bar-overlay.ts"

describe("buildWindowsTitleBarOverlay", () => {
  it("uses the light title bar colors", () => {
    expect(buildWindowsTitleBarOverlay("light")).toEqual({
      color: "#ffffff",
      symbolColor: "#1c2024",
      height: windowsTitleBarOverlayHeight,
    })
  })

  it("uses the dark title bar colors", () => {
    expect(buildWindowsTitleBarOverlay("dark")).toEqual({
      color: "#111113",
      symbolColor: "#edeef0",
      height: windowsTitleBarOverlayHeight,
    })
  })
})

describe("windowBackgroundColorForTheme", () => {
  it("matches the overlay background color", () => {
    expect(windowBackgroundColorForTheme("light")).toBe("#ffffff")
    expect(windowBackgroundColorForTheme("dark")).toBe("#111113")
  })
})

describe("resolveWindowsTitleBarTheme", () => {
  it("maps nativeTheme dark state to a title bar theme", () => {
    expect(resolveWindowsTitleBarTheme(false)).toBe("light")
    expect(resolveWindowsTitleBarTheme(true)).toBe("dark")
  })
})

describe("shouldApplyWindowsTitleBarTheme", () => {
  it("returns true when the next theme differs from the last applied theme", () => {
    expect(shouldApplyWindowsTitleBarTheme(null, "light")).toBe(true)
    expect(shouldApplyWindowsTitleBarTheme("light", "dark")).toBe(true)
  })

  it("returns false when the theme is unchanged", () => {
    expect(shouldApplyWindowsTitleBarTheme("light", "light")).toBe(false)
    expect(shouldApplyWindowsTitleBarTheme("dark", "dark")).toBe(false)
  })
})
