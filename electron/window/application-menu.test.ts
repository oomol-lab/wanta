import type { MenuItemConstructorOptions } from "electron"

import { describe, expect, it, vi } from "vitest"
import { APP_COMMANDS } from "../app-command.ts"
import { normalizeAppLocale } from "../app-locale.ts"
import { branding } from "../branding.ts"
import { applicationMenuMessages } from "./application-menu-messages.ts"
import { buildApplicationMenuTemplate } from "./application-menu.ts"

type MenuClick = () => void

function menuTemplate(input: Partial<Parameters<typeof buildApplicationMenuTemplate>[0]> = {}) {
  return buildApplicationMenuTemplate({
    developmentMode: false,
    locale: "en",
    onCommand: () => undefined,
    platform: "darwin",
    ...input,
  })
}

function collectLabels(items: MenuItemConstructorOptions[]): string[] {
  return items.flatMap((item) => {
    const labels = typeof item.label === "string" ? [item.label] : []
    const submenuLabels = Array.isArray(item.submenu) ? collectLabels(item.submenu) : []
    return [...labels, ...submenuLabels]
  })
}

function topLabels(items: MenuItemConstructorOptions[]): string[] {
  return items.map((item) => item.label).filter((label): label is string => typeof label === "string")
}

function findItem(items: MenuItemConstructorOptions[], label: string): MenuItemConstructorOptions {
  const item = items.find((entry) => entry.label === label)
  expect(item).toBeTruthy()
  return item as MenuItemConstructorOptions
}

describe("application menu locale helpers", () => {
  it("normalizes supported app locales", () => {
    expect(normalizeAppLocale("zh-CN")).toBe("zh-CN")
    expect(normalizeAppLocale("zh-Hans")).toBe("zh-CN")
    expect(normalizeAppLocale("en-US")).toBe("en")
    expect(normalizeAppLocale(undefined)).toBe("en")
  })

  it("keeps menu message keys in parity", () => {
    expect(Object.keys(applicationMenuMessages["zh-CN"]).sort()).toEqual(Object.keys(applicationMenuMessages.en).sort())
  })
})

describe("buildApplicationMenuTemplate", () => {
  it("localizes standard macOS menu role labels in Chinese", () => {
    const template = menuTemplate({ locale: "zh-CN", platform: "darwin" })
    const labels = collectLabels(template)

    expect(labels).toContain("撤销")
    expect(labels).toContain("剪切")
    expect(labels).toContain("粘贴并匹配样式")
    expect(labels).toContain("前置所有窗口")
    expect(labels).not.toContain("Undo")
    expect(labels).not.toContain("Paste and Match Style")
  })

  it("hides developer-only commands in production menus", () => {
    const template = menuTemplate({ developmentMode: false, locale: "zh-CN", platform: "darwin" })
    const labels = collectLabels(template)

    expect(topLabels(template)).toEqual([branding.appName, "文件", "编辑", "视图", "窗口", "帮助"])
    expect(labels).not.toContain("开发")
    expect(labels).not.toContain("重新加载窗口")
    expect(labels).not.toContain("强制重新加载")
    expect(labels).not.toContain("切换开发者工具")
  })

  it("places developer commands in a dedicated development menu", () => {
    const template = menuTemplate({ developmentMode: true, locale: "zh-CN", platform: "darwin" })
    const labels = collectLabels(template)

    expect(topLabels(template)).toEqual([branding.appName, "文件", "编辑", "视图", "开发", "窗口", "帮助"])
    expect(labels).toContain("重新加载窗口")
    expect(labels).toContain("强制重新加载")
    expect(labels).toContain("切换开发者工具")
  })

  it("uses Windows-friendly File menu labels", () => {
    const template = menuTemplate({ developmentMode: false, locale: "en", platform: "win32" })
    const fileMenu = findItem(template, "File")
    const fileLabels = Array.isArray(fileMenu.submenu) ? collectLabels(fileMenu.submenu) : []

    expect(topLabels(template)).toEqual(["File", "Edit", "View", "Window", "Help"])
    expect(fileLabels).toContain("New Chat")
    expect(fileLabels).toContain("Settings…")
    expect(fileLabels).toContain("Exit")
  })

  it("dispatches app command menu items", () => {
    const onCommand = vi.fn()
    const template = menuTemplate({ locale: "zh-CN", onCommand, platform: "darwin" })
    const fileMenu = findItem(template, "文件")
    const newChatItem = Array.isArray(fileMenu.submenu) ? findItem(fileMenu.submenu, "新对话") : undefined

    if (!newChatItem) {
      throw new Error("New chat menu item was not found.")
    }
    expect(newChatItem.click).toBeTypeOf("function")
    ;(newChatItem.click as MenuClick)()

    expect(onCommand).toHaveBeenCalledExactlyOnceWith(APP_COMMANDS.newChat)
  })

  it("places a localized update check in the macOS application menu", () => {
    const onCommand = vi.fn()
    const template = menuTemplate({ locale: "zh-CN", onCommand, platform: "darwin" })
    const applicationMenu = findItem(template, branding.appName)
    const submenu = Array.isArray(applicationMenu.submenu) ? applicationMenu.submenu : []
    const updateItem = findItem(submenu, "检查更新…")

    expect(
      submenu
        .map((item) => item.label)
        .filter(Boolean)
        .slice(0, 3),
    ).toEqual([`关于 ${branding.appName}`, "检查更新…", "设置…"])
    expect(updateItem.click).toBeTypeOf("function")
    ;(updateItem.click as MenuClick)()
    expect(onCommand).toHaveBeenCalledExactlyOnceWith(APP_COMMANDS.checkForUpdates)
  })

  it("places the update check in the Windows Help menu", () => {
    const onCommand = vi.fn()
    const template = menuTemplate({ locale: "en", onCommand, platform: "win32" })
    const helpMenu = findItem(template, "Help")
    const submenu = Array.isArray(helpMenu.submenu) ? helpMenu.submenu : []
    const updateItem = findItem(submenu, "Check for Updates…")

    expect(submenu.map((item) => item.label).filter(Boolean)).toEqual([
      "Check for Updates…",
      `About ${branding.appName}`,
    ])
    expect(updateItem.click).toBeTypeOf("function")
    ;(updateItem.click as MenuClick)()
    expect(onCommand).toHaveBeenCalledExactlyOnceWith(APP_COMMANDS.checkForUpdates)
  })

  it("keeps the update check out of Linux menus", () => {
    expect(collectLabels(menuTemplate({ locale: "en", platform: "linux" }))).not.toContain("Check for Updates…")
  })
})
