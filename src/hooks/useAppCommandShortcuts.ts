import type { AppCommand } from "../../electron/app-command.ts"

import * as React from "react"
import { appCommandForKeyboardShortcut } from "@/lib/app-shortcuts"

const blockingOverlaySelector = [
  '[role="dialog"][aria-modal="true"]',
  '[role="menu"]',
  '[data-slot="dropdown-menu-content"]',
  '[data-slot="select-content"]',
].join(",")

function hasBlockingOverlay(): boolean {
  return Boolean(document.querySelector(blockingOverlaySelector))
}

function isEditableShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false
  }
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    Boolean(target.closest('[contenteditable="true"]'))
  )
}

export function useAppCommandEvents(runCommand: (command: AppCommand) => void): void {
  React.useEffect(() => {
    const bridge = globalThis.lumo
    if (!bridge?.onAppCommand) {
      return undefined
    }
    return bridge.onAppCommand(runCommand)
  }, [runCommand])
}

export function useAppCommandShortcuts(runCommand: (command: AppCommand) => void): void {
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (isEditableShortcutTarget(event.target)) {
        return
      }
      const command = appCommandForKeyboardShortcut(event)
      if (!command || hasBlockingOverlay()) {
        return
      }
      event.preventDefault()
      runCommand(command)
    }

    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [runCommand])
}
