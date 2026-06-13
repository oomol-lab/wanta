import type { AuthRuntimeAccount } from "./auth/store.ts"

import { ConnectionServer } from "@oomol/connection"
import { ElectronServerAdapter } from "@oomol/connection-electron-adapter/server"
import { app, BrowserWindow, nativeTheme, session, shell } from "electron"
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
import { readOomolSessionCookie } from "./auth/session-cookie.ts"
import { AuthStore } from "./auth/store.ts"
import { branding } from "./branding.ts"
import { ChatServiceImpl } from "./chat/node.ts"
import { ConnectionsServiceImpl } from "./connections/node.ts"
import { listenProtocolUrls, registerProtocolClient, requestProtocolSingleInstanceLock } from "./protocol.ts"
import { SessionServiceImpl } from "./session/node.ts"
import { SettingsServiceImpl } from "./settings/node.ts"
import { SettingsStore } from "./settings/store.ts"
import { UpdateServiceImpl } from "./update/node.ts"

const dirname = path.dirname(fileURLToPath(import.meta.url))
const appRoot = path.join(dirname, "..")
process.env.APP_ROOT = appRoot

const viteDevServerUrl = process.env["VITE_DEV_SERVER_URL"]
const rendererDist = path.join(appRoot, "dist")
const preloadPath = path.join(dirname, "preload.js")
const titleBarHeight = 48
const macTrafficLightPosition = { x: 15, y: 17 }
const darkWindowColor = "#171717"
const lightWindowColor = "#ffffff"

// dev 用本地 scheme，生产用正式 scheme（R1 / 阶段 6）。
const protocolScheme = viteDevServerUrl ? branding.devProtocolScheme : branding.protocolScheme

let mainWindow: BrowserWindow | null = null

const server = new ConnectionServer(new ElectronServerAdapter())

const settingsStore = new SettingsStore(app.getPath("userData"))
// 二进制解析：生产从打包 Resources/bin（extraResources），dev 从 node_modules（opencode）与 .oo-bin（oo）。
const opencodeBinPath = app.isPackaged
  ? resolveBundledBin(process.resourcesPath, opencodeBinaryName())
  : resolveDevOpencodeBin(appRoot)
const ooBinPath = app.isPackaged ? resolveBundledBin(process.resourcesPath, ooBinaryName()) : resolveOoBin()

// Agent 内核：凭证来自浏览器登录（userData/auth.json，账号默认 api-key 等价旧 OO_API_KEY env）。
// 未登录时 agent=null，服务仍注册但 isReady()=false，渲染层显示登录页；
// 登录 / 登出时经 applyAuthAccount 动态装配。
let agent: AgentManager | null = null
// 装配串行化：登录后紧接登出时避免 dispose/start 交错。
let applyChain: Promise<void> = Promise.resolve()

const authStore = new AuthStore(app.getPath("userData"))
const chatService = new ChatServiceImpl()
const sessionService = new SessionServiceImpl()
// Connections 直调 connector HTTP（与 agent 解耦），复用同一账号 api-key。
const connectionsService = new ConnectionsServiceImpl()
// 凭证逻辑在未注册的 AuthManager；注册给渲染层的 AuthServiceImpl 只是薄门面（防 RPC 凭证泄露）。
const authManager = new AuthManager({
  store: authStore,
  protocolScheme,
  applyAccount: applyAuthAccount,
})
const authService = new AuthServiceImpl(authManager)
const settingsService = new SettingsServiceImpl({
  store: settingsStore,
})
// 更新渠道（stable/beta）持久化在同一 settings.json；服务内部仅打包态联网。
const updateService = new UpdateServiceImpl({
  store: settingsStore,
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
server.registerService(settingsService)
server.registerService(authService)
server.registerService(updateService)
settingsService.applyStartupTheme()

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

    const account = authManager.activeAccount()
    if (account) {
      void applyAuthAccount(account).catch((error: unknown) => {
        console.error("[lumo] agent sidecar failed to start:", error)
      })
    } else {
      console.log("[lumo] not signed in — login page will be shown")
    }

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
    agent?.dispose()
    server.dispose()
  })
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
  const effectiveAccount =
    account && !account.sessionToken ? { ...account, sessionToken: await readOomolSessionCookie() } : account
  // 幂等短路：冷启动 deep-link 与 whenReady 双路径会用同一账号 apply 两次。
  if (
    effectiveAccount &&
    appliedAccount &&
    agent?.isReady() &&
    effectiveAccount.id === appliedAccount.id &&
    effectiveAccount.apiKey === appliedAccount.apiKey &&
    effectiveAccount.sessionToken === appliedAccount.sessionToken
  ) {
    return
  }
  appliedAccount = null
  agent?.dispose()
  agent = null
  chatService.setAgent(null)
  chatService.setVoiceAuthToken(effectiveAccount?.sessionToken)
  sessionService.setAgent(null)
  connectionsService.setApiKey(effectiveAccount?.apiKey)
  // 凭证变化后主动广播摘要，连接面板即时刷新（失败静默，面板有自己的拉取路径）。
  void connectionsService.refreshAndEmit().catch(() => undefined)

  if (!effectiveAccount) {
    return
  }

  const nextAgent = new AgentManager({
    apiKey: effectiveAccount.apiKey,
    opencodeBinPath,
    ooBinPath,
    rootDir: path.join(app.getPath("userData"), "agent"),
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
    sessionService.setAgent(null)
    throw error
  }
  appliedAccount = effectiveAccount
  chatService.startEventBridge()
  console.log("[lumo] agent sidecar ready at", nextAgent.url)
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

// 仅放行安全的用户意图协议外开；其余（file:、自定义协议等）一律忽略。
function openExternalUrl(url: string): void {
  if (/^(https?|mailto|tel):/i.test(url)) {
    void shell.openExternal(url)
  }
}

function createMainWindow(): void {
  installPermissionRequestHandler()
  const isMac = process.platform === "darwin"
  const backgroundColor = nativeTheme.shouldUseDarkColors ? darkWindowColor : lightWindowColor

  mainWindow = new BrowserWindow({
    width: 1080,
    height: 720,
    minWidth: 720,
    minHeight: 480,
    show: false,
    title: branding.appName,
    backgroundColor,
    titleBarStyle: isMac ? "hidden" : "default",
    ...(isMac ? { trafficLightPosition: macTrafficLightPosition } : {}),
    ...(isMac
      ? {}
      : {
          frame: false,
          titleBarOverlay: {
            color: backgroundColor,
            symbolColor: nativeTheme.shouldUseDarkColors ? "#e5e5e5" : "#404040",
            height: titleBarHeight,
          },
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
