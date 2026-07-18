import type { AuthorizationOverlays } from "./authorization.ts"
import type { AuthorizationOverlayStore } from "./authorization.ts"
import type { StoppedGenerations } from "./stopped-generations.ts"
import type { StoppedGenerationStore } from "./stopped-generations.ts"

import assert from "node:assert/strict"
import { test, vi } from "vitest"
import { OutputPersistence } from "./output-persistence.ts"

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((innerResolve) => {
    resolve = innerResolve
  })
  return { promise, resolve }
}

async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (condition()) return
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
  assert.fail("Timed out waiting for persistence mutation")
}

test("concurrent stopped-generation records are serialized without losing a session", async () => {
  const firstWrite = deferred()
  const snapshots: StoppedGenerations[] = []
  const write = vi.fn(async (records: StoppedGenerations) => {
    snapshots.push(records)
    if (snapshots.length === 1) await firstWrite.promise
  })
  const persistence = new OutputPersistence(
    { stoppedGeneration: { read: async () => new Map(), write } as unknown as StoppedGenerationStore },
    () => undefined,
  )

  const first = persistence.recordStopped("session-1", "message-1", ["part-1"], 1)
  const second = persistence.recordStopped("session-2", "message-2", ["part-2"], 2)
  await waitFor(() => snapshots.length === 1)
  assert.equal(write.mock.calls.length, 1)
  firstWrite.resolve()
  await Promise.all([first, second])

  assert.equal(write.mock.calls.length, 2)
  assert.deepEqual([...snapshots[1]!.keys()], ["session-1", "session-2"])
})

test("removeSession deletes authorization and stopped overlays together", async () => {
  let authorization: AuthorizationOverlays = new Map([
    ["session-1", new Map([["message-1", new Map([["part-1", { displayName: "App", service: "app" }]])]])],
  ])
  let stopped: StoppedGenerations = new Map([
    ["session-1", new Map([["message-1", { partIds: new Set(["part-1"]), stoppedAt: 1 }]])],
  ])
  const persistence = new OutputPersistence(
    {
      authorization: {
        read: async () => authorization,
        write: async (records: AuthorizationOverlays) => {
          authorization = records
        },
      } as unknown as AuthorizationOverlayStore,
      stoppedGeneration: {
        read: async () => stopped,
        write: async (records: StoppedGenerations) => {
          stopped = records
        },
      } as unknown as StoppedGenerationStore,
    },
    () => undefined,
  )

  await persistence.removeSession("session-1")

  assert.equal(authorization.has("session-1"), false)
  assert.equal(stopped.has("session-1"), false)
})
