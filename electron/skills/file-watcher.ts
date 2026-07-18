import type { FSWatcher } from "node:fs"

import { watch } from "node:fs"
import { readdir } from "node:fs/promises"
import path from "node:path"
import { logDiagnostic, logDiagnosticOnChange } from "../diagnostics-log.ts"

const missingWatchRetryMs = 30_000
const watcherReconcileDelayMs = 250
const ignoredDirectoryNames = new Set([".git", "node_modules"])

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
  private readonly watchers = new Map<string, FSWatcher>()
  private watchPaths: SkillWatchPath[] = []
  private inventoryChangeTimer: NodeJS.Timeout | undefined
  private runtimeSkillSyncTimer: NodeJS.Timeout | undefined
  private watcherReconcileTimer: NodeJS.Timeout | undefined
  private missingWatchRetryTimer: NodeJS.Timeout | undefined
  private reconcileQueue: Promise<void> = Promise.resolve()
  private disposed = false

  public constructor(options: SkillFileWatcherOptions) {
    this.options = options
  }

  public start(paths: readonly SkillWatchPath[]): void {
    if (this.watchPaths.length > 0 || this.disposed) {
      return
    }
    const registeredPaths = new Set<string>()
    for (const watchPath of paths) {
      const { pathname } = watchPath
      if (registeredPaths.has(pathname)) {
        continue
      }
      registeredPaths.add(pathname)
      this.watchPaths.push(watchPath)
    }
    this.enqueueWatcherReconcile()
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
    for (const watcher of this.watchers.values()) {
      watcher.close()
    }
    this.watchers.clear()
    this.watchPaths = []
    if (this.inventoryChangeTimer) {
      clearTimeout(this.inventoryChangeTimer)
      this.inventoryChangeTimer = undefined
    }
    if (this.runtimeSkillSyncTimer) {
      clearTimeout(this.runtimeSkillSyncTimer)
      this.runtimeSkillSyncTimer = undefined
    }
    if (this.watcherReconcileTimer) {
      clearTimeout(this.watcherReconcileTimer)
      this.watcherReconcileTimer = undefined
    }
    if (this.missingWatchRetryTimer) {
      clearTimeout(this.missingWatchRetryTimer)
      this.missingWatchRetryTimer = undefined
    }
  }

  private enqueueWatcherReconcile(): void {
    const operation = this.reconcileQueue.catch(() => undefined).then(() => this.reconcileWatchers())
    this.reconcileQueue = operation.catch((error: unknown) => {
      logDiagnostic("skills", "failed to reconcile skill watchers", { error }, "warn")
    })
  }

  private scheduleWatcherReconcile(delayMs = watcherReconcileDelayMs): void {
    if (this.disposed || this.watcherReconcileTimer) return
    this.watcherReconcileTimer = setTimeout(() => {
      this.watcherReconcileTimer = undefined
      this.enqueueWatcherReconcile()
    }, delayMs)
    this.watcherReconcileTimer.unref()
  }

  private async reconcileWatchers(): Promise<void> {
    if (this.disposed) return
    const recursive = process.platform === "darwin" || process.platform === "win32"
    const desired = new Map<string, SkillWatchPath>()
    let missingPath = false

    for (const watchPath of this.watchPaths) {
      if (recursive) {
        desired.set(watchPath.pathname, watchPath)
        continue
      }
      try {
        for (const pathname of await listWatchDirectories(watchPath.pathname)) {
          const previous = desired.get(pathname)
          desired.set(pathname, {
            pathname,
            affectsRuntimeSkills: Boolean(previous?.affectsRuntimeSkills || watchPath.affectsRuntimeSkills),
            syncRuntimeSkills: Boolean(previous?.syncRuntimeSkills || watchPath.syncRuntimeSkills),
          })
        }
      } catch (error) {
        missingPath = true
        this.reportWatchError(watchPath.pathname, watchPath.affectsRuntimeSkills, false, error)
      }
    }

    for (const [pathname, watcher] of this.watchers) {
      if (desired.has(pathname)) continue
      watcher.close()
      this.watchers.delete(pathname)
    }
    for (const watchPath of desired.values()) {
      if (!this.watchers.has(watchPath.pathname)) this.registerWatcher(watchPath, recursive)
    }

    if (missingPath && !this.disposed && !this.missingWatchRetryTimer) {
      this.missingWatchRetryTimer = setTimeout(() => {
        this.missingWatchRetryTimer = undefined
        this.enqueueWatcherReconcile()
      }, missingWatchRetryMs)
      this.missingWatchRetryTimer.unref()
    }
  }

  private registerWatcher(watchPath: SkillWatchPath, recursive: boolean): void {
    const { pathname, affectsRuntimeSkills, syncRuntimeSkills } = watchPath
    try {
      const watcher = watch(pathname, { persistent: false, recursive }, () => {
        this.options.onFilesChanged()
        this.scheduleInventoryChanged()
        if (affectsRuntimeSkills) this.options.onRuntimeSkillsChanged()
        if (syncRuntimeSkills) this.scheduleExternalRuntimeSync()
        if (!recursive) this.scheduleWatcherReconcile()
      })
      watcher.on("error", (error) => {
        if (this.watchers.get(pathname) === watcher) this.watchers.delete(pathname)
        watcher.close()
        this.reportWatchError(pathname, affectsRuntimeSkills, recursive, error)
        this.scheduleWatcherReconcile()
      })
      this.watchers.set(pathname, watcher)
      logDiagnosticOnChange(`skill-service:watch:${pathname}`, "skill-service", "watching skill path", {
        affectsRuntimeSkills,
        pathname,
        recursive,
      })
    } catch (error) {
      this.reportWatchError(pathname, affectsRuntimeSkills, recursive, error)
      this.scheduleWatcherReconcile(missingWatchRetryMs)
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

export async function listWatchDirectories(rootPath: string): Promise<string[]> {
  const directories: string[] = []
  const pending = [rootPath]
  while (pending.length > 0) {
    const current = pending.pop()
    if (!current) continue
    directories.push(current)
    let entries
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch (error) {
      if (current === rootPath) throw error
      continue
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || ignoredDirectoryNames.has(entry.name)) continue
      pending.push(path.join(current, entry.name))
    }
  }
  return directories
}
