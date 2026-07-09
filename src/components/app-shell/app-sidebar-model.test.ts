import type { SessionInfo, SessionProject } from "../../../electron/session/common.ts"

import assert from "node:assert/strict"
import { test } from "vitest"
import { buildProjectSidebarGroups } from "./app-sidebar-model.ts"

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

test("buildProjectSidebarGroups orders running projects by run start", () => {
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
    ["running-project", "idle-project"],
  )
})
