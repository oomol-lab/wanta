import type { TitleBarOverlayOptions } from "electron"

export type WindowsTitleBarTheme = "light" | "dark"
export type NativeWindowMaterial = "macos-vibrancy" | "windows-mica" | "none"

export const windowsTitleBarOverlayHeight = 47
export const transparentWindowBackgroundColor = "#00000000"

const windowsTitleBarOverlayColors: Record<WindowsTitleBarTheme, { color: string; symbolColor: string }> = {
  // 背景色需与 src/index.css 的 --background 保持一致；高度少 1px 以露出顶栏底部分隔线。
  light: {
    color: "#ffffff",
    symbolColor: "#252a2e",
  },
  dark: {
    color: "#111113",
    symbolColor: "#f0f6fc",
  },
}

export function resolveWindowsTitleBarTheme(shouldUseDarkColors: boolean): WindowsTitleBarTheme {
  return shouldUseDarkColors ? "dark" : "light"
}

export function buildWindowsTitleBarOverlay(theme: WindowsTitleBarTheme): TitleBarOverlayOptions {
  return {
    ...windowsTitleBarOverlayColors[theme],
    height: windowsTitleBarOverlayHeight,
  }
}

export function windowBackgroundColorForTheme(theme: WindowsTitleBarTheme): string {
  return windowsTitleBarOverlayColors[theme].color
}

export function nativeWindowMaterialForPlatform(platform: NodeJS.Platform): NativeWindowMaterial {
  if (platform === "darwin") {
    return "macos-vibrancy"
  }
  if (platform === "win32") {
    return "windows-mica"
  }
  return "none"
}

export function windowBackgroundColorForMaterial(theme: WindowsTitleBarTheme, material: NativeWindowMaterial): string {
  return material === "none" ? windowBackgroundColorForTheme(theme) : transparentWindowBackgroundColor
}

export function shouldApplyWindowsTitleBarTheme(
  lastAppliedTheme: WindowsTitleBarTheme | null,
  nextTheme: WindowsTitleBarTheme,
): boolean {
  return lastAppliedTheme !== nextTheme
}
