import assert from "node:assert/strict"
import { mkdtemp, readdir } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { test } from "vitest"
import { SessionActivityStore } from "./activity-store.ts"

test("SessionActivityStore persists recent session activity", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "lumo-session-activity-"))
  const store = new SessionActivityStore(dir)
  const activity = new Map([
    ["session-a", 1_000],
    ["session-b", 2_000],
  ])

  await store.write(activity)

  assert.deepEqual(await store.read(), activity)
})

test("SessionActivityStore supports concurrent writes", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "lumo-session-activity-"))
  const store = new SessionActivityStore(dir)

  await Promise.all([store.write(new Map([["session-a", 1_000]])), store.write(new Map([["session-b", 2_000]]))])

  assert.equal((await store.read()).size, 1)
  assert.deepEqual(
    (await readdir(dir)).filter((file) => file.includes(".tmp-")),
    [],
  )
})
