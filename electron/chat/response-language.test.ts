import assert from "node:assert/strict"
import { test } from "vitest"
import { detectResponseLanguage } from "./response-language.ts"

test("detectResponseLanguage recognizes an English task in a Chinese interface", () => {
  assert.equal(detectResponseLanguage("Help me analyze Gmail messages from the past three days"), "English")
})

test("detectResponseLanguage recognizes a Chinese task containing an English product name", () => {
  assert.equal(detectResponseLanguage("帮我分析过去三天的 Gmail 邮件"), "Simplified Chinese")
})

test("detectResponseLanguage prioritizes the instruction before quoted source material", () => {
  assert.equal(detectResponseLanguage("Please summarize this message: 你好，感谢你联系我们"), "English")
  assert.equal(
    detectResponseLanguage("请总结这封邮件：Thank you for contacting us about your account"),
    "Simplified Chinese",
  )
})

test("detectResponseLanguage leaves short and unsupported-language requests unresolved", () => {
  assert.equal(detectResponseLanguage("OK, continue"), undefined)
  assert.equal(detectResponseLanguage("Analysez mes messages Gmail des trois derniers jours"), undefined)
  assert.equal(detectResponseLanguage("メールを分析してください"), undefined)
})
