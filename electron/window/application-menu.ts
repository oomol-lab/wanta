import type { AppCommand } from "../app-command.ts"
import type { MenuItemConstructorOptions } from "electron"

import { APP_COMMANDS } from "../app-command.ts"
import { branding } from "../branding.ts"

interface ApplicationMenuOptions {
  locale?: string
  onCommand: (command: AppCommand) => void
  platform: NodeJS.Platform
}

function labels(locale: string | undefined): {
  about: string
  edit: string
  file: string
  focusComposer: string
  help: string
  newChat: string
  searchTasks: string
  settings: string
  stopGeneration: string
  toggleSidebar: string
  view: string
  window: string
} {
  const useChinese = locale?.toLowerCase().startsWith("zh") ?? false
  if (useChinese) {
    return {
      about: `关于 ${branding.appName}`,
      edit: "编辑",
      file: "文件",
      focusComposer: "聚焦输入框",
      help: "帮助",
      newChat: "新对话",
      searchTasks: "搜索任务",
      settings: "设置",
      stopGeneration: "停止生成",
      toggleSidebar: "切换侧边栏",
      view: "视图",
      window: "窗口",
    }
  }
  return {
    about: `About ${branding.appName}`,
    edit: "Edit",
    file: "File",
    focusComposer: "Focus Composer",
    help: "Help",
    newChat: "New Chat",
    searchTasks: "Search Tasks",
    settings: "Settings",
    stopGeneration: "Stop Generation",
    toggleSidebar: "Toggle Sidebar",
    view: "View",
    window: "Window",
  }
}

function settingsMenuItem(input: ApplicationMenuOptions, label: string): MenuItemConstructorOptions {
  return {
    accelerator: "CommandOrControl+,",
    click: () => input.onCommand(APP_COMMANDS.openSettings),
    label,
  }
}

export function buildApplicationMenuTemplate(input: ApplicationMenuOptions): MenuItemConstructorOptions[] {
  const label = labels(input.locale)
  const isMac = input.platform === "darwin"

  const template: MenuItemConstructorOptions[] = []

  if (isMac) {
    template.push({
      label: branding.appName,
      submenu: [
        { label: label.about, role: "about" },
        { type: "separator" },
        settingsMenuItem(input, label.settings),
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
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
        isMac ? { role: "close" } : { role: "quit" },
      ],
    },
    {
      label: label.edit,
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "pasteAndMatchStyle" },
        { role: "delete" },
        { type: "separator" },
        { role: "selectAll" },
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
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: label.window,
      submenu: isMac
        ? [{ role: "minimize" }, { role: "zoom" }, { type: "separator" }, { role: "front" }]
        : [{ role: "minimize" }, { role: "close" }],
    },
    {
      label: label.help,
      submenu: [],
    },
  )

  return template
}
