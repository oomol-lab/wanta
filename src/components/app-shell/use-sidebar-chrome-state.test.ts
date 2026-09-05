// @vitest-environment happy-dom
import * as React from "react"
import { createRoot } from "react-dom/client"
import { expect, test, vi } from "vitest"
import { SIDEBAR_MAX_WIDTH_PX, SIDEBAR_MIN_WIDTH_PX, SIDEBAR_WIDTH_STORAGE_KEY } from "./app-shell-model.ts"
import { writeStoredSidebarCollapsed } from "./sidebar-persistence.ts"
import { useSidebarChromeState } from "./use-sidebar-chrome-state.ts"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

test("stable sidebar callbacks retain current width and collapsed-state behavior", () => {
  localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, "264")
  writeStoredSidebarCollapsed(localStorage, false)
  const container = document.createElement("div")
  const root = createRoot(container)
  let state!: ReturnType<typeof useSidebarChromeState>
  function Probe({ revision: _revision }: { revision: number }) {
    const ref = React.useRef<HTMLDivElement>(null)
    state = useSidebarChromeState(ref)
    return React.createElement("div", { ref })
  }
  const key = (value: string, shiftKey = false) =>
    ({ key: value, shiftKey, preventDefault: vi.fn() }) as unknown as React.KeyboardEvent<HTMLDivElement>
  const pointer = () => ({ clientX: 100, preventDefault: vi.fn() }) as unknown as React.PointerEvent<HTMLDivElement>
  try {
    React.act(() => root.render(React.createElement(Probe, { revision: 0 })))
    const initialStart = state.handleSidebarResizeStart
    const initialKeyDown = state.handleSidebarResizeKeyDown
    React.act(() => root.render(React.createElement(Probe, { revision: 1 })))
    expect(state.handleSidebarResizeStart).toBe(initialStart)
    expect(state.handleSidebarResizeKeyDown).toBe(initialKeyDown)

    React.act(() => state.handleSidebarResizeKeyDown(key("Home")))
    expect(state.sidebarWidth).toBe(SIDEBAR_MIN_WIDTH_PX)
    React.act(() => state.handleSidebarResizeStart(pointer()))
    React.act(() => {
      window.dispatchEvent(new PointerEvent("pointermove", { clientX: 112 }))
      window.dispatchEvent(new PointerEvent("pointerup"))
    })
    expect(state.sidebarWidth).toBe(SIDEBAR_MIN_WIDTH_PX + 12)
    expect(localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY)).toBe(String(SIDEBAR_MIN_WIDTH_PX + 12))

    React.act(() => state.handleSidebarResizeKeyDown(key("End")))
    React.act(() => state.handleSidebarResizeKeyDown(key("ArrowLeft", true)))
    expect(state.sidebarWidth).toBe(SIDEBAR_MAX_WIDTH_PX - 24)
    React.act(() => state.setSidebarCollapsed(true))
    React.act(() => {
      state.handleSidebarResizeKeyDown(key("Home"))
      state.handleSidebarResizeStart(pointer())
    })
    expect(state.sidebarWidth).toBe(SIDEBAR_MAX_WIDTH_PX - 24)
    expect(state.isSidebarResizing).toBe(false)
  } finally {
    React.act(() => root.unmount())
    localStorage.clear()
  }
})
