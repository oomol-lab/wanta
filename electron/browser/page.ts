import type { WindowsTitleBarTheme } from "../window/title-bar-overlay.ts"
import type { BrowserPageState, BrowserViewBounds } from "./common.ts"
import type {
  BrowserWindow as ElectronBrowserWindow,
  Event as ElectronEvent,
  Session,
  WebContentsView as ElectronWebContentsView,
} from "electron"
import type { Dialog, Locator, Page } from "playwright-core"

import { nativeTheme, WebContentsView } from "electron"
import { resolveWindowsTitleBarTheme, windowBackgroundColorForTheme } from "../window/title-bar-overlay.ts"
import { PlaywrightWebContentsRelay } from "./playwright-relay.ts"
import { isAllowedBrowserUrl, parseBrowserUrl } from "./policy.ts"

const snapshotLimit = 60_000
const browserThemeWorldId = 999

export interface BrowserReadResult {
  dialog: BrowserDialogState | null
  snapshot: string
  title: string
  url: string
}

export interface BrowserDialogState {
  defaultValue: string
  message: string
  type: string
}

export interface BrowserTypeInput {
  key?: string
  submit?: boolean
  target: string
  text?: string
}

export class BrowserPage {
  public readonly sessionId: string
  private crashed = false
  private currentDialog: Dialog | null = null
  private documentColorScheme: string | null = null
  private readonly mainWindow: ElectronBrowserWindow
  private navigationSequence = 0
  private page: Page | null = null
  private relay: PlaywrightWebContentsRelay | null = null
  private readonly stateChanged: (state: BrowserPageState) => void
  private readonly view: ElectronWebContentsView
  private visible = false

