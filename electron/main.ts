import type { AuthRuntimeAccount } from "./auth/store.ts"

import { ConnectionServer } from "@oomol/connection"
import { ElectronServerAdapter } from "@oomol/connection-electron-adapter/server"
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, session, shell } from "electron"
import { stat } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  ooBinaryName,
  opencodeBinaryName,
  resolveBundledBin,
  resolveDevOoBin,
  resolveDevOpencodeBin,
} from "./agent/binaries.ts"
import { AgentManager } from "./agent/manager.ts"
import { AuthManager, AuthServiceImpl } from "./auth/node.ts"
import { AuthStore } from "./auth/store.ts"
import { branding } from "./branding.ts"
import { ArtifactRootStore } from "./chat/artifact-roots.ts"
import { mimeFromPath } from "./chat/artifacts.ts"
import { saveClipboardAttachment } from "./chat/clipboard-attachment.ts"
import { ChatServiceImpl } from "./chat/node.ts"
import { StoppedGenerationStore } from "./chat/stopped-generations.ts"
import { ConnectionsServiceImpl } from "./connections/node.ts"
import { ModelsServiceImpl } from "./models/node.ts"
import { ModelsStore } from "./models/store.ts"
import { OrganizationsServiceImpl } from "./organizations/node.ts"
import { listenProtocolUrls, registerProtocolClient, requestProtocolSingleInstanceLock } from "./protocol.ts"
import { SessionActivityStore } from "./session/activity-store.ts"
import { SessionMetadataStore } from "./session/metadata-store.ts"
import { SessionServiceImpl } from "./session/node.ts"
import { SettingsServiceImpl } from "./settings/node.ts"
import { SettingsStore } from "./settings/store.ts"
import { SkillServiceImpl } from "./skills/node.ts"
import { UpdateServiceImpl } from "./update/node.ts"
import {
  buildWindowsTitleBarOverlay,
  resolveWindowsTitleBarTheme,
  windowBackgroundColorForTheme,
} from "./window/title-bar-overlay.ts"

const dirname = path.dirname(fileURLToPath(import.meta.url))
const appRoot = path.join(dirname, "..")
process.env.APP_ROOT = appRoot

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

const server = new ConnectionServer(new ElectronServerAdapter())

const settingsStore = new SettingsStore(app.getPath("userData"))
const modelsStore = new ModelsStore(app.getPath("userData"))
// 二进制解析：生产从打包 Resources/bin（extraResources），dev 从 node_modules（opencode）与 .oo-bin（oo）。
const opencodeBinPath = app.isPackaged
  ? resolveBundledBin(process.resourcesPath, opencodeBinaryName())
  : resolveDevOpencodeBin(appRoot)
const ooBinPath = app.isPackaged ? resolveBundledBin(process.resourcesPath, ooBinaryName()) : resolveOoBin()
process.env.OO_CLI_PATH = ooBinPath

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
const artifactRootStore = new ArtifactRootStore(app.getPath("userData"))
const stoppedGenerationStore = new StoppedGenerationStore(app.getPath("userData"))
const chatService = new ChatServiceImpl(null, { artifactRootStore, stoppedGenerationStore })
const sessionService = new SessionServiceImpl(null, {
  activityStore: sessionActivityStore,
  metadataStore: sessionMetadataStore,
})
const modelsService = new ModelsServiceImpl({
  store: modelsStore,
  onCustomModelsChanged: restartAgentForModelConfig,
})
// Connections 直调 connector HTTP（与 agent 解耦），复用同一账号 api-key。
const connectionsService = new ConnectionsServiceImpl()
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
const organizationsService = new OrganizationsServiceImpl(authManager)
const settingsService = new SettingsServiceImpl({
  store: settingsStore,
})
// 更新渠道（stable/beta）持久化在同一 settings.json；服务内部仅打包态联网。
const updateService = new UpdateServiceImpl({
  store: settingsStore,
})

