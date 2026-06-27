import type { WindowsTitleBarTheme } from "../window/title-bar-overlay.ts"
import type { AppSettings, SettingsService, ThemeSource } from "./common.ts"
import type { SettingsStore } from "./store.ts"
import type { IConnectionService } from "@oomol/connection"

import { ConnectionService } from "@oomol/connection"
import { BrowserWindow, nativeTheme } from "electron"
import {
  buildWindowsTitleBarOverlay,
  nativeWindowMaterialForPlatform,
  resolveWindowsTitleBarTheme,
  shouldApplyWindowsTitleBarTheme,
  windowBackgroundColorForMaterial,
} from "../window/title-bar-overlay.ts"
import { SettingsService as SettingsServiceName } from "./common.ts"

export interface SettingsServiceDeps {
  store: SettingsStore
}

export class SettingsServiceImpl
  extends ConnectionService<SettingsService>
  implements IConnectionService<SettingsService>
{
  private readonly deps: SettingsServiceDeps
  private lastAppliedWindowsTitleBarTheme: WindowsTitleBarTheme | null = null
  private nativeThemeListenerInstalled = false

  public constructor(deps: SettingsServiceDeps) {
    super(SettingsServiceName)
    this.deps = deps
  }

  private readonly handleNativeThemeUpdated = (): void => {
    this.applyWindowsTitleBarOverlay()
  }

  /** 从持久化读取当前设置（含默认值兜底）。 */
  public current(): AppSettings {
    const persisted = this.deps.store.read()
    const themeSource: ThemeSource =
      persisted.themeSource === "light" || persisted.themeSource === "dark" ? persisted.themeSource : "system"
    return { themeSource }
  }

  /** 启动时把持久化的 themeSource 应用到 nativeTheme（窗口背景一致）。 */
  public applyStartupTheme(): void {
    nativeTheme.themeSource = this.current().themeSource
    this.installNativeThemeListener()
    this.applyWindowsTitleBarOverlay()
  }

  public setThemeSource(source: ThemeSource): Promise<void> {
    nativeTheme.themeSource = source
    this.applyWindowsTitleBarOverlay()
    this.deps.store.write({ ...this.deps.store.read(), themeSource: source })
    return Promise.resolve()
  }

  public override dispose(): void {
    nativeTheme.off("updated", this.handleNativeThemeUpdated)
    this.nativeThemeListenerInstalled = false
    super.dispose()
  }

  private installNativeThemeListener(): void {
    if (this.nativeThemeListenerInstalled) {
      return
    }

    nativeTheme.on("updated", this.handleNativeThemeUpdated)
    this.nativeThemeListenerInstalled = true
  }

  private applyWindowsTitleBarOverlay(): void {
    if (process.platform !== "win32") {
      return
    }

    const windows = BrowserWindow.getAllWindows().filter((window) => !window.isDestroyed())
    if (windows.length === 0) {
      return
    }

    const nextTheme = resolveWindowsTitleBarTheme(nativeTheme.shouldUseDarkColors)
    if (!shouldApplyWindowsTitleBarTheme(this.lastAppliedWindowsTitleBarTheme, nextTheme)) {
      return
    }

    const overlay = buildWindowsTitleBarOverlay(nextTheme)
    const material = nativeWindowMaterialForPlatform(process.platform)
    const backgroundColor = windowBackgroundColorForMaterial(nextTheme, material)
    for (const window of windows) {
      window.setBackgroundColor(backgroundColor)
      if (material === "windows-mica") {
        window.setBackgroundMaterial("mica")
      }
      window.setTitleBarOverlay(overlay)
    }
    this.lastAppliedWindowsTitleBarTheme = nextTheme
  }
}
