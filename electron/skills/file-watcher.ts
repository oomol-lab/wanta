import type { FSWatcher } from "node:fs"

import { watch } from "node:fs"
import { logDiagnostic, logDiagnosticOnChange } from "../diagnostics-log.ts"

export interface SkillWatchPath {
  affectsRuntimeSkills: boolean
  pathname: string
  syncRuntimeSkills: boolean
}

export interface SkillFileWatcherOptions {
  onExternalRuntimeSync: () => Promise<void>
  onFilesChanged: () => void
  onInventoryChanged: () => Promise<void>
  onRuntimeSkillsChanged: () => void
}

/** 集中管理 skill 目录监听、去重注册和两类 debounce，service 只处理实际同步与事件广播。 */
export class SkillFileWatcher {
  private readonly options: SkillFileWatcherOptions
  private readonly watchers: FSWatcher[] = []
  private inventoryChangeTimer: NodeJS.Timeout | undefined
  private runtimeSkillSyncTimer: NodeJS.Timeout | undefined
  private disposed = false

  public constructor(options: SkillFileWatcherOptions) {
    this.options = options
  }

  public start(paths: readonly SkillWatchPath[]): void {
    if (this.watchers.length > 0 || this.disposed) {
      return
    }
    const registeredPaths = new Set<string>()
    const recursive = process.platform === "darwin" || process.platform === "win32"
    for (const { pathname, affectsRuntimeSkills, syncRuntimeSkills } of paths) {
      if (registeredPaths.has(pathname)) {
        continue
      }
      registeredPaths.add(pathname)
      try {
        const watcher = watch(pathname, { persistent: false, recursive }, () => {
          this.options.onFilesChanged()
          this.scheduleInventoryChanged()
          if (affectsRuntimeSkills) {
            this.options.onRuntimeSkillsChanged()
          }
          if (syncRuntimeSkills) {
            this.scheduleExternalRuntimeSync()
          }
        })
        watcher.on("error", (error) => this.reportWatchError(pathname, affectsRuntimeSkills, recursive, error))
        this.watchers.push(watcher)
        logDiagnosticOnChange(`skill-service:watch:${pathname}`, "skill-service", "watching skill path", {
          affectsRuntimeSkills,
          pathname,
          recursive,
        })
      } catch (error) {
        this.reportWatchError(pathname, affectsRuntimeSkills, recursive, error)
        // 目录可能尚不存在；focus/background refresh 仍会兜底发现后续变化。
      }
    }
  }

  private reportWatchError(pathname: string, affectsRuntimeSkills: boolean, recursive: boolean, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error)
    const isMissing = message.includes("ENOENT")
    logDiagnosticOnChange(
      `skill-service:watch:${pathname}`,
      "skill-service",
      "failed to watch skill path",
      { affectsRuntimeSkills, error: message, pathname, recursive },
      isMissing ? "trace" : "warn",
      isMissing
        ? { affectsRuntimeSkills, missing: true, pathname, recursive }
        : { affectsRuntimeSkills, error: message, pathname, recursive },
    )
  }

  public dispose(): void {
    this.disposed = true
    for (const watcher of this.watchers) {
      watcher.close()
    }
    this.watchers.length = 0
    if (this.inventoryChangeTimer) {
      clearTimeout(this.inventoryChangeTimer)
      this.inventoryChangeTimer = undefined
    }
    if (this.runtimeSkillSyncTimer) {
      clearTimeout(this.runtimeSkillSyncTimer)
      this.runtimeSkillSyncTimer = undefined
    }
  }

  private scheduleInventoryChanged(): void {
    if (this.inventoryChangeTimer) {
      clearTimeout(this.inventoryChangeTimer)
    }
    this.inventoryChangeTimer = setTimeout(() => {
      this.inventoryChangeTimer = undefined
      void this.options.onInventoryChanged().catch((error: unknown) => {
        logDiagnostic("skills", "failed to emit inventory change", { error }, "warn")
      })
    }, 300)
    this.inventoryChangeTimer.unref()
  }

  private scheduleExternalRuntimeSync(): void {
    if (this.runtimeSkillSyncTimer) {
      clearTimeout(this.runtimeSkillSyncTimer)
    }
    this.runtimeSkillSyncTimer = setTimeout(() => {
      this.runtimeSkillSyncTimer = undefined
      void this.options.onExternalRuntimeSync().catch((error: unknown) => {
        console.warn("[wanta] failed to sync external skills to runtime:", error)
        logDiagnostic("skills", "failed to sync external skills to runtime", { error }, "warn")
      })
    }, 500)
    this.runtimeSkillSyncTimer.unref()
  }
}
