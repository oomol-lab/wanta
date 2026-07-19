import type { AuthorizationOverlayStore, AuthorizationOverlays } from "./authorization.ts"
import type { AuthorizationInfo } from "./common.ts"
import type { StoppedGenerationStore, StoppedGenerations } from "./stopped-generations.ts"

import assert from "node:assert/strict"
import { expect, it, test, vi } from "vitest"
import { OutputPersistence } from "./output-persistence.ts"

const authorization: AuthorizationInfo = {
  displayName: "Supabase",
  service: "supabase",
}

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
  let authorizationRecords: AuthorizationOverlays = new Map([
    ["session-1", new Map([["message-1", new Map([["part-1", { displayName: "App", service: "app" }]])]])],
  ])
  let stopped: StoppedGenerations = new Map([
    ["session-1", new Map([["message-1", { partIds: new Set(["part-1"]), stoppedAt: 1 }]])],
  ])
  const persistence = new OutputPersistence(
    {
      authorization: {
        read: async () => authorizationRecords,
        write: async (records: AuthorizationOverlays) => {
          authorizationRecords = records
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

  assert.equal(authorizationRecords.has("session-1"), false)
  assert.equal(stopped.has("session-1"), false)
})

it("keeps authorization overlays unchanged when persistence fails", async () => {
  let persisted: AuthorizationOverlays = new Map()
  let failWrite = true
  const store = {
    read: async () => persisted,
    write: async (next: AuthorizationOverlays) => {
      if (failWrite) {
        failWrite = false
        throw new Error("authorization write failed")
      }
      persisted = next
    },
  } as AuthorizationOverlayStore
  const persistence = new OutputPersistence({ authorization: store }, () => undefined)

  await expect(persistence.recordAuthorization("session-1", "message-1", "part-1", authorization)).rejects.toThrow(
    "authorization write failed",
  )
  expect(await persistence.overlaysFor("session-1")).toBeUndefined()

  await persistence.recordAuthorization("session-2", "message-2", "part-2", authorization)

  expect(persisted.has("session-1")).toBe(false)
  expect(persisted.get("session-2")?.get("message-2")?.get("part-2")).toEqual(authorization)
})

it("restores authorization records when stopped-state removal fails", async () => {
  const initialAuthorization: AuthorizationOverlays = new Map([
    ["session-1", new Map([["message-1", new Map([["part-1", authorization]])]])],
  ])
  const initialStopped: StoppedGenerations = new Map([
    ["session-1", new Map([["message-1", { partIds: new Set(["part-1"]), stoppedAt: 1_000 }]])],
  ])
  let persistedAuthorization = initialAuthorization
  let persistedStopped = initialStopped
  let failStoppedWrite = true
  const authorizationStore = {
    read: async () => persistedAuthorization,
    write: async (next: AuthorizationOverlays) => {
      persistedAuthorization = next
    },
  } as AuthorizationOverlayStore
  const stoppedStore = {
    read: async () => persistedStopped,
    write: async (next: StoppedGenerations) => {
      if (failStoppedWrite) {
        failStoppedWrite = false
        throw new Error("stopped write failed")
      }
      persistedStopped = next
    },
  } as StoppedGenerationStore
  const persistence = new OutputPersistence(
    { authorization: authorizationStore, stoppedGeneration: stoppedStore },
    () => undefined,
  )

  await expect(persistence.removeSession("session-1")).rejects.toThrow("stopped write failed")

  expect(await persistence.overlaysFor("session-1")).toBeDefined()
  expect(await persistence.stoppedFor("session-1")).toBeDefined()
  expect(persistedAuthorization.has("session-1")).toBe(true)
  expect(persistedStopped.has("session-1")).toBe(true)
})
