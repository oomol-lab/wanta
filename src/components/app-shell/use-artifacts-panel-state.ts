import type { AppShellRoute as Route } from "./app-shell-types.ts"
import type { PanelSelection } from "./artifacts-panel-selection.ts"
import type { ArtifactSelection } from "@/routes/Chat/GeneratedArtifacts"
import type { TurnOutputSelection } from "@/routes/Chat/TurnOutputs"

import * as React from "react"
import {
  artifactsPanelDragLayout,
  artifactsPanelMaxWidth,
  ARTIFACTS_PANEL_MIN_WIDTH_PX,
  ARTIFACTS_PANEL_WIDTH_STORAGE_KEY,
  BROWSER_PANEL_WIDTH_STORAGE_KEY,
  clampArtifactsPanelWidthForLayout,
  readStoredArtifactsPanelWidth,
  readStoredBrowserPanelWidth,
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
  browserPanelVisible: boolean
  closeBrowserPanel: () => void
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
  isArtifactsPanelDragCollapsed: boolean
  latestArtifactSelection: ArtifactSelection | null
  rightPanelVisible: boolean
  setArtifactsPanelOpen: React.Dispatch<React.SetStateAction<boolean>>
  setArtifactsPanelMaximizedState: (maximized: boolean) => void
  turnOutputSelection: TurnOutputSelection | null
  visibleRightPanelWidth: number
}

