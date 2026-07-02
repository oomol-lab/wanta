import type { AppShellRoute as Route } from "./app-shell-types.ts"
import type { ArtifactSelection } from "@/routes/Chat/GeneratedArtifacts"
import type { TurnOutputSelection } from "@/routes/Chat/TurnOutputs"

import * as React from "react"
import {
  artifactsPanelMaxWidth,
  ARTIFACTS_PANEL_MIN_WIDTH_PX,
  ARTIFACTS_PANEL_WIDTH_STORAGE_KEY,
  clampArtifactsPanelWidthForLayout,
  readStoredArtifactsPanelWidth,
} from "./app-shell-model.ts"

interface UseArtifactsPanelStateOptions {
  activeSessionId: string | null
  appChromeRef: React.RefObject<HTMLDivElement | null>
  route: Route
  setIsSidebarRestoring: React.Dispatch<React.SetStateAction<boolean>>
  setSidebarCollapsed: React.Dispatch<React.SetStateAction<boolean>>
  sidebarCollapsed: boolean
  sidebarWidth: number
}

interface UseArtifactsPanelStateResult {
  artifactSelection: ArtifactSelection | null
  artifactsPanelContentRef: React.RefObject<HTMLDivElement | null>
  artifactsPanelIsMaximized: boolean
  artifactsPanelMaxWidthState: number | null
  artifactsPanelOpen: boolean
  artifactsPanelShellRef: React.RefObject<HTMLDivElement | null>
  artifactsPanelVisible: boolean
  handleArtifactsAvailable: (selection: ArtifactSelection) => void
  handleArtifactsOpen: (selection: ArtifactSelection) => void
  handleArtifactsPanelResizeKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void
  handleArtifactsPanelResizeStart: (event: React.PointerEvent<HTMLDivElement>) => void
  handleArtifactsReset: () => void
  handleTurnOutputAvailable: (selection: TurnOutputSelection) => void
  handleTurnOutputOpen: (selection: TurnOutputSelection) => void
  hasPanelSelection: boolean
  isArtifactsPanelResizing: boolean
  setArtifactsPanelOpen: React.Dispatch<React.SetStateAction<boolean>>
  setArtifactsPanelMaximizedState: (maximized: boolean) => void
  turnOutputSelection: TurnOutputSelection | null
  visibleArtifactsPanelWidth: number
}

