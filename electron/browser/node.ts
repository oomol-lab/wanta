import type {
  BrowserDownloadResult,
  BrowserNavigateRequest,
  BrowserPageState,
  BrowserService,
  BrowserShowRequest,
} from "./common.ts"
import type { BrowserReadResult, BrowserTypeInput } from "./page.ts"
import type { IConnectionService } from "@oomol/connection"
import type { BrowserWindow, Session } from "electron"

import { ConnectionService } from "@oomol/connection"
import { session, shell } from "electron"
import { createHash } from "node:crypto"
import { mkdir, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { BrowserService as BrowserServiceName } from "./common.ts"
import { BrowserPage } from "./page.ts"
import { normalizeBrowserBounds } from "./policy.ts"

const maxLivePages = 3

export type BrowserControlRequest =
  | { action: "navigate"; sessionId: string; url: string }
  | { action: "read"; sessionId: string; target?: string }
  | { action: "click"; sessionId: string; target: string }
  | ({ action: "type"; sessionId: string } & BrowserTypeInput)
  | { action: "scroll"; deltaY: number; sessionId: string; target?: string }
  | { action: "screenshot"; fullPage: boolean; sessionId: string }
  | { accept: boolean; action: "dialog"; promptText?: string; sessionId: string }

export interface BrowserScreenshotResult {
  fileUrl: string
  title: string
  url: string
}

export type BrowserControlResult = BrowserPageState | BrowserReadResult | BrowserScreenshotResult

interface PageEntry {
  lastUsedAt: number
  page: BrowserPage
}

export interface BrowserServiceOptions {
  downloadsDir: string
  enabled: boolean
  screenshotDir: string
}

interface BrowserManagerEvents {
  browserRequested: (sessionId: string) => void
  downloadFinished: (result: BrowserDownloadResult) => void
  pageRemoved: (sessionId: string) => void
  stateChanged: (state: BrowserPageState) => void
}

export class BrowserManager {
  private readonly configuredSessions = new WeakSet<Session>()
  private readonly downloadsDir: string
  private enabled: boolean
  private events: BrowserManagerEvents | null = null
  private mainWindow: BrowserWindow | null = null
  private pageCreation: Promise<void> = Promise.resolve()
  private readonly pages = new Map<string, PageEntry>()
  private partitionSession: Session | null = null
  private profileReset: Promise<void> = Promise.resolve()
  private profileScope = "local"
  private profileVersion = 0
  private readonly screenshotDir: string
  private visibleSessionId: string | null = null

  public constructor(options: BrowserServiceOptions) {
    this.downloadsDir = options.downloadsDir
    this.enabled = options.enabled
    this.screenshotDir = options.screenshotDir
  }

  public setEvents(events: BrowserManagerEvents): void {
    this.events = events
  }

  public setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window
  }

  public async setEnabled(enabled: boolean): Promise<void> {
    if (enabled === this.enabled) return
    this.enabled = enabled
    if (enabled) return

    this.profileVersion += 1
    const reset = this.disposePages()
    this.profileReset = reset
    await reset
  }

  public async setProfileScope(scope: string | undefined): Promise<void> {
    const next = scope?.trim() || "local"
    if (next === this.profileScope) return
    this.profileScope = next
    this.profileVersion += 1
    this.partitionSession = null
    const reset = this.disposePages()
    this.profileReset = reset
    await reset
  }

  public getState(sessionId: string): Promise<BrowserPageState | null> {
    if (!this.enabled) return Promise.resolve(null)
    return Promise.resolve(this.pages.get(sessionId)?.page.state() ?? null)
  }

  public async clearData(): Promise<void> {
    const partitionSession = this.getPartitionSession()
    this.profileVersion += 1
    const reset = (async () => {
      await this.disposePages()
      await Promise.all([partitionSession.clearCache(), partitionSession.clearStorageData()])
    })()
    this.profileReset = reset
    try {
      await reset
    } finally {
      if (this.profileReset === reset) {
        this.profileReset = Promise.resolve()
      }
    }
  }

  public async show(request: BrowserShowRequest): Promise<BrowserPageState> {
    const page = await this.ensurePage(request.sessionId)
    if (this.visibleSessionId && this.visibleSessionId !== request.sessionId) {
      this.pages.get(this.visibleSessionId)?.page.hide()
    }
    const window = this.requireWindow()
    const content = window.getContentBounds()
    const bounds = normalizeBrowserBounds(request.bounds, {
      height: content.height,
      width: content.width,
      x: 0,
      y: 0,
    })
    page.show(bounds)
    this.visibleSessionId = request.sessionId
    this.touch(request.sessionId)
    return page.state()
  }

  public hide(sessionId: string): Promise<void> {
    const page = this.pages.get(sessionId)?.page
    page?.hide()
    if (this.visibleSessionId === sessionId) this.visibleSessionId = null
    return Promise.resolve()
  }

  public async navigate(request: BrowserNavigateRequest): Promise<BrowserPageState> {
    const page = await this.ensurePage(request.sessionId)
    this.touch(request.sessionId)
    const state = await page.navigate(request.url)
    this.emitState(state)
    return state
  }

  public async goBack(sessionId: string): Promise<BrowserPageState> {
    const page = await this.ensurePage(sessionId)
    const state = await page.goBack()
    this.emitState(state)
    return state
  }

  public async goForward(sessionId: string): Promise<BrowserPageState> {
    const page = await this.ensurePage(sessionId)
    const state = await page.goForward()
    this.emitState(state)
    return state
  }

  public async reload(sessionId: string): Promise<BrowserPageState> {
    const page = await this.ensurePage(sessionId)
    const state = await page.reload()
    this.emitState(state)
    return state
  }

  public async openInSystemBrowser(sessionId: string): Promise<void> {
    const state = this.pages.get(sessionId)?.page.state()
    if (!state?.navigation.url || state.navigation.url === "about:blank") return
    await shell.openExternal(state.navigation.url)
  }

  public async openDownloadsFolder(): Promise<void> {
    const error = await shell.openPath(this.downloadsDir)
    if (error) throw new Error(error)
  }

  public async execute(request: BrowserControlRequest, signal?: AbortSignal): Promise<BrowserControlResult> {
    const page = await this.ensurePage(request.sessionId)
    this.events?.browserRequested(request.sessionId)
    this.touch(request.sessionId)
    switch (request.action) {
      case "navigate":
        return page.navigate(request.url, signal)
      case "read":
        return page.read(request.target, signal)
      case "click":
        return page.click(request.target, signal)
      case "type":
        return page.type(request, signal)
      case "scroll":
        return page.scroll(request.target, request.deltaY, signal)
      case "screenshot":
        return this.captureScreenshot(page, request.fullPage, signal)
      case "dialog":
        return page.handleDialog(request.accept, request.promptText)
    }
  }

  public async removeSession(sessionId: string): Promise<void> {
    await this.disposePage(sessionId)
    await rm(this.sessionScreenshotDir(sessionId), { force: true, recursive: true })
  }

  private async disposePage(sessionId: string): Promise<void> {
    const entry = this.pages.get(sessionId)
    if (entry) {
      this.pages.delete(sessionId)
      if (this.visibleSessionId === sessionId) this.visibleSessionId = null
      await entry.page.dispose()
      this.events?.pageRemoved(sessionId)
    }
  }

  public async dispose(): Promise<void> {
    await this.disposePages()
    this.mainWindow = null
    this.partitionSession = null
  }

  private async ensurePage(sessionId: string): Promise<BrowserPage> {
    this.assertEnabled()
    const requestedProfileVersion = this.profileVersion
    await this.profileReset
    this.assertEnabled()
    if (requestedProfileVersion !== this.profileVersion) {
      throw new Error("The browser profile changed before the action could start.")
    }
    const normalizedSessionId = sessionId.trim()
    if (!normalizedSessionId) throw new Error("Browser session ID is required.")
    const existing = this.pages.get(normalizedSessionId)
    if (existing && !existing.page.isCrashed()) {
      this.touch(normalizedSessionId)
      return existing.page
    }

    const previousCreation = this.pageCreation
    let releaseCreation = (): void => undefined
    this.pageCreation = new Promise<void>((resolve) => {
      releaseCreation = resolve
    })
    await previousCreation
    try {
      await this.profileReset
      this.assertEnabled()
      if (requestedProfileVersion !== this.profileVersion) {
        throw new Error("The browser profile changed before the action could start.")
      }
      const current = this.pages.get(normalizedSessionId)
      if (current && !current.page.isCrashed()) {
        this.touch(normalizedSessionId)
        return current.page
      }
      if (current) await this.disposePage(normalizedSessionId)
      await this.evictPageIfNeeded()
      this.assertEnabled()
      if (requestedProfileVersion !== this.profileVersion) {
        throw new Error("The browser profile changed before the action could start.")
      }
      const page = new BrowserPage({
        mainWindow: this.requireWindow(),
        partitionSession: this.getPartitionSession(),
        sessionId: normalizedSessionId,
        stateChanged: (state) => this.emitState(state),
      })
      this.pages.set(normalizedSessionId, { lastUsedAt: Date.now(), page })
      try {
        await page.initialize()
        if (requestedProfileVersion !== this.profileVersion) {
          throw new Error("The browser profile changed before the action could start.")
        }
        return page
      } catch (error) {
        this.pages.delete(normalizedSessionId)
        await page.dispose().catch(() => undefined)
        throw error
      }
    } finally {
      releaseCreation()
    }
  }

  private getPartitionSession(): Session {
    if (this.partitionSession) return this.partitionSession
    const scope = createHash("sha256").update(this.profileScope).digest("hex").slice(0, 24)
    const partitionSession = session.fromPartition(`persist:wanta-browser-${scope}`, { cache: true })
    if (!this.configuredSessions.has(partitionSession)) {
      partitionSession.setPermissionCheckHandler(() => false)
      partitionSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
      partitionSession.setDownloadPath(this.downloadsDir)
      partitionSession.on("will-download", (_event, item) => {
        const filename = item.getFilename()
        item.once("done", (_doneEvent, state) => {
          if (state === "completed" || state === "interrupted") {
            this.events?.downloadFinished({ filename, state })
          }
        })
      })
      this.configuredSessions.add(partitionSession)
    }
    this.partitionSession = partitionSession
    return partitionSession
  }

  private async evictPageIfNeeded(): Promise<void> {
    if (this.pages.size < maxLivePages) return
    const candidate = [...this.pages.entries()]
      .filter(([sessionId]) => sessionId !== this.visibleSessionId)
      .sort((left, right) => left[1].lastUsedAt - right[1].lastUsedAt)[0]
    if (!candidate) throw new Error("Close the visible browser page before opening another task.")
    await this.disposePage(candidate[0])
  }

  private async captureScreenshot(
    page: BrowserPage,
    fullPage: boolean,
    signal?: AbortSignal,
  ): Promise<BrowserScreenshotResult> {
    const image = await page.screenshot(fullPage, signal)
    const state = page.state()
    const sessionDir = this.sessionScreenshotDir(page.sessionId)
    await mkdir(sessionDir, { recursive: true })
    const filePath = path.join(sessionDir, "latest.png")
    await writeFile(filePath, image)
    return {
      fileUrl: pathToFileURL(filePath).href,
      title: state.navigation.title,
      url: state.navigation.url,
    }
  }

  private touch(sessionId: string): void {
    const entry = this.pages.get(sessionId)
    if (entry) entry.lastUsedAt = Date.now()
  }

  private sessionScreenshotDir(sessionId: string): string {
    return path.join(this.screenshotDir, createHash("sha256").update(sessionId).digest("hex").slice(0, 24))
  }

  private emitState(state: BrowserPageState): void {
    this.events?.stateChanged(state)
  }

  private requireWindow(): BrowserWindow {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      throw new Error("The browser window is unavailable.")
    }
    return this.mainWindow
  }

  private assertEnabled(): void {
    if (!this.enabled) {
      throw new Error("The integrated browser is disabled in Settings.")
    }
  }

  private async disposePages(): Promise<void> {
    const entries = [...this.pages.entries()]
    this.pages.clear()
    this.visibleSessionId = null
    await Promise.all(entries.map(([, entry]) => entry.page.dispose().catch(() => undefined)))
    for (const [sessionId] of entries) {
      this.events?.pageRemoved(sessionId)
    }
  }
}

