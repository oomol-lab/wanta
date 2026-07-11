import type { AppCommand } from "./app-command.ts"
import type { AppLocale } from "./app-locale.ts"
import type { AttachmentPickerKind } from "./attachment-picker.ts"
import type { AuthRuntimeAccount } from "./auth/store.ts"

import { ConnectionServer } from "@oomol/connection"
import { ElectronServerAdapter } from "@oomol/connection-electron-adapter/server"
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, session, shell } from "electron"
import { stat } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  ooBinaryName,
  opencodeBinaryName,
  resolveBundledBin,
  resolveBundledSkillsDir,
  resolveDevBundledSkillsDir,
  resolveDevOoBin,
  resolveDevOpencodeBin,
} from "./agent/binaries.ts"
import { AgentManager } from "./agent/manager.ts"
import { APP_COMMAND_CHANNEL, APP_COMMANDS } from "./app-command.ts"
import { APP_LOCALE_CHANNEL, isAppLocale, normalizeAppLocale } from "./app-locale.ts"
import { ArtifactResourceLeaseStore } from "./artifact-resource/lease-store.ts"
import {
  artifactResourceUrl,
  installArtifactResourceProtocol,
  registerArtifactResourceScheme,
} from "./artifact-resource/protocol.ts"
import { isAttachmentPickerKind } from "./attachment-picker.ts"
import { AuthManager, AuthServiceImpl } from "./auth/node.ts"
import { AuthStore } from "./auth/store.ts"
import { branding } from "./branding.ts"
import { ArtifactBundleStore } from "./chat/artifact-bundles.ts"
import { mimeFromPath } from "./chat/artifacts.ts"
import { AuthorizationOverlayStore } from "./chat/authorization.ts"
import { saveClipboardAttachment } from "./chat/clipboard-attachment.ts"
import { ChatServiceImpl } from "./chat/node.ts"
import { SpreadsheetPreviewWorkerClient } from "./chat/spreadsheet-preview-worker-client.ts"
import { StoppedGenerationStore } from "./chat/stopped-generations.ts"
import { TurnOutputStore } from "./chat/turn-outputs.ts"
import { parseConnectionOAuthCallback } from "./connections/domain.ts"
import { configureDiagnosticsLog, flushDiagnosticsLog, logDiagnostic } from "./diagnostics-log.ts"
import { GitServiceImpl } from "./git/node.ts"
import { ModelsServiceImpl } from "./models/node.ts"
import { ModelsStore } from "./models/store.ts"
import { installOomolCorsShim } from "./net/oomol-cors.ts"
// Organizations 请求已整体搬到渲染层（src/lib/organizations-client.ts），不再有对应主进程 service。
import { listenProtocolUrls, registerProtocolClient, requestProtocolSingleInstanceLock } from "./protocol.ts"
import { normalizeRendererErrorReport } from "./renderer-error-report.ts"
import { SessionActivityStore } from "./session/activity-store.ts"
import { SessionMetadataStore } from "./session/metadata-store.ts"
import { SessionServiceImpl } from "./session/node.ts"
import { SessionProjectStore } from "./session/project-store.ts"
import { SettingsServiceImpl } from "./settings/node.ts"
import { SettingsStore } from "./settings/store.ts"
import { SkillServiceImpl } from "./skills/node.ts"
import { UpdateServiceImpl } from "./update/node.ts"
import { buildApplicationMenuTemplate } from "./window/application-menu.ts"
import {
  buildWindowsTitleBarOverlay,
  nativeWindowMaterialForPlatform,
  resolveWindowsTitleBarTheme,
  windowBackgroundColorForMaterial,
} from "./window/title-bar-overlay.ts"
import { createHideOnCloseHandler, revealMainWindow } from "./window/window-close-behavior.ts"
import { createWindowsTrayLifecycle } from "./window/windows-tray-lifecycle.ts"

const dirname = path.dirname(fileURLToPath(import.meta.url))
const appRoot = path.join(dirname, "..")
process.env.APP_ROOT = appRoot
configureDiagnosticsLog(path.join(app.getPath("userData"), "logs", "diagnostics.jsonl"))
installMainProcessErrorHandlers()
registerArtifactResourceScheme()

const viteDevServerUrl = process.env["VITE_DEV_SERVER_URL"]
const rendererDist = path.join(appRoot, "dist")
const preloadPath = path.join(dirname, "preload.js")
const macTrafficLightPosition = { x: 15, y: 17 }
const skillRuntimeRefreshDelayMs = 1_500
const skillRuntimeRefreshBusyRetryMs = 2_000
const skillRuntimeRefreshMaxBusyRetries = 10

