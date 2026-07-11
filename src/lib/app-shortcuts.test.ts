import { describe, expect, it } from "vitest"
import { APP_COMMANDS } from "../../electron/app-command.ts"
import { appCommandAriaShortcut, appCommandForKeyboardShortcut, appCommandShortcutLabel } from "./app-shortcuts.ts"

describe("app shortcuts", () => {
  it("maps command modifier shortcuts on macOS", () => {
    expect(appCommandForKeyboardShortcut({ key: "n", metaKey: true }, "darwin")).toBe(APP_COMMANDS.newChat)
    expect(appCommandForKeyboardShortcut({ key: "K", metaKey: true }, "darwin")).toBe(APP_COMMANDS.openSearch)
    expect(appCommandForKeyboardShortcut({ key: ",", metaKey: true }, "darwin")).toBe(APP_COMMANDS.openSettings)
    expect(appCommandForKeyboardShortcut({ key: "b", metaKey: true }, "darwin")).toBe(APP_COMMANDS.toggleSidebar)
    expect(appCommandForKeyboardShortcut({ key: "l", metaKey: true }, "darwin")).toBe(APP_COMMANDS.focusComposer)
    expect(appCommandForKeyboardShortcut({ key: ".", metaKey: true }, "darwin")).toBe(APP_COMMANDS.stopGeneration)
  })

  it("maps control shortcuts off macOS", () => {
    expect(appCommandForKeyboardShortcut({ key: "n", ctrlKey: true }, "win32")).toBe(APP_COMMANDS.newChat)
    expect(appCommandForKeyboardShortcut({ key: "k", ctrlKey: true }, "linux")).toBe(APP_COMMANDS.openSearch)
  })

  it("does not steal text-editing or repeated variants", () => {
    expect(appCommandForKeyboardShortcut({ key: "k", ctrlKey: true }, "darwin")).toBeNull()
    expect(appCommandForKeyboardShortcut({ key: "k", metaKey: true, shiftKey: true }, "darwin")).toBeNull()
    expect(appCommandForKeyboardShortcut({ key: "k", metaKey: true, repeat: true }, "darwin")).toBeNull()
    expect(appCommandForKeyboardShortcut({ key: "k" }, "darwin")).toBeNull()
  })

  it("formats visible and aria shortcut labels", () => {
    expect(appCommandShortcutLabel(APP_COMMANDS.openSearch, "darwin")).toBe("⌘K")
    expect(appCommandShortcutLabel(APP_COMMANDS.openSearch, "win32")).toBe("Ctrl+K")
    expect(appCommandAriaShortcut(APP_COMMANDS.openSearch, "darwin")).toBe("Meta+K")
    expect(appCommandAriaShortcut(APP_COMMANDS.openSearch, "win32")).toBe("Control+K")
    expect(appCommandShortcutLabel(APP_COMMANDS.openConnections, "darwin")).toBe("")
    expect(appCommandAriaShortcut(APP_COMMANDS.openConnections, "win32")).toBe("")
    expect(appCommandShortcutLabel(APP_COMMANDS.checkForUpdates, "darwin")).toBe("")
    expect(appCommandAriaShortcut(APP_COMMANDS.checkForUpdates, "win32")).toBe("")
  })
})
