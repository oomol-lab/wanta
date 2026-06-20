import type { TitleBarOverlayOptions } from "electron"

export type WindowsTitleBarTheme = "light" | "dark"

export const windowsTitleBarOverlayHeight = 48

const windowsTitleBarOverlayColors: Record<WindowsTitleBarTheme, { color: string; symbolColor: string }> = {
  // 与 src/index.css 里的顶栏背景/前景保持同步。
  light: {
    color: "#ffffff",
    symbolColor: "#1c2024",
  },
  dark: {
    color: "#111113",
    symbolColor: "#edeef0",
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

export function shouldApplyWindowsTitleBarTheme(
  lastAppliedTheme: WindowsTitleBarTheme | null,
  nextTheme: WindowsTitleBarTheme,
): boolean {
  return lastAppliedTheme !== nextTheme
}
