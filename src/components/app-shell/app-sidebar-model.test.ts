import type { SessionInfo, SessionProject } from "../../../electron/session/common.ts"

import assert from "node:assert/strict"
import { test } from "vitest"
import { buildProjectSidebarGroups, projectSidebarSessionsInRenderOrder } from "./app-sidebar-model.ts"

function project(id: string, updatedAt: number): SessionProject {
  return {
    id,
    name: id,
    path: `/tmp/${id}`,
    createdAt: updatedAt,
    updatedAt,
    scope: { type: "personal" },
  }
}

function session(id: string, projectId: string, updatedAt: number): SessionInfo {
  return {
    id,
    title: id,
    createdAt: updatedAt,
    updatedAt,
    projectId,
  }
}

test("buildProjectSidebarGroups orders running sessions first inside a project", () => {
  const groups = buildProjectSidebarGroups(
    [project("project", 1_000)],
    [session("idle-new", "project", 5_000), session("running", "project", 2_000)],
    {
      getSessionRunStartedAt: (id) => (id === "running" ? 6_000 : null),
      isSessionRunning: (id) => id === "running",
    },
  )

  assert.deepEqual(
    groups[0]?.sessions.map((item) => item.id),
    ["running", "idle-new"],
  )
})

test("buildProjectSidebarGroups keeps idle child order stable when updatedAt changes", () => {
  const groups = buildProjectSidebarGroups(
    [project("project", 1_000)],
    [
      { ...session("viewed", "project", 5_000), createdAt: 1_000 },
      { ...session("newer", "project", 2_000), createdAt: 2_000 },
    ],
  )

  assert.deepEqual(
    groups[0]?.sessions.map((item) => item.id),
    ["newer", "viewed"],
  )
})

test("buildProjectSidebarGroups keeps the selected hidden child visible", () => {
  const groups = buildProjectSidebarGroups(
    [project("project", 1_000)],
    [
      session("sixth", "project", 1_000),
      session("fifth", "project", 2_000),
      session("fourth", "project", 3_000),
      session("third", "project", 4_000),
      session("second", "project", 5_000),
      session("first", "project", 6_000),
    ],
    {},
    { selectedSessionId: "sixth" },
  )

  assert.deepEqual(
    groups[0]?.sessions.map((item) => item.id),
    ["first", "second", "third", "fourth", "fifth", "sixth"],
  )
  assert.equal(groups[0]?.hiddenCount, 0)
})

test("buildProjectSidebarGroups keeps project order while a child session is running", () => {
  const groups = buildProjectSidebarGroups(
    [project("idle-project", 9_000), project("running-project", 1_000)],
    [session("idle", "idle-project", 9_000), session("running", "running-project", 2_000)],
    {
      getSessionRunStartedAt: (id) => (id === "running" ? 10_000 : null),
      isSessionRunning: (id) => id === "running",
    },
  )

  assert.deepEqual(
    groups.map((group) => group.project.id),
    ["idle-project", "running-project"],
  )
})

test("projectSidebarSessionsInRenderOrder mirrors the project sidebar sections", () => {
  const pinnedGroup = {
    hiddenCount: 0,
    project: { ...project("pinned-project", 3_000), pinnedAt: 4_000 },
    sessions: [session("pinned-child", "pinned-project", 3_000)],
  }
  const regularGroup = {
    hiddenCount: 0,
    project: project("regular-project", 2_000),
    sessions: [session("regular-child", "regular-project", 2_000)],
  }
  const pinnedSession = session("pinned-session", "regular-project", 1_000)

  assert.deepEqual(
    projectSidebarSessionsInRenderOrder({
      pinnedGroups: [pinnedGroup],
      pinnedSessions: [pinnedSession],
      regularGroups: [regularGroup],
    }).map((item) => item.id),
    ["pinned-child", "pinned-session", "regular-child"],
  )
})
