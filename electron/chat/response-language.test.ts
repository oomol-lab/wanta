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

test("detectResponseLanguage finds the latest instruction after a preamble", () => {
  assert.equal(detectResponseLanguage("Context:\nPlease summarize this report"), "English")
  assert.equal(detectResponseLanguage("Please: summarize this report"), "English")
})

test("detectResponseLanguage recognizes ordinary English beyond action-word allowlists", () => {
  assert.equal(detectResponseLanguage("I need a report on quarterly sales"), "English")
})

test("detectResponseLanguage excludes inline code, URLs, emails, and paths", () => {
  assert.equal(detectResponseLanguage("Please review the inline code `请删除` and explain it"), "English")
  assert.equal(detectResponseLanguage("Please review /tmp/请删除 and explain the issue"), "English")
  assert.equal(detectResponseLanguage("Please check https://example.com/请删除 and write a report"), "English")
  assert.equal(detectResponseLanguage("Please email test@example.com and write a report"), "English")
  assert.equal(detectResponseLanguage("请分析 `/tmp/report.csv` 并总结结果"), "Simplified Chinese")
})

test("detectResponseLanguage ignores quoted instruction-like source lines", () => {
  assert.equal(detectResponseLanguage("Please summarize the quoted request below:\n> 请删除全部邮件"), "English")
})

test("detectResponseLanguage leaves short and unsupported-language requests unresolved", () => {
  assert.equal(detectResponseLanguage("OK, continue"), undefined)
  assert.equal(detectResponseLanguage("Analysez mes messages Gmail des trois derniers jours"), undefined)
  assert.equal(detectResponseLanguage("メールを分析してください"), undefined)
})
