import assert from "node:assert/strict"
import { test } from "vitest"
import { findOfficialAuthorizationUrl, isVersionNewer } from "./lark-cli.ts"

test("Lark CLI update comparison handles stable and prerelease versions", () => {
  assert.equal(isVersionNewer("1.0.82", "1.0.81"), true)
  assert.equal(isVersionNewer("1.1.0", "1.0.99"), true)
  assert.equal(isVersionNewer("1.0.81", "1.0.81"), false)
  assert.equal(isVersionNewer("1.0.81-beta.2", "1.0.81-beta.1"), true)
  assert.equal(isVersionNewer("1.0.81", "1.0.81-beta.2"), true)
  assert.equal(isVersionNewer("invalid", "1.0.81"), false)
})

test("Lark CLI authorization URLs are recovered from JSON without widening the host allowlist", () => {
  assert.equal(
    findOfficialAuthorizationUrl('{"verification_url":"https://open.feishu.cn/device?a=1\\u0026b=2"}'),
    "https://open.feishu.cn/device?a=1&b=2",
  )
  assert.equal(
    findOfficialAuthorizationUrl("https://open.larksuite.com/device?id=1"),
    "https://open.larksuite.com/device?id=1",
  )
  assert.equal(findOfficialAuthorizationUrl("https://open.feishu.cn.evil.example/device"), undefined)
  assert.equal(findOfficialAuthorizationUrl("https://open.feishu.cn:8443/device"), undefined)
})
