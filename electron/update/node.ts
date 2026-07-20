import type { SettingsStore } from "../settings/store.ts"
import type { UpdateChannel } from "./channel.ts"
import type { AppUpdateState, AppUpdateStatus, UpdateService } from "./common.ts"
import type { IConnectionService } from "@oomol/connection"
import type { UpdateCheckResult } from "electron-updater"

import { ConnectionService } from "@oomol/connection"
import { app, powerMonitor } from "electron"
import updaterPkg from "electron-updater"
import { branding } from "../branding.ts"
import { logDiagnostic } from "../diagnostics-log.ts"
import { staticBaseUrl } from "../domain.ts"
import { resolveUpdateChannel, updaterChannelName } from "./channel.ts"
import { UpdateService as UpdateServiceName } from "./common.ts"
import {
  foregroundUpdateCheckDelayRangeMs,
  hasRecentSuccessfulCheck,
  jitteredUpdateCheckIntervalMs,
  randomDelayMs,
  resumeUpdateCheckDelayRangeMs,
  shouldCheckAfterForeground,
  shouldCheckAfterResume,
  startupUpdateCheckDelayRangeMs,
} from "./policy.ts"

// 结构移植自 oo-desktop electron/update/node.ts（状态机 / in-flight 去重 / 404 容忍重试），
// 裁去 telemetry 与 apply-outcome 跟踪（Wanta 无 telemetry 基建），加渠道管理。
// 渠道经 setFeedURL 的 GenericServerOptions.channel 传入——刻意不用 autoUpdater.channel
// setter：该 setter 会静默把 allowDowngrade 置 true（electron-updater AppUpdater 源码），
// 与"beta 切回 stable 默认等下一个正式版、绝不自动降级"的策略冲突。

const missingAssetRetryDelayMs = 60_000
const missingAssetMaxRetries = 3
// Electron net.request 不触发 'socket' 事件，builder-util-runtime 的 60s 库级超时在打包态
// 从不生效——feed 被防火墙黑洞时 checkForUpdates 永远 pending。服务级超时兜底：超时后
// 状态可恢复（按钮重新可点），但底层库级请求未结清前不会发起新请求（库级去重会粘回
// 旧请求，见 runCheck 的序列化），届时明确报 "Update check timed out"。
const checkTimeoutMs = 120_000

type ElectronUpdaterModule = typeof import("electron-updater")
type AutoUpdater = ElectronUpdaterModule["autoUpdater"]

export interface UpdateServiceDeps {
  beforeInstallDownloadedAppUpdate?: () => void | Promise<void>
  onStateChanged?: (state: AppUpdateState) => void
  store: SettingsStore
}

export class UpdateServiceImpl extends ConnectionService<UpdateService> implements IConnectionService<UpdateService> {
  private autoUpdater: AutoUpdater | undefined
  private boundListeners: Array<[string, (...args: never[]) => void]> = []
  private cancellationToken: UpdateCheckResult["cancellationToken"] | undefined
  // 渠道的内存真源（settings.json 仅持久化）：patchStatus 在 download-progress 等高频
  // 事件里运行，不能每次同步读盘（主进程 fs 纪律）。
  private channel: UpdateChannel
  // 渠道切换代数：切换后在途检查的结果一律按陈旧丢弃，防止旧渠道结果被标上新渠道。
  private checkGeneration = 0
  private configuredChannel: "latest" | "beta" | undefined
  private inFlightCheck: Promise<AppUpdateState> | undefined
  private inFlightDownload: { generation: number; promise: Promise<void> } | undefined
  private activeDownload: { generation: number; version: string } | undefined
  // 库级 checkForUpdates 的在途跟踪：electron-updater 自带去重会把新调用粘到旧请求上，
  // 渠道切换后必须确认上一轮已结清才能发起（见 runCheck）。
  private libraryCheck: Promise<unknown> | undefined
  private libraryCheckSettled = true
  private missingAssetRetryAttempt = 0
  private missingAssetRetryGeneration = 0
  private missingAssetRetryTimer: NodeJS.Timeout | undefined
  private backgroundCheckTimer: NodeJS.Timeout | undefined
  private foregroundCheckTimer: NodeJS.Timeout | undefined
  private backgroundChecksStarted = false
  private readonly handleSystemResume = (): void => {
    if (!shouldCheckAfterResume(this.state.checkedAt, Date.now())) {
      return
    }
    this.scheduleBackgroundCheck(
      randomDelayMs(resumeUpdateCheckDelayRangeMs.min, resumeUpdateCheckDelayRangeMs.max, Math.random()),
      "resume",
    )
  }
  private state: AppUpdateState
  private readonly deps: UpdateServiceDeps

