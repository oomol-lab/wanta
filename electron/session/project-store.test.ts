import assert from "node:assert/strict"
import { mkdtemp } from "node:fs/promises"
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
        scope: { type: "organization" as const, organizationId: "org-id", organizationName: "org-name" },
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