export function useArtifactsPanelState({
  activeSessionId,
  appChromeRef,
  route,
  setIsSidebarRestoring,
  setSidebarCollapsed,
  sidebarCollapsed,
  sidebarWidth,
}: UseArtifactsPanelStateOptions): UseArtifactsPanelStateResult {
  const [artifactSelection, setArtifactSelection] = React.useState<ArtifactSelection | null>(null)
  const [turnOutputSelection, setTurnOutputSelection] = React.useState<TurnOutputSelection | null>(null)
  const [artifactsPanelOpen, setArtifactsPanelOpen] = React.useState(false)
  const [artifactsPanelMaximized, setArtifactsPanelMaximized] = React.useState(false)
  const [artifactsPanelWidth, setArtifactsPanelWidth] = React.useState(readStoredArtifactsPanelWidth)
  const [artifactsPanelMaxWidthState, setArtifactsPanelMaxWidthState] = React.useState<number | null>(null)
  const [isArtifactsPanelResizing, setIsArtifactsPanelResizing] = React.useState(false)
  const artifactsPanelResizeStart = React.useRef<{ pointerX: number; width: number } | null>(null)
  const artifactsPanelResizeFrame = React.useRef<number | null>(null)
  const artifactsPanelPendingWidth = React.useRef<number | null>(null)
  const artifactsPanelLayoutWidth = React.useRef<number | null>(null)
  const artifactsPanelSidebarRestore = React.useRef<boolean | null>(null)
  const panelSelectionModeRef = React.useRef<"auto" | "manual">("auto")
  const sidebarCollapsedRef = React.useRef(sidebarCollapsed)
  const artifactsPanelShellRef = React.useRef<HTMLDivElement | null>(null)
  const artifactsPanelContentRef = React.useRef<HTMLDivElement | null>(null)
  const artifactsPanelMaxWidthValue = artifactsPanelMaxWidthState ?? Number.POSITIVE_INFINITY
  const hasPanelSelection = artifactSelection !== null || turnOutputSelection !== null
  const artifactsPanelVisible = route === "chat" && artifactsPanelOpen && hasPanelSelection
  const artifactsPanelIsMaximized = artifactsPanelVisible && artifactsPanelMaximized
  const visibleArtifactsPanelWidth = clampArtifactsPanelWidthForLayout(artifactsPanelWidth, artifactsPanelMaxWidthValue)

  React.useEffect(() => {
    sidebarCollapsedRef.current = sidebarCollapsed
  }, [sidebarCollapsed])

  const clampArtifactsPanelWidthToLayout = React.useCallback(
    (width: number): number => clampArtifactsPanelWidthForLayout(width, artifactsPanelMaxWidthValue),
    [artifactsPanelMaxWidthValue],
  )

  const applyArtifactsPanelShellWidth = React.useCallback((width: number): void => {
    const element = artifactsPanelShellRef.current
    if (element) {
      element.style.width = `${width}px`
    }
  }, [])

  const freezeArtifactsPanelContentWidth = React.useCallback((width: number): void => {
    const element = artifactsPanelContentRef.current
    if (element) {
      element.style.width = `${width}px`
    }
  }, [])

  const clearArtifactsPanelContentWidth = React.useCallback((): void => {
    const element = artifactsPanelContentRef.current
    if (element) {
      element.style.removeProperty("width")
    }
  }, [])

  const restoreSidebarAfterArtifactsMaximize = React.useCallback((): void => {
    const previousCollapsed = artifactsPanelSidebarRestore.current
    if (previousCollapsed === null) {
      return
    }
    artifactsPanelSidebarRestore.current = null
    setSidebarCollapsed((current) => {
      if (current === previousCollapsed) {
        return current
      }
      if (current) {
        setIsSidebarRestoring(true)
      }
      return previousCollapsed
    })
  }, [setIsSidebarRestoring, setSidebarCollapsed])

  const setArtifactsPanelMaximizedState = React.useCallback(
    (maximized: boolean): void => {
      if (maximized) {
        if (artifactsPanelSidebarRestore.current === null) {
          artifactsPanelSidebarRestore.current = sidebarCollapsedRef.current
        }
        setSidebarCollapsed(true)
        setArtifactsPanelMaximized(true)
        return
      }

      setArtifactsPanelMaximized(false)
      restoreSidebarAfterArtifactsMaximize()
    },
    [restoreSidebarAfterArtifactsMaximize, setSidebarCollapsed],
  )

  React.useEffect(() => {
    setArtifactSelection(null)
    setTurnOutputSelection(null)
    setArtifactsPanelOpen(false)
    setArtifactsPanelMaximizedState(false)
  }, [activeSessionId, setArtifactsPanelMaximizedState])

  React.useLayoutEffect(() => {
    const element = appChromeRef.current
    if (!element) {
      return
    }

    const updateArtifactsPanelBounds = (): void => {
      const appWidth = element.clientWidth
      const previousAppWidth = artifactsPanelLayoutWidth.current
      artifactsPanelLayoutWidth.current = appWidth
      const maxWidth = artifactsPanelMaxWidth(appWidth, sidebarWidth, sidebarCollapsed)
      const expandedBy = previousAppWidth === null ? 0 : Math.max(0, appWidth - previousAppWidth)
      const shouldGrowPanel =
        expandedBy > 0 &&
        route === "chat" &&
        artifactsPanelOpen &&
        (artifactSelection !== null || turnOutputSelection !== null) &&
        !isArtifactsPanelResizing

      setArtifactsPanelMaxWidthState(maxWidth)
      setArtifactsPanelWidth((width) =>
        clampArtifactsPanelWidthForLayout(width + (shouldGrowPanel ? expandedBy : 0), maxWidth),
      )
    }

    updateArtifactsPanelBounds()
    const observer = new ResizeObserver(updateArtifactsPanelBounds)
    observer.observe(element)
    return () => observer.disconnect()
  }, [
    appChromeRef,
    artifactSelection,
    artifactsPanelOpen,
    isArtifactsPanelResizing,
    route,
    sidebarCollapsed,
    sidebarWidth,
    turnOutputSelection,
  ])

  React.useEffect(() => {
    try {
      globalThis.localStorage?.setItem(ARTIFACTS_PANEL_WIDTH_STORAGE_KEY, String(artifactsPanelWidth))
    } catch {
      // 本地存储不可用时仅保留本次会话宽度。
    }
  }, [artifactsPanelWidth])

  React.useEffect(() => {
    if (!isArtifactsPanelResizing) {
      return
    }

    const flushArtifactsPanelWidth = (): void => {
      artifactsPanelResizeFrame.current = null
      const width = artifactsPanelPendingWidth.current
      if (width !== null) {
        applyArtifactsPanelShellWidth(width)
      }
    }
    const handlePointerMove = (event: PointerEvent): void => {
      const start = artifactsPanelResizeStart.current
      if (!start) {
        return
      }
      artifactsPanelPendingWidth.current = clampArtifactsPanelWidthToLayout(
        start.width + start.pointerX - event.clientX,
      )
      if (artifactsPanelResizeFrame.current === null) {
        artifactsPanelResizeFrame.current = window.requestAnimationFrame(flushArtifactsPanelWidth)
      }
    }
    const handlePointerUp = (): void => {
      if (artifactsPanelResizeFrame.current !== null) {
        window.cancelAnimationFrame(artifactsPanelResizeFrame.current)
        artifactsPanelResizeFrame.current = null
      }
      const width = artifactsPanelPendingWidth.current
      artifactsPanelPendingWidth.current = null
      if (width !== null) {
        applyArtifactsPanelShellWidth(width)
        setArtifactsPanelWidth(width)
      }
      clearArtifactsPanelContentWidth()
      artifactsPanelResizeStart.current = null
      setIsArtifactsPanelResizing(false)
    }

    window.addEventListener("pointermove", handlePointerMove)
    window.addEventListener("pointerup", handlePointerUp, { once: true })
    window.addEventListener("pointercancel", handlePointerUp, { once: true })
    return () => {
      if (artifactsPanelResizeFrame.current !== null) {
        window.cancelAnimationFrame(artifactsPanelResizeFrame.current)
        artifactsPanelResizeFrame.current = null
      }
      artifactsPanelPendingWidth.current = null
      clearArtifactsPanelContentWidth()
      window.removeEventListener("pointermove", handlePointerMove)
      window.removeEventListener("pointerup", handlePointerUp)
      window.removeEventListener("pointercancel", handlePointerUp)
    }
  }, [
    applyArtifactsPanelShellWidth,
    clampArtifactsPanelWidthToLayout,
    clearArtifactsPanelContentWidth,
    isArtifactsPanelResizing,
  ])

  React.useEffect(() => {
    if (!artifactsPanelVisible && artifactsPanelMaximized) {
      setArtifactsPanelMaximizedState(false)
    }
  }, [artifactsPanelMaximized, artifactsPanelVisible, setArtifactsPanelMaximizedState])

  const handleArtifactsPanelResizeStart = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!artifactsPanelVisible) {
      return
    }
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const dragStartWidth = visibleArtifactsPanelWidth
    const frozenContentWidth = Math.max(
      dragStartWidth,
      Number.isFinite(artifactsPanelMaxWidthValue) ? artifactsPanelMaxWidthValue : dragStartWidth,
    )
    applyArtifactsPanelShellWidth(dragStartWidth)
    freezeArtifactsPanelContentWidth(frozenContentWidth)
    artifactsPanelResizeStart.current = { pointerX: event.clientX, width: dragStartWidth }
    setIsArtifactsPanelResizing(true)
  }

  const handleArtifactsPanelResizeKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (!artifactsPanelVisible) {
      return
    }

    const step = event.shiftKey ? 24 : 12
    if (event.key === "ArrowLeft") {
      event.preventDefault()
      setArtifactsPanelWidth((width) => clampArtifactsPanelWidthToLayout(width + step))
    } else if (event.key === "ArrowRight") {
      event.preventDefault()
      setArtifactsPanelWidth((width) => clampArtifactsPanelWidthToLayout(width - step))
    } else if (event.key === "Home") {
      event.preventDefault()
      setArtifactsPanelWidth(ARTIFACTS_PANEL_MIN_WIDTH_PX)
    }
  }

  const handleArtifactsReset = React.useCallback(() => {
    panelSelectionModeRef.current = "auto"
    setArtifactSelection(null)
    setTurnOutputSelection(null)
    setArtifactsPanelOpen(false)
    setArtifactsPanelMaximizedState(false)
  }, [setArtifactsPanelMaximizedState])

  const handleArtifactsOpen = React.useCallback((selection: ArtifactSelection) => {
    panelSelectionModeRef.current = "manual"
    setArtifactSelection(selection)
    setTurnOutputSelection(null)
    setArtifactsPanelOpen(true)
  }, [])

  const handleArtifactsAvailable = React.useCallback((selection: ArtifactSelection) => {
    if (panelSelectionModeRef.current === "manual") {
      return
    }
    setTurnOutputSelection(null)
    setArtifactSelection((current) => {
      return current?.messageId === selection.messageId ? current : selection
    })
  }, [])

  const handleTurnOutputOpen = React.useCallback((selection: TurnOutputSelection) => {
    panelSelectionModeRef.current = "manual"
    setTurnOutputSelection(selection)
    setArtifactSelection(null)
    setArtifactsPanelOpen(true)
  }, [])

  const handleTurnOutputAvailable = React.useCallback(
    (selection: TurnOutputSelection) => {
      if (panelSelectionModeRef.current === "manual") {
        return
      }
      setTurnOutputSelection((current) => {
        if (artifactSelection) {
          return current
        }
        return current?.record.messageId === selection.record.messageId ? current : selection
      })
    },
    [artifactSelection],
  )

  return {
    artifactSelection,
    artifactsPanelContentRef,
    artifactsPanelIsMaximized,
    artifactsPanelMaxWidthState,
    artifactsPanelOpen,
    artifactsPanelShellRef,
    artifactsPanelVisible,
    handleArtifactsAvailable,
    handleArtifactsOpen,
    handleArtifactsPanelResizeKeyDown,
    handleArtifactsPanelResizeStart,
    handleArtifactsReset,
    handleTurnOutputAvailable,
    handleTurnOutputOpen,
    hasPanelSelection,
    isArtifactsPanelResizing,
    setArtifactsPanelOpen,
    setArtifactsPanelMaximizedState,
    turnOutputSelection,
    visibleArtifactsPanelWidth,
  }
}
