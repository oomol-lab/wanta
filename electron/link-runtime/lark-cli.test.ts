import assert from "node:assert/strict"
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, expect, test } from "vitest"
import { findOfficialAuthorizationUrl, isVersionNewer, LarkCliManager, redactCommandError } from "./lark-cli.ts"

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

describe.runIf(process.platform !== "win32")("Lark CLI Agent activation", () => {
  test("exposes the runtime only while the isolated identity is connected", async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), "wanta-lark-cli-agent-"))
    try {
      const binaryPath = path.join(base, "lark-cli")
      const rootDir = path.join(base, "private-runtime")
      const skillsDir = path.join(base, "skills")
      await mkdir(path.join(skillsDir, "lark-calendar"), { recursive: true })
      await writeFile(path.join(skillsDir, "lark-calendar", "SKILL.md"), "---\nname: lark-calendar\n---\n", "utf-8")
      await writeFile(
        binaryPath,
        `#!/bin/sh
if [ "$1" = "--version" ]; then echo "lark-cli 1.0.81"; exit 0; fi
if [ "$1" = "auth" ] && [ "$2" = "status" ]; then
  if [ -f "$LARKSUITE_CLI_CONFIG_DIR/authorized" ]; then
    echo '{"identity":"user","verified":true,"name":"Shaun"}'
  else
    echo '{"identity":"none"}'
  fi
  exit 0
fi
exit 1
`,
        "utf-8",
      )
      await chmod(binaryPath, 0o755)
      const manager = new LarkCliManager({
        bundledBinaryPath: binaryPath,
        bundledSkillsDir: skillsDir,
        openExternalUrl: () => undefined,
        rootDir,
      })

      await expect(manager.availableRuntime()).resolves.toMatchObject({ binaryPath, skillsDir })
      await expect(manager.agentRuntime()).resolves.toBeNull()

      await mkdir(path.join(rootDir, "config"), { recursive: true })
      await writeFile(path.join(rootDir, "config", "authorized"), "1", "utf-8")
      await expect(manager.agentRuntime()).resolves.toMatchObject({ binaryPath, skillsDir })

      await rm(path.join(rootDir, "config", "authorized"))
      await expect(manager.agentRuntime()).resolves.toBeNull()
    } finally {
      await rm(base, { force: true, recursive: true })
    }
  })
})
