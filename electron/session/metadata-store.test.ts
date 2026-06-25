import type { SessionMetadata } from "./metadata-store.ts"

import assert from "node:assert/strict"
import { mkdtemp, readdir } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { test } from "vitest"
import { SessionMetadataStore } from "./metadata-store.ts"

test("SessionMetadataStore persists scope, pinned, and archived metadata", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "wanta-session-metadata-"))
  const store = new SessionMetadataStore(dir)
  const metadata = new Map<string, SessionMetadata>([
    ["pinned", { pinnedAt: 1_000, scope: { type: "personal" } }],
    ["archived", { archivedAt: 2_000 }],
    ["organization", { scope: { type: "organization", organizationId: "org-id", organizationName: "org-name" } }],
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