  public constructor(deps: UpdateServiceDeps) {
    super(UpdateServiceName)
    this.deps = deps
    this.channel = resolveUpdateChannel(deps.store.read().updateChannel, app.getVersion())
    this.state = { ...this.snapshotBase(), status: { status: "idle" } }
  }

  public getAppUpdateState(): Promise<AppUpdateState> {
    return Promise.resolve(this.state)
  }

  /** 启动跨平台后台更新调度：延迟首查、周期检查，并在 Windows/macOS/Linux 唤醒后按 TTL 补查。 */
  public startBackgroundChecks(): void {
    if (this.backgroundChecksStarted || !app.isPackaged) {
      return
    }
    this.backgroundChecksStarted = true
    powerMonitor.on("resume", this.handleSystemResume)
    this.scheduleBackgroundCheck(
      randomDelayMs(startupUpdateCheckDelayRangeMs.min, startupUpdateCheckDelayRangeMs.max, Math.random()),
      "startup",
    )
  }

  /** 窗口重新进入前台且上次成功检查已超过 30 分钟时，短延迟补查；不重置周期定时器。 */
  public handleWindowForegrounded(): void {
    if (
      !this.backgroundChecksStarted ||
      this.foregroundCheckTimer ||
      !shouldCheckAfterForeground(this.state.checkedAt, Date.now())
    ) {
      return
    }
    const delayMs = randomDelayMs(
      foregroundUpdateCheckDelayRangeMs.min,
      foregroundUpdateCheckDelayRangeMs.max,
      Math.random(),
    )
    logDiagnostic("update-service", "foreground update check scheduled", {
      checkedAt: this.state.checkedAt,
      delayMs,
      scheduledAt: new Date(Date.now() + delayMs).toISOString(),
    })
    this.foregroundCheckTimer = setTimeout(() => {
      this.foregroundCheckTimer = undefined
      if (!shouldCheckAfterForeground(this.state.checkedAt, Date.now())) return
      void this.runBackgroundCheck("foreground")
    }, delayMs)
    this.foregroundCheckTimer.unref()
  }

  public async checkForAppUpdate(): Promise<AppUpdateState> {
    if (this.inFlightCheck) {
      return this.inFlightCheck
    }
    const promise = this.runCheck(false)
    this.inFlightCheck = promise
    try {
      return await promise
    } finally {
      if (this.inFlightCheck === promise) {
        this.inFlightCheck = undefined
      }
    }
  }

  public async downloadAppUpdate(): Promise<void> {
    const generation = this.checkGeneration
    const current = this.inFlightDownload
    if (current) {
      if (current.generation === generation) return current.promise
      await current.promise.catch(() => undefined)
      if (generation !== this.checkGeneration) return
      return this.downloadAppUpdate()
    }
    const promise = this.runDownload(generation)
    const inFlight = { generation, promise }
    this.inFlightDownload = inFlight
    try {
      await promise
    } finally {
      if (this.inFlightDownload === inFlight) {
        this.inFlightDownload = undefined
      }
    }
  }

  public async installDownloadedAppUpdate(): Promise<void> {
    // 不设本地闩锁：quitAndInstall 失败都走异步 'error' 事件（届时状态离开 downloaded，
    // 按钮自然消失），重复调用由 electron-updater 自身去重。
    if (!app.isPackaged || this.state.status.status !== "downloaded") {
      return
    }
    logDiagnostic(
      "update-service",
      "install downloaded update requested",
      { channel: this.channel, version: this.state.status.version },
      "info",
    )
    // macOS 的 quitAndInstall 会先 close 所有窗口，再触发 app.before-quit。必须提前让
    // 主窗口 close handler 放行，否则窗口会被 hide-on-close 逻辑拦住，安装流程停在重启中。
    // 同时 await 该回调：Wanta 在此把 opencode 工具子进程树连根回收——必须在 quitAndInstall
    // 触发退出之前完成，安装路径不能像用户退出那样 preventDefault+app.exit（会跳过安装）。
    await this.deps.beforeInstallDownloadedAppUpdate?.()
    this.getAutoUpdater().quitAndInstall()
  }