interface SelectedAttachmentPath {
  name: string
  mime: string
  size: number
  path: string
  kind: "file" | "directory"
}

interface SaveClipboardAttachmentRequest {
  name?: string
  mime?: string
  bytes: ArrayBuffer
}

// dev 用本地 scheme，生产用正式 scheme（R1 / 阶段 6）。
const protocolScheme = viteDevServerUrl ? branding.devProtocolScheme : branding.protocolScheme

let mainWindow: BrowserWindow | null = null
let currentLocale: AppLocale | null = null
let isQuitting = false
type AppQuitIntent = "none" | "user-quit" | "update-install" | "termination-signal"
let appQuitIntent: AppQuitIntent = "none"
// 退出回收只跑一次：记忆化 Promise，多条退出路径（before-quit / 信号 / 更新安装）复用同一次回收。
let shutdownReap: Promise<void> | null = null
let windowsTrayLifecycle: {
  dispose: () => void
  setLocale: (locale: string) => void
} | null = null

const server = new ConnectionServer(new ElectronServerAdapter())

const settingsStore = new SettingsStore(app.getPath("userData"))
const modelsStore = new ModelsStore(app.getPath("userData"))
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

// Agent 内核：凭证来自浏览器登录（userData/auth.json，账号默认 api-key 等价旧 OO_API_KEY env）。
// 未登录时 agent=null，服务仍注册但 isReady()=false，渲染层显示登录页；
// 登录 / 登出时经 applyAuthAccount 动态装配。
let agent: AgentManager | null = null
// 装配串行化：登录后紧接登出时避免 dispose/start 交错。
let applyChain: Promise<void> = Promise.resolve()
let agentRuntimeVersion = 0
let appliedAgentRuntimeVersion = -1
let pendingSkillRuntimeRefresh: NodeJS.Timeout | undefined