export class BrowserServiceImpl
  extends ConnectionService<BrowserService>
  implements IConnectionService<BrowserService>
{
  private readonly browser: BrowserManager

  public constructor(browser: BrowserManager) {
    super(BrowserServiceName)
    this.browser = browser
    browser.setEvents({
      browserRequested: (sessionId) => {
        void this.send("browserRequested", { sessionId }).catch(() => undefined)
      },
      downloadFinished: (result) => {
        void this.send("downloadFinished", result).catch(() => undefined)
      },
      pageRemoved: (sessionId) => {
        void this.send("pageRemoved", { sessionId }).catch(() => undefined)
      },
      stateChanged: (state) => {
        void this.send("stateChanged", state).catch(() => undefined)
      },
    })
  }

  public clearData(): Promise<void> {
    return this.browser.clearData()
  }

  public getState(sessionId: string): Promise<BrowserPageState | null> {
    return this.browser.getState(sessionId)
  }

  public show(request: BrowserShowRequest): Promise<BrowserPageState> {
    return this.browser.show(request)
  }

  public hide(sessionId: string): Promise<void> {
    return this.browser.hide(sessionId)
  }

  public navigate(request: BrowserNavigateRequest): Promise<BrowserPageState> {
    return this.browser.navigate(request)
  }

  public goBack(sessionId: string): Promise<BrowserPageState> {
    return this.browser.goBack(sessionId)
  }

  public goForward(sessionId: string): Promise<BrowserPageState> {
    return this.browser.goForward(sessionId)
  }

  public reload(sessionId: string): Promise<BrowserPageState> {
    return this.browser.reload(sessionId)
  }

  public openDownloadsFolder(): Promise<void> {
    return this.browser.openDownloadsFolder()
  }

  public openInSystemBrowser(sessionId: string): Promise<void> {
    return this.browser.openInSystemBrowser(sessionId)
  }
}