  public setUpdateChannel(channel: UpdateChannel): Promise<AppUpdateState> {
    // 契约类型之外的运行时防御：invoke 参数来自渲染进程，不可信。
    if (channel !== "stable" && channel !== "beta") {
      throw new Error(`Invalid update channel: ${String(channel)}`)
    }
    // 点击当前渠道不打扰现状（否则会清掉 downloaded 等待安装的状态并触发无意义重查）。
    if (channel === this.channel) {
      // 但要归一化持久化：channel 可能是按版本号推导的（settings.json 无键），用户此刻
      // 显式确认了选择——不落盘的话，升级换版本后推导结果改变会静默翻转用户的选择。
      if (this.deps.store.read().updateChannel !== channel) {
        this.deps.store.write({ ...this.deps.store.read(), updateChannel: channel })
      }
      return Promise.resolve(this.state)
    }

    this.deps.store.write({ ...this.deps.store.read(), updateChannel: channel })
    this.channel = channel
    this.checkGeneration += 1
    this.inFlightCheck = undefined
    this.resetMissingAssetRetryState()

    // 旧渠道的在途下载立即取消；旧渠道产物解除退出自动安装——无条件清（下载竞速完成
    // 越过 cancel 时 status 还停在 downloading，按 downloaded 判断会漏），runDownload
    // 每次下载前重新武装，无副作用。win/linux 由 BaseUpdater 在退出时读取该开关；
    // mac 一旦 downloaded 已被 Squirrel.Mac 暂存、无 API 撤销——重启仍会装上，属已知平台限制。
    this.cancellationToken?.cancel()
    this.cancellationToken = undefined
    this.activeDownload = undefined
    if (this.autoUpdater) {
      this.autoUpdater.autoInstallOnAppQuit = false
    }

    // feed 重配延迟到下次 getAutoUpdater()（configuredChannel 失配触发 setFeedURL）。
    this.state = { ...this.snapshotBase(), status: { status: "idle" } }
    this.sendStateChanged("set update channel")
    // 切渠道后立即按后台策略检查并准备更新（dev 下 runCheck 内部短路为 not-available）。
    void this.runBackgroundCheck("channel-change")
    return Promise.resolve(this.state)
  }

  public override dispose(): void {
    if (this.backgroundChecksStarted) {
      powerMonitor.off("resume", this.handleSystemResume)
      this.backgroundChecksStarted = false
    }
    if (this.backgroundCheckTimer) {
      clearTimeout(this.backgroundCheckTimer)
      this.backgroundCheckTimer = undefined
    }
    if (this.foregroundCheckTimer) {
      clearTimeout(this.foregroundCheckTimer)
      this.foregroundCheckTimer = undefined
    }
    this.resetMissingAssetRetryState()
    this.cancellationToken?.cancel()
    // autoUpdater 是进程级单例，必须解绑本服务挂上去的监听。
    if (this.autoUpdater) {
      for (const [event, listener] of this.boundListeners) {
        this.autoUpdater.off(event as Parameters<AutoUpdater["off"]>[0], listener)
      }
    }
    this.boundListeners = []
    super.dispose()
  }

  private scheduleBackgroundCheck(delayMs: number, trigger: "interval" | "resume" | "startup"): void {
    if (!this.backgroundChecksStarted) {
      return
    }
    if (this.backgroundCheckTimer) {
      clearTimeout(this.backgroundCheckTimer)
    }
    logDiagnostic("update-service", "background update check scheduled", {
      checkedAt: this.state.checkedAt,
      delayMs,
      scheduledAt: new Date(Date.now() + delayMs).toISOString(),
      trigger,
    })
    this.backgroundCheckTimer = setTimeout(() => {
      this.backgroundCheckTimer = undefined
      void this.runBackgroundCheck(trigger).finally(() => {
        this.scheduleBackgroundCheck(jitteredUpdateCheckIntervalMs(this.channel, Math.random()), "interval")
      })
    }, delayMs)
    this.backgroundCheckTimer.unref()
  }