const authStore = new AuthStore(app.getPath("userData"))
const sessionActivityStore = new SessionActivityStore(app.getPath("userData"))
const sessionMetadataStore = new SessionMetadataStore(app.getPath("userData"))
const sessionProjectStore = new SessionProjectStore(app.getPath("userData"))
const artifactBundleStore = new ArtifactBundleStore(app.getPath("userData"))
const authorizationOverlayStore = new AuthorizationOverlayStore(app.getPath("userData"))
const stoppedGenerationStore = new StoppedGenerationStore(app.getPath("userData"))
const turnOutputStore = new TurnOutputStore(app.getPath("userData"), artifactBundleStore)
const trustedAttachmentPaths = new Set<string>()
const artifactResourceLeaseStore = new ArtifactResourceLeaseStore()
const spreadsheetPreviewWorker = new SpreadsheetPreviewWorkerClient()
// Connections 请求已整体搬到渲染层（src/lib/connections-client.ts）；主进程只保留 agent 组织作用域同步，
// 经 ChatService.setAgentOrganization → onSetAgentOrganization 回调（渲染层切 workspace 时调用）。
const chatService = new ChatServiceImpl(null, {
  createArtifactResourceUrl: (item) => artifactResourceUrl(artifactResourceLeaseStore.grant(item).token),
  createSpreadsheetPreview: (filePath, mime, size) => spreadsheetPreviewWorker.preview(filePath, mime, size),
  artifactBundleStore,
  authorizationOverlayStore,
  projectStore: sessionProjectStore,
  stoppedGenerationStore,
  trustedAttachmentPaths,
  turnOutputStore,
  onSetAgentOrganization: handleAgentOrganizationChanged,
})
const sessionService = new SessionServiceImpl(null, {
  activityStore: sessionActivityStore,
  metadataStore: sessionMetadataStore,
  onSessionRemoved: async (sessionId) => {
    await Promise.all([artifactBundleStore.removeSession(sessionId), turnOutputStore.removeSession(sessionId)]).catch(
      (error: unknown) => {
        console.warn("[wanta] failed to clean removed session outputs", error)
      },
    )
  },
  projectStore: sessionProjectStore,
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
const authService = new AuthServiceImpl(authManager)
const skillService = new SkillServiceImpl(authManager, {
  onRuntimeSkillsChanged: scheduleAgentRefreshForSkillChange,
})
const settingsService = new SettingsServiceImpl({
  store: settingsStore,
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
  store: settingsStore,
})
const gitService = new GitServiceImpl({
  projectStore: sessionProjectStore,
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
server.registerService(sessionService)
server.registerService(skillService)
server.registerService(modelsService)
server.registerService(settingsService)
server.registerService(authService)
server.registerService(updateService)
server.registerService(gitService)
settingsService.applyStartupTheme()
registerAttachmentDialogHandler()
registerAppLocaleHandler()
registerRendererErrorHandler()

if (isLocked) {
  server.start()

  // macOS 冷启动的 open-url 在 ready 前就会派发（无缓冲），监听必须尽早注册——
  // 放进 whenReady 会整个丢掉登录回调。
  listenProtocolUrls(protocolScheme, { handleUrl: handleDeepLink }, showMainWindow)

  if (initialUrl) {
    // 冷启动经协议 URL 拉起（win/linux argv）：先完成登录回调，窗口创建在 whenReady。
    void authManager.completeBrowserLoginCallback(initialUrl).catch((error: unknown) => {
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
      // 启动静默检查（autoDownload=false，下载/安装由设置页 UI 显式触发）；dev 内部短路。
      void updateService.checkForAppUpdate().catch((error: unknown) => {
        console.warn("[wanta] startup update check failed:", error)
        logMainError("startup update check failed", error)
      })

      // 启动时一次性抹除磁盘上残留的旧长期 api-key（迁移到纯会话 token 后不再落盘任何凭证）。
      authStore.purgeLegacy()
      void authManager
        .activeRuntimeAccount()
        .then((account) => {
          if (account) {
            return applyAuthAccount(account)
          }
          console.log("[wanta] not signed in (or session expired) — login page will be shown")
          return undefined
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
    if (pendingSkillRuntimeRefresh) {
      clearTimeout(pendingSkillRuntimeRefresh)
      pendingSkillRuntimeRefresh = undefined
    }
    // 退出观感：先藏窗口，回收（含最长宽限期）在后台进行，不让用户盯着卡住的窗口。
    mainWindow?.hide()
    windowsTrayLifecycle?.dispose()
    windowsTrayLifecycle = null
    await agent?.dispose()
    await spreadsheetPreviewWorker.dispose()
    server.dispose()
    artifactResourceLeaseStore.clear()
    await flushDiagnosticsLog().catch((error: unknown) => {
      console.warn("[wanta] failed to flush diagnostics log", error)
    })
  })()
  return shutdownReap
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

function registerAttachmentDialogHandler(): void {
  ipcMain.handle("wanta:select-attachment-paths", async (event, kind: unknown): Promise<SelectedAttachmentPath[]> => {
    assertAttachmentPickerKind(kind)
    const parent = BrowserWindow.fromWebContents(event.sender) ?? undefined
    const properties = attachmentDialogProperties(kind, process.platform)
    const result = parent
      ? await dialog.showOpenDialog(parent, { properties })
      : await dialog.showOpenDialog({ properties })
    if (result.canceled) {
      return []
    }
    const items = (await Promise.all(result.filePaths.map((filePath) => selectedAttachmentPath(filePath)))).filter(
      (item): item is SelectedAttachmentPath => Boolean(item),
    )
    for (const item of items) {
      rememberTrustedAttachmentPath(item.path)
    }
    return items
  })
  ipcMain.handle(
    "wanta:save-clipboard-attachment",
    async (_event, req: SaveClipboardAttachmentRequest): Promise<SelectedAttachmentPath> => {
      const attachment = await saveClipboardAttachment(app.getPath("userData"), req)
      rememberTrustedAttachmentPath(attachment.path)
      return {
        name: attachment.name,
        mime: attachment.mime,
        size: attachment.size,
        path: attachment.path,
        kind: "file",
      }
    },
  )
  ipcMain.handle("wanta:selected-attachment-path-for-file", async (_event, filePath: unknown) => {
    if (typeof filePath !== "string" || !filePath.trim()) {
      return null
    }
    const item = await selectedAttachmentPath(filePath)
    if (item) {
      rememberTrustedAttachmentPath(item.path)
    }
    return item
  })
  ipcMain.handle("wanta:select-project-directory", async (event): Promise<SelectedAttachmentPath | null> => {
    const parent = BrowserWindow.fromWebContents(event.sender) ?? undefined
    const options: Electron.OpenDialogOptions = {
      properties: ["openDirectory", "createDirectory"],
    }
    const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths[0]) {
      return null
    }
    const directoryPath = result.filePaths[0]
    return {
      name: path.basename(directoryPath.replace(/[\\/]+$/, "")) || directoryPath,
      mime: "inode/directory",
      size: 0,
      path: directoryPath,
      kind: "directory",
    }
  })
}

function rememberTrustedAttachmentPath(filePath: string): void {
  if (filePath.trim()) {
    trustedAttachmentPaths.add(filePath)
  }
}

function registerRendererErrorHandler(): void {
  ipcMain.on("wanta:renderer-error", (_event, input: unknown) => {
    const report = normalizeRendererErrorReport(input)
    if (!report) {
      return
    }
    const message = report.level === "error" ? "renderer error" : "renderer handled issue"
    if (report.level === "error") {
      console.error("[wanta] renderer error:", report)
    } else {
      console.warn("[wanta] renderer handled issue:", report)
    }
    logDiagnostic("renderer", message, { ...report }, report.level)
  })
}

function assertAttachmentPickerKind(kind: unknown): asserts kind is AttachmentPickerKind {
  if (!isAttachmentPickerKind(kind)) {
    throw new Error("Invalid attachment picker kind.")
  }
}

function attachmentDialogProperties(
  kind: AttachmentPickerKind,
  platform: NodeJS.Platform,
): NonNullable<Electron.OpenDialogOptions["properties"]> {
  switch (kind) {
    case "file":
      return ["openFile", "multiSelections"]
    case "directory":
      return ["openDirectory", "multiSelections"]
    case "file-or-directory": {
      if (platform !== "darwin") {
        throw new Error("Selecting files and folders together is only supported on macOS.")
      }
      return ["openFile", "openDirectory", "multiSelections"]
    }
  }
}

async function selectedAttachmentPath(filePath: string): Promise<SelectedAttachmentPath | null> {
  try {
    const info = await stat(filePath)
    const kind = info.isDirectory() ? "directory" : "file"
    return {
      name: path.basename(filePath.replace(/[\\/]+$/, "")) || filePath,
      mime: kind === "directory" ? "inode/directory" : mimeFromPath(filePath),
      size: kind === "file" ? info.size : 0,
      path: filePath,
      kind,
    }
  } catch {
    return null
  }
}

function runtimeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 凭证 → 运行时装配：替换 agent（重启 sidecar）并同步 connector 凭证。经 applyChain 串行执行。 */
function applyAuthAccount(account: AuthRuntimeAccount | null): Promise<void> {
  const next = applyChain.then(() => applyAuthAccountNow(account))
  applyChain = next.catch((error: unknown) => {
    logMainError("auth account application failed", error)
  })
  return next
}

/** 最近一次成功装配的账号：同凭证重复 apply 时短路，避免无谓的 sidecar 重启。 */
let appliedAccount: AuthRuntimeAccount | null = null
// agent 的当前组织作用域：由渲染层切 workspace 时经 setAgentOrganization IPC 更新；agent 重建时据此设初值。
let activeAgentOrganizationName: string | undefined

async function applyAuthAccountNow(account: AuthRuntimeAccount | null): Promise<void> {
  // account 恒带会话 token（来自 activeRuntimeAccount / adoptAccount）；token 缺失即为 null = 登出态。
  // 幂等短路：冷启动 deep-link 与 whenReady 双路径会用同一账号 apply 两次。
  if (
    account &&
    appliedAccount &&
    agent?.isReady() &&
    appliedAgentRuntimeVersion === agentRuntimeVersion &&
    account.id === appliedAccount.id &&
    account.sessionToken === appliedAccount.sessionToken
  ) {
    return
  }
  const previousAccountId = appliedAccount?.id
  appliedAccount = null
  // 后台回收旧 agent（含 opencode 工具子进程树）；重启不等回收完成，回收在后台自完成。
  void agent?.dispose()
  agent = null
  chatService.setAgent(null)
  chatService.setAgentStatus(account ? { status: "starting" } : { status: "signed_out" })
  sessionService.setAgent(null)

  if (!account) {
    activeAgentOrganizationName = undefined
    return
  }
  if (previousAccountId && previousAccountId !== account.id) {
    activeAgentOrganizationName = undefined
  }

  const nextAgent = new AgentManager({
    authToken: account.sessionToken,
    opencodeBinPath,
    ooBinPath,
    bundledSkillsDir,
    organizationName: activeAgentOrganizationName,
    rootDir: path.join(app.getPath("userData"), "agent"),
    customModels: await modelsStore.runtimeCustomModels(),
  })
  agent = nextAgent
  chatService.setAgent(nextAgent)
  sessionService.setAgent(nextAgent)
  try {
    await nextAgent.start()
  } catch (error) {
    // 启动失败不留僵尸 agent：清空引用，下次登录可重试。后台回收，不阻塞错误上报。
    void nextAgent.dispose()
    agent = null
    chatService.setAgent(null)
    chatService.setAgentStatus({ status: "error", message: runtimeErrorMessage(error) })
    sessionService.setAgent(null)
    throw error
  }
  appliedAccount = account
  appliedAgentRuntimeVersion = agentRuntimeVersion
  chatService.startEventBridge()
  chatService.setAgentStatus({ status: "ready" })
  console.log("[wanta] agent sidecar ready at", nextAgent.url)
  void skillService.ensureDefaultRegistrySkillsInstalled().catch((error: unknown) => {
    console.warn("[wanta] default registry skill installation failed:", error)
  })
}

async function handleAgentOrganizationChanged(organizationName: string | undefined): Promise<void> {
  const previousOrganizationName = activeAgentOrganizationName
  const nextOrganizationName = organizationName?.trim() ? organizationName.trim() : undefined
  activeAgentOrganizationName = nextOrganizationName
  try {
    await agent?.setOrganizationName(nextOrganizationName)
  } catch (error: unknown) {
    activeAgentOrganizationName = previousOrganizationName
    console.error("[wanta] failed to update agent workspace scope:", error)
    throw error
  }
}

function restartAgentForModelConfig(): void {
  agentRuntimeVersion += 1
  void authManager
    .activeRuntimeAccount()
    .then(async (account) => {
      await applyAuthAccount(account)
      // 会话中途过期：装配登出态后主动广播"未登录"，渲染层据此落回登录页（一致生命周期）。
      if (!account) {
        await authManager.broadcastAuthState()
      }
    })
    .catch((error: unknown) => {
      console.error("[wanta] failed to restart agent after model config change:", error)
    })
}

function scheduleAgentRefreshForSkillChange(
  reason: string,
  delayMs = skillRuntimeRefreshDelayMs,
  busyRetryCount = 0,
): void {
  if (pendingSkillRuntimeRefresh) {
    clearTimeout(pendingSkillRuntimeRefresh)
  }

  pendingSkillRuntimeRefresh = setTimeout(() => {
    pendingSkillRuntimeRefresh = undefined
    refreshAgentForSkillChange(reason, busyRetryCount)
  }, delayMs)
  pendingSkillRuntimeRefresh.unref()
}

function refreshAgentForSkillChange(reason: string, busyRetryCount = 0): void {
  if (!authManager.activeAccount() || !agent?.isReady()) {
    return
  }

  if (chatService.hasActiveGeneration()) {
    if (busyRetryCount < skillRuntimeRefreshMaxBusyRetries) {
      scheduleAgentRefreshForSkillChange(reason, skillRuntimeRefreshBusyRetryMs, busyRetryCount + 1)
      return
    }
    console.warn("[wanta] refreshing agent after skill change while generation is still active:", {
      busyRetryCount,
      reason,
    })
  }

  agentRuntimeVersion += 1
  void authManager
    .activeRuntimeAccount()
    .then(async (account) => {
      await applyAuthAccount(account)
      // 会话中途过期：装配登出态后主动广播"未登录"，渲染层据此落回登录页（一致生命周期）。
      if (!account) {
        await authManager.broadcastAuthState()
      }
    })
    .catch((error: unknown) => {
      console.error("[wanta] failed to restart agent after skill change:", { error, reason })
    })
}

/**
 * dev：解析 oo 绝对路径（WANTA_OO_BIN 覆盖 > 项目本地 .oo-bin/，由 postinstall 下载）。生产由 extraResources 解析。
 * 不在此做存在性预检——主进程禁用同步 fs（阻塞渲染）；dev 缺失由 predev 守卫（scripts/check-oo.ts）提前报错退出，
 * 打包产物则一定内置 oo。
 */
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

function installApplicationMenu(): void {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate(
      buildApplicationMenuTemplate({
        developmentMode: shouldShowDevelopmentMenu(),
        locale: activeLocale(),
        onCommand: sendAppCommand,
        platform: process.platform,
      }),
    ),
  )
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
          ...(nativeMaterial === "windows-mica" ? { backgroundMaterial: "mica" } : {}),
          frame: false,
          titleBarOverlay: buildWindowsTitleBarOverlay(titleBarTheme),
        }),
    webPreferences: {
      preload: preloadPath,
    },
  })

  mainWindow.once("ready-to-show", () => mainWindow?.show())

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
          onOpen: () => {
            if (mainWindow) {
              revealMainWindow(mainWindow)
            } else {
              createMainWindow()
            }
          },
        })
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
    // 应用自身的页面（dev server / file://）放行，其余一律拦截并外开。
    const isAppUrl = viteDevServerUrl ? url.startsWith(viteDevServerUrl) : url.startsWith("file:")
    if (!isAppUrl) {
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
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === "media")
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
