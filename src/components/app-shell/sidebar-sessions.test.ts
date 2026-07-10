import type { SessionInfo } from "../../../electron/session/common.ts"

import assert from "node:assert/strict"
import { test } from "vitest"
import { groupSidebarSessions, nextActiveSessionIdAfterArchive, projectHasRunningSession } from "./sidebar-sessions.ts"

function session(id: string, updatedAt: number, extras: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id,
    title: id,
    createdAt: updatedAt,
    updatedAt,
    ...extras,
  }
}

test("groupSidebarSessions shows pinned sessions before regular sessions", () => {
  const groups = groupSidebarSessions([
    session("regular", 3_000),
    session("old-pin", 1_000, { pinnedAt: 4_000 }),
    session("new-pin", 2_000, { pinnedAt: 5_000 }),
  ])

  assert.deepEqual(
    groups.pinned.map((item) => item.id),
    ["new-pin", "old-pin"],
  )
  assert.deepEqual(
    groups.regular.map((item) => item.id),
    ["regular"],
  )
})

test("groupSidebarSessions keeps idle sessions in creation order when updatedAt changes", () => {
  const groups = groupSidebarSessions([
    session("viewed", 5_000, { createdAt: 1_000 }),
    session("newer", 2_000, { createdAt: 2_000 }),
  ])

  assert.deepEqual(
    groups.regular.map((item) => item.id),
    ["newer", "viewed"],
  )
})

test("groupSidebarSessions orders running regular sessions by run start", () => {
  const groups = groupSidebarSessions(
    [session("idle-new", 5_000), session("running-old", 1_000), session("running-new", 2_000)],
    {
      getSessionRunStartedAt: (id) => (id === "running-new" ? 4_000 : id === "running-old" ? 3_000 : null),
      isSessionRunning: (id) => id.startsWith("running"),
    },
  )

  assert.deepEqual(
    groups.regular.map((item) => item.id),
    ["running-new", "running-old", "idle-new"],
  )
})

test("groupSidebarSessions keeps pinned order unless a pinned session is running", () => {
  const groups = groupSidebarSessions(
    [session("newer-pin", 1_000, { pinnedAt: 5_000 }), session("running-pin", 2_000, { pinnedAt: 4_000 })],
    {
      getSessionRunStartedAt: (id) => (id === "running-pin" ? 6_000 : null),
      isSessionRunning: (id) => id === "running-pin",
    },
  )

  assert.deepEqual(
    groups.pinned.map((item) => item.id),
    ["running-pin", "newer-pin"],
  )
})

test("groupSidebarSessions excludes archived sessions", () => {
  const groups = groupSidebarSessions([
    session("archived-pin", 1_000, { archivedAt: 6_000, pinnedAt: 5_000 }),
    session("archived", 2_000, { archivedAt: 6_000 }),
    session("active", 3_000),
  ])

  assert.deepEqual(
    groups.pinned.map((item) => item.id),
    [],
  )
  assert.deepEqual(
    groups.regular.map((item) => item.id),
    ["active"],
  )
})

test("nextActiveSessionIdAfterArchive picks the next visible session", () => {
  assert.equal(nextActiveSessionIdAfterArchive([session("first", 3_000), session("second", 2_000)], "first"), "second")
  assert.equal(nextActiveSessionIdAfterArchive([session("only", 1_000)], "only"), null)
})

test("projectHasRunningSession includes pinned project sessions", () => {
  const sessions = [
    session("other", 1_000, { projectId: "project-b" }),
    session("pinned", 2_000, { pinnedAt: 3_000, projectId: "project-a" }),
  ]

  assert.equal(
    projectHasRunningSession("project-a", sessions, (id) => id === "pinned"),
    true,
  )
})

test("projectHasRunningSession ignores archived sessions", () => {
  const sessions = [session("archived", 1_000, { archivedAt: 2_000, projectId: "project-a" })]

  assert.equal(
    projectHasRunningSession("project-a", sessions, (id) => id === "archived"),
    false,
  )
})
