import type { SessionProject } from "../session/common.ts"

import assert from "node:assert/strict"
import { test } from "vitest"
import { GitServiceImpl } from "./node.ts"

function projectStore(projects: SessionProject[]): { read: () => Promise<Map<string, SessionProject>> } {
  return {
    read: async () => new Map(projects.map((project) => [project.id, project])),
  }
}

test("GitServiceImpl rejects repository state for unregistered project paths", async () => {
  const service = new GitServiceImpl({
    projectStore: projectStore([
      {
        id: "project-a",
        name: "A",
        path: "/Users/example/project-a",
        createdAt: 1,
        updatedAt: 1,
      },
    ]),
  })

  const state = await service.getRepositoryState({ projectId: "project-a", path: "/Users/example/other" })

  assert.equal(state.available, false)
  assert.equal(state.error, "path_unavailable")
  assert.equal(state.message, "Project is not registered.")
})

test("GitServiceImpl rejects checkout for archived projects", async () => {
  const service = new GitServiceImpl({
    projectStore: projectStore([
      {
        id: "project-a",
        name: "A",
        path: "/Users/example/project-a",
        createdAt: 1,
        updatedAt: 1,
        archivedAt: 2,
      },
    ]),
  })

  const state = await service.checkoutBranch({
    projectId: "project-a",
    path: "/Users/example/project-a",
    branch: "main",
  })

  assert.equal(state.available, false)
  assert.equal(state.error, "path_unavailable")
  assert.equal(state.message, "Project is not registered.")
})

test("GitServiceImpl rejects branch creation for archived projects", async () => {
  const service = new GitServiceImpl({
    projectStore: projectStore([
      {
        id: "project-a",
        name: "A",
        path: "/Users/example/project-a",
        createdAt: 1,
        updatedAt: 1,
        archivedAt: 2,
      },
    ]),
  })

  const state = await service.createAndCheckoutBranch({
    projectId: "project-a",
    path: "/Users/example/project-a",
    branch: "feature/test",
  })

  assert.equal(state.available, false)
  assert.equal(state.error, "path_unavailable")
  assert.equal(state.message, "Project is not registered.")
})
