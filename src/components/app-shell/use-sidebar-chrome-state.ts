import * as React from "react"
import {
  clampSidebarWidth,
  readStoredSidebarWidth,
  SIDEBAR_AUTO_COLLAPSE_MAX_WIDTH_PX,
  SIDEBAR_MAX_WIDTH_PX,
  SIDEBAR_MIN_WIDTH_PX,
  SIDEBAR_RESTORE_DELAY_MS,
  SIDEBAR_WIDTH_STORAGE_KEY,
} from "./app-shell-model.ts"
import { readStoredSidebarCollapsed, writeStoredSidebarCollapsed } from "./sidebar-persistence.ts"

interface UseSidebarChromeStateResult {
  handleSidebarResizeKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void
  handleSidebarResizeStart: (event: React.PointerEvent<HTMLDivElement>) => void
  handleToggleSidebar: () => void
  isSidebarResizing: boolean
  isSidebarRestoring: boolean
  setIsSidebarRestoring: React.Dispatch<React.SetStateAction<boolean>>
  setSidebarCollapsed: React.Dispatch<React.SetStateAction<boolean>>
  sidebarCollapsed: boolean
  sidebarWidth: number
}

export function useSidebarChromeState(): UseSidebarChromeStateResult {
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(() =>
    readStoredSidebarCollapsed(globalThis.localStorage),
  )
  const [isSidebarRestoring, setIsSidebarRestoring] = React.useState(false)
  const [sidebarWidth, setSidebarWidth] = React.useState(readStoredSidebarWidth)
  const [isSidebarResizing, setIsSidebarResizing] = React.useState(false)
  const sidebarResizeStart = React.useRef<{ pointerX: number; width: number } | null>(null)

  React.useEffect(() => {
    if (!isSidebarRestoring) {
      return
    }
    const id = window.setTimeout(() => setIsSidebarRestoring(false), SIDEBAR_RESTORE_DELAY_MS)
    return () => window.clearTimeout(id)
  }, [isSidebarRestoring])

  React.useEffect(() => {
    const mediaQuery = window.matchMedia(`(max-width: ${SIDEBAR_AUTO_COLLAPSE_MAX_WIDTH_PX}px)`)
    const collapseIfNarrow = (matches: boolean): void => {
      if (matches) {
        setSidebarCollapsed(true)
      }
    }

    collapseIfNarrow(mediaQuery.matches)
    const onChange = (event: MediaQueryListEvent): void => collapseIfNarrow(event.matches)
    mediaQuery.addEventListener("change", onChange)
    return () => mediaQuery.removeEventListener("change", onChange)
  }, [])

  React.useEffect(() => {
    try {
      globalThis.localStorage?.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(sidebarWidth))
    } catch {
      // 本地存储不可用时仅保留本次会话宽度。
    }
  }, [sidebarWidth])

  React.useEffect(() => {
    if (!isSidebarResizing) {
      return
    }

    const handlePointerMove = (event: PointerEvent): void => {
      const start = sidebarResizeStart.current
      if (!start) {
        return
      }
      setSidebarWidth(clampSidebarWidth(start.width + event.clientX - start.pointerX))
    }
    const handlePointerUp = (): void => {
      sidebarResizeStart.current = null
      setIsSidebarResizing(false)
    }

    window.addEventListener("pointermove", handlePointerMove)
    window.addEventListener("pointerup", handlePointerUp, { once: true })
    window.addEventListener("pointercancel", handlePointerUp, { once: true })
    return () => {
      window.removeEventListener("pointermove", handlePointerMove)
      window.removeEventListener("pointerup", handlePointerUp)
      window.removeEventListener("pointercancel", handlePointerUp)
    }
  }, [isSidebarResizing])

  const handleToggleSidebar = React.useCallback((): void => {
    setSidebarCollapsed((collapsed) => {
      const nextCollapsed = !collapsed
      if (collapsed) {
        setIsSidebarRestoring(true)
      }
      writeStoredSidebarCollapsed(globalThis.localStorage, nextCollapsed)
      return nextCollapsed
    })
  }, [])

  const handleSidebarResizeStart = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (sidebarCollapsed) {
      return
    }
    event.preventDefault()
    sidebarResizeStart.current = { pointerX: event.clientX, width: sidebarWidth }
    setIsSidebarResizing(true)
  }

  const handleSidebarResizeKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (sidebarCollapsed) {
      return
    }

    const step = event.shiftKey ? 24 : 12
    if (event.key === "ArrowLeft") {
      event.preventDefault()
      setSidebarWidth((width) => clampSidebarWidth(width - step))
    } else if (event.key === "ArrowRight") {
      event.preventDefault()
      setSidebarWidth((width) => clampSidebarWidth(width + step))
    } else if (event.key === "Home") {
      event.preventDefault()
      setSidebarWidth(SIDEBAR_MIN_WIDTH_PX)
    } else if (event.key === "End") {
      event.preventDefault()
      setSidebarWidth(SIDEBAR_MAX_WIDTH_PX)
    }
  }

  return {
    handleSidebarResizeKeyDown,
    handleSidebarResizeStart,
    handleToggleSidebar,
    isSidebarResizing,
    isSidebarRestoring,
    setIsSidebarRestoring,
    setSidebarCollapsed,
    sidebarCollapsed,
    sidebarWidth,
  }
}
