import type { AppCommand } from "./app-command.ts"
import type { AppLocale } from "./app-locale.ts"
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
import { APP_COMMAND_CHANNEL } from "./app-command.ts"
import { APP_LOCALE_CHANNEL, isAppLocale, normalizeAppLocale } from "./app-locale.ts"
import { AuthManager, AuthServiceImpl } from "./auth/node.ts"
import { AuthStore } from "./auth/store.ts"
import { branding } from "./branding.ts"
import { ArtifactRootStore } from "./chat/artifact-roots.ts"
import { mimeFromPath } from "./chat/artifacts.ts"
import { AuthorizationOverlayStore } from "./chat/authorization.ts"
import { saveClipboardAttachment } from "./chat/clipboard-attachment.ts"
import { ChatServiceImpl } from "./chat/node.ts"
import { StoppedGenerationStore } from "./chat/stopped-generations.ts"
import { GitServiceImpl } from "./git/node.ts"
import { ModelsServiceImpl } from "./models/node.ts"
import { ModelsStore } from "./models/store.ts"
import { installOomolCorsShim } from "./net/oomol-cors.ts"
// Organizations 请求已整体搬到渲染层（src/lib/organizations-client.ts），不再有对应主进程 service。
import { listenProtocolUrls, registerProtocolClient, requestProtocolSingleInstanceLock } from "./protocol.ts"
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
import { createWindowsCloseHandler, revealWindowFromTray } from "./window/windows-tray-close-behavior.ts"
import { createWindowsTrayLifecycle } from "./window/windows-tray-lifecycle.ts"

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
let currentLocale: AppLocale | null = null
let isQuitting = false
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
const artifactRootStore = new ArtifactRootStore(app.getPath("userData"))
const authorizationOverlayStore = new AuthorizationOverlayStore(app.getPath("userData"))
const stoppedGenerationStore = new StoppedGenerationStore(app.getPath("userData"))
// Connections 请求已整体搬到渲染层（src/lib/connections-client.ts）；主进程只保留 agent 组织作用域同步，
// 经 ChatService.setAgentOrganization → onSetAgentOrganization 回调（渲染层切 workspace 时调用）。
const chatService = new ChatServiceImpl(null, {
  artifactRootStore,
  authorizationOverlayStore,
  stoppedGenerationStore,
  onSetAgentOrganization: handleAgentOrganizationChanged,
})
const sessionService = new SessionServiceImpl(null, {
  activityStore: sessionActivityStore,
  metadataStore: sessionMetadataStore,
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
  store: settingsStore,
})
const gitService = new GitServiceImpl()

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
server.registerService(skillService)
server.registerService(modelsService)
server.registerService(settingsService)
server.registerService(authService)
server.registerService(updateService)
server.registerService(gitService)
settingsService.applyStartupTheme()
registerAttachmentDialogHandler()
registerAppLocaleHandler()

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

  app.whenReady().then(() => {
    // 放行渲染进程对 *.<endpoint> 的已鉴权直连请求（凭证经会话 cookie 自动附带，token 不进渲染层）。
    installOomolCorsShim(session.defaultSession)
    installApplicationMenu()
    createMainWindow()
    // 启动静默检查（autoDownload=false，下载/安装由设置页 UI 显式触发）；dev 内部短路。
    void updateService.checkForAppUpdate().catch((error: unknown) => {
      console.warn("[wanta] startup update check failed:", error)
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
    isQuitting = true
    if (pendingSkillRuntimeRefresh) {
      clearTimeout(pendingSkillRuntimeRefresh)
      pendingSkillRuntimeRefresh = undefined
    }
    windowsTrayLifecycle?.dispose()
    windowsTrayLifecycle = null
    agent?.dispose()
    server.dispose()
  })
}

function registerAttachmentDialogHandler(): void {
  ipcMain.handle(
    "wanta:select-attachment-paths",
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
    "wanta:save-clipboard-attachment",
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
  appliedAccount = null
  agent?.dispose()
  agent = null
  chatService.setAgent(null)
  chatService.setAgentStatus(account ? { status: "starting" } : { status: "signed_out" })
  sessionService.setAgent(null)

  if (!account) {
    return
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
  console.log("[wanta] agent sidecar ready at", nextAgent.url)
  void skillService.ensureDefaultRegistrySkillsInstalled().catch((error: unknown) => {
    console.warn("[wanta] default registry skill installation failed:", error)
  })
}

function handleAgentOrganizationChanged(organizationName: string | undefined): void {
  activeAgentOrganizationName = organizationName
  void agent?.setOrganizationName(organizationName).catch((error: unknown) => {
    console.error("[wanta] failed to update agent workspace scope:", error)
  })
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
    void shell.openExternal(url)
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

  if (process.platform === "win32") {
    mainWindow.on(
      "close",
      createWindowsCloseHandler({
        hide: () => mainWindow?.hide(),
        isQuitting: () => isQuitting,
      }),
    )

    if (!windowsTrayLifecycle) {
      try {
        windowsTrayLifecycle = createWindowsTrayLifecycle({
          iconPath: getBrandingResourcePath("icon.ico"),
          locale: activeLocale(),
          onExit: () => {
            isQuitting = true
            app.quit()
          },
          onOpen: () => {
            if (mainWindow) {
              revealWindowFromTray(mainWindow)
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
  if (process.platform === "win32") {
    mainWindow.show()
  }
  mainWindow.focus()
}

async function handleDeepLink(url: string): Promise<boolean> {
  // 先聚焦窗口（登录回调的网络交换可能耗时数秒），再交给 auth 完成登录。
  showMainWindow()
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
