import type { SessionInfo } from "../../electron/session/common.ts"

import assert from "node:assert/strict"
import { test } from "vitest"
import { applySessionActivity, mergeSessionsWithLocalCreated, resolveKnowledgeBaseIdsUpdate } from "./useSessions.ts"

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

test("resolveKnowledgeBaseIdsUpdate composes rapid knowledge-base toggles from the latest intent", () => {
  const addFirst = resolveKnowledgeBaseIdsUpdate([], (current) => [...current, "first"])
  const addSecond = resolveKnowledgeBaseIdsUpdate(addFirst, (current) => [...current, "second"])

  assert.deepEqual(addSecond, ["first", "second"])
})

test("resolveKnowledgeBaseIdsUpdate normalizes duplicate and blank ids", () => {
  assert.deepEqual(resolveKnowledgeBaseIdsUpdate(["existing"], [" existing ", "", "new", "new"]), ["existing", "new"])
})

test("applySessionActivity updates a known session without replacing unrelated sessions", () => {
  const first: SessionInfo = { id: "first", title: "First", createdAt: 1_000, updatedAt: 1_000 }
  const second: SessionInfo = { id: "second", title: "Second", createdAt: 2_000, updatedAt: 2_000 }

  const updated = applySessionActivity([first, second], {
    activity: { sessionId: "first", usedAt: 3_000 },
    reason: "record session use",
  })

  assert.equal(updated[0]?.updatedAt, 3_000)
  assert.equal(updated[1], second)
})

test("applySessionActivity ignores unknown and stale activity updates", () => {
  const session: SessionInfo = { id: "session", title: "Session", createdAt: 1_000, updatedAt: 2_000 }

  assert.equal(
    applySessionActivity([session], {
      activity: { sessionId: "unknown", usedAt: 3_000 },
      reason: "record session use",
    })[0],
    session,
  )
  assert.equal(
    applySessionActivity([session], {
      activity: { sessionId: "session", usedAt: 1_500 },
      reason: "record session use",
    })[0],
    session,
  )
})
