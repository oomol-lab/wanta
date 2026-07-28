import type { WebContents } from "electron"
import type { Browser, ConnectOverCDPTransport, Page } from "playwright-core"

import { chromium } from "playwright-core"

interface CDPRequest {
  id: number
  method: string
  params?: Record<string, unknown>
  sessionId?: string
}

interface CDPMessage {
  error?: { code: number; message: string }
  id?: number
  method?: string
  params?: unknown
  result?: unknown
  sessionId?: string
}

interface CDPTargetInfo {
  attached: boolean
  browserContextId?: string
  canAccessOpener: boolean
  targetId: string
  title: string
  type: string
  url: string
}

interface TargetInfoResult {
  targetInfo: CDPTargetInfo
}

const pageSessionId = "wanta-browser-page"

export class PlaywrightWebContentsRelay {
  private browser: Browser | null = null
  private readonly contents: WebContents
  private targetInfo: CDPTargetInfo | null = null
  private transport: ConnectOverCDPTransport | null = null
  private autoAttached = false

  public constructor(contents: WebContents) {
    this.contents = contents
  }

  public async connect(): Promise<Page> {
    if (!this.contents.debugger.isAttached()) this.contents.debugger.attach("1.3")
    const target = (await this.contents.debugger.sendCommand("Target.getTargetInfo")) as TargetInfoResult
    this.targetInfo = target.targetInfo
    this.contents.debugger.on("message", this.handleDebuggerMessage)

    const transport: ConnectOverCDPTransport = {
      close: () => this.closeTransport(),
      send: (message) => this.send(message as CDPRequest),
    }
    this.transport = transport
    try {
      this.browser = await chromium.connectOverCDP(transport)
      const page = this.browser.contexts().flatMap((context) => context.pages())[0]
      if (!page) throw new Error("Playwright did not discover the browser page.")
      await page.emulateMedia({ colorScheme: null })
      return page
    } catch (error) {
      this.closeTransport()
      throw error
    }
  }

  public async dispose(): Promise<void> {
    const browser = this.browser
    this.browser = null
    if (browser) await browser.close().catch(() => undefined)
    this.closeTransport()
  }

  private readonly handleDebuggerMessage = (
    _event: Electron.Event,
    method: string,
    params: unknown,
    childSessionId?: string,
  ): void => {
    this.emit({ method, params, sessionId: childSessionId || pageSessionId })
  }

  private send(request: CDPRequest): void {
    const { id, method, params, sessionId } = request
    if (method === "Browser.getVersion") {
      this.emit({
        id,
        result: {
          jsVersion: process.versions.v8,
          product: `Electron/${process.versions.electron}`,
          protocolVersion: "1.3",
          revision: "",
          userAgent: this.contents.getUserAgent(),
        },
      })
      return
    }
    if (method === "Browser.setDownloadBehavior") {
      this.emit({ id, result: {} })
      return
    }
    if (method === "Target.setAutoAttach" && !sessionId) {
      this.announcePage()
      this.emit({ id, result: {} })
      return
    }
    if (method === "Target.getTargetInfo" && sessionId === pageSessionId) {
      this.emit({ id, result: { targetInfo: this.targetInfo }, sessionId })
      return
    }

    void this.contents.debugger
      .sendCommand(method, params, sessionId === pageSessionId ? undefined : sessionId)
      .then((result) => this.emit({ id, result, sessionId }))
      .catch((error: unknown) => {
        this.emit({
          error: { code: -32_000, message: error instanceof Error ? error.message : String(error) },
          id,
          sessionId,
        })
      })
  }

  private announcePage(): void {
    if (this.autoAttached || !this.targetInfo) return
    this.autoAttached = true
    this.emit({
      method: "Target.attachedToTarget",
      params: {
        sessionId: pageSessionId,
        targetInfo: { ...this.targetInfo, attached: true },
        waitingForDebugger: false,
      },
    })
  }

  private emit(message: CDPMessage): void {
    setImmediate(() => this.transport?.onmessage?.(message))
  }

  private closeTransport(): void {
    this.contents.debugger.off("message", this.handleDebuggerMessage)
    if (!this.contents.isDestroyed() && this.contents.debugger.isAttached()) {
      this.contents.debugger.detach()
    }
    const transport = this.transport
    this.transport = null
    transport?.onclose?.()
  }
}
