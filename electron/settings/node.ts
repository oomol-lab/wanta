import type { WindowsTitleBarTheme } from "../window/title-bar-overlay.ts"
import type { AppSettings, CompletionNotificationCondition, SettingsService, ThemeSource } from "./common.ts"
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
import { DEFAULT_APP_SETTINGS, SettingsService as SettingsServiceName } from "./common.ts"

export interface SettingsServiceDeps {
  onSettingsChanged?: (settings: AppSettings) => Promise<void> | void
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
      persisted.themeSource === "light" || persisted.themeSource === "dark"
        ? persisted.themeSource
        : DEFAULT_APP_SETTINGS.themeSource
    const completionNotificationCondition: CompletionNotificationCondition =
      persisted.completionNotificationCondition === "never" ||
      persisted.completionNotificationCondition === "background" ||
      persisted.completionNotificationCondition === "always"
        ? persisted.completionNotificationCondition
        : DEFAULT_APP_SETTINGS.completionNotificationCondition
    return {
      completionNotificationCondition,
      knowledgeBaseBetaEnabled: booleanSetting(
        persisted.knowledgeBaseBetaEnabled,
        DEFAULT_APP_SETTINGS.knowledgeBaseBetaEnabled,
      ),
      notificationSoundEnabled: booleanSetting(
        persisted.notificationSoundEnabled,
        DEFAULT_APP_SETTINGS.notificationSoundEnabled,
      ),
      themeSource,
      unreadBadgeEnabled: booleanSetting(persisted.unreadBadgeEnabled, DEFAULT_APP_SETTINGS.unreadBadgeEnabled),
    }
  }

  public getSettings(): Promise<AppSettings> {
    return Promise.resolve(this.current())
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

  public setKnowledgeBaseBetaEnabled(enabled: boolean): Promise<void> {
    this.deps.store.write({ ...this.deps.store.read(), knowledgeBaseBetaEnabled: enabled })
    this.settingsChanged()
    return Promise.resolve()
  }

  public setCompletionNotificationCondition(condition: CompletionNotificationCondition): Promise<void> {
    const normalized: CompletionNotificationCondition =
      condition === "never" || condition === "background" || condition === "always"
        ? condition
        : DEFAULT_APP_SETTINGS.completionNotificationCondition
    this.deps.store.write({ ...this.deps.store.read(), completionNotificationCondition: normalized })
    this.settingsChanged()
    return Promise.resolve()
  }

  public setNotificationSoundEnabled(enabled: boolean): Promise<void> {
    this.deps.store.write({ ...this.deps.store.read(), notificationSoundEnabled: enabled })
    this.settingsChanged()
    return Promise.resolve()
  }

  public setUnreadBadgeEnabled(enabled: boolean): Promise<void> {
    this.deps.store.write({ ...this.deps.store.read(), unreadBadgeEnabled: enabled })
    this.settingsChanged()
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

  private settingsChanged(): void {
    const settings = this.current()
    void this.send("settingsChanged", settings).catch((error: unknown) => {
      console.warn("[wanta] settings broadcast failed:", error)
    })
    void Promise.resolve(this.deps.onSettingsChanged?.(settings)).catch((error: unknown) => {
      console.warn("[wanta] settings change handler failed:", error)
    })
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

function booleanSetting(value: boolean | undefined, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback
}
