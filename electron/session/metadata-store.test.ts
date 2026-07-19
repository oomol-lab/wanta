import type { SessionMetadata } from "./metadata-store.ts"

import assert from "node:assert/strict"
import { mkdtemp, readdir, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { test } from "vitest"
import { normalizeSessionScopeValue } from "./common.ts"
import { SessionMetadataStore } from "./metadata-store.ts"

test("SessionMetadataStore persists scope, permission mode, knowledge, pinned, and archived metadata", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "wanta-session-metadata-"))
  const store = new SessionMetadataStore(dir)
  const metadata = new Map<string, SessionMetadata>([
    ["pinned", { pinnedAt: 1_000, scope: { teamId: "team-id", teamName: "team-name" } }],
    ["archived", { archivedAt: 2_000 }],
    ["full-access", { permissionMode: "full_access" }],
    ["knowledge", { knowledgeBaseIds: ["journey-to-the-west", "characters"] }],
    ["team", { scope: { teamId: "team-id", teamName: "team-name" } }],
  ])

  await store.write(metadata)

  assert.deepEqual(await store.read(), metadata)
})

test("SessionMetadataStore supports concurrent writes", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "wanta-session-metadata-"))
  const store = new SessionMetadataStore(dir)

  await Promise.all([
    store.write(new Map([["pinned", { pinnedAt: 1_000 }]])),
    store.write(new Map([["archived", { archivedAt: 2_000 }]])),
  ])

  assert.equal((await store.read()).size, 1)
  assert.deepEqual(
    (await readdir(dir)).filter((file) => file.includes(".tmp-")),
    [],
  )
})

test("SessionMetadataStore ignores corrupted team scope fields", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "wanta-session-metadata-"))
  await writeFile(
    path.join(dir, "session-metadata.json"),
    JSON.stringify({
      version: 2,
      sessions: {
        valid: {
          pinnedAt: 1_000,
          scope: { teamId: "team-id", teamName: "team-name" },
        },
        corrupted: { archivedAt: 2_000, scope: { teamId: 123, teamName: {} } },
        invalidPermission: { permissionMode: "root" },
        normalizedKnowledge: { knowledgeBaseIds: [" first ", "first", "", 123, "second"] },
      },
    }),
    "utf-8",
  )

  const store = new SessionMetadataStore(dir)

  assert.deepEqual(
    await store.read(),
    new Map<string, SessionMetadata>([
      ["valid", { pinnedAt: 1_000, scope: { teamId: "team-id", teamName: "team-name" } }],
      ["corrupted", { archivedAt: 2_000 }],
      ["normalizedKnowledge", { knowledgeBaseIds: ["first", "second"] }],
    ]),
  )
})

test("SessionMetadataStore migrates legacy organization scope fields", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "wanta-session-metadata-"))
  await writeFile(
    path.join(dir, "session-metadata.json"),
    JSON.stringify({
      version: 2,
      sessions: { legacy: { scope: { organizationId: "team-id", organizationName: "team-name" } } },
    }),
    "utf-8",
  )

  const store = new SessionMetadataStore(dir)
  assert.deepEqual(await store.read(), new Map([["legacy", { scope: { teamId: "team-id", teamName: "team-name" } }]]))
})

test("normalizeSessionScopeValue never mixes partial current and legacy scope pairs", () => {
  assert.deepEqual(
    normalizeSessionScopeValue({
      organizationId: "legacy-id",
      organizationName: "legacy-name",
      teamId: "current-id",
    }),
    { teamId: "legacy-id", teamName: "legacy-name" },
  )
  assert.deepEqual(
    normalizeSessionScopeValue({
      organizationId: "legacy-id",
      organizationName: "legacy-name",
      teamId: "current-id",
      teamName: "current-name",
    }),
    { teamId: "current-id", teamName: "current-name" },
  )
})
