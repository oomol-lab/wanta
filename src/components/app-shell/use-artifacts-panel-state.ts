import type { AppShellRoute as Route } from "./app-shell-types.ts"
import type { PanelSelection } from "./artifacts-panel-selection.ts"
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
import {
  artifactPanelSelection,
  EMPTY_PANEL_SELECTION,
  nextArtifactPanelSelection,
  nextTurnOutputPanelSelection,
  releaseManualPanelSelection,
  turnOutputPanelSelection,
} from "./artifacts-panel-selection.ts"

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
  latestArtifactSelection: ArtifactSelection | null
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
  const [panelSelection, setPanelSelection] = React.useState<PanelSelection>(EMPTY_PANEL_SELECTION)
  const [latestAutoPanelSelection, setLatestAutoPanelSelection] = React.useState<PanelSelection>(EMPTY_PANEL_SELECTION)
  const [latestArtifactSelection, setLatestArtifactSelection] = React.useState<ArtifactSelection | null>(null)
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
  const sidebarCollapsedRef = React.useRef(sidebarCollapsed)
  const artifactsPanelShellRef = React.useRef<HTMLDivElement | null>(null)
  const artifactsPanelContentRef = React.useRef<HTMLDivElement | null>(null)
  const artifactsPanelMaxWidthValue = artifactsPanelMaxWidthState ?? Number.POSITIVE_INFINITY
  const artifactSelection = panelSelection.kind === "artifact" ? panelSelection.selection : null
  const turnOutputSelection = panelSelection.kind === "turnOutput" ? panelSelection.selection : null
  const hasPanelSelection = panelSelection.kind !== "empty"
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
    const currentCollapsed = sidebarCollapsedRef.current
    if (currentCollapsed === previousCollapsed) {
      return
    }
    if (currentCollapsed) {
      setIsSidebarRestoring(true)
    }
    setSidebarCollapsed(previousCollapsed)
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
    setPanelSelection(EMPTY_PANEL_SELECTION)
    setLatestAutoPanelSelection(EMPTY_PANEL_SELECTION)
    setLatestArtifactSelection(null)
    setArtifactsPanelOpen(false)
    setArtifactsPanelMaximizedState(false)
  }, [activeSessionId, setArtifactsPanelMaximizedState])

  React.useEffect(() => {
    if (artifactsPanelOpen) {
      return
    }
    setPanelSelection((current) => {
      if (latestAutoPanelSelection.kind !== "empty") {
        return latestAutoPanelSelection
      }
      const released = releaseManualPanelSelection(current)
      return released === current ? current : released
    })
  }, [artifactsPanelOpen, latestAutoPanelSelection])

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
        panelSelection.kind !== "empty" &&
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
    artifactsPanelOpen,
    isArtifactsPanelResizing,
    panelSelection.kind,
    route,
    sidebarCollapsed,
    sidebarWidth,
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

  const handleArtifactsPanelResizeStart = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>): void => {
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
    },
    [
      applyArtifactsPanelShellWidth,
      artifactsPanelMaxWidthValue,
      artifactsPanelVisible,
      freezeArtifactsPanelContentWidth,
      visibleArtifactsPanelWidth,
    ],
  )

  const handleArtifactsPanelResizeKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>): void => {
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
    },
    [artifactsPanelVisible, clampArtifactsPanelWidthToLayout],
  )

  const handleArtifactsReset = React.useCallback(() => {
    setPanelSelection(EMPTY_PANEL_SELECTION)
    setLatestAutoPanelSelection(EMPTY_PANEL_SELECTION)
    setLatestArtifactSelection(null)
    setArtifactsPanelOpen(false)
    setArtifactsPanelMaximizedState(false)
  }, [setArtifactsPanelMaximizedState])

  const handleArtifactsOpen = React.useCallback((selection: ArtifactSelection) => {
    setPanelSelection(artifactPanelSelection(selection, "manual"))
    setArtifactsPanelOpen(true)
  }, [])

  const handleArtifactsAvailable = React.useCallback(
    (selection: ArtifactSelection) => {
      setLatestArtifactSelection(selection)
      setLatestAutoPanelSelection(artifactPanelSelection(selection, "auto"))
      setPanelSelection((current) => nextArtifactPanelSelection(current, selection, artifactsPanelOpen))
    },
    [artifactsPanelOpen],
  )

  const handleTurnOutputOpen = React.useCallback((selection: TurnOutputSelection) => {
    setPanelSelection(turnOutputPanelSelection(selection, "manual"))
    setArtifactsPanelOpen(true)
  }, [])

  const handleTurnOutputAvailable = React.useCallback(
    (selection: TurnOutputSelection) => {
      setLatestAutoPanelSelection((current) => nextTurnOutputPanelSelection(current, selection, false))
      setPanelSelection((current) => nextTurnOutputPanelSelection(current, selection, artifactsPanelOpen))
    },
    [artifactsPanelOpen],
  )

  const setArtifactsPanelOpenState = React.useCallback<React.Dispatch<React.SetStateAction<boolean>>>((value) => {
    setArtifactsPanelOpen((current) => {
      return typeof value === "function" ? value(current) : value
    })
  }, [])

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
    latestArtifactSelection,
    setArtifactsPanelOpen: setArtifactsPanelOpenState,
    setArtifactsPanelMaximizedState,
    turnOutputSelection,
    visibleArtifactsPanelWidth,
  }
}
