import assert from "node:assert/strict"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, test } from "vitest"
import { chromiumTimeToUnixMs, formatExpiry, inspectAuthState, resolveDevUserDataDir } from "./dev-auth-state.ts"

describe("dev auth state helpers", () => {
  test("resolveDevUserDataDir uses bootstrap userData", async () => {
    const userDataDir = await resolveDevUserDataDir({
      userDataDir: "/tmp/repo/wanta",
    })

    assert.equal(userDataDir, "/tmp/repo/wanta")
  })

  test("resolveDevUserDataDir accepts env-only bootstrap config", async () => {
    const userDataDir = await resolveDevUserDataDir({
      env: {
        WANTA_USER_DATA_DIR: "/tmp/worktree-user-data",
      },
    })

    assert.equal(userDataDir, "/tmp/worktree-user-data")
  })

  test("inspectAuthState requires both profile and oomol-token cookie marker", async () => {
    const dir = await makeTempDir()
    await writeFile(
      path.join(dir, "auth.json"),
      `${JSON.stringify({
        accounts: [{ id: "u1", name: "User" }],
        currentId: "u1",
      })}\n`,
    )
    await mkdir(path.join(dir, "Default", "Network"), { recursive: true })

    assert.deepEqual(await inspectAuthState(dir), {
      hasOomolCookie: false,
      hasProfile: true,
      isLoggedIn: false,
    })

    await writeFile(path.join(dir, "Default", "Network", "Cookies"), "sqlite bytes oomol-token redacted")

    assert.deepEqual(await inspectAuthState(dir), {
      hasOomolCookie: true,
      hasProfile: true,
      isLoggedIn: true,
    })
  })

  test("inspectAuthState treats mismatched current profile as missing", async () => {
    const dir = await makeTempDir()
    await writeFile(
      path.join(dir, "auth.json"),
      `${JSON.stringify({
        accounts: [{ id: "u1", name: "User" }],
        currentId: "u2",
      })}\n`,
    )
    await writeFile(path.join(dir, "Cookies"), "oomol-token")

    assert.deepEqual(await inspectAuthState(dir), {
      hasOomolCookie: true,
      hasProfile: false,
      isLoggedIn: false,
    })
  })

  test("chromiumTimeToUnixMs converts Chromium cookie timestamps", () => {
    assert.equal(new Date(chromiumTimeToUnixMs("13430723115000000")).toISOString(), "2026-08-09T04:25:15.000Z")
  })

  test("formatExpiry shows expiry and remaining days", () => {
    assert.equal(
      formatExpiry(Date.UTC(2026, 7, 9, 4, 25, 15), Date.UTC(2026, 7, 8, 4, 25, 15)),
      "2026-08-09T04:25:15.000Z (1.0 days remaining)",
    )
    assert.equal(formatExpiry(undefined), "unknown")
  })
})

async function makeTempDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "wanta-auth-state-test-"))
}
