import assert from "node:assert/strict"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, test } from "vitest"
import { initializeWorktreeUserData, resolveCanonicalUserDataDir } from "./dev-worktree.ts"

const originalSourceDir = process.env["WANTA_DEV_AUTH_SOURCE_DIR"]

afterEach(() => {
  if (originalSourceDir === undefined) {
    delete process.env["WANTA_DEV_AUTH_SOURCE_DIR"]
  } else {
    process.env["WANTA_DEV_AUTH_SOURCE_DIR"] = originalSourceDir
  }
})

describe("dev worktree userData initialization", () => {
  test("uses explicit canonical source override", async () => {
    process.env["WANTA_DEV_AUTH_SOURCE_DIR"] = "/tmp/canonical-wanta"

    assert.equal(await resolveCanonicalUserDataDir("/tmp/worktree"), "/tmp/canonical-wanta")
  })

  test("copies canonical userData only when target is missing or empty", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "wanta-worktree-init-"))
    const source = path.join(root, "repo", "wanta")
    const target = path.join(root, "worktree", "wanta")
    process.env["WANTA_DEV_AUTH_SOURCE_DIR"] = source
    await mkdir(source, { recursive: true })
    await writeFile(path.join(source, "settings.json"), "source-settings")

    assert.equal(await initializeWorktreeUserData(configFor(target)), "copied")
    assert.equal(await readFile(path.join(target, "settings.json"), "utf-8"), "source-settings")

    await writeFile(path.join(target, "settings.json"), "target-settings")
    assert.equal(await initializeWorktreeUserData(configFor(target)), "kept")
    assert.equal(await readFile(path.join(target, "settings.json"), "utf-8"), "target-settings")

    await rm(root, { force: true, recursive: true })
  })

  test("starts clean when canonical source is missing or empty", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "wanta-worktree-empty-"))
    const source = path.join(root, "repo", "wanta")
    const target = path.join(root, "worktree", "wanta")
    process.env["WANTA_DEV_AUTH_SOURCE_DIR"] = source

    assert.equal(await initializeWorktreeUserData(configFor(target)), "empty-source")
    await mkdir(source, { recursive: true })
    assert.equal(await initializeWorktreeUserData(configFor(target)), "empty-source")

    await rm(root, { force: true, recursive: true })
  })
})

function configFor(userDataDir: string) {
  return {
    devServerPort: 6000,
    env: {
      WANTA_DEV_SERVER_PORT: "6000",
      WANTA_SKIP_PROTOCOL_REGISTRATION: "1",
      WANTA_USER_DATA_DIR: userDataDir,
    },
    generatedAt: "2026-01-01T00:00:00.000Z",
    repoRoot: path.dirname(userDataDir),
    userDataDir,
  }
}
