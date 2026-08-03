import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, expect, test } from "vitest"
import {
  DingTalkCliManager,
  extractOfficialDingTalkAuthorizationUrl,
  parseDingTalkAuthStatus,
  redactDingTalkCliError,
} from "./dingtalk-cli.ts"

describe("DingTalk CLI state", () => {
  test("parses the active organization and exact profile", () => {
    expect(
      parseDingTalkAuthStatus({
        authenticated: true,
        corp_id: "ding-corp",
        corp_name: "OOMOL",
        user_id: "user-1",
        user_name: "Shaun",
      }),
    ).toEqual({
      accountLabel: "OOMOL · Shaun",
      authenticated: true,
      connection: "connected",
      profile: "ding-corp:user-1",
    })
  })

  test("distinguishes expired and disconnected credentials", () => {
    expect(parseDingTalkAuthStatus({ authenticated: false, reason: "token_refresh_failed" }).connection).toBe("expired")
    expect(parseDingTalkAuthStatus({ authenticated: false, message: "未登录" }).connection).toBe("disconnected")
  })

  test("accepts only the official OAuth authorization page", () => {
    const official = "https://login.dingtalk.com/oauth2/auth?client_id=abc&redirect_uri=http%3A%2F%2F127.0.0.1"
    expect(extractOfficialDingTalkAuthorizationUrl(`open ${official}\n`)).toBe(official)
    expect(extractOfficialDingTalkAuthorizationUrl("https://login.dingtalk.com.evil.example/oauth2/auth")).toBeNull()
    expect(extractOfficialDingTalkAuthorizationUrl("http://login.dingtalk.com/oauth2/auth")).toBeNull()
    expect(extractOfficialDingTalkAuthorizationUrl("https://login.dingtalk.com/oauth2/logout")).toBeNull()
  })

  test("redacts authorization URLs and credentials", () => {
    const message = redactDingTalkCliError(
      "open https://login.dingtalk.com/oauth2/auth?code=secret access_token=secret",
      1,
      null,
    )
    expect(message).not.toContain("login.dingtalk.com")
    expect(message).not.toContain("access_token=secret")
    expect(message).toContain("[authorization-url]")
    expect(message).toContain("exit 1")
  })
})

describe.runIf(process.platform !== "win32")("DingTalk CLI lifecycle", () => {
  test("opens official authorization and logs out only the exact active profile", async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), "wanta-dingtalk-cli-"))
    try {
      const binaryPath = path.join(base, "dws")
      const rootDir = path.join(base, "private-runtime")
      const skillsDir = path.join(base, "skills")
      await mkdir(path.join(skillsDir, "dws"), { recursive: true })
      await writeFile(path.join(skillsDir, "dws", "SKILL.md"), "---\nname: dws\n---\n", "utf-8")
      await writeFile(
        binaryPath,
        `#!/bin/sh
if [ "$1" = "version" ]; then echo '{"version":"v1.0.55"}'; exit 0; fi
if [ "$1" = "auth" ] && [ "$2" = "status" ]; then
  if [ -f "$DWS_CONFIG_DIR/authorized" ]; then
    echo '{"authenticated":true,"corp_id":"ding-corp","corp_name":"OOMOL","user_id":"user-1","user_name":"Shaun"}'
  else
    echo '{"authenticated":false,"message":"not logged in"}'
  fi
  exit 0
fi
if [ "$1" = "auth" ] && [ "$2" = "login" ]; then
  printf 'https://login.dingtalk.com/oauth2/auth?client_id=test&redirect_uri=http%%3A%%2F%%2F127.0.0.1'
  sleep 0.05
  mkdir -p "$DWS_CONFIG_DIR"
  touch "$DWS_CONFIG_DIR/authorized"
  echo '{"success":true}'
  exit 0
fi
if [ "$1" = "auth" ] && [ "$2" = "logout" ]; then
  echo "$3 $4" > "$DWS_CONFIG_DIR/logout-args"
  rm -f "$DWS_CONFIG_DIR/authorized"
  exit 0
fi
exit 1
`,
        "utf-8",
      )
      await chmod(binaryPath, 0o755)
      const opened: string[] = []
      const manager = new DingTalkCliManager({
        binaryPath,
        openExternalUrl: (url) => opened.push(url),
        rootDir,
        skillsDir,
      })

      const connected = await manager.connect()
      expect(connected).toMatchObject({
        accountLabel: "OOMOL · Shaun",
        connection: "connected",
        phase: "idle",
      })
      expect(opened).toHaveLength(1)
      expect(opened[0]).toContain("https://login.dingtalk.com/oauth2/auth")

      const disconnected = await manager.disconnect()
      expect(disconnected.connection).toBe("disconnected")
      await expect(readFile(path.join(rootDir, "config", "logout-args"), "utf-8")).resolves.toBe(
        "--profile ding-corp:user-1\n",
      )
    } finally {
      await rm(base, { force: true, recursive: true })
    }
  })
})