  private async runBackgroundCheck(
    trigger: "channel-change" | "foreground" | "interval" | "resume" | "startup",
  ): Promise<void> {
    // 已下载的安装包必须保持 ready 状态；周期检查不能把它覆盖回 checking/available。
    if (this.state.status.status === "downloading" || this.state.status.status === "downloaded") {
      return
    }
    if (trigger !== "channel-change" && hasRecentSuccessfulCheck(this.state.checkedAt, Date.now())) {
      logDiagnostic("update-service", "scheduled update check skipped because state is fresh", {
        checkedAt: this.state.checkedAt,
        trigger,
      })
      return
    }
    logDiagnostic("update-service", "background update check started", {
      channel: this.channel,
      currentVersion: app.getVersion(),
      trigger,
    })
    try {
      const state = await this.checkForAppUpdate()
      // 普通桌面应用的默认路径：后台准备更新，只把“何时重启”留给用户决定。
      if (state.status.status === "available") {
        await this.downloadAppUpdate()
      }
      logDiagnostic("update-service", "background update check completed", {
        checkedAt: state.checkedAt,
        status: state.status.status,
        trigger,
      })
    } catch (error) {
      this.logFailure("background update check failed", error, "warn")
    }
  }

  private snapshotBase(): Pick<AppUpdateState, "currentVersion" | "isPackaged" | "channel"> {
    return {
      currentVersion: app.getVersion(),
      isPackaged: app.isPackaged,
      channel: this.channel,
    }
  }

  private patchStatus(status: AppUpdateStatus): void {
    this.state = { ...this.state, ...this.snapshotBase(), status }
    this.sendStateChanged(`patch ${status.status} status`)
  }

  private async runCheck(isMissingAssetRetry: boolean): Promise<AppUpdateState> {
    if (!app.isPackaged) {
      this.state = {
        ...this.snapshotBase(),
        checkedAt: new Date().toISOString(),
        status: { status: "not-available" },
      }
      this.sendStateChanged("set dev update state")
      return this.state
    }

    if (!isMissingAssetRetry) {
      this.resetMissingAssetRetryState()
    }
    const generation = this.checkGeneration
    this.patchStatus({ status: "checking" })

    try {
      // 序列化库级检查：electron-updater 对 checkForUpdates 自身去重（checkForUpdatesPromise），
      // 旧渠道在途请求未结清时直接调用会原样复用旧 provider 的结果——generation 是新的、
      // 守卫放行，旧渠道结果就被标上新渠道。必须等上一轮库级请求结清再发起。
      if (this.libraryCheck && !this.libraryCheckSettled) {
        await withTimeout(this.libraryCheck, checkTimeoutMs, "prior update check settling").catch((error: unknown) => {
          this.logFailure("prior update check failed while settling", error, "warn")
        })
        if (generation !== this.checkGeneration) {
          return this.state
        }
        if (!this.libraryCheckSettled) {
          // 底层请求仍挂着（feed 被黑洞且 OS 未报错）：此时发起新检查只会被库级去重
          // 粘回旧请求，宁可明确报错；底层请求结清或重启应用后可恢复。
          this.patchStatus({ status: "error", error: "Update check timed out" })
          return this.state
        }
      }
      const result = await withTimeout(this.trackLibraryCheck(), checkTimeoutMs, "update check")
      if (generation !== this.checkGeneration) {
        return this.state
      }
      const info = result?.isUpdateAvailable ? result.updateInfo : undefined
      this.state = {
        ...this.snapshotBase(),
        checkedAt: new Date().toISOString(),
        status: info
          ? { status: "available", version: info.version, releaseDate: info.releaseDate }
          : { status: "not-available" },
      }
      this.sendStateChanged("complete update check")
      return this.state
    } catch (cause) {
      if (generation !== this.checkGeneration) {
        return this.state
      }
      const message = cause instanceof Error ? cause.message : String(cause)
      if (isMissingAssetError(cause)) {
        // 上传/CDN 竞态或渠道 yml 暂缺：按"暂无更新"处理并限次重试，不打扰用户。
        console.warn("[wanta] update check skipped, asset missing (404):", message)
        logDiagnostic("update-service", "update check skipped because asset is missing", { error: cause }, "warn")
        this.patchStatus({ status: "not-available" })
        this.scheduleMissingAssetRetry()
        return this.state
      }
      // 检查失败不向调用方抛：状态里已带错误，渲染层据此显示。
      console.warn("[wanta] update check failed:", message)
      logDiagnostic("update-service", "update check failed", { error: cause }, "warn")
      this.patchStatus({ status: "error", error: message })
      return this.state
    }
  }

