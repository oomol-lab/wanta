import type { AppCommand } from "./app-command.ts"
import type { AppLocale } from "./app-locale.ts"
import type { AuthRuntimeAccount } from "./auth/store.ts"
import type { AppUpdateState } from "./update/common.ts"

import { ConnectionServer } from "@oomol/connection"
import { ElectronServerAdapter } from "@oomol/connection-electron-adapter/server"
import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  Notification,
  safeStorage,
  session,
  shell,
} from "electron"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { AgentRefreshScheduler } from "./agent-refresh-scheduler.ts"
import {
  ooBinaryName,
  opencodeBinaryName,
  resolveBundledBin,
  resolveBundledSkillsDir,
  resolveBundledToolRuntimePath,
  resolveDevBundledSkillsDir,
  resolveDevBundledToolRuntimePath,
  resolveDevOoBin,
  resolveDevOpencodeBin,
} from "./agent/binaries.ts"
import { AgentManager } from "./agent/manager.ts"
import { AgentRetirementPool } from "./agent/retirement.ts"
import { APP_COMMAND_CHANNEL, APP_COMMANDS } from "./app-command.ts"
import { APP_LOCALE_CHANNEL, isAppLocale, normalizeAppLocale } from "./app-locale.ts"
import { ArtifactResourceLeaseStore } from "./artifact-resource/lease-store.ts"
import {
  artifactResourceUrl,
  installArtifactResourceProtocol,
  registerArtifactResourceScheme,
} from "./artifact-resource/protocol.ts"
import { registerAttachmentDialogHandlers } from "./attachment-dialog-handlers.ts"
import { AttentionServiceImpl } from "./attention/node.ts"
import { AttentionStore } from "./attention/store.ts"
import { AuthManager, AuthServiceImpl } from "./auth/node.ts"
import { AuthStore } from "./auth/store.ts"
import { branding } from "./branding.ts"
import { ArtifactBundleStore } from "./chat/artifact-bundles.ts"
import { AuthorizationOverlayStore } from "./chat/authorization.ts"
import { ChatServiceImpl } from "./chat/node.ts"
import { removeSessionOutputDirectories } from "./chat/output-directory-cleanup.ts"
import { SpreadsheetPreviewWorkerClient } from "./chat/spreadsheet-preview-worker-client.ts"
import { StoppedGenerationStore } from "./chat/stopped-generations.ts"
import { TurnOutputStore } from "./chat/turn-outputs.ts"
import { UserAttachmentStore } from "./chat/user-attachments.ts"
import { parseConnectionOAuthCallback } from "./connections/domain.ts"
import { configureDiagnosticsLog, flushDiagnosticsLog, logDiagnostic } from "./diagnostics-log.ts"
import { GitServiceImpl } from "./git/node.ts"
import { KnowledgeServiceImpl } from "./knowledge/node.ts"
import { KnowledgeStore } from "./knowledge/store.ts"
import { isAudioOnlyMediaRequest, isTrustedRendererUrl } from "./media-permission-policy.ts"
import { ModelCredentialStore } from "./models/credential-store.ts"
import { ModelsServiceImpl } from "./models/node.ts"
import { ModelsStore } from "./models/store.ts"
import { installOomolCorsShim } from "./net/oomol-cors.ts"
// Teams 请求已整体搬到渲染层（src/lib/teams-client.ts），不再有对应主进程 service。
import { listenProtocolUrls, registerProtocolClient, requestProtocolSingleInstanceLock } from "./protocol.ts"
import { normalizeRendererErrorReport } from "./renderer-error-report.ts"
import { resolveAgentRuntime } from "./runtime/agent-runtime.ts"
import { resolveRuntimeCapabilities } from "./runtime/common.ts"
import { SessionActivityStore } from "./session/activity-store.ts"
import { SessionMetadataStore } from "./session/metadata-store.ts"
import { SessionServiceImpl } from "./session/node.ts"
import { SessionProjectStore } from "./session/project-store.ts"
import { SettingsServiceImpl } from "./settings/node.ts"
import { SettingsStore } from "./settings/store.ts"
import { ensureDefaultRegistrySkillsInstalled, SkillServiceImpl } from "./skills/node.ts"
import { ExpiringTrustedPathRegistry } from "./trusted-path-registry.ts"
import { UpdateServiceImpl } from "./update/node.ts"
import { buildApplicationMenuTemplate } from "./window/application-menu.ts"
import {
  buildWindowsTitleBarOverlay,
  nativeWindowFrameForPlatform,
  nativeWindowMaterialForPlatform,
  resolveWindowsTitleBarTheme,
  windowBackgroundColorForMaterial,
} from "./window/title-bar-overlay.ts"
import { createHideOnCloseHandler, revealMainWindow } from "./window/window-close-behavior.ts"
import { createWindowsTrayLifecycle } from "./window/windows-tray-lifecycle.ts"

declare const __APP_COMMIT__: string | undefined

const dirname = path.dirname(fileURLToPath(import.meta.url))
const appRoot = path.join(dirname, "..")
process.env.APP_ROOT = appRoot
configureDiagnosticsLog(path.join(app.getPath("userData"), "logs", "diagnostics.jsonl"))
installMainProcessErrorHandlers()
registerArtifactResourceScheme()
if (process.platform === "win32") {
  // Windows Toast 以 AppUserModelID 识别发送者；与安装包 appId 保持单一来源。
  app.setAppUserModelId(branding.appId)
}

