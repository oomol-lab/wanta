import { describe, expect, it, vi } from "vitest"
import { createHideOnCloseHandler, revealMainWindow } from "./window-close-behavior.ts"

describe("createHideOnCloseHandler", () => {
  it("prevents close and hides the window while the app keeps running", () => {
    const preventDefault = vi.fn()
    const hide = vi.fn()
    const handler = createHideOnCloseHandler({
      hide,
      isQuitting: () => false,
    })

    handler({ preventDefault } as unknown as Electron.Event)

    expect(preventDefault).toHaveBeenCalledTimes(1)
    expect(hide).toHaveBeenCalledTimes(1)
  })

  it("lets the window close during a real app quit", () => {
    const preventDefault = vi.fn()
    const hide = vi.fn()
    const handler = createHideOnCloseHandler({
      hide,
      isQuitting: () => true,
    })

    handler({ preventDefault } as unknown as Electron.Event)

    expect(preventDefault).not.toHaveBeenCalled()
    expect(hide).not.toHaveBeenCalled()
  })
})

describe("revealMainWindow", () => {
  it("shows and focuses a hidden window", () => {
    const focus = vi.fn()
    const restore = vi.fn()
    const show = vi.fn()

    revealMainWindow({
      focus,
      isMinimized: () => false,
      restore,
      show,
    })

    expect(show).toHaveBeenCalledTimes(1)
    expect(restore).not.toHaveBeenCalled()
    expect(focus).toHaveBeenCalledTimes(1)
  })

  it("restores minimized windows before focusing", () => {
    const focus = vi.fn()
    const restore = vi.fn()
    const show = vi.fn()

    revealMainWindow({
      focus,
      isMinimized: () => true,
      restore,
      show,
    })

    expect(show).toHaveBeenCalledTimes(1)
    expect(restore).toHaveBeenCalledTimes(1)
    expect(focus).toHaveBeenCalledTimes(1)
  })
})
