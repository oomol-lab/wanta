import type { BrowserPageState, BrowserViewBounds } from "../../../electron/browser/common.ts"
import type { BrowserService } from "../../../electron/browser/common.ts"
import type { ConnectionClientService } from "@oomol/connection"

import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  LoaderCircle,
  Maximize2,
  Minimize2,
  RotateCw,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react"
import * as React from "react"
import { toast } from "sonner"
import { useT } from "@/i18n/i18n"
import { reportRendererHandledError } from "@/lib/renderer-diagnostics"
import { cn } from "@/lib/utils"

interface BrowserPanelProps {
  browserService: ConnectionClientService<BrowserService>
  maximized: boolean
  sessionId: string
  state: BrowserPageState
  onClose: () => void
  onToggleMaximized: () => void
}

const toolbarButtonClass =
  "oo-toolbar-button flex size-8 shrink-0 items-center justify-center rounded-md [-webkit-app-region:no-drag] hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground disabled:pointer-events-none disabled:opacity-40"

function browserViewIsOccluded(root: ParentNode = document): boolean {
  return Boolean(root.querySelector('[aria-modal="true"]'))
}

export function BrowserPanel({
  browserService,
  maximized,
  sessionId,
  state,
  onClose,
  onToggleMaximized,
}: BrowserPanelProps) {
  const t = useT()
  const browserSlotRef = React.useRef<HTMLDivElement | null>(null)
  const previewRequestRef = React.useRef(0)
  const [address, setAddress] = React.useState(state.navigation.url === "about:blank" ? "" : state.navigation.url)
  const [previewDataUrl, setPreviewDataUrl] = React.useState<string | null>(null)

  React.useEffect(() => {
    setAddress(state.navigation.url === "about:blank" ? "" : state.navigation.url)
  }, [state.navigation.url])

  const capturePreview = React.useCallback(async (): Promise<void> => {
    const request = ++previewRequestRef.current
    const preview = await browserService.invoke("capturePreview", sessionId)
    if (request === previewRequestRef.current) setPreviewDataUrl(preview)
  }, [browserService, sessionId])

  const refreshPreview = React.useCallback((): void => {
    void capturePreview().catch((cause: unknown) => {
      reportRendererHandledError("browser", "capture browser modal backdrop preview failed", cause)
    })
  }, [capturePreview])

  React.useEffect(() => {
    previewRequestRef.current += 1
    setPreviewDataUrl(null)
  }, [sessionId])

  React.useEffect(() => {
    if (!state.navigation.loading) refreshPreview()
  }, [refreshPreview, state.navigation.loading, state.navigation.url])

  React.useLayoutEffect(() => {
    const slot = browserSlotRef.current
    if (!slot) return

    let frame: number | null = null
    let visibilityRevision = 0
    let visibilityTransition = Promise.resolve()
    const enqueueVisibility = (visible: boolean, bounds?: BrowserViewBounds, captureBeforeHide = true): void => {
      const revision = ++visibilityRevision
      visibilityTransition = visibilityTransition
        .then(async () => {
          if (revision !== visibilityRevision) return
          if (visible && bounds) {
            await browserService.invoke("show", { bounds, sessionId })
            if (revision === visibilityRevision) refreshPreview()
            return
          }
          await browserService.invoke("hide", sessionId)
          if (revision !== visibilityRevision || !captureBeforeHide) return
          void capturePreview().catch((cause: unknown) => {
            reportRendererHandledError("browser", "capture hidden browser preview failed", cause)
          })
        })
        .catch((cause: unknown) => {
          reportRendererHandledError(
            "browser",
            visible ? "show browser page failed" : "hide browser page behind renderer surface failed",
            cause,
          )
        })
    }
    const showBrowser = (): void => {
      frame = null
      if (browserViewIsOccluded()) return
      const rect = slot.getBoundingClientRect()
      if (rect.width < 1 || rect.height < 1) return
      const bounds: BrowserViewBounds = {
        height: rect.height,
        width: rect.width,
        x: rect.x,
        y: rect.y,
      }
      enqueueVisibility(true, bounds)
    }
    const scheduleShow = (): void => {
      if (browserViewIsOccluded()) {
        if (frame !== null) {
          window.cancelAnimationFrame(frame)
          frame = null
        }
        enqueueVisibility(false)
        return
      }
      if (frame !== null) window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(showBrowser)
    }

    scheduleShow()
    const resizeObserver = new ResizeObserver(scheduleShow)
    resizeObserver.observe(slot)
    const overlayObserver = new MutationObserver(scheduleShow)
    overlayObserver.observe(document.body, {
      attributes: true,
      attributeFilter: ["aria-modal"],
      childList: true,
      subtree: true,
    })
    window.addEventListener("resize", scheduleShow)
    return () => {
      resizeObserver.disconnect()
      overlayObserver.disconnect()
      window.removeEventListener("resize", scheduleShow)
      if (frame !== null) window.cancelAnimationFrame(frame)
      enqueueVisibility(false, undefined, false)
    }
  }, [browserService, capturePreview, refreshPreview, sessionId])

  const runNavigationAction = React.useCallback(
    (action: "goBack" | "goForward" | "reload"): void => {
      void browserService.invoke(action, sessionId).catch((cause: unknown) => {
        reportRendererHandledError("browser", `browser ${action} failed`, cause)
        toast.error(t("browser.actionFailed"))
      })
    },
    [browserService, sessionId, t],
  )

  const navigate = React.useCallback(
    (event: React.FormEvent<HTMLFormElement>): void => {
      event.preventDefault()
      void browserService.invoke("navigate", { sessionId, url: address }).catch((cause: unknown) => {
        reportRendererHandledError("browser", "browser navigation failed", cause)
        toast.error(t("browser.invalidAddress"))
      })
    },
    [address, browserService, sessionId, t],
  )

  const openInSystemBrowser = React.useCallback((): void => {
    void browserService.invoke("openInSystemBrowser", sessionId).catch((cause: unknown) => {
      reportRendererHandledError("browser", "open browser page in system browser failed", cause)
      toast.error(t("browser.actionFailed"))
    })
  }, [browserService, sessionId, t])

  const setZoomFactor = React.useCallback(
    (factor: number): void => {
      void browserService.invoke("setZoomFactor", { factor, sessionId }).catch((cause: unknown) => {
        reportRendererHandledError("browser", "set browser zoom failed", cause)
        toast.error(t("browser.actionFailed"))
      })
    },
    [browserService, sessionId, t],
  )

  return (
    <section className="flex h-full min-h-0 flex-col border-l border-border bg-background">
      <div className="oo-titlebar oo-toolbar flex h-[var(--app-titlebar-height)] shrink-0 items-center gap-1 border-b border-border px-2 [-webkit-app-region:drag]">
        <button
          type="button"
          className={toolbarButtonClass}
          disabled={!state.navigation.canGoBack}
          title={t("browser.back")}
          aria-label={t("browser.back")}
          onClick={() => runNavigationAction("goBack")}
        >
          <ArrowLeft className="size-4" />
        </button>
        <button
          type="button"
          className={toolbarButtonClass}
          disabled={!state.navigation.canGoForward}
          title={t("browser.forward")}
          aria-label={t("browser.forward")}
          onClick={() => runNavigationAction("goForward")}
        >
          <ArrowRight className="size-4" />
        </button>
        <button
          type="button"
          className={toolbarButtonClass}
          title={t("browser.reload")}
          aria-label={t("browser.reload")}
          onClick={() => runNavigationAction("reload")}
        >
          <LoaderCircle className={cn("size-4 animate-spin", !state.navigation.loading && "hidden")} />
          <RotateCw className={cn("size-4", state.navigation.loading && "hidden")} />
        </button>
        <form className="min-w-0 flex-1 [-webkit-app-region:no-drag]" onSubmit={navigate}>
          <input
            value={address}
            aria-label={t("browser.address")}
            placeholder={t("browser.addressPlaceholder")}
            className="h-8 w-full min-w-0 rounded-md border border-border bg-background px-2.5 text-sm outline-none focus:border-ring"
            onChange={(event) => setAddress(event.currentTarget.value)}
          />
        </form>
        {maximized ? (
          <>
            <button
              type="button"
              className={toolbarButtonClass}
              disabled={state.zoomFactor <= 0.25}
              title={t("browser.zoomOut")}
              aria-label={t("browser.zoomOut")}
              onClick={() => setZoomFactor(state.zoomFactor - 0.1)}
            >
              <ZoomOut className="size-4" />
            </button>
            <button
              type="button"
              className="oo-toolbar-button h-8 min-w-11 shrink-0 rounded-md px-1 text-xs [-webkit-app-region:no-drag] hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground"
              title={t("browser.resetZoom")}
              aria-label={t("browser.resetZoom")}
              onClick={() => setZoomFactor(1)}
            >
              {Math.round(state.zoomFactor * 100)}%
            </button>
            <button
              type="button"
              className={toolbarButtonClass}
              disabled={state.zoomFactor >= 2}
              title={t("browser.zoomIn")}
              aria-label={t("browser.zoomIn")}
              onClick={() => setZoomFactor(state.zoomFactor + 0.1)}
            >
              <ZoomIn className="size-4" />
            </button>
          </>
        ) : null}
        <button
          type="button"
          className={toolbarButtonClass}
          title={maximized ? t("browser.restore") : t("browser.maximize")}
          aria-label={maximized ? t("browser.restore") : t("browser.maximize")}
          aria-pressed={maximized}
          onClick={onToggleMaximized}
        >
          {maximized ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
        </button>
        <button
          type="button"
          className={toolbarButtonClass}
          disabled={!state.navigation.url || state.navigation.url === "about:blank"}
          title={t("browser.openInSystem")}
          aria-label={t("browser.openInSystem")}
          onClick={openInSystemBrowser}
        >
          <ExternalLink className="size-4" />
        </button>
        <button
          type="button"
          className={toolbarButtonClass}
          title={t("browser.close")}
          aria-label={t("browser.close")}
          onClick={onClose}
        >
          <X className="size-4" />
        </button>
      </div>
      <div ref={browserSlotRef} className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-background">
        {previewDataUrl ? (
          <img
            src={previewDataUrl}
            alt=""
            aria-hidden="true"
            draggable={false}
            className="pointer-events-none absolute inset-0 size-full select-none"
          />
        ) : null}
      </div>
    </section>
  )
}
