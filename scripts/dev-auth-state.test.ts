import assert from "node:assert/strict"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, test } from "vitest"
import { inspectAuthState, resolveDevAuthPaths } from "./dev-auth-state.ts"

describe("dev auth state helpers", () => {
  test("resolveDevAuthPaths uses bootstrap userData and machine root", () => {
    const paths = resolveDevAuthPaths(
      {
        userDataDir: ".wanta-dev/user-data",
      },
      "/tmp/home",
    )

    assert.equal(paths.machineRoot, "/tmp/home/wanta-dev")
    assert.equal(paths.captureUserDataDir, "/tmp/home/wanta-dev/login-user-data")
    assert.equal(paths.snapshotDir, "/tmp/home/wanta-dev/login-state")
    assert.match(paths.worktreeUserDataDir, /\/\.wanta-dev\/user-data$/)
  })

  test("resolveDevAuthPaths accepts env-only bootstrap config", () => {
    const paths = resolveDevAuthPaths(
      {
        env: {
          WANTA_USER_DATA_DIR: "/tmp/worktree-user-data",
        },
      },
      "/tmp/home",
    )

    assert.equal(paths.worktreeUserDataDir, "/tmp/worktree-user-data")
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
})

async function makeTempDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "wanta-auth-state-test-"))
}