  public constructor(input: {
    mainWindow: ElectronBrowserWindow
    partitionSession: Session
    sessionId: string
    stateChanged: (state: BrowserPageState) => void
  }) {
    this.mainWindow = input.mainWindow
    this.sessionId = input.sessionId
    this.stateChanged = input.stateChanged
    this.view = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        session: input.partitionSession,
      },
    })
    this.applyTheme()
    nativeTheme.on("updated", this.applyTheme)
    this.installWebContentsListeners()
  }

  public async initialize(): Promise<void> {
    await this.view.webContents.loadURL("about:blank")
    const relay = new PlaywrightWebContentsRelay(this.view.webContents)
    this.relay = relay
    const page = await relay.connect()
    this.page = page
    page.on("dialog", (dialog) => {
      this.currentDialog = dialog
      this.emitState()
    })
    this.emitState()
  }

  public state(): BrowserPageState {
    const history = this.view.webContents.navigationHistory
    return {
      crashed: this.crashed,
      navigation: {
        canGoBack: history.canGoBack(),
        canGoForward: history.canGoForward(),
        loading: this.view.webContents.isLoading(),
        title: this.view.webContents.getTitle(),
        url: this.view.webContents.getURL(),
      },
      sessionId: this.sessionId,
      visible: this.visible,
    }
  }

  public isCrashed(): boolean {
    return this.crashed || this.view.webContents.isDestroyed()
  }

  public show(bounds: BrowserViewBounds): void {
    if (this.visible) {
      this.view.setBounds(bounds)
      return
    }
    this.mainWindow.contentView.addChildView(this.view)
    this.visible = true
    this.view.setBounds(bounds)
    this.view.webContents.focus()
    this.emitState()
  }

  public hide(): void {
    if (!this.visible) return
    this.mainWindow.contentView.removeChildView(this.view)
    this.visible = false
    this.emitState()
  }

  public async navigate(value: string, signal?: AbortSignal): Promise<BrowserPageState> {
    const url = parseBrowserUrl(value)
    await this.requirePage().goto(url.href, { signal, waitUntil: "domcontentloaded" })
    return this.state()
  }

  public async goBack(signal?: AbortSignal): Promise<BrowserPageState> {
    await this.requirePage().goBack({ signal, waitUntil: "domcontentloaded" })
    return this.state()
  }

  public async goForward(signal?: AbortSignal): Promise<BrowserPageState> {
    await this.requirePage().goForward({ signal, waitUntil: "domcontentloaded" })
    return this.state()
  }

  public async reload(signal?: AbortSignal): Promise<BrowserPageState> {
    await this.requirePage().reload({ signal, waitUntil: "domcontentloaded" })
    return this.state()
  }

  public async read(target?: string, signal?: AbortSignal): Promise<BrowserReadResult> {
    const dialog = this.dialogState()
    if (dialog) {
      return {
        dialog,
        snapshot: "[A JavaScript dialog is blocking page interaction. Handle the dialog before reading again.]",
        title: this.view.webContents.getTitle(),
        url: this.view.webContents.getURL(),
      }
    }
    const page = this.requirePage()
    const snapshot = target
      ? await this.locator(target).ariaSnapshot({ mode: "ai", signal })
      : await page.ariaSnapshot({ mode: "ai", signal })
    return {
      dialog: null,
      snapshot: boundedSnapshot(snapshot),
      title: await page.title(),
      url: page.url(),
    }
  }

  public async click(target: string, signal?: AbortSignal): Promise<BrowserReadResult> {
    await this.locator(target).click({ signal })
    return this.read(undefined, signal)
  }

  public async type(input: BrowserTypeInput, signal?: AbortSignal): Promise<BrowserReadResult> {
    const locator = this.locator(input.target)
    if (input.text !== undefined) await locator.fill(input.text, { signal })
    if (input.key) await locator.press(input.key, { signal })
    if (input.submit) await locator.press("Enter", { signal })
    if (input.text === undefined && !input.key && !input.submit) {
      throw new Error("Browser type requires text, key, or submit.")
    }
    return this.read(undefined, signal)
  }

  public async scroll(target: string | undefined, deltaY: number, signal?: AbortSignal): Promise<BrowserReadResult> {
    if (target) await this.locator(target).scrollIntoViewIfNeeded({ signal })
    await this.requirePage().mouse.wheel(0, deltaY)
    return this.read(undefined, signal)
  }

  public screenshot(fullPage: boolean, signal?: AbortSignal): Promise<Buffer> {
    return this.requirePage().screenshot({ fullPage, signal, type: "png" })
  }

  public async handleDialog(accept: boolean, promptText?: string): Promise<BrowserReadResult> {
    const dialog = this.currentDialog
    if (!dialog) throw new Error("There is no active browser dialog.")
    this.currentDialog = null
    if (accept) await dialog.accept(promptText)
    else await dialog.dismiss()
    this.emitState()
    return this.read()
  }

  public async dispose(): Promise<void> {
    nativeTheme.off("updated", this.applyTheme)
    this.hide()
    const relay = this.relay
    this.relay = null
    this.page = null
    await relay?.dispose()
    if (!this.view.webContents.isDestroyed()) this.view.webContents.close()
  }

  private requirePage(): Page {
    if (this.isCrashed() || !this.page) throw new Error("The browser page is unavailable.")
    return this.page
  }

  private locator(target: string): Locator {
    return this.requirePage().locator(browserLocatorSelector(target))
  }

  private dialogState(): BrowserDialogState | null {
    const dialog = this.currentDialog
    if (!dialog) return null
    return {
      defaultValue: dialog.defaultValue(),
      message: dialog.message(),
      type: dialog.type(),
    }
  }

  private installWebContentsListeners(): void {
    const contents = this.view.webContents
    const emit = (): void => this.emitState()
    contents.on("did-start-loading", () => {
      this.navigationSequence += 1
      this.documentColorScheme = null
      this.applyTheme()
      emit()
    })
    contents.on("did-finish-load", () => {
      void this.updateDocumentColorScheme()
    })
    contents.on("did-stop-loading", emit)
    contents.on("did-navigate", emit)
    contents.on("did-navigate-in-page", emit)
    contents.on("page-title-updated", emit)
    contents.on("render-process-gone", () => {
      this.crashed = true
      this.emitState()
    })
    contents.on("will-navigate", (event, url) => preventBlockedNavigation(event, url))
    contents.on("will-redirect", (event, url) => preventBlockedNavigation(event, url))
    contents.setWindowOpenHandler(({ url }) => {
      if (isAllowedBrowserUrl(url)) void this.navigate(url).catch(() => undefined)
      return { action: "deny" }
    })
  }

  private readonly applyTheme = (): void => {
    const appTheme = resolveWindowsTitleBarTheme(nativeTheme.shouldUseDarkColors)
    const theme = browserBackgroundTheme(this.documentColorScheme, appTheme)
    this.view.setBackgroundColor(windowBackgroundColorForTheme(theme))
  }

  private async updateDocumentColorScheme(): Promise<void> {
    const sequence = this.navigationSequence
    const colorScheme = await this.view.webContents
      .executeJavaScriptInIsolatedWorld(browserThemeWorldId, [
        { code: "getComputedStyle(document.documentElement).colorScheme" },
      ])
      .catch(() => null)
    if (
      sequence !== this.navigationSequence ||
      typeof colorScheme !== "string" ||
      this.view.webContents.isDestroyed()
    ) {
      return
    }
    this.documentColorScheme = colorScheme
    this.applyTheme()
  }

  private emitState(): void {
    if (!this.view.webContents.isDestroyed()) this.stateChanged(this.state())
  }
}

function preventBlockedNavigation(event: ElectronEvent, url: string): void {
  if (!isAllowedBrowserUrl(url)) event.preventDefault()
}

function boundedSnapshot(snapshot: string): string {
  if (snapshot.length <= snapshotLimit) return snapshot
  return `${snapshot.slice(0, snapshotLimit)}\n\n[Snapshot truncated. Read a specific ref or selector to continue.]`
}

export function browserLocatorSelector(target: string): string {
  const normalized = target.trim()
  if (!normalized) throw new Error("A browser target is required.")
  return /^(?:f\d+)?e\d+$/u.test(normalized) ? `aria-ref=${normalized}` : normalized
}

export function browserBackgroundTheme(
  documentColorScheme: string | null,
  appTheme: WindowsTitleBarTheme,
): WindowsTitleBarTheme {
  const schemes = new Set(documentColorScheme?.trim().toLowerCase().split(/\s+/) ?? [])
  return schemes.has("light") && !schemes.has("dark") ? "light" : appTheme
}
