import type { AppCommand } from "../../electron/app-command.ts"

import { APP_COMMANDS } from "../../electron/app-command.ts"

export interface KeyboardShortcutEvent {
  altKey?: boolean
  ctrlKey?: boolean
  key: string
  metaKey?: boolean
  repeat?: boolean
  shiftKey?: boolean
}

export function isMacPlatform(platform: NodeJS.Platform | undefined = globalThis.wanta?.platform): boolean {
  return platform === "darwin"
}

export function appCommandForKeyboardShortcut(
  event: KeyboardShortcutEvent,
  platform: NodeJS.Platform | undefined = globalThis.wanta?.platform,
): AppCommand | null {
  if (event.repeat || event.altKey || event.shiftKey) {
    return null
  }

  const isMac = isMacPlatform(platform)
  const commandModifier = isMac ? Boolean(event.metaKey) && !event.ctrlKey : Boolean(event.ctrlKey) && !event.metaKey
  if (!commandModifier) {
    return null
  }

  switch (event.key.toLowerCase()) {
    case "b":
      return APP_COMMANDS.toggleSidebar
    case "k":
      return APP_COMMANDS.openSearch
    case "l":
      return APP_COMMANDS.focusComposer
    case "n":
      return APP_COMMANDS.newChat
    case ",":
      return APP_COMMANDS.openSettings
    case ".":
      return APP_COMMANDS.stopGeneration
    default:
      return null
  }
}

export function appCommandShortcutLabel(
  command: AppCommand,
  platform: NodeJS.Platform | undefined = globalThis.wanta?.platform,
): string {
  const modifier = isMacPlatform(platform) ? "⌘" : "Ctrl+"
  switch (command) {
    case APP_COMMANDS.focusComposer:
      return `${modifier}L`
    case APP_COMMANDS.newChat:
      return `${modifier}N`
    case APP_COMMANDS.openSearch:
      return `${modifier}K`
    case APP_COMMANDS.openSettings:
      return `${modifier},`
    case APP_COMMANDS.stopGeneration:
      return `${modifier}.`
    case APP_COMMANDS.toggleSidebar:
      return `${modifier}B`
  }
}

export function appCommandAriaShortcut(
  command: AppCommand,
  platform: NodeJS.Platform | undefined = globalThis.wanta?.platform,
): string {
  const modifier = isMacPlatform(platform) ? "Meta" : "Control"
  switch (command) {
    case APP_COMMANDS.focusComposer:
      return `${modifier}+L`
    case APP_COMMANDS.newChat:
      return `${modifier}+N`
    case APP_COMMANDS.openSearch:
      return `${modifier}+K`
    case APP_COMMANDS.openSettings:
      return `${modifier}+,`
    case APP_COMMANDS.stopGeneration:
      return `${modifier}+.`
    case APP_COMMANDS.toggleSidebar:
      return `${modifier}+B`
  }
}

export function labelWithShortcut(label: string, shortcut: string): string {
  return `${label} (${shortcut})`
}
