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

test("groupSidebarSessions keeps project sessions out of task groups", () => {
  const groups = groupSidebarSessions([
    session("task", 1_000),
    session("project", 2_000, { projectId: "project-a" }),
    session("project-pin", 3_000, { pinnedAt: 4_000, projectId: "project-a" }),
  ])

  assert.deepEqual(
    groups.pinned.map((item) => item.id),
    [],
  )
  assert.deepEqual(
    groups.regular.map((item) => item.id),
    ["task"],
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
