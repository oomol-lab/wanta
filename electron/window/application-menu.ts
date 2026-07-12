import type { AppCommand } from "../app-command.ts"
import type { MenuItemConstructorOptions, NativeImage } from "electron"

import { APP_COMMANDS } from "../app-command.ts"
import { normalizeAppLocale } from "../app-locale.ts"
import { branding } from "../branding.ts"
import { applicationMenuLabels } from "./application-menu-messages.ts"

interface ApplicationMenuOptions {
  developmentMode: boolean
  locale?: string
  macIcons?: {
    about: NativeImage
    checkForUpdates: NativeImage
    services: NativeImage
    settings: NativeImage
  }
  onCommand: (command: AppCommand) => void
  platform: NodeJS.Platform
}

function settingsMenuItem(input: ApplicationMenuOptions, label: string): MenuItemConstructorOptions {
  return {
    accelerator: "CommandOrControl+,",
    click: () => input.onCommand(APP_COMMANDS.openSettings),
    ...(input.platform === "darwin" && input.macIcons ? { icon: input.macIcons.settings } : {}),
    label,
  }
}

function roleMenuItem(
  role: NonNullable<MenuItemConstructorOptions["role"]>,
  label: string,
): MenuItemConstructorOptions {
  return { label, role }
}

export function buildApplicationMenuTemplate(input: ApplicationMenuOptions): MenuItemConstructorOptions[] {
  const label = applicationMenuLabels(normalizeAppLocale(input.locale))
  const isMac = input.platform === "darwin"

  const template: MenuItemConstructorOptions[] = []

  if (isMac) {
    template.push({
      label: branding.appName,
      submenu: [
        { ...roleMenuItem("about", label.about), id: "app-about" },
        {
          click: () => input.onCommand(APP_COMMANDS.checkForUpdates),
          ...(input.macIcons ? { icon: input.macIcons.checkForUpdates } : {}),
          label: label.checkForUpdates,
        },
        { type: "separator" },
        settingsMenuItem(input, label.settings),
        { type: "separator" },
        { ...roleMenuItem("services", label.services), id: "app-services" },
        { type: "separator" },
        roleMenuItem("hide", label.hide),
        roleMenuItem("hideOthers", label.hideOthers),
        roleMenuItem("unhide", label.showAll),
        { type: "separator" },
        roleMenuItem("quit", label.quit),
      ],
    })
  }

  template.push(
    {
      label: label.file,
      submenu: [
        {
          accelerator: "CommandOrControl+N",
          click: () => input.onCommand(APP_COMMANDS.newChat),
          label: label.newChat,
        },
        ...(isMac ? [] : [{ type: "separator" } as const, settingsMenuItem(input, label.settings)]),
        { type: "separator" },
        isMac ? roleMenuItem("close", label.closeWindow) : roleMenuItem("quit", label.exit),
      ],
    },
    {
      label: label.edit,
      submenu: [
        roleMenuItem("undo", label.undo),
        roleMenuItem("redo", label.redo),
        { type: "separator" },
        roleMenuItem("cut", label.cut),
        roleMenuItem("copy", label.copy),
        roleMenuItem("paste", label.paste),
        roleMenuItem("pasteAndMatchStyle", label.pasteAndMatchStyle),
        roleMenuItem("delete", label.delete),
        { type: "separator" },
        roleMenuItem("selectAll", label.selectAll),
      ],
    },
    {
      label: label.view,
      submenu: [
        {
          accelerator: "CommandOrControl+K",
          click: () => input.onCommand(APP_COMMANDS.openSearch),
          label: label.searchTasks,
        },
        {
          accelerator: "CommandOrControl+L",
          click: () => input.onCommand(APP_COMMANDS.focusComposer),
          label: label.focusComposer,
        },
        {
          accelerator: "CommandOrControl+.",
          click: () => input.onCommand(APP_COMMANDS.stopGeneration),
          label: label.stopGeneration,
        },
        { type: "separator" },
        {
          accelerator: "CommandOrControl+B",
          click: () => input.onCommand(APP_COMMANDS.toggleSidebar),
          label: label.toggleSidebar,
        },
        { type: "separator" },
        roleMenuItem("resetZoom", label.resetZoom),
        roleMenuItem("zoomIn", label.zoomIn),
        roleMenuItem("zoomOut", label.zoomOut),
        { type: "separator" },
        roleMenuItem("togglefullscreen", label.toggleFullScreen),
      ],
    },
  )

  if (input.developmentMode) {
    template.push({
      label: label.developer,
      submenu: [
        roleMenuItem("reload", label.reload),
        roleMenuItem("forceReload", label.forceReload),
        roleMenuItem("toggleDevTools", label.toggleDevTools),
      ],
    })
  }

  template.push(
    {
      label: label.window,
      submenu: isMac
        ? [
            roleMenuItem("minimize", label.minimize),
            roleMenuItem("zoom", label.zoom),
            { type: "separator" },
            roleMenuItem("front", label.front),
          ]
        : [roleMenuItem("minimize", label.minimize), roleMenuItem("close", label.closeWindow)],
    },
    {
      role: "help",
      label: label.help,
      submenu: [
        ...(!isMac && input.platform === "win32"
          ? [
              {
                click: () => input.onCommand(APP_COMMANDS.checkForUpdates),
                label: label.checkForUpdates,
              },
              { type: "separator" as const },
            ]
          : []),
        roleMenuItem("about", label.about),
      ],
    },
  )

  return template
}