chatService.sessionActivity.on(({ sessionId, usedAt }) => {
  void sessionService.recordUseAndEmit(sessionId, usedAt).catch(() => undefined)
})

registerProtocolClient(protocolScheme)
const { initialUrl, isLocked } = requestProtocolSingleInstanceLock(protocolScheme, { enabled: app.isPackaged })

if (!isLocked) {
  app.quit()
}

// 注册所有 service 实现，必须在 server.start() 之前。
server.registerService(chatService)
server.registerService(sessionService)
server.registerService(connectionsService)
server.registerService(skillService)
server.registerService(modelsService)
server.registerService(organizationsService)
server.registerService(settingsService)
server.registerService(authService)
server.registerService(updateService)
settingsService.applyStartupTheme()
registerAttachmentDialogHandler()

if (isLocked) {
  server.start()

  // macOS 冷启动的 open-url 在 ready 前就会派发（无缓冲），监听必须尽早注册——
  // 放进 whenReady 会整个丢掉登录回调。
  listenProtocolUrls(protocolScheme, { handleUrl: handleDeepLink }, showMainWindow)

  if (initialUrl) {
    // 冷启动经协议 URL 拉起（win/linux argv）：先完成登录回调，窗口创建在 whenReady。
    void authManager.completeBrowserLoginCallback(initialUrl).catch((error: unknown) => {
      console.error("[lumo] failed to handle startup deep link:", error)
    })
  }

  app.whenReady().then(() => {
    createMainWindow()
    // 启动静默检查（autoDownload=false，下载/安装由设置页 UI 显式触发）；dev 内部短路。
    void updateService.checkForAppUpdate().catch((error: unknown) => {
      console.warn("[lumo] startup update check failed:", error)
    })

    // 启动时一次性抹除磁盘上残留的旧长期 api-key（迁移到纯会话 token 后不再落盘任何凭证）。
    authStore.purgeLegacy()
    void authManager
      .activeRuntimeAccount()
      .then((account) => {
        if (account) {
          return applyAuthAccount(account)
        }
        console.log("[lumo] not signed in (or session expired) — login page will be shown")
        return undefined
      })
      .catch((error: unknown) => {
        console.error("[lumo] agent sidecar failed to start:", error)
      })

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow()
      }
    })
  })

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit()
    }
  })

  app.on("before-quit", () => {
    if (pendingSkillRuntimeRefresh) {
      clearTimeout(pendingSkillRuntimeRefresh)
      pendingSkillRuntimeRefresh = undefined
    }
    agent?.dispose()
    server.dispose()
  })
}

function registerAttachmentDialogHandler(): void {
  ipcMain.handle(
    "lumo:select-attachment-paths",
    async (event, kind: "file" | "directory"): Promise<SelectedAttachmentPath[]> => {
      const parent = BrowserWindow.fromWebContents(event.sender) ?? undefined
      const properties: Electron.OpenDialogOptions["properties"] =
        kind === "directory" ? ["openDirectory", "multiSelections"] : ["openFile", "multiSelections"]
      const result = parent
        ? await dialog.showOpenDialog(parent, { properties })
        : await dialog.showOpenDialog({ properties })
      if (result.canceled) {
        return []
      }
      const items = await Promise.all(result.filePaths.map((filePath) => selectedAttachmentPath(filePath)))
      return items.filter((item): item is SelectedAttachmentPath => Boolean(item))
    },
  )
  ipcMain.handle(
    "lumo:save-clipboard-attachment",
    async (_event, req: SaveClipboardAttachmentRequest): Promise<SelectedAttachmentPath> => {
      const attachment = await saveClipboardAttachment(app.getPath("userData"), req)
      return {
        name: attachment.name,
        mime: attachment.mime,
        size: attachment.size,
        path: attachment.path,
        kind: "file",
      }
    },
  )
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
  applyChain = next.catch(() => undefined)
  return next
}

