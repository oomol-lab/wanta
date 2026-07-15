import type { AppLocale } from "../app-locale.ts"
import type { AppSettings } from "../settings/common.ts"
import type { AttentionService, AttentionState, VisibleSessionRequest } from "./common.ts"
import type { AttentionStore, UnreadAttentionEntry } from "./store.ts"
import type { IConnectionService } from "@oomol/connection"
import type { BrowserWindow as ElectronBrowserWindow, NativeImage } from "electron"

import { ConnectionService } from "@oomol/connection"
import { app, nativeImage, Notification } from "electron"
import { AttentionService as AttentionServiceName } from "./common.ts"
import { isSessionActivelyViewed, shouldShowCompletionNotification } from "./policy.ts"

interface AttentionServiceDeps {
  getLocale: () => AppLocale
  getSettings: () => AppSettings
  getWindow: () => ElectronBrowserWindow | null
  revealWindow: () => void
  store: AttentionStore
}

interface CompleteSessionRequest {
  runId: string
  sessionId: string
}

const messages = {
  en: {
    completedBody: "Open Wanta to review the result.",
    completedTitle: "Task completed",
    testBody: "Task completion notifications are ready.",
    testTitle: "Test notification",
    unreadBadge: "Unread tasks",
  },
  "zh-CN": {
    completedBody: "打开 Wanta 查看结果。",
    completedTitle: "任务已完成",
    testBody: "任务完成通知已准备好。",
    testTitle: "测试通知",
    unreadBadge: "未读任务",
  },
} as const

let windowsUnreadOverlay: NativeImage | null = null

