import type { SessionInfo } from "../../../electron/session/common.ts"

import assert from "node:assert/strict"
import { test } from "vitest"
import { groupSidebarSessions, nextActiveSessionIdAfterArchive } from "./sidebar-sessions.ts"

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

test("nextActiveSessionIdAfterArchive picks the next visible session", () => {
  assert.equal(nextActiveSessionIdAfterArchive([session("first", 3_000), session("second", 2_000)], "first"), "second")
  assert.equal(nextActiveSessionIdAfterArchive([session("only", 1_000)], "only"), null)
})
