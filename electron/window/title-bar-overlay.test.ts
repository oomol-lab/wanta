import { describe, expect, it } from "vitest"
import {
  buildWindowsTitleBarOverlay,
  nativeFramelessWindowFrameForPlatform,
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
  it("uses native materials only where Electron supports them", () => {
    expect(nativeWindowMaterialForPlatform("darwin")).toBe("macos-vibrancy")
    expect(nativeWindowMaterialForPlatform("win32")).toBe("windows-mica")
    expect(nativeWindowMaterialForPlatform("linux")).toBe("none")
  })
})

describe("nativeFramelessWindowFrameForPlatform", () => {
  it("keeps the native Windows frame and rounded corners enabled", () => {
    expect(nativeFramelessWindowFrameForPlatform("win32")).toEqual({
      roundedCorners: true,
      thickFrame: true,
    })
  })

  it("does not override native frame behavior on other platforms", () => {
    expect(nativeFramelessWindowFrameForPlatform("darwin")).toEqual({})
    expect(nativeFramelessWindowFrameForPlatform("linux")).toEqual({})
  })
})

describe("windowBackgroundColorForMaterial", () => {
  it("keeps Linux and unsupported platforms opaque", () => {
    expect(windowBackgroundColorForMaterial("light", "none")).toBe("#ffffff")
    expect(windowBackgroundColorForMaterial("dark", "none")).toBe("#111113")
  })

  it("uses a transparent window background when native material is active", () => {
    expect(windowBackgroundColorForMaterial("light", "macos-vibrancy")).toBe(transparentWindowBackgroundColor)
    expect(windowBackgroundColorForMaterial("dark", "windows-mica")).toBe(transparentWindowBackgroundColor)
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
