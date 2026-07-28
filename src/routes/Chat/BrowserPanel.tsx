import type { BrowserPageState, BrowserViewBounds } from "../../../electron/browser/common.ts"
import type { BrowserService } from "../../../electron/browser/common.ts"
import type { ConnectionClientService } from "@oomol/connection"

import { ArrowLeft, ArrowRight, ExternalLink, LoaderCircle, RotateCw, X } from "lucide-react"
import * as React from "react"
import { toast } from "sonner"
import { useT } from "@/i18n/i18n"
import { reportRendererHandledError } from "@/lib/renderer-diagnostics"
import { cn } from "@/lib/utils"

interface BrowserPanelProps {
  browserService: ConnectionClientService<BrowserService>
  sessionId: string
  state: BrowserPageState
  onClose: () => void
}

const toolbarButtonClass =
  "oo-toolbar-button flex size-8 shrink-0 items-center justify-center rounded-md hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground disabled:pointer-events-none disabled:opacity-40"

export function BrowserPanel({ browserService, sessionId, state, onClose }: BrowserPanelProps) {
  const t = useT()
  const browserSlotRef = React.useRef<HTMLDivElement | null>(null)
  const [address, setAddress] = React.useState(state.navigation.url === "about:blank" ? "" : state.navigation.url)

  React.useEffect(() => {
    setAddress(state.navigation.url === "about:blank" ? "" : state.navigation.url)
  }, [state.navigation.url])

  React.useLayoutEffect(() => {
    const slot = browserSlotRef.current
    if (!slot) return

    let frame: number | null = null
    const showBrowser = (): void => {
      frame = null
      const rect = slot.getBoundingClientRect()
      if (rect.width < 1 || rect.height < 1) return
      const bounds: BrowserViewBounds = {
        height: rect.height,
        width: rect.width,
        x: rect.x,
        y: rect.y,
      }
      void browserService.invoke("show", { bounds, sessionId }).catch((cause: unknown) => {
        reportRendererHandledError("browser", "show browser page failed", cause)
      })
    }
    const scheduleShow = (): void => {
      if (frame !== null) window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(showBrowser)
    }

    scheduleShow()
    const observer = new ResizeObserver(scheduleShow)
    observer.observe(slot)
    window.addEventListener("resize", scheduleShow)
    return () => {
      observer.disconnect()
      window.removeEventListener("resize", scheduleShow)
      if (frame !== null) window.cancelAnimationFrame(frame)
      void browserService.invoke("hide", sessionId).catch(() => undefined)
    }
  }, [browserService, sessionId])

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

  return (
    <section className="flex h-full min-h-0 flex-col border-l border-border bg-background">
      <div className="oo-toolbar flex h-[var(--app-titlebar-height)] shrink-0 items-center gap-1 border-b border-border px-2">
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
        <form className="min-w-0 flex-1" onSubmit={navigate}>
          <input
            value={address}
            aria-label={t("browser.address")}
            placeholder={t("browser.addressPlaceholder")}
            className="h-8 w-full min-w-0 rounded-md border border-border bg-background px-2.5 text-sm outline-none focus:border-ring"
            onChange={(event) => setAddress(event.currentTarget.value)}
          />
        </form>
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
      <div ref={browserSlotRef} className="min-h-0 min-w-0 flex-1 bg-background" />
    </section>
  )
}