/** 统一管理未读任务、应用图标红标和原生完成通知。 */
export class AttentionServiceImpl
  extends ConnectionService<AttentionService>
  implements IConnectionService<AttentionService>
{
  private readonly deps: AttentionServiceDeps
  private readonly notifications = new Map<string, Notification>()
  private unreadSessions = new Map<string, UnreadAttentionEntry>()
  private loadPromise: Promise<void> | null = null
  private mutationQueue: Promise<void> = Promise.resolve()
  private rendererVisible = false
  private visibleSessionId: string | null = null

  public constructor(deps: AttentionServiceDeps) {
    super(AttentionServiceName)
    this.deps = deps
  }

  public async initialize(): Promise<void> {
    await this.ensureLoaded()
    this.updateBadge(this.deps.getSettings())
  }

  public async getAttentionState(): Promise<AttentionState> {
    await this.ensureLoaded()
    return this.currentState()
  }

  public setVisibleSession(req: VisibleSessionRequest): Promise<void> {
    this.visibleSessionId = req.sessionId?.trim() || null
    this.rendererVisible = req.visible
    if (!this.visibleSessionId || !this.rendererVisible || !this.deps.getWindow()?.isFocused()) {
      return Promise.resolve()
    }
    return this.markSessionViewed(this.visibleSessionId)
  }

  public markSessionViewed(sessionId: string): Promise<void> {
    const normalized = sessionId.trim()
    if (!normalized) return Promise.resolve()
    return this.enqueueMutation(async () => {
      await this.ensureLoaded()
      this.closeSessionNotification(normalized)
      if (!this.unreadSessions.delete(normalized)) return
      await this.persistAndPublish()
    })
  }

  public completeSession(req: CompleteSessionRequest): Promise<void> {
    return this.enqueueMutation(async () => {
      await this.ensureLoaded()
      const window = this.deps.getWindow()
      const windowFocused = window?.isFocused() === true
      const viewed = isSessionActivelyViewed({
        rendererVisible: this.rendererVisible,
        sessionId: req.sessionId,
        visibleSessionId: this.visibleSessionId,
        windowFocused,
      })
      if (viewed) {
        if (this.unreadSessions.delete(req.sessionId)) {
          await this.persistAndPublish()
        }
      } else {
        this.unreadSessions.set(req.sessionId, { createdAt: Date.now(), runId: req.runId })
        await this.persistAndPublish()
      }

      const settings = this.deps.getSettings()
      if (shouldShowCompletionNotification(settings.completionNotificationCondition, windowFocused)) {
        this.showNotification(req.sessionId, false)
      }
    })
  }

  public removeSession(sessionId: string): Promise<void> {
    return this.markSessionViewed(sessionId)
  }

  public clearAll(): Promise<void> {
    return this.enqueueMutation(async () => {
      await this.ensureLoaded()
      for (const [id, notification] of this.notifications) {
        if (id.startsWith("completion-")) notification.close()
      }
      if (this.unreadSessions.size === 0) return
      this.unreadSessions.clear()
      await this.persistAndPublish()
    })
  }

  public testCompletionNotification(): Promise<void> {
    this.showNotification(null, true)
    return Promise.resolve()
  }

  public settingsChanged(settings: AppSettings): void {
    if (this.loadPromise) {
      void this.loadPromise.then(() => this.updateBadge(settings))
    }
  }

  public override dispose(): void {
    for (const notification of this.notifications.values()) notification.close()
    this.notifications.clear()
    super.dispose()
  }

  private async ensureLoaded(): Promise<void> {
    this.loadPromise ??= this.deps.store.read().then((entries) => {
      this.unreadSessions = entries
    })
    await this.loadPromise
  }

  private enqueueMutation(task: () => Promise<void>): Promise<void> {
    const next = this.mutationQueue.then(task, task)
    this.mutationQueue = next.catch(() => undefined)
    return next
  }

  private currentState(): AttentionState {
    return { unreadSessionIds: [...this.unreadSessions.keys()] }
  }

  private async persistAndPublish(): Promise<void> {
    await this.deps.store.write(this.unreadSessions)
    const state = this.currentState()
    this.updateBadge(this.deps.getSettings())
    void this.send("attentionStateChanged", state).catch((error: unknown) => {
      console.warn("[wanta] attention state broadcast failed:", error)
    })
  }

  private updateBadge(settings: AppSettings): void {
    const count = settings.unreadBadgeEnabled ? this.unreadSessions.size : 0
    if (process.platform === "win32") {
      const window = this.deps.getWindow()
      if (!window || window.isDestroyed()) return
      const overlay = count > 0 ? windowsUnreadOverlayIcon() : null
      window.setOverlayIcon(
        overlay?.isEmpty() ? null : overlay,
        `${messages[this.deps.getLocale()].unreadBadge}: ${count}`,
      )
      return
    }
    app.badgeCount = count
  }

  private closeSessionNotification(sessionId: string): void {
    this.notifications.get(`completion-${sessionId}`)?.close()
  }

  private showNotification(sessionId: string | null, test: boolean): void {
    if (!Notification.isSupported()) return
    const locale = this.deps.getLocale()
    const copy = messages[locale]
    const id = test ? `test-${Date.now()}` : `completion-${sessionId}`
    this.notifications.get(id)?.close()
    const notification = new Notification({
      body: test ? copy.testBody : copy.completedBody,
      groupId: "task-completion",
      id,
      silent: !this.deps.getSettings().notificationSoundEnabled,
      title: test ? copy.testTitle : copy.completedTitle,
    })
    this.notifications.set(id, notification)
    const forget = (): void => {
      if (this.notifications.get(id) === notification) {
        this.notifications.delete(id)
      }
    }
    notification.once("close", forget)
    notification.once("failed", (_event, error) => {
      forget()
      console.warn("[wanta] task completion notification failed:", error)
    })
    if (sessionId) {
      notification.once("click", () => {
        this.deps.revealWindow()
        void this.markSessionViewed(sessionId).catch((error: unknown) => {
          console.warn("[wanta] failed to mark notification session as viewed:", error)
        })
        void this.send("openSessionRequested", { sessionId }).catch((error: unknown) => {
          console.warn("[wanta] failed to route task completion notification:", error)
        })
      })
    }
    notification.show()
  }
}

function windowsUnreadOverlayIcon(): NativeImage {
  windowsUnreadOverlay ??= nativeImage.createFromDataURL(
    `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="#ef4444" stroke="#ffffff" stroke-width="2"/></svg>',
    )}`,
  )
  return windowsUnreadOverlay
}
