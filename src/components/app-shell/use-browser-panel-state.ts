import type { BrowserPageState } from "../../../electron/browser/common.ts"
import type { AppShellRoute as Route } from "./app-shell-types.ts"

import * as React from "react"
import { useBrowserService } from "@/components/AppContext"
import { reportRendererHandledError } from "@/lib/renderer-diagnostics"

interface UseBrowserPanelStateOptions {
  activeSessionId: string | null
  route: Route
}

interface UseBrowserPanelStateResult {
  browserPanelOpen: boolean
  browserPanelVisible: boolean
  browserState: BrowserPageState | null
  closeBrowserPanel: () => void
  toggleBrowserPanel: () => void
}

export function useBrowserPanelState({
  activeSessionId,
  route,
}: UseBrowserPanelStateOptions): UseBrowserPanelStateResult {
  const browserService = useBrowserService()
  const [browserPanelOpen, setBrowserPanelOpen] = React.useState(false)
  const [browserState, setBrowserState] = React.useState<BrowserPageState | null>(null)

  React.useEffect(() => {
    let cancelled = false
    let receivedStateEvent = false

    setBrowserState(null)
    setBrowserPanelOpen(false)

    if (!activeSessionId) return

    const offState = browserService.serverEvents.on("stateChanged", (state) => {
      if (state.sessionId !== activeSessionId) return
      receivedStateEvent = true
      setBrowserState(state)
    })
    const offRequested = browserService.serverEvents.on("browserRequested", ({ sessionId }) => {
      if (sessionId !== activeSessionId) return
      receivedStateEvent = true
      setBrowserPanelOpen(true)
    })
    const offRemoved = browserService.serverEvents.on("pageRemoved", ({ sessionId }) => {
      if (sessionId !== activeSessionId) return
      receivedStateEvent = true
      setBrowserState(null)
      setBrowserPanelOpen(false)
    })

    void browserService
      .invoke("getState", activeSessionId)
      .then((state) => {
        if (cancelled || receivedStateEvent) return
        setBrowserState(state)
        setBrowserPanelOpen(Boolean(state))
      })
      .catch((cause: unknown) => {
        reportRendererHandledError("browser", "read browser page state failed", cause)
      })

    return () => {
      cancelled = true
      offState()
      offRequested()
      offRemoved()
    }
  }, [activeSessionId, browserService])

  const closeBrowserPanel = React.useCallback(() => {
    setBrowserPanelOpen(false)
    if (activeSessionId) {
      void browserService.invoke("hide", activeSessionId).catch((cause: unknown) => {
        reportRendererHandledError("browser", "hide browser page failed", cause)
      })
    }
  }, [activeSessionId, browserService])

  const toggleBrowserPanel = React.useCallback(() => {
    if (!browserState) return
    setBrowserPanelOpen((open) => !open)
  }, [browserState])

  return {
    browserPanelOpen,
    browserPanelVisible: route === "chat" && browserPanelOpen && browserState !== null,
    browserState,
    closeBrowserPanel,
    toggleBrowserPanel,
  }
}