export function useArtifactsPanelState({
  activeSessionId,
  appChromeRef,
  browserPanelVisible,
  closeBrowserPanel,
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
  const [browserPanelWidth, setBrowserPanelWidth] = React.useState(readStoredBrowserPanelWidth)
  const [artifactsPanelMaxWidthState, setArtifactsPanelMaxWidthState] = React.useState<number | null>(null)
  const [isArtifactsPanelResizing, setIsArtifactsPanelResizing] = React.useState(false)
  const [isArtifactsPanelDragCollapsed, setIsArtifactsPanelDragCollapsed] = React.useState(false)
  const [artifactsPanelDragWidth, setArtifactsPanelDragWidth] = React.useState<number | null>(null)
  const artifactsPanelResizeStart = React.useRef<{
    browser: boolean
    pointerX: number
    width: number
  } | null>(null)
  const artifactsPanelResizeFrame = React.useRef<number | null>(null)
  const artifactsPanelPendingWidth = React.useRef<number | null>(null)
  const artifactsPanelPendingRawWidth = React.useRef<number | null>(null)
  const artifactsPanelDragCollapsedRef = React.useRef(false)
  const artifactsPanelSidebarRestore = React.useRef<boolean | null>(null)
  const sidebarCollapsedRef = React.useRef(sidebarCollapsed)
  const artifactsPanelShellRef = React.useRef<HTMLDivElement | null>(null)
  const artifactsPanelContentRef = React.useRef<HTMLDivElement | null>(null)
  const artifactsPanelMaxWidthValue = artifactsPanelMaxWidthState ?? Number.POSITIVE_INFINITY
  const artifactSelection = panelSelection.kind === "artifact" ? panelSelection.selection : null
  const turnOutputSelection = panelSelection.kind === "turnOutput" ? panelSelection.selection : null
  const hasPanelSelection = panelSelection.kind !== "empty"
  const artifactsPanelVisible = route === "chat" && artifactsPanelOpen && hasPanelSelection && !browserPanelVisible
  const rightPanelVisible = (browserPanelVisible || artifactsPanelVisible) && !isArtifactsPanelDragCollapsed
  const artifactsPanelIsMaximized = rightPanelVisible && artifactsPanelMaximized
  const preferredRightPanelWidth = browserPanelVisible ? browserPanelWidth : artifactsPanelWidth
  const visibleRightPanelWidth =
    artifactsPanelDragWidth ?? clampArtifactsPanelWidthForLayout(preferredRightPanelWidth, artifactsPanelMaxWidthValue)

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

  const setArtifactsPanelDragCollapsedState = React.useCallback((collapsed: boolean): void => {
    artifactsPanelDragCollapsedRef.current = collapsed
    setIsArtifactsPanelDragCollapsed(collapsed)
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
      const maxWidth = artifactsPanelMaxWidth(appWidth, sidebarWidth, sidebarCollapsed)

      setArtifactsPanelMaxWidthState(maxWidth)
    }

    updateArtifactsPanelBounds()
    const observer = new ResizeObserver(updateArtifactsPanelBounds)
    observer.observe(element)
    return () => observer.disconnect()
  }, [appChromeRef, sidebarCollapsed, sidebarWidth])

  React.useEffect(() => {
    try {
      globalThis.localStorage?.setItem(ARTIFACTS_PANEL_WIDTH_STORAGE_KEY, String(artifactsPanelWidth))
    } catch {
      // 本地存储不可用时仅保留本次会话宽度。
    }
  }, [artifactsPanelWidth])

  React.useEffect(() => {
    try {
      globalThis.localStorage?.setItem(BROWSER_PANEL_WIDTH_STORAGE_KEY, String(browserPanelWidth))
    } catch {
      // Keep the width in memory when local storage is unavailable.
    }
  }, [browserPanelWidth])

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
      const rawWidth = start.width + start.pointerX - event.clientX
      const layout = artifactsPanelDragLayout(rawWidth, artifactsPanelMaxWidthValue)
      artifactsPanelPendingRawWidth.current = rawWidth
      artifactsPanelPendingWidth.current = layout.width

      if (layout.collapsed !== artifactsPanelDragCollapsedRef.current) {
        if (artifactsPanelResizeFrame.current !== null) {
          window.cancelAnimationFrame(artifactsPanelResizeFrame.current)
          artifactsPanelResizeFrame.current = null
        }
        setArtifactsPanelDragCollapsedState(layout.collapsed)
        if (layout.collapsed) {
          return
        }
        setArtifactsPanelDragWidth(layout.width)
        applyArtifactsPanelShellWidth(layout.width)
      }
      if (artifactsPanelResizeFrame.current === null) {
        artifactsPanelResizeFrame.current = window.requestAnimationFrame(flushArtifactsPanelWidth)
      }
    }
    const handlePointerUp = (): void => {
      if (artifactsPanelResizeFrame.current !== null) {
        window.cancelAnimationFrame(artifactsPanelResizeFrame.current)
        artifactsPanelResizeFrame.current = null
      }
      const rawWidth = artifactsPanelPendingRawWidth.current
      const width = artifactsPanelPendingWidth.current
      const collapsed = rawWidth !== null && artifactsPanelDragLayout(rawWidth, artifactsPanelMaxWidthValue).collapsed
      artifactsPanelPendingRawWidth.current = null
      artifactsPanelPendingWidth.current = null
      if (collapsed) {
        if (artifactsPanelResizeStart.current?.browser) {
          closeBrowserPanel()
        } else {
          setArtifactsPanelOpen(false)
        }
        setArtifactsPanelMaximized(false)
      } else if (width !== null) {
        applyArtifactsPanelShellWidth(width)
        if (artifactsPanelResizeStart.current?.browser) {
          setBrowserPanelWidth(width)
        } else {
          setArtifactsPanelWidth(width)
        }
      }
      clearArtifactsPanelContentWidth()
      artifactsPanelResizeStart.current = null
      setIsArtifactsPanelResizing(false)
      setArtifactsPanelDragCollapsedState(false)
      setArtifactsPanelDragWidth(null)
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
      artifactsPanelPendingRawWidth.current = null
      clearArtifactsPanelContentWidth()
      setArtifactsPanelDragCollapsedState(false)
      setArtifactsPanelDragWidth(null)
      window.removeEventListener("pointermove", handlePointerMove)
      window.removeEventListener("pointerup", handlePointerUp)
      window.removeEventListener("pointercancel", handlePointerUp)
    }
  }, [
    applyArtifactsPanelShellWidth,
    artifactsPanelMaxWidthValue,
    clearArtifactsPanelContentWidth,
    closeBrowserPanel,
    isArtifactsPanelResizing,
    setArtifactsPanelDragCollapsedState,
  ])

  React.useEffect(() => {
    if (!rightPanelVisible && artifactsPanelMaximized) {
      setArtifactsPanelMaximizedState(false)
    }
  }, [artifactsPanelMaximized, rightPanelVisible, setArtifactsPanelMaximizedState])

  const handleArtifactsPanelResizeStart = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>): void => {
      if (!rightPanelVisible) {
        return
      }
      event.preventDefault()
      event.currentTarget.setPointerCapture(event.pointerId)
      const dragStartWidth = visibleRightPanelWidth
      const frozenContentWidth = Math.max(
        dragStartWidth,
        Number.isFinite(artifactsPanelMaxWidthValue) ? artifactsPanelMaxWidthValue : dragStartWidth,
      )
      applyArtifactsPanelShellWidth(dragStartWidth)
      if (!browserPanelVisible) {
        freezeArtifactsPanelContentWidth(frozenContentWidth)
      }
      artifactsPanelResizeStart.current = {
        browser: browserPanelVisible,
        pointerX: event.clientX,
        width: dragStartWidth,
      }
      artifactsPanelPendingRawWidth.current = dragStartWidth
      artifactsPanelPendingWidth.current = dragStartWidth
      setArtifactsPanelDragCollapsedState(false)
      setArtifactsPanelDragWidth(null)
      setIsArtifactsPanelResizing(true)
    },
    [
      applyArtifactsPanelShellWidth,
      artifactsPanelMaxWidthValue,
      browserPanelVisible,
      freezeArtifactsPanelContentWidth,
      rightPanelVisible,
      setArtifactsPanelDragCollapsedState,
      visibleRightPanelWidth,
    ],
  )

  const handleArtifactsPanelResizeKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>): void => {
      if (!rightPanelVisible) {
        return
      }

      const step = event.shiftKey ? 24 : 12
      const setPanelWidth = browserPanelVisible ? setBrowserPanelWidth : setArtifactsPanelWidth
      if (event.key === "ArrowLeft") {
        event.preventDefault()
        setPanelWidth((width) => clampArtifactsPanelWidthToLayout(width + step))
      } else if (event.key === "ArrowRight") {
        event.preventDefault()
        setPanelWidth((width) => clampArtifactsPanelWidthToLayout(width - step))
      } else if (event.key === "Home") {
        event.preventDefault()
        setPanelWidth(ARTIFACTS_PANEL_MIN_WIDTH_PX)
      }
    },
    [browserPanelVisible, clampArtifactsPanelWidthToLayout, rightPanelVisible],
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
    isArtifactsPanelDragCollapsed,
    latestArtifactSelection,
    rightPanelVisible,
    setArtifactsPanelOpen: setArtifactsPanelOpenState,
    setArtifactsPanelMaximizedState,
    turnOutputSelection,
    visibleRightPanelWidth,
  }
}