const viteDevServerUrl = process.env["VITE_DEV_SERVER_URL"]
const rendererDist = path.join(appRoot, "dist")
const rendererBaseUrl = pathToFileURL(`${rendererDist}${path.sep}`).href
const preloadPath = path.join(dirname, "preload.js")
const macTrafficLightPosition = { x: 15, y: 17 }
const shutdownCleanupTimeoutMs = 5_000

// dev 用本地 scheme，生产用正式 scheme（R1 / 阶段 6）。
const protocolScheme = viteDevServerUrl ? branding.devProtocolScheme : branding.protocolScheme

let mainWindow: BrowserWindow | null = null
let currentLocale: AppLocale | null = null
let isQuitting = false
type AppQuitIntent = "none" | "user-quit" | "update-install" | "termination-signal"
let appQuitIntent: AppQuitIntent = "none"
// 退出回收只跑一次：记忆化 Promise，多条退出路径（before-quit / 信号 / 更新安装）复用同一次回收。
let shutdownReap: Promise<void> | null = null
const agentRetirementPool = new AgentRetirementPool()
let windowsTrayLifecycle: {
  dispose: () => void
  setLocale: (locale: string) => void
  setUpdateReadyVersion: (version: string | undefined) => void
} | null = null
let updateReadyNotification: Notification | null = null
let lastNotifiedUpdateVersion: string | null = null

const server = new ConnectionServer(new ElectronServerAdapter())

const settingsStore = new SettingsStore(app.getPath("userData"))
const attentionStore = new AttentionStore(app.getPath("userData"))
const modelCredentialStore = new ModelCredentialStore(app.getPath("userData"), safeStorage)
const modelsStore = new ModelsStore(app.getPath("userData"), modelCredentialStore)
const knowledgeStore = new KnowledgeStore(app.getPath("userData"))
const wikiGraphCliPath = path.join(app.getAppPath(), "node_modules", "wiki-graph", "dist", "cli.js")
// 二进制解析：生产从打包 Resources/bin（extraResources），dev 从 node_modules（opencode）与 .oo-bin（oo）。
const opencodeBinPath = app.isPackaged
  ? resolveBundledBin(process.resourcesPath, opencodeBinaryName())
  : resolveDevOpencodeBin(appRoot)
const ooBinPath = app.isPackaged ? resolveBundledBin(process.resourcesPath, ooBinaryName()) : resolveOoBin()
process.env.OO_CLI_PATH = ooBinPath
// 内置 oo skill 源目录：生产从打包 Resources/skills，dev 从 resources/skills（postinstall 导出）。
// AgentManager 启动时拷进 OpenCode workspace 的 .opencode/skill/，使 agent 直接读到。
const bundledSkillsDir = app.isPackaged
  ? resolveBundledSkillsDir(process.resourcesPath)
  : resolveDevBundledSkillsDir(appRoot)
const bundledToolRuntimePath = app.isPackaged
  ? resolveBundledToolRuntimePath(process.resourcesPath)
  : resolveDevBundledToolRuntimePath(appRoot)

// Agent 内核：凭证来自 Electron 会话中的短期 token；userData/auth.json 仅保存账号 profile。
// 未登录时 agent=null，服务仍注册但 isReady()=false，渲染层显示登录页；
// 登录 / 登出时经 applyAuthAccount 动态装配。
let agent: AgentManager | null = null
// 装配串行化：登录后紧接登出时避免 dispose/start 交错。
let applyChain: Promise<void> = Promise.resolve()
let agentRuntimeVersion = 0
let appliedAgentRuntimeVersion = -1
let runtimeInitialized = false