  private async runDownload(generation: number): Promise<void> {
    if (!app.isPackaged) {
      return
    }
    if (this.state.status.status === "downloading" || this.state.status.status === "downloaded") {
      return
    }

    const updater = this.getAutoUpdater()
    // 渠道切换守卫：pre-download 检查的网络往返窗口内若切了渠道，绝不能继续武装/下载
    // 旧渠道产物（此时 cancellationToken 尚未赋值，setUpdateChannel 的取消够不着）。
    if (generation !== this.checkGeneration) return
    this.patchStatus({ status: "downloading" })

    // electron-updater 要求 downloadUpdate 前有同一 updater 实例的有效 check 结果。
    // 这次 check 同样要吃 404 容忍（"available" 与点击下载之间渠道 yml 可能被刷掉）与超时。
    let result: UpdateCheckResult | null
    try {
      result = await withTimeout(this.trackLibraryCheck(), checkTimeoutMs, "pre-download check")
    } catch (cause) {
      if (generation !== this.checkGeneration) {
        return
      }
      this.handleDownloadFailure(cause)
      return
    }
    if (generation !== this.checkGeneration) {
      return
    }
    if (!result?.isUpdateAvailable || !result.updateInfo) {
      this.patchStatus({ status: "not-available" })
      return
    }

    this.cancellationToken = result.cancellationToken
    const activeDownload = { generation, version: result.updateInfo.version }
    this.activeDownload = activeDownload
    // 下载开始才武装退出自动安装：开关精确对应"本会话当前渠道下载的产物"，
    // 渠道切换时可解除（见 setUpdateChannel）。
    updater.autoInstallOnAppQuit = true
    try {
      await updater.downloadUpdate(result.cancellationToken)
      // 完成态由 update-downloaded 事件落到 downloaded。
    } catch (cause) {
      if (this.activeDownload === activeDownload) this.activeDownload = undefined
      if (isCancellationError(cause)) {
        // 渠道切换取消：状态已被 setUpdateChannel 重置，不再覆盖。
        return
      }
      if (generation !== this.checkGeneration) return
      this.handleDownloadFailure(cause)
      throw cause
    } finally {
      this.cancellationToken = undefined
    }
  }

  /** 发起一次库级 checkForUpdates 并跟踪其结清状态（供库级去重序列化判断）。 */
  private trackLibraryCheck(): Promise<UpdateCheckResult | null> {
    const raw = this.getAutoUpdater().checkForUpdates()
    this.libraryCheckSettled = false
    this.libraryCheck = raw.then(
      () => {
        this.libraryCheckSettled = true
      },
      () => {
        this.libraryCheckSettled = true
      },
    )
    return raw
  }

  private handleDownloadFailure(cause: unknown): void {
    const message = cause instanceof Error ? cause.message : String(cause)
    if (isMissingAssetError(cause)) {
      console.warn("[wanta] update download skipped, asset missing (404):", message)
      logDiagnostic("update-service", "update download skipped because asset is missing", { error: cause }, "warn")
      this.patchStatus({ status: "not-available" })
      this.scheduleMissingAssetRetry()
      return
    }
    this.logFailure("update download failed", cause, "warn")
    this.patchStatus({ status: "error", error: message })
  }

  private sendStateChanged(action: string): void {
    try {
      this.deps.onStateChanged?.(this.state)
    } catch (error) {
      this.logFailure("update state observer failed", error, "warn", { action, status: this.state.status.status })
    }
    void this.send("appUpdateStateChanged", this.state).catch((error: unknown) => {
      this.logFailure("failed to emit app update state", error, "warn", { action, status: this.state.status.status })
    })
  }

  private logFailure(
    message: string,
    error: unknown,
    level: "warn" | "error" = "warn",
    fields: Record<string, unknown> = {},
  ): void {
    console.warn(`[wanta] ${message}:`, error)
    logDiagnostic("update-service", message, { error, ...fields }, level)
  }

