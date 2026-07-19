import assert from "node:assert/strict"
import { mkdtemp, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { test } from "vitest"
import { SessionProjectStore } from "./project-store.ts"

test("SessionProjectStore persists local projects", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "wanta-session-projects-"))
  const store = new SessionProjectStore(dir)
  const projects = new Map([
    [
      "project-a",
      {
        id: "project-a",
        name: "wanta",
        path: "/Users/example/code/wanta",
        createdAt: 1_000,
        updatedAt: 2_000,
        scope: { teamId: "team-id", teamName: "team-name" },
        pinnedAt: 3_000,
      },
    ],
  ])

  await store.write(projects)

  assert.deepEqual(await store.read(), projects)
})

test("SessionProjectStore supports concurrent writes", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "wanta-session-projects-"))
  const store = new SessionProjectStore(dir)

  await Promise.all([
    store.write(
      new Map([
        [
          "project-a",
          {
            id: "project-a",
            name: "A",
            path: "/tmp/a",
            createdAt: 1_000,
            updatedAt: 1_000,
          },
        ],
      ]),
    ),
    store.write(
      new Map([
        [
          "project-b",
          {
            id: "project-b",
            name: "B",
            path: "/tmp/b",
            createdAt: 2_000,
            updatedAt: 2_000,
          },
        ],
      ]),
    ),
  ])

  assert.equal((await store.read()).size, 1)
})

test("SessionProjectStore migrates legacy organization scope fields", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "wanta-session-projects-"))
  await writeFile(
    path.join(dir, "session-projects.json"),
    JSON.stringify({
      version: 1,
      projects: {
        legacy: {
          name: "Legacy",
          path: "/tmp/legacy",
          createdAt: 1_000,
          updatedAt: 2_000,
          scope: { organizationId: "team-id", organizationName: "team-name" },
        },
      },
    }),
    "utf-8",
  )

  const project = (await new SessionProjectStore(dir).read()).get("legacy")
  assert.deepEqual(project?.scope, { teamId: "team-id", teamName: "team-name" })
})
