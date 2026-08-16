import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, test } from "vitest"
import { ExternalSessionStore } from "./external-store.ts"

const temporaryDirectories: string[] = []
const knownId = "wanta-ext:codex:123e4567-e89b-12d3-a456-426614174000"
const unknownId = "wanta-ext:future-agent:123e4567-e89b-12d3-a456-426614174001"

async function createStore(): Promise<{ directory: string; store: ExternalSessionStore }> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "wanta-external-store-"))
  temporaryDirectories.push(directory)
  return { directory, store: new ExternalSessionStore(directory) }
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

test("v1 records migrate their provider identity from the session id", async () => {
  const { directory, store } = await createStore()
  await writeFile(
    path.join(directory, "external-sessions.json"),
    JSON.stringify({
      version: 1,
      sessions: {
        [knownId]: { title: "Codex", createdAt: 1, updatedAt: 2 },
      },
    }),
  )

  const records = await store.read()
  assert.equal(records.get(knownId)?.agentKind, "codex")
  await store.write(records)
  const persisted = JSON.parse(await readFile(path.join(directory, "external-sessions.json"), "utf8")) as {
    version: number
    sessions: Record<string, { agentKind?: string }>
  }
  assert.equal(persisted.version, 2)
  assert.equal(persisted.sessions[knownId]?.agentKind, "codex")
})

test("unknown providers survive read and unrelated write cycles", async () => {
  const { directory, store } = await createStore()
  await writeFile(
    path.join(directory, "external-sessions.json"),
    JSON.stringify({
      version: 2,
      sessions: {
        [unknownId]: { agentKind: "future-agent", title: "Future", createdAt: 3, updatedAt: 4 },
      },
    }),
  )

  const records = await store.read()
  assert.equal(records.get(unknownId)?.agentKind, "future-agent")
  records.set(knownId, { id: knownId, agentKind: "codex", title: "Codex", createdAt: 5, updatedAt: 5 })
  await store.write(records)
  const restored = await store.read()
  assert.equal(restored.get(unknownId)?.title, "Future")
  assert.equal(restored.get(knownId)?.agentKind, "codex")
})