  private getAutoUpdater(): AutoUpdater {
    if (!this.autoUpdater) {
      // electron-updater 通过 Object.defineProperty 在 CJS exports 上挂 autoUpdater getter；
      // 必须走静态 default import 读 updaterPkg.autoUpdater（命名导入在 ESM 下会是 undefined）。
      this.autoUpdater = updaterPkg.autoUpdater
      this.autoUpdater.autoDownload = false
      this.autoUpdater.autoInstallOnAppQuit = false
      this.bindEvents(this.autoUpdater)
    }

    const channel = updaterChannelName(this.channel)
    if (this.configuredChannel !== channel) {
      this.autoUpdater.setFeedURL({
        provider: "generic",
        url: `${staticBaseUrl}/${branding.updateFeedPath}/${process.platform}/${process.arch}`,
        channel,
      })
      // 显式 false：stable 构建经 generateUpdatesFilesForAllChannels 刷新 beta.yml 时
      // 可能低于已装 beta，必须忽略（等下一个 stable 版本号反超后收敛），绝不自动降级。
      this.autoUpdater.allowDowngrade = false
      this.configuredChannel = channel
    }

    return this.autoUpdater
  }

  private bindEvents(updater: AutoUpdater): void {
    const on = <E extends Parameters<AutoUpdater["on"]>[0]>(
      event: E,
      listener: Parameters<AutoUpdater["on"]>[1],
    ): void => {
      updater.on(event, listener as never)
      this.boundListeners.push([event, listener as never])
    }
    // 陈旧守卫：下载代数和目标版本必须与当前任务一致——渠道切换把 activeDownload
    // 清空后，越过取消竞速完成的旧渠道事件不得再污染新渠道状态。
    on("download-progress", ((progress: { percent: number }) => {
      if (this.activeDownload?.generation === this.checkGeneration && this.state.status.status === "downloading") {
        this.patchStatus({ status: "downloading", percent: progress.percent })
      }
    }) as never)
    on("update-downloaded", ((info: { version: string }) => {
      if (
        this.activeDownload?.generation === this.checkGeneration &&
        this.activeDownload.version === info.version &&
        this.state.status.status === "downloading"
      ) {
        this.resetMissingAssetRetryState()
        this.patchStatus({ status: "downloaded", version: info.version })
        this.activeDownload = undefined
      }
    }) as never)
    on("error", ((error: Error) => {
      if (isCancellationError(error)) {
        return
      }
      if (this.activeDownload?.generation === this.checkGeneration || this.state.status.status === "downloaded") {
        this.activeDownload = undefined
        this.patchStatus({ status: "error", error: error.message })
        return
      }
      logDiagnostic("update-service", "ignored stale updater error event", { error }, "warn")
    }) as never)
  }

  private resetMissingAssetRetryState(): void {
    this.missingAssetRetryGeneration += 1
    if (this.missingAssetRetryTimer) {
      clearTimeout(this.missingAssetRetryTimer)
      this.missingAssetRetryTimer = undefined
    }
    this.missingAssetRetryAttempt = 0
  }

  private scheduleMissingAssetRetry(): void {
    if (!app.isPackaged || this.missingAssetRetryTimer || this.missingAssetRetryAttempt >= missingAssetMaxRetries) {
      return
    }
    const generation = this.missingAssetRetryGeneration
    const nextAttempt = this.missingAssetRetryAttempt + 1
    this.missingAssetRetryTimer = setTimeout(() => {
      if (generation !== this.missingAssetRetryGeneration) {
        return
      }
      this.missingAssetRetryTimer = undefined
      this.missingAssetRetryAttempt = nextAttempt
      void this.runCheck(true).catch((error: unknown) => {
        this.logFailure("missing asset retry update check failed", error, "warn")
      })
    }, missingAssetRetryDelayMs)
    this.missingAssetRetryTimer.unref()
  }
}

/** 资产缺失类 404（上传竞态 / 渠道 yml 暂缺，含 ERR_UPDATER_CHANNEL_FILE_NOT_FOUND 的 HttpError）。 */
function isMissingAssetError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /404/.test(message) && /(download|not\s*found|status|http)/i.test(message)
}

function isCancellationError(error: unknown): boolean {
  return error instanceof Error && (error.name === "CancellationError" || /cancelled/i.test(error.message))
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out (${label}, ${timeoutMs}ms)`))
    }, timeoutMs)
    timer.unref()
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error instanceof Error ? error : new Error(String(error)))
      },
    )
  })
}
