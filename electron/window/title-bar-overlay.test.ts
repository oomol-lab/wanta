import { describe, expect, it } from "vitest"
import {
  buildWindowsTitleBarOverlay,
  nativeWindowFrameForPlatform,
  nativeWindowMaterialForPlatform,
  resolveWindowsTitleBarTheme,
  shouldApplyWindowsTitleBarTheme,
  transparentWindowBackgroundColor,
  windowBackgroundColorForMaterial,
  windowBackgroundColorForTheme,
  windowsTitleBarOverlayHeight,
} from "./title-bar-overlay.ts"

describe("buildWindowsTitleBarOverlay", () => {
  it("uses the light title bar colors", () => {
    expect(buildWindowsTitleBarOverlay("light")).toEqual({
      color: "#ffffff",
      symbolColor: "#252a2e",
      height: windowsTitleBarOverlayHeight,
    })
  })

  it("uses the dark title bar colors", () => {
    expect(buildWindowsTitleBarOverlay("dark")).toEqual({
      color: "#111113",
      symbolColor: "#f0f6fc",
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

describe("nativeWindowMaterialForPlatform", () => {
  it("keeps Windows opaque while retaining macOS vibrancy", () => {
    expect(nativeWindowMaterialForPlatform("darwin")).toBe("macos-vibrancy")
    expect(nativeWindowMaterialForPlatform("win32")).toBe("none")
    expect(nativeWindowMaterialForPlatform("linux")).toBe("none")
  })
})

describe("nativeWindowFrameForPlatform", () => {
  it("keeps the native Windows frame so DWM owns the window outline", () => {
    expect(nativeWindowFrameForPlatform("win32")).toEqual({})
  })

  it("preserves the existing platform behavior elsewhere", () => {
    expect(nativeWindowFrameForPlatform("darwin")).toEqual({})
    expect(nativeWindowFrameForPlatform("linux")).toEqual({ frame: false })
    expect(nativeWindowFrameForPlatform("freebsd")).toEqual({ frame: false })
  })
})

describe("windowBackgroundColorForMaterial", () => {
  it("keeps Linux and unsupported platforms opaque", () => {
    expect(windowBackgroundColorForMaterial("light", "none")).toBe("#ffffff")
    expect(windowBackgroundColorForMaterial("dark", "none")).toBe("#111113")
  })

  it("uses a transparent window background only when macOS vibrancy is active", () => {
    expect(windowBackgroundColorForMaterial("light", "macos-vibrancy")).toBe(transparentWindowBackgroundColor)
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