const authStore = new AuthStore(app.getPath("userData"))
const sessionActivityStore = new SessionActivityStore(app.getPath("userData"))
const sessionMetadataStore = new SessionMetadataStore(app.getPath("userData"))
const sessionProjectStore = new SessionProjectStore(app.getPath("userData"))
const artifactBundleStore = new ArtifactBundleStore(app.getPath("userData"))
const authorizationOverlayStore = new AuthorizationOverlayStore(app.getPath("userData"))
const stoppedGenerationStore = new StoppedGenerationStore(app.getPath("userData"))
const turnOutputStore = new TurnOutputStore(app.getPath("userData"), artifactBundleStore)
const userAttachmentStore = new UserAttachmentStore(app.getPath("userData"))
const trustedAttachmentPaths = new ExpiringTrustedPathRegistry()
const trustedProjectPaths = new ExpiringTrustedPathRegistry()
const artifactResourceLeaseStore = new ArtifactResourceLeaseStore()
const spreadsheetPreviewWorker = new SpreadsheetPreviewWorkerClient()
// Connections 请求已整体搬到渲染层（src/lib/connections-client.ts）；主进程只保留 agent 团队作用域同步，
// 经 ChatService.setAgentTeam → onSetAgentTeam 回调（渲染层切 workspace 时调用）。
const chatService = new ChatServiceImpl(null, {
  bugReportRuntime: {
    appCommit: typeof __APP_COMMIT__ === "string" ? __APP_COMMIT__ : "unknown",
    appVersion: app.getVersion(),
    platform: process.platform,
  },
  createArtifactThumbnail: async (filePath) => {
    const image = await nativeImage.createThumbnailFromPath(filePath, { height: 160, width: 160 })
    return { dataUrl: image.isEmpty() ? null : image.toDataURL() }
  },
  createArtifactResourceUrl: (item) => {
    const lease = artifactResourceLeaseStore.grant(item)
    return { expiresAt: lease.expiresAt, url: artifactResourceUrl(lease.token) }
  },
  createSpreadsheetPreview: (filePath, mime, size) => spreadsheetPreviewWorker.preview(filePath, mime, size),
  artifactBundleStore,
  authorizationOverlayStore,
  projectStore: sessionProjectStore,
  stoppedGenerationStore,
  trustedAttachmentPaths,
  turnOutputStore,
  userAttachmentStore,
  onPermissionModeChanged: (sessionId, permissionMode) =>
    sessionService.setPermissionMode({ id: sessionId, permissionMode }),
  onOomolAuthRequired: () => authManager.expireSession().then(() => undefined),
  onSetAgentTeam: handleAgentTeamChanged,
  onSessionCompleted: (input) => attentionService.completeSession(input),
})
const sessionService = new SessionServiceImpl(null, {
  activityStore: sessionActivityStore,
  metadataStore: sessionMetadataStore,
  onSessionArchived: (sessionId) => attentionService.removeSession(sessionId),
  onSessionRemoved: async (sessionId) => {
    await chatService.forgetSession(sessionId).catch((error: unknown) => {
      console.warn("[wanta] failed to clear removed session chat state", error)
      logMainError("failed to clear removed session chat state", error, { sessionId })
    })
    const [artifactBundles, turnOutputs] = await Promise.all([artifactBundleStore.read(), turnOutputStore.read()])
    await removeSessionOutputDirectories({
      agentRoot: path.join(app.getPath("userData"), "agent"),
      artifactBundles: artifactBundles.get(sessionId)?.values(),
      sessionId,
      turnOutputs: turnOutputs.get(sessionId)?.values(),
    }).catch((error: unknown) => {
      console.warn("[wanta] failed to clean removed session directories", error)
    })
    await Promise.all([
      artifactBundleStore.removeSession(sessionId),
      attentionService.removeSession(sessionId),
      turnOutputStore.removeSession(sessionId),
      userAttachmentStore.removeSession(sessionId),
    ]).catch((error: unknown) => {
      console.warn("[wanta] failed to clean removed session outputs", error)
    })
  },
  projectStore: sessionProjectStore,
  trustedProjectPaths,
})
const modelsService = new ModelsServiceImpl({
  store: modelsStore,
  onCustomModelsChanged: restartAgentForModelConfig,
})
// 凭证逻辑在未注册的 AuthManager；注册给渲染层的 AuthServiceImpl 只是薄门面（防 RPC 凭证泄露）。
const authManager = new AuthManager({
  store: authStore,
  protocolScheme,
  applyAccount: applyAuthAccount,
})
const agentRefreshScheduler = new AgentRefreshScheduler({
  canRefresh: () => runtimeInitialized,
  isBusy: () => chatService.hasActiveGeneration(),
  isQuitting: () => isQuitting,
  refresh: refreshAgentRuntime,
})
const authService = new AuthServiceImpl(authManager)
const skillService = new SkillServiceImpl(authManager, {
  onRuntimeSkillsChanged: (reason) => agentRefreshScheduler.schedule(reason),
})
const settingsService = new SettingsServiceImpl({
  onSettingsChanged: (settings) => attentionService.settingsChanged(settings),
  store: settingsStore,
})
const attentionService = new AttentionServiceImpl({
  getLocale: activeLocale,
  getSettings: () => settingsService.current(),
  getWindow: () => mainWindow,
  revealWindow: showMainWindow,
  store: attentionStore,
})
// 更新渠道（stable/beta）持久化在同一 settings.json；服务内部仅打包态联网。
const updateService = new UpdateServiceImpl({
  // 安装前先武装退出意图并把 agent（含 opencode 工具子进程树）连根回收，再交给
  // quitAndInstall。此处刻意在 quitAndInstall 之前 await：安装走 Squirrel 的正常退出流程，
  // 不能像用户退出那样 preventDefault+app.exit（会跳过安装），故回收必须在退出前完成。
  beforeInstallDownloadedAppUpdate: async () => {
    armAppQuit("update-install")
    await reapAgentForShutdown()
  },
  onStateChanged: handleAppUpdateStateChanged,
  store: settingsStore,
})
const gitService = new GitServiceImpl({
  projectStore: sessionProjectStore,
})
const knowledgeService = new KnowledgeServiceImpl({
  onRemoved: async (id) => {
    await Promise.all([sessionService.removeKnowledgeBaseReferences(id), agent?.removeKnowledgeBaseAccess(id)])
  },
  runtime: { executablePath: process.execPath, cliPath: wikiGraphCliPath },
  store: knowledgeStore,
  trustedImportPaths: trustedAttachmentPaths,
})

chatService.sessionActivity.on(({ sessionId, usedAt }) => {
  void sessionService.recordUseAndEmit(sessionId, usedAt).catch((error: unknown) => {
    console.warn("[wanta] failed to record session activity:", error)
    logMainError("failed to record session activity", error, { sessionId })
  })
})

registerProtocolClient(protocolScheme)
const { initialUrl, isLocked } = requestProtocolSingleInstanceLock(protocolScheme, { enabled: app.isPackaged })

if (!isLocked) {
  app.quit()
}

// 注册所有 service 实现，必须在 server.start() 之前。
server.registerService(chatService)
server.registerService(attentionService)
server.registerService(sessionService)
server.registerService(skillService)
server.registerService(modelsService)
server.registerService(settingsService)
server.registerService(authService)
server.registerService(updateService)
server.registerService(gitService)
server.registerService(knowledgeService)
settingsService.applyStartupTheme()
registerAttachmentDialogHandlers(trustedAttachmentPaths, {
  createSpreadsheetPreview: (filePath, mime, size) => spreadsheetPreviewWorker.preview(filePath, mime, size),
  rememberProjectPath: (directoryPath) => trustedProjectPaths.add(directoryPath),
})
registerAppLocaleHandler()
registerRendererErrorHandler()