/** 最近一次成功装配的账号：同凭证重复 apply 时短路，避免无谓的 sidecar 重启。 */
let appliedAccount: AuthRuntimeAccount | null = null

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
  appliedAccount = null
  agent?.dispose()
  agent = null
  chatService.setAgent(null)
  chatService.setAgentStatus(account ? { status: "starting" } : { status: "signed_out" })
  chatService.setBillingAccountContext({ token: account?.sessionToken, userId: account?.id })
  sessionService.setAgent(null)
  connectionsService.setAuthToken(account?.sessionToken)
  // 凭证变化后主动广播摘要，连接面板即时刷新（失败静默，面板有自己的拉取路径）。
  void connectionsService.refreshAndEmit().catch(() => undefined)

  if (!account) {
    return
  }

  const nextAgent = new AgentManager({
    authToken: account.sessionToken,
    opencodeBinPath,
    ooBinPath,
    rootDir: path.join(app.getPath("userData"), "agent"),
    customModels: await modelsStore.runtimeCustomModels(),
  })
  agent = nextAgent
  chatService.setAgent(nextAgent)
  sessionService.setAgent(nextAgent)
  try {
    await nextAgent.start()
  } catch (error) {
    // 启动失败不留僵尸 agent：清空引用，下次登录可重试。
    nextAgent.dispose()
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
  console.log("[lumo] agent sidecar ready at", nextAgent.url)
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
      console.error("[lumo] failed to restart agent after model config change:", error)
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
    console.warn("[lumo] refreshing agent after skill change while generation is still active:", {
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
      console.error("[lumo] failed to restart agent after skill change:", { error, reason })
    })
}

/**
 * dev：解析 oo 绝对路径（LUMO_OO_BIN 覆盖 > 项目本地 .oo-bin/，由 postinstall 下载）。生产由 extraResources 解析。
 * 不在此做存在性预检——主进程禁用同步 fs（阻塞渲染）；dev 缺失由 predev 守卫（scripts/check-oo.ts）提前报错退出，
 * 打包产物则一定内置 oo。
 */
function resolveOoBin(): string {
  if (process.env["LUMO_OO_BIN"]) {
    return process.env["LUMO_OO_BIN"]
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
    void shell.openExternal(url)
  }
}

function createMainWindow(): void {
  installPermissionRequestHandler()
  const isMac = process.platform === "darwin"
  const titleBarTheme = resolveWindowsTitleBarTheme(nativeTheme.shouldUseDarkColors)
  const backgroundColor = windowBackgroundColorForTheme(titleBarTheme)

  mainWindow = new BrowserWindow({
    width: 1080,
    height: 720,
    minWidth: 720,
    minHeight: 480,
    show: false,
    title: branding.appName,
    icon: getBrandingResourcePath("icon.png"),
    backgroundColor,
    titleBarStyle: "hidden",
    ...(isMac ? { trafficLightPosition: macTrafficLightPosition } : {}),
    ...(isMac
      ? {}
      : {
          frame: false,
          titleBarOverlay: buildWindowsTitleBarOverlay(titleBarTheme),
        }),
    webPreferences: {
      preload: preloadPath,
    },
  })

  mainWindow.once("ready-to-show", () => mainWindow?.show())

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

  if (viteDevServerUrl) {
    void mainWindow.loadURL(viteDevServerUrl)
  } else {
    void mainWindow.loadFile(path.join(rendererDist, "index.html"))
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
  if (mainWindow.isMinimized()) {
    mainWindow.restore()
  }
  mainWindow.focus()
}

async function handleDeepLink(url: string): Promise<boolean> {
  // 先聚焦窗口（登录回调的网络交换可能耗时数秒），再交给 auth 完成登录。
  showMainWindow()
  const handled = await authManager.completeBrowserLoginCallback(url)
  if (!handled) {
    console.log("[lumo] unrecognized deep link:", redactDeepLink(url))
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
