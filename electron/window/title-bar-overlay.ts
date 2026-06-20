import type { TitleBarOverlayOptions } from "electron"

export type WindowsTitleBarTheme = "light" | "dark"

export const windowsTitleBarOverlayHeight = 47

const windowsTitleBarOverlayColors: Record<WindowsTitleBarTheme, { color: string; symbolColor: string }> = {
  // 与 Chat desktop 的 Windows 顶栏叠层基线保持同步；高度少 1px 以露出顶栏底部分隔线。
  light: {
    color: "#ffffff",
    symbolColor: "#252a2e",
  },
  dark: {
    color: "#111213",
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

export function shouldApplyWindowsTitleBarTheme(
  lastAppliedTheme: WindowsTitleBarTheme | null,
  nextTheme: WindowsTitleBarTheme,
): boolean {
  return lastAppliedTheme !== nextTheme
}
