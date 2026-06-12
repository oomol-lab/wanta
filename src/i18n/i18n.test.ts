import assert from "node:assert/strict"
import { test } from "vitest"
import { isLocale, translate } from "./i18n.ts"

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

test("isLocale guards the supported locales", () => {
  assert.equal(isLocale("zh-CN"), true)
  assert.equal(isLocale("en"), true)
  assert.equal(isLocale("fr"), false)
  assert.equal(isLocale(null), false)
})
