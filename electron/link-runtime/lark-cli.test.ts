import assert from "node:assert/strict"
import { test } from "vitest"
import { findOfficialAuthorizationUrl, isVersionNewer, redactCommandError } from "./lark-cli.ts"

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

test("Lark CLI command errors redact authorization URLs and credentials", () => {
  const redacted = redactCommandError(
    'request failed device_code=dev-secret app_secret:app-secret "access_token":"access-secret", refresh_token=refresh-secret https://open.feishu.cn/device?id=secret',
  )

  assert.match(redacted, /request failed/u)
  assert.equal(redacted.includes("dev-secret"), false)
  assert.equal(redacted.includes("app-secret"), false)
  assert.equal(redacted.includes("access-secret"), false)
  assert.equal(redacted.includes("refresh-secret"), false)
  assert.equal(redacted.includes("id=secret"), false)
  assert.match(redacted, /\[redacted\]/u)
  assert.match(redacted, /\[authorization-url\]/u)
})
