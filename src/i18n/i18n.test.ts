import assert from "node:assert/strict"
import { test } from "vitest"
import { isLocale, translate } from "./i18n.ts"
import { skillsMessages } from "./skills-messages.ts"

test("translate returns locale-specific strings", () => {
  assert.equal(translate("zh-CN", "settings.title"), "设置")
  assert.equal(translate("en", "settings.title"), "Settings")
  assert.equal(translate("zh-CN", "connections.connect"), "连接")
  assert.equal(translate("en", "connections.connect"), "Connect")
})

test("translate interpolates {var}", () => {
  assert.equal(translate("en", "chat.authNeeded", { name: "Slack" }), "Slack needs authorization to continue")
  assert.equal(translate("zh-CN", "chat.authNeeded", { name: "Slack" }), "需要授权 Slack 才能继续")
  assert.equal(translate("en", "connections.more", { count: 577 }), "Search to connect more (577 total)")
})

test("translate interpolates OO-style {{var}}", () => {
  assert.equal(translate("zh-CN", "skills.registryInstallDone", { name: "Slack" }), "已安装 Slack。")
  assert.equal(translate("en", "skills.registryInstallDone", { name: "Slack" }), "Slack installed.")
  assert.equal(translate("zh-CN", "skills.installed"), "已安装")
})

test("full access permission mode is localized without implementation labels", () => {
  assert.equal(translate("zh-CN", "chat.permissionModeFullAccess"), "完全访问")
  assert.equal(translate("en", "chat.permissionModeFullAccess"), "Full access")
  assert.doesNotMatch(translate("zh-CN", "chat.fullAccessDialogTitle"), /YOLO/)
  assert.doesNotMatch(translate("en", "chat.fullAccessDialogTitle"), /YOLO/)
  assert.doesNotMatch(translate("zh-CN", "chat.fullAccessDialogBody"), /YOLO/)
  assert.doesNotMatch(translate("en", "chat.fullAccessDialogBody"), /YOLO/)
})

test("isLocale guards the supported locales", () => {
  assert.equal(isLocale("zh-CN"), true)
  assert.equal(isLocale("en"), true)
  assert.equal(isLocale("fr"), false)
  assert.equal(isLocale(null), false)
})

test("skills i18n locale keysets stay in parity", () => {
  assert.deepEqual(flattenKeys(skillsMessages["zh-CN"]), flattenKeys(skillsMessages.en))
})

function flattenKeys(value: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(value)
    .flatMap(([key, entry]) => {
      const nextKey = prefix ? `${prefix}.${key}` : key
      if (entry && typeof entry === "object" && !Array.isArray(entry)) {
        return flattenKeys(entry as Record<string, unknown>, nextKey)
      }
      return [nextKey]
    })
    .sort()
}