if (isLocked) {
  server.start()

  // macOS 冷启动的 open-url 在 ready 前就会派发（无缓冲），监听必须尽早注册——
  // 放进 whenReady 会整个丢掉登录回调。
  listenProtocolUrls(protocolScheme, { handleUrl: handleDeepLink }, showMainWindow)

  if (initialUrl) {
    // 冷启动经协议 URL 拉起（win/linux argv）：统一分发登录与连接器回调，窗口创建在 whenReady。
    void handleDeepLink(initialUrl).catch((error: unknown) => {
      console.error("[wanta] failed to handle startup deep link:", error)
    })
  }

  app
    .whenReady()
    .then(() => {
      installArtifactResourceProtocol(artifactResourceLeaseStore)
      // 放行渲染进程对 *.<endpoint> 的已鉴权直连请求（凭证经会话 cookie 自动附带，token 不进渲染层）。
      installOomolCorsShim(session.defaultSession)
      installApplicationMenu()
      createMainWindow()
      void attentionService.initialize().catch((error: unknown) => {
        console.warn("[wanta] failed to initialize task attention state:", error)
      })
      void userAttachmentStore.pruneExpiredUnreferenced().catch((error: unknown) => {
        console.warn("[wanta] failed to prune expired attachment snapshots:", error)
      })
      // 打包态启动跨平台后台更新：延迟首查、周期检查、系统唤醒后补查；发现后后台下载，
      // 安装仍由用户点击重启或正常退出触发，避免打断 Agent 任务。
      updateService.startBackgroundChecks()

      // 启动时一次性抹除磁盘上残留的旧长期 api-key（迁移到纯会话 token 后不再落盘任何凭证）。
      authStore.purgeLegacy()
      void authManager
        .activeRuntimeAccount()
        .then((account) => {
          return applyAuthAccount(account)
        })
        .catch((error: unknown) => {
          console.error("[wanta] agent sidecar failed to start:", error)
          logMainError("agent sidecar failed to start", error)
        })

      app.on("activate", () => {
        if (mainWindow) {
          revealMainWindow(mainWindow)
        } else if (BrowserWindow.getAllWindows().length === 0) {
          createMainWindow()
        }
      })
    })
    .catch((error: unknown) => {
      console.error("[wanta] app startup failed:", error)
      logMainError("app startup failed", error)
    })

  app.on("window-all-closed", () => {
    // 沿用系统惯例：仅 Windows/Linux 在关闭最后一个窗口时退出；macOS 保持存活留在 Dock，
    // 点图标经 activate 重开窗口。macOS 上"退出后仍显示正在后台运行"的病根是 opencode sidecar
    // 孤儿化（见下方信号处理器与 sidecar.ts 的按组回收），而非关窗行为，故这里不改。
    if (process.platform !== "darwin") {
      app.quit()
    }
  })

  // 终端 Ctrl-C / kill <pid> / OS 关机 / macOS "停止在后台运行" 可能以原始 POSIX 信号（而非 Cocoa
  // Quit 事件，后者走 before-quit）送达主进程。没有信号处理器时进程会被直接终止、不触发 before-quit，
  // opencode sidecar 便沦为永久孤儿（reparent 到 launchd），macOS 仍把 app 判为"后台运行"。
  // 这里 await 完整回收（进程树 SIGTERM/SIGKILL 送达）后再硬退出。
  // 另注：opencode 现以 detached 独立进程组运行，dev 下 Ctrl-C 不会经前台进程组自然传到它，
  // 全靠此处 SIGINT 处理器显式回收，否则会残留孤儿。
  const onTerminationSignal = (signal: NodeJS.Signals): void => {
    console.log(`[wanta] received ${signal}; shutting down`)
    armAppQuit("termination-signal")
    void reapAgentForShutdown().finally(() => app.exit(0))
  }
  process.once("SIGTERM", () => onTerminationSignal("SIGTERM"))
  process.once("SIGINT", () => onTerminationSignal("SIGINT"))

  app.on("before-quit", (event) => {
    // 更新安装（quitAndInstall）路径：回收已在 beforeInstallDownloadedAppUpdate 里 await 完成，
    // 且必须放行 Squirrel 的正常退出流程去执行安装，故绝不 preventDefault/app.exit。
    if (appQuitIntent === "update-install") {
      return
    }
    // 用户退出（Cmd+Q / 菜单退出 / win-linux 关末窗）：opencode 的工具子进程各自 setsid 逃逸出
    // opencode 进程组，单发 kill(-pgid) 收不掉，退出后成孤儿被 macOS 判为"正在后台运行"。这里
    // 始终拦下默认退出，await 按 ppid 进程树连根回收后再 app.exit(0)（回收记忆化，连按 Cmd+Q
    // 也只回收一次，且每次 before-quit 都 preventDefault，绝不让第二次退出穿透略过回收）。
    event.preventDefault()
    armAppQuit("user-quit")
    void reapAgentForShutdown().finally(() => app.exit(0))
  })
}

/**
 * 退出前一次性回收：停掉待处理定时器/托盘，await agent（含 opencode 工具子进程树）连根回收，
 * 再 dispose 服务与刷日志。记忆化，确保多条退出路径只回收一次。
 */
