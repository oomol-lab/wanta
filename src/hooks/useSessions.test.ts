import type { SessionInfo } from "../../electron/session/common.ts"

import assert from "node:assert/strict"
import { test } from "vitest"
import { mergeSessionsWithLocalCreated } from "./useSessions.ts"

test("mergeSessionsWithLocalCreated keeps a locally created session while remote list catches up", () => {
  const oldSession: SessionInfo = {
    id: "old",
    title: "Old",
    createdAt: 1_000,
    updatedAt: 1_000,
  }
  const createdSession: SessionInfo = {
    id: "created",
    title: "Created",
    createdAt: 2_000,
    updatedAt: 2_000,
  }

  const merged = mergeSessionsWithLocalCreated([oldSession], [createdSession])

  assert.deepEqual(
    merged.map((session) => session.id),
    ["created", "old"],
  )
})

test("mergeSessionsWithLocalCreated uses the remote session once it is listed", () => {
  const localCreatedSession: SessionInfo = {
    id: "created",
    title: "Local title",
    createdAt: 1_000,
    updatedAt: 1_000,
  }
  const remoteCreatedSession: SessionInfo = {
    id: "created",
    title: "Remote title",
    createdAt: 1_000,
    updatedAt: 3_000,
  }

  const merged = mergeSessionsWithLocalCreated([remoteCreatedSession], [localCreatedSession])

  assert.deepEqual(merged, [remoteCreatedSession])
})
