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

interface MockDingTalkCli {
  authorizationOpened: Promise<void>
  base: string
  manager: DingTalkCliManager
  opened: string[]
  rootDir: string
  states: Array<{ error?: string; phase: string }>
}

async function createMockDingTalkCli(): Promise<MockDingTalkCli> {
  const base = await mkdtemp(path.join(os.tmpdir(), "wanta-dingtalk-cli-"))
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
  if [ -f "$DWS_CONFIG_DIR/invalid-status" ]; then
    echo '{"access_token":"secret"'
  elif [ -f "$DWS_CONFIG_DIR/expired" ]; then
    echo '{"authenticated":false,"reason":"token_refresh_failed"}'
  elif [ -f "$DWS_CONFIG_DIR/missing-profile" ]; then
    echo '{"authenticated":true,"corp_name":"OOMOL","user_name":"Shaun"}'
  elif [ -f "$DWS_CONFIG_DIR/authorized" ]; then
    echo '{"authenticated":true,"corp_id":"ding-corp","corp_name":"OOMOL","user_id":"user-1","user_name":"Shaun"}'
  else
    echo '{"authenticated":false,"message":"not logged in"}'
  fi
  exit 0
fi
if [ "$1" = "auth" ] && [ "$2" = "login" ]; then
  printf 'https://login.dingtalk.com/oauth2/auth?client_id=test&redirect_uri=http%%3A%%2F%%2F127.0.0.1'
  while [ -f "$DWS_CONFIG_DIR/pause-login" ]; do :; done
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
  let resolveAuthorizationOpened: (() => void) | undefined
  const authorizationOpened = new Promise<void>((resolve) => {
    resolveAuthorizationOpened = resolve
  })
  const states: MockDingTalkCli["states"] = []
  const manager = new DingTalkCliManager({
    binaryPath,
    openExternalUrl: (url) => {
      opened.push(url)
      resolveAuthorizationOpened?.()
    },
    rootDir,
    skillsDir,
  })
  manager.stateChanged.on((state) => states.push({ error: state.error, phase: state.phase }))
  return { authorizationOpened, base, manager, opened, rootDir, states }
}

function waitForAuthorization(opened: Promise<void>, connection: Promise<unknown>): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("DingTalk authorization URL did not open in time.")), 1_000)
    const fail = (error: unknown) => {
      clearTimeout(timeout)
      reject(error)
    }
    void opened.then(() => {
      clearTimeout(timeout)
      resolve()
    }, fail)
    void connection.catch(fail)
  })
}

describe.runIf(process.platform !== "win32")("DingTalk CLI lifecycle", () => {
  test("opens official authorization and logs out only the exact active profile", async () => {
    const fixture = await createMockDingTalkCli()
    try {
      const connected = await fixture.manager.connect()

      expect(connected).toMatchObject({
        accountLabel: "OOMOL · Shaun",
        connection: "connected",
        phase: "idle",
      })
      expect(fixture.opened).toHaveLength(1)
      expect(fixture.opened[0]).toContain("https://login.dingtalk.com/oauth2/auth")

      const disconnected = await fixture.manager.disconnect()
      expect(disconnected.connection).toBe("disconnected")
      await expect(readFile(path.join(fixture.rootDir, "config", "logout-args"), "utf-8")).resolves.toBe(
        "--profile ding-corp:user-1\n",
      )
    } finally {
      await rm(fixture.base, { force: true, recursive: true })
    }
  })

  test("cancels authorization without leaving an error state", async () => {
    const fixture = await createMockDingTalkCli()
    try {
      await mkdir(path.join(fixture.rootDir, "config"), { recursive: true })
      await writeFile(path.join(fixture.rootDir, "config", "pause-login"), "1", "utf-8")
      const connection = fixture.manager.connect()
      await waitForAuthorization(fixture.authorizationOpened, connection)

      fixture.manager.cancelConnection()

      await expect(connection).rejects.toThrow()
      expect(fixture.states.at(-1)).toEqual({ error: undefined, phase: "idle" })
    } finally {
      await rm(fixture.base, { force: true, recursive: true })
    }
  })

  test("reports expired credentials while keeping the runtime available", async () => {
    const fixture = await createMockDingTalkCli()
    try {
      await mkdir(path.join(fixture.rootDir, "config"), { recursive: true })
      await writeFile(path.join(fixture.rootDir, "config", "expired"), "1", "utf-8")

      await expect(fixture.manager.getState()).resolves.toMatchObject({ available: true, connection: "expired" })
    } finally {
      await rm(fixture.base, { force: true, recursive: true })
    }
  })

  test("refuses an unscoped logout when the account identity is incomplete", async () => {
    const fixture = await createMockDingTalkCli()
    try {
      await mkdir(path.join(fixture.rootDir, "config"), { recursive: true })
      await writeFile(path.join(fixture.rootDir, "config", "missing-profile"), "1", "utf-8")

      await expect(fixture.manager.disconnect()).rejects.toThrow("exact account identity")
      await expect(readFile(path.join(fixture.rootDir, "config", "logout-args"), "utf-8")).rejects.toThrow()
    } finally {
      await rm(fixture.base, { force: true, recursive: true })
    }
  })

  test("does not expose invalid CLI JSON through state errors", async () => {
    const fixture = await createMockDingTalkCli()
    try {
      await mkdir(path.join(fixture.rootDir, "config"), { recursive: true })
      await writeFile(path.join(fixture.rootDir, "config", "invalid-status"), "1", "utf-8")

      const state = await fixture.manager.getState()
      expect(state.error).toBe("DingTalk CLI returned output that is not valid JSON.")
      expect(state.error).not.toContain("secret")
    } finally {
      await rm(fixture.base, { force: true, recursive: true })
    }
  })
})
