import type { MenuItemConstructorOptions } from "electron"

import { Menu, Tray } from "electron"
import { branding } from "../branding.ts"

export function buildWindowsTrayMenuTemplate(input: {
  locale?: string
  onExit: () => void
  onOpen: () => void
}): MenuItemConstructorOptions[] {
  const useChinese = input.locale?.toLowerCase().startsWith("zh") ?? false
  const openLabel = useChinese ? `打开 ${branding.appName}` : `Open ${branding.appName}`
  const exitLabel = useChinese ? "退出" : "Exit"

  return [
    {
      label: openLabel,
      click: () => input.onOpen(),
    },
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
  onOpen: () => void
}): {
  dispose: () => void
  setLocale: (locale: string) => void
} {
  const tray = new Tray(input.iconPath)
  const onTrayClick = (): void => input.onOpen()

  const updateTray = (locale = input.locale): void => {
    tray.setToolTip(branding.appName)
    tray.setContextMenu(
      Menu.buildFromTemplate(
        buildWindowsTrayMenuTemplate({
          locale,
          onExit: input.onExit,
          onOpen: input.onOpen,
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
    setLocale: (locale: string) => updateTray(locale),
  }
}
