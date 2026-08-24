import { mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, test } from "vitest"
import { ExternalOoScopeStore } from "./oo-scope-store.ts"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

describe("ExternalOoScopeStore", () => {
  test("tracks only running external turns and their teams", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "wanta-external-oo-scope-"))
    roots.push(root)
    const filePath = path.join(root, "scope.json")
    const store = new ExternalOoScopeStore(filePath)

    await store.activate("session-a", "oomol", "Team A")
    await store.activate("session-b", "oomol", "Team A")
    expect(JSON.parse(await readFile(filePath, "utf8"))).toEqual({
      external: true,
      runtime: "oomol",
      sessionTeams: { "session-a": "Team A", "session-b": "Team A" },
    })

    await store.deactivate("session-a")
    expect(JSON.parse(await readFile(filePath, "utf8"))).toMatchObject({ sessionTeams: { "session-b": "Team A" } })
  })

  test("clears stale turn identities when the runtime changes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "wanta-external-oo-scope-"))
    roots.push(root)
    const filePath = path.join(root, "scope.json")
    const store = new ExternalOoScopeStore(filePath)

    await store.activate("session-a", "oomol", "Team A")
    await store.setRuntime("openconnector")

    expect(JSON.parse(await readFile(filePath, "utf8"))).toEqual({
      external: true,
      runtime: "openconnector",
      sessionTeams: {},
    })
  })
})