function reapAgentForShutdown(): Promise<void> {
  shutdownReap ??= (async () => {
    agentRefreshScheduler.dispose()
    // 退出观感：先藏窗口，回收（含最长宽限期）在后台进行，不让用户盯着卡住的窗口。
    mainWindow?.hide()
    updateReadyNotification?.close()
    updateReadyNotification = null
    windowsTrayLifecycle?.dispose()
    windowsTrayLifecycle = null
    const activeAgent = agent
    agent = null
    chatService.setAgent(null)
    sessionService.setAgent(null)
    if (activeAgent) {
      await runBoundedShutdownStep("retire active agent", () => agentRetirementPool.retire(activeAgent))
    }
    await runBoundedShutdownStep("drain agent retirements", () => agentRetirementPool.drain())
    await runBoundedShutdownStep("dispose spreadsheet preview worker", () => spreadsheetPreviewWorker.dispose())
    server.dispose()
    artifactResourceLeaseStore.clear()
    await runBoundedShutdownStep("flush diagnostics log", flushDiagnosticsLog)
  })()
  return shutdownReap
}

async function runBoundedShutdownStep(label: string, task: () => Promise<void>): Promise<void> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${shutdownCleanupTimeoutMs}ms`)),
      shutdownCleanupTimeoutMs,
    )
  })
  try {
    await Promise.race([Promise.resolve().then(task), timeout])
  } catch (error) {
    console.warn(`[wanta] shutdown cleanup failed: ${label}`, error)
    logDiagnostic("app-lifecycle", "shutdown cleanup failed", { error, label }, "warn")
  } finally {
    if (timer) {
      clearTimeout(timer)
    }
  }
}

function armAppQuit(intent: Exclude<AppQuitIntent, "none">): void {
  if (appQuitIntent === "none") {
    appQuitIntent = intent
    logDiagnostic("app-lifecycle", "application quit armed", { intent }, "info")
  }
  isQuitting = true
}

function logMainError(message: string, error: unknown, fields: Record<string, unknown> = {}): void {
  logDiagnostic("main", message, { ...fields, error }, "error")
}

function installMainProcessErrorHandlers(): void {
  process.on("uncaughtExceptionMonitor", (error, origin) => {
    console.error("[wanta] uncaught exception:", error)
    logMainError("uncaught exception", error, { origin })
  })
  process.on("unhandledRejection", (reason) => {
    console.error("[wanta] unhandled promise rejection:", reason)
    logMainError("unhandled promise rejection", reason)
  })
  process.on("warning", (warning) => {
    console.warn("[wanta] process warning:", warning)
    logDiagnostic("main", "process warning", { warning }, "warn")
  })
  app.on("child-process-gone", (_event, details) => {
    console.error("[wanta] child process gone:", details)
    logDiagnostic("main", "child process gone", { details }, "error")
  })
  app.on("render-process-gone", (_event, webContents, details) => {
    console.error("[wanta] render process gone:", details)
    logDiagnostic(
      "main",
      "render process gone",
      {
        details,
        url: webContents.getURL(),
      },
      "error",
    )
  })
}

function registerRendererErrorHandler(): void {
  ipcMain.on("wanta:renderer-error", (_event, input: unknown) => {
    const report = normalizeRendererErrorReport(input)
    if (!report) return
    const message = report.level === "error" ? "renderer error" : "renderer handled issue"
    if (report.level === "error") console.error("[wanta] renderer error:", report)
    else console.warn("[wanta] renderer handled issue:", report)
    logDiagnostic("renderer", message, { ...report }, report.level)
  })
}

function runtimeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 凭证 → 运行时装配：替换 agent（重启 sidecar）并同步 connector 凭证。经 applyChain 串行执行。 */
function applyAuthAccount(account: AuthRuntimeAccount | null): Promise<void> {
  if (isQuitting) {
    return Promise.resolve()
  }
  const next = applyChain.then(() => applyAuthAccountNow(account))
  applyChain = next.catch((error: unknown) => {
    logMainError("auth account application failed", error)
  })
  return next
}

/** 最近一次成功装配的账号：同凭证重复 apply 时短路，避免无谓的 sidecar 重启。 */
let appliedAccount: AuthRuntimeAccount | null = null
let appliedRuntimeKey: string | null = null
// agent 的当前团队作用域：由渲染层切 workspace 时经 setAgentTeam IPC 更新；agent 重建时据此设初值。
let activeAgentTeamName: string | undefined

async function applyAuthAccountNow(account: AuthRuntimeAccount | null): Promise<void> {
  if (isQuitting) {
    return
  }
  runtimeInitialized = true
  const runtimeVersionAtStart = agentRuntimeVersion
  const runtimeModels = await modelsStore.runtimeModels()
  const runtime = resolveAgentRuntime(account, runtimeModels.selected, runtimeModels.customModels)
  // 冷启动 deep-link、模型事件与 auth 广播可能重复触发；运行时身份和配置版本均未变化时短路。
  if (
    runtime &&
    appliedRuntimeKey === runtime.key &&
    agent?.isReady() &&
    appliedAgentRuntimeVersion === agentRuntimeVersion &&
    account?.id === appliedAccount?.id
  ) {
    return
  }
  const previousAccountId = appliedAccount?.id
  appliedAccount = null
  appliedRuntimeKey = null
  // 旧 sidecar 必须在新 sidecar 启动前完成回收，避免共享 workspace/isolation 的两个运行时短暂并存。
  const previousAgent = agent
  agent = null
  chatService.setAgent(null)
  chatService.setRuntimeCapabilities(
    resolveRuntimeCapabilities({
      mode: account ? "oomol" : "local",
      localAgentAvailable: Boolean(runtime),
    }),
  )
  chatService.setAgentStatus(runtime ? { status: "starting" } : { status: "model_required" })
  sessionService.setAgent(null)

  if (previousAgent) {
    try {
      await agentRetirementPool.retire(previousAgent)
    } catch (error) {
      // 旧运行时未确认退出时不冒险启动第二个 sidecar；保持 appliedAccount 为空，允许后续重试。
      console.warn("[wanta] failed to retire previous agent runtime:", error)
      logMainError("failed to retire previous agent runtime", error)
      chatService.setAgentStatus({
        status: "error",
        message: `Failed to stop the previous OpenCode runtime: ${runtimeErrorMessage(error)}`,
      })
      return
    }
  }

  if (!runtime || isQuitting) {
    activeAgentTeamName = undefined
    await attentionService.clearAll().catch((error: unknown) => {
      console.warn("[wanta] failed to clear attention state during sign-out:", error)
    })
    if (!account) console.log("[wanta] local Agent requires a configured custom model")
    return
  }
  if (previousAccountId && previousAccountId !== account?.id) {
    activeAgentTeamName = undefined
    await attentionService.clearAll().catch((error: unknown) => {
      console.warn("[wanta] failed to clear attention state during account switch:", error)
    })
  }

  if (isQuitting) {
    return
  }
  const cloudRuntime =
    runtime.cloudRuntime.kind === "oomol"
      ? { ...runtime.cloudRuntime, teamName: activeAgentTeamName }
      : runtime.cloudRuntime
  const nextAgent = new AgentManager({
    cloudRuntime,
    defaultModel: runtime.defaultModel,
    opencodeBinPath,
    ooBinPath,
    wikiGraphCliPath,
    wikiGraphExecutablePath: process.execPath,
    knowledgeRegistryPath: knowledgeStore.registryPath(),
    bundledSkillsDir,
    bundledToolRuntimePath,
    rootDir: path.join(app.getPath("userData"), "agent"),
    customModels: runtimeModels.customModels,
  })
  agent = nextAgent
  chatService.setAgent(nextAgent)
  sessionService.setAgent(nextAgent)
  try {
    await nextAgent.start()
  } catch (error) {
    // 启动失败不留僵尸 agent：清空引用并完成回收，下次登录可重试。
    await agentRetirementPool.retire(nextAgent)
    agent = null
    chatService.setAgent(null)
    chatService.setAgentStatus({ status: "error", message: runtimeErrorMessage(error) })
    sessionService.setAgent(null)
    throw error
  }
  if (isQuitting) {
    await agentRetirementPool.retire(nextAgent)
    if (agent === nextAgent) {
      agent = null
      chatService.setAgent(null)
      sessionService.setAgent(null)
    }
    return
  }
  appliedAccount = account
  appliedRuntimeKey = runtime.key
  appliedAgentRuntimeVersion = runtimeVersionAtStart
  chatService.startEventBridge()
  chatService.setAgentStatus({ status: "ready" })
  console.log("[wanta] agent sidecar ready at", nextAgent.url)
  if (agentRuntimeVersion !== runtimeVersionAtStart) {
    agentRefreshScheduler.schedule("runtime configuration changed during agent startup", 0)
  }
  if (runtime.mode === "oomol") {
    void skillService[ensureDefaultRegistrySkillsInstalled]().catch((error: unknown) => {
      console.warn("[wanta] default registry skill installation failed:", error)
    })
  }
}

async function handleAgentTeamChanged(teamName: string | undefined): Promise<void> {
  const previousTeamName = activeAgentTeamName
  const nextTeamName = teamName?.trim() ? teamName.trim() : undefined
  activeAgentTeamName = nextTeamName
  try {
    await agent?.setTeamName(nextTeamName)
  } catch (error: unknown) {
    activeAgentTeamName = previousTeamName
    console.error("[wanta] failed to update agent workspace scope:", error)
    throw error
  }
}

function restartAgentForModelConfig(): void {
  if (isQuitting) {
    return
  }
  agentRefreshScheduler.schedule("model configuration changed", 0)
}

async function refreshAgentRuntime(_reason: string): Promise<void> {
  agentRuntimeVersion += 1
  const account = await authManager.activeRuntimeAccount()
  await applyAuthAccount(account)
  // 会话中途过期：装配登出态后主动广播“未登录”，渲染层据此切回本地 workspace。
  if (!account) await authManager.broadcastAuthState()
}
function resolveOoBin(): string {
  if (process.env["WANTA_OO_BIN"]) {
    return process.env["WANTA_OO_BIN"]
  }
  return resolveDevOoBin(appRoot)
}

function getBrandingResourcePath(fileName: string): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, fileName)
  }

  return path.join(appRoot, "resources", "branding", fileName)
}

// 仅放行安全的用户意图协议外开；其余（file:、自定义协议等）一律忽略。
function openExternalUrl(url: string): void {
  if (/^(https?|mailto|tel):/i.test(url)) {
    void shell.openExternal(url).catch((error: unknown) => {
      console.warn("[wanta] failed to open external URL:", error)
      logMainError("failed to open external URL", error, { url })
    })
  }
}

function sendAppCommand(command: AppCommand): void {
  showMainWindow()
  const target = mainWindow
  if (!target) {
    return
  }
  const send = (): void => target.webContents.send(APP_COMMAND_CHANNEL, command)
  if (target.webContents.isLoading()) {
    target.webContents.once("did-finish-load", send)
    return
  }
  send()
}

let applicationMenuIcons: {
  about: Electron.NativeImage
  checkForUpdates: Electron.NativeImage
  services: Electron.NativeImage
  settings: Electron.NativeImage
} | null = null

function macMenuSymbol(name: string): Electron.NativeImage {
  const image = nativeImage.createFromNamedImage(name).resize({ height: 16 })
  image.setTemplateImage(true)
  return image
}

function macApplicationMenuIcons(): typeof applicationMenuIcons {
  if (process.platform !== "darwin") {
    return null
  }
  // 菜单会在语言切换时重建；保留 NativeImage 强引用，避免 AppKit 后续重绘时图标丢失。
  applicationMenuIcons ??= {
    about: macMenuSymbol("info.circle"),
    checkForUpdates: macMenuSymbol("arrow.clockwise"),
    services: macMenuSymbol("link"),
    settings: macMenuSymbol("gearshape"),
  }
  return applicationMenuIcons
}

function installApplicationMenu(): void {
  const macIcons = macApplicationMenuIcons()
  const menu = Menu.buildFromTemplate(
    buildApplicationMenuTemplate({
      developmentMode: shouldShowDevelopmentMenu(),
      locale: activeLocale(),
      macIcons: macIcons ?? undefined,
      onCommand: sendAppCommand,
      platform: process.platform,
    }),
  )
  // macOS 会先为 Services role 放入系统图标；菜单构建后再替换，保留原生 Services 子菜单行为。
  if (macIcons) {
    const aboutItem = menu.getMenuItemById("app-about")
    const servicesItem = menu.getMenuItemById("app-services")
    if (aboutItem) aboutItem.icon = macIcons.about
    if (servicesItem) servicesItem.icon = macIcons.services
  }
  Menu.setApplicationMenu(menu)
}

function activeLocale(): AppLocale {
  return currentLocale ?? normalizeAppLocale(app.getLocale())
}

function shouldShowDevelopmentMenu(): boolean {
  return !app.isPackaged || process.env["WANTA_ENABLE_DEV_MENU"] === "1"
}

function registerAppLocaleHandler(): void {
  ipcMain.on(APP_LOCALE_CHANNEL, (_event, locale: unknown) => {
    if (!isAppLocale(locale) || currentLocale === locale) {
      return
    }
    currentLocale = locale
    if (app.isReady()) {
      installApplicationMenu()
    }
    windowsTrayLifecycle?.setLocale(locale)
  })
}

function createMainWindow(): void {
  installPermissionRequestHandler()
  const isMac = process.platform === "darwin"
  const titleBarTheme = resolveWindowsTitleBarTheme(nativeTheme.shouldUseDarkColors)
  const nativeMaterial = nativeWindowMaterialForPlatform(process.platform)
  const backgroundColor = windowBackgroundColorForMaterial(titleBarTheme, nativeMaterial)

  mainWindow = new BrowserWindow({
    width: 1080,
    height: 720,
    minWidth: 720,
    minHeight: 480,
    show: false,
    title: branding.appName,
    icon: getBrandingResourcePath("icon.png"),
    backgroundColor,
    ...(nativeMaterial === "none" ? {} : { transparent: true }),
    titleBarStyle: "hidden",
    ...(isMac
      ? {
          trafficLightPosition: macTrafficLightPosition,
          vibrancy: "sidebar",
          visualEffectState: "followWindow",
        }
      : {}),
    ...(isMac
      ? {}
      : {
          ...nativeWindowFrameForPlatform(process.platform),
          titleBarOverlay: buildWindowsTitleBarOverlay(titleBarTheme),
        }),
    webPreferences: {
      preload: preloadPath,
    },
  })

  mainWindow.once("ready-to-show", () => mainWindow?.show())
  mainWindow.on("focus", () => updateService.handleWindowForegrounded())
  mainWindow.on("show", () => updateService.handleWindowForegrounded())
  mainWindow.on("hide", () => {
    void updateService.getAppUpdateState().then(handleAppUpdateStateChanged)
  })

  if (process.platform === "darwin" || process.platform === "win32") {
    mainWindow.on(
      "close",
      createHideOnCloseHandler({
        hide: () => mainWindow?.hide(),
        isQuitting: () => isQuitting,
      }),
    )
  }

  if (process.platform === "win32") {
    if (!windowsTrayLifecycle) {
      try {
        windowsTrayLifecycle = createWindowsTrayLifecycle({
          iconPath: getBrandingResourcePath("icon.ico"),
          locale: activeLocale(),
          onExit: () => {
            armAppQuit("user-quit")
            app.quit()
          },
          onInstallUpdate: () => {
            void updateService.installDownloadedAppUpdate().catch((error: unknown) => {
              console.warn("[wanta] failed to install update from Windows tray", error)
              logDiagnostic("update-service", "tray update install failed", { error }, "warn")
            })
          },
          onOpen: () => {
            if (mainWindow) {
              revealMainWindow(mainWindow)
            } else {
              createMainWindow()
            }
          },
        })
        void updateService.getAppUpdateState().then(handleAppUpdateStateChanged)
      } catch (error) {
        console.warn("[wanta] failed to initialize Windows tray lifecycle", error)
      }
    }
  }

  // 渲染层里的外链（如 Markdown 里的链接、授权 URL）走系统浏览器，绝不在应用窗口内导航。
  // 仅放行安全的用户意图协议（http/https/mailto/tel），其余忽略，避免诱导触发 file:// 或自定义协议。
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalUrl(url)
    return { action: "deny" }
  })
  mainWindow.webContents.on("will-navigate", (event, url) => {
    // 只放行 dev server 同源页面或打包后的 renderer 目录，避免任意本地页面继承 preload 权限。
    if (!isTrustedRendererUrl(url, viteDevServerUrl, rendererBaseUrl)) {
      event.preventDefault()
      openExternalUrl(url)
    }
  })
  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame) {
      return
    }
    console.error("[wanta] renderer failed to load:", { errorCode, errorDescription, validatedURL })
    logDiagnostic(
      "main-window",
      "renderer failed to load",
      {
        errorCode,
        errorDescription,
        url: validatedURL,
      },
      "error",
    )
  })
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error("[wanta] main window render process gone:", details)
    logDiagnostic("main-window", "main window render process gone", { details }, "error")
  })
  mainWindow.on("unresponsive", () => {
    console.warn("[wanta] main window became unresponsive")
    logDiagnostic("main-window", "main window became unresponsive", {}, "warn")
  })

  if (viteDevServerUrl) {
    void mainWindow.loadURL(viteDevServerUrl).catch((error: unknown) => {
      console.error("[wanta] failed to load renderer URL:", error)
      logMainError("failed to load renderer URL", error, { url: viteDevServerUrl })
    })
  } else {
    const rendererEntry = path.join(rendererDist, "index.html")
    void mainWindow.loadFile(rendererEntry).catch((error: unknown) => {
      console.error("[wanta] failed to load renderer file:", error)
      logMainError("failed to load renderer file", error, { path: rendererEntry })
    })
  }

  mainWindow.on("closed", () => {
    mainWindow = null
  })
}

function installPermissionRequestHandler(): void {
  session.defaultSession.setPermissionCheckHandler((webContents, permission, _requestingOrigin, details) => {
    return (
      permission === "media" &&
      webContents === mainWindow?.webContents &&
      details.isMainFrame &&
      details.mediaType === "audio" &&
      isTrustedRendererUrl(details.requestingUrl, viteDevServerUrl, rendererBaseUrl)
    )
  })
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    callback(
      permission === "media" &&
        webContents === mainWindow?.webContents &&
        details.isMainFrame &&
        "mediaTypes" in details &&
        isAudioOnlyMediaRequest(details.mediaTypes) &&
        isTrustedRendererUrl(details.requestingUrl, viteDevServerUrl, rendererBaseUrl),
    )
  })
}

function showMainWindow(): void {
  if (!app.isReady()) {
    // open-url / second-instance 可能先于 ready 到达；窗口统一由 whenReady 创建。
    return
  }
  if (!mainWindow) {
    createMainWindow()
    return
  }
  revealMainWindow(mainWindow)
}

function handleAppUpdateStateChanged(state: AppUpdateState): void {
  const readyVersion = state.status.status === "downloaded" ? state.status.version : undefined
  windowsTrayLifecycle?.setUpdateReadyVersion(readyVersion)

  if (!readyVersion) {
    updateReadyNotification?.close()
    updateReadyNotification = null
    return
  }
  if (lastNotifiedUpdateVersion === readyVersion) return

  const window = mainWindow
  if (window?.isVisible() === true && window.isFocused()) {
    // 前台由渲染层在 Agent 空闲时显示应用内对话框，避免原生通知与对话框重复。
    return
  }
  lastNotifiedUpdateVersion = readyVersion
  if (!Notification.isSupported()) {
    logDiagnostic("update-service", "update ready notification unsupported", { version: readyVersion }, "warn")
    return
  }

  const chinese = activeLocale() === "zh-CN"
  const notification = new Notification({
    body: chinese ? "打开 Wanta 即可选择合适的时间重启。" : "Open Wanta to restart when you're ready.",
    groupId: "app-update",
    id: `app-update-${readyVersion}`,
    title: chinese ? `Wanta ${readyVersion} 已准备好` : `Wanta ${readyVersion} is ready`,
  })
  updateReadyNotification?.close()
  updateReadyNotification = notification
  notification.once("click", () => {
    logDiagnostic("update-service", "update ready notification clicked", { version: readyVersion }, "info")
    showMainWindow()
  })
  notification.once("show", () => {
    logDiagnostic("update-service", "update ready notification accepted", { version: readyVersion }, "info")
  })
  notification.once("failed", (_event, error) => {
    logDiagnostic("update-service", "update ready notification failed", { error, version: readyVersion }, "warn")
  })
  notification.once("close", () => {
    if (updateReadyNotification === notification) updateReadyNotification = null
  })
  notification.show()
}

async function handleDeepLink(url: string): Promise<boolean> {
  // 先聚焦窗口（登录回调的网络交换可能耗时数秒），再交给 auth 完成登录。
  showMainWindow()
  const connectionCallback = parseConnectionOAuthCallback(url, protocolScheme)
  if (connectionCallback) {
    sendAppCommand(APP_COMMANDS.openConnections)
    return true
  }
  const handled = await authManager.completeBrowserLoginCallback(url)
  if (!handled) {
    console.log("[wanta] unrecognized deep link:", redactDeepLink(url))
  }
  return handled
}

/** 日志脱敏：deep link 的 query 可能携带 authID（可直接兑换凭证），只记 scheme/host/path。 */
function redactDeepLink(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`
  } catch {
    return "<unparseable>"
  }
}
