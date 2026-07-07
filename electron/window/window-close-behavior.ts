import type { BrowserWindow } from "electron"

export function createHideOnCloseHandler(input: {
  hide: () => void
  isQuitting: () => boolean
}): (event: Electron.Event) => void {
  return (event) => {
    if (input.isQuitting()) {
      return
    }

    event.preventDefault()
    input.hide()
  }
}

export function revealMainWindow(window: Pick<BrowserWindow, "focus" | "isMinimized" | "restore" | "show">): void {
  window.show()
  if (window.isMinimized()) {
    window.restore()
  }
  window.focus()
}
