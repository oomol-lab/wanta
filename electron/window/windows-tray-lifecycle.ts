import type { MenuItemConstructorOptions } from "electron"

import { Menu, Tray } from "electron"
import { normalizeAppLocale } from "../app-locale.ts"
import { branding } from "../branding.ts"
import { nativeTranslate } from "../native-messages.ts"

export function buildWindowsTrayMenuTemplate(input: {
  locale?: string
  onExit: () => void
  onInstallUpdate?: () => void
  onOpen: () => void
  updateReadyVersion?: string
}): MenuItemConstructorOptions[] {
  const locale = normalizeAppLocale(input.locale)
  const openLabel = nativeTranslate(locale, "tray.open")
  const updateLabel = nativeTranslate(locale, "tray.update", { version: input.updateReadyVersion ?? "" })
  const exitLabel = nativeTranslate(locale, "menu.exit")

  return [
    {
      label: openLabel,
      click: () => input.onOpen(),
    },
    ...(input.updateReadyVersion && input.onInstallUpdate
      ? [
          {
            label: updateLabel,
            click: () => input.onInstallUpdate?.(),
          },
          { type: "separator" as const },
        ]
      : []),
    {
      label: exitLabel,
      click: () => input.onExit(),
    },
  ]
}

export function createWindowsTrayLifecycle(input: {
  iconPath: string
  locale?: string
  onExit: () => void
  onInstallUpdate: () => void
  onOpen: () => void
}): {
  dispose: () => void
  setLocale: (locale: string) => void
  setUpdateReadyVersion: (version: string | undefined) => void
} {
  const tray = new Tray(input.iconPath)
  const onTrayClick = (): void => input.onOpen()
  let currentLocale = input.locale
  let updateReadyVersion: string | undefined

  const updateTray = (): void => {
    tray.setToolTip(branding.appName)
    tray.setContextMenu(
      Menu.buildFromTemplate(
        buildWindowsTrayMenuTemplate({
          locale: currentLocale,
          onExit: input.onExit,
          onInstallUpdate: input.onInstallUpdate,
          onOpen: input.onOpen,
          updateReadyVersion,
        }),
      ),
    )
  }
  updateTray()
  tray.on("click", onTrayClick)

  return {
    dispose: () => {
      tray.removeListener("click", onTrayClick)
      tray.destroy()
    },
    setLocale: (locale: string) => {
      currentLocale = locale
      updateTray()
    },
    setUpdateReadyVersion: (version: string | undefined) => {
      if (updateReadyVersion === version) return
      updateReadyVersion = version
      updateTray()
    },
  }
}
