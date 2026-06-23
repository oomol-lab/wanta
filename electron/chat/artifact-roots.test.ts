import type { ChatMessage } from "./common.ts"

import assert from "node:assert/strict"
import { mkdtemp } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { test } from "vitest"
import { applyArtifactRoots, ArtifactRootStore, recordArtifactRoot } from "./artifact-roots.ts"

function assistant(id: string, artifactRoot?: string): ChatMessage {
  return {
    id,
    role: "assistant",
    createdAt: 1,
    parts: [],
    ...(artifactRoot ? { artifactRoot } : {}),
  }
}

function user(id: string): ChatMessage {
  return {
    id,
    role: "user",
    createdAt: 1,
    parts: [],
  }
}

test("recordArtifactRoot stores message artifact roots by session", () => {
  const records = new Map<string, Map<string, string>>()

  assert.equal(recordArtifactRoot(records, "session-1", "message-1", "/tmp/artifacts/turn-1"), true)
  assert.equal(recordArtifactRoot(records, "session-1", "message-1", "/tmp/artifacts/turn-1"), false)
  assert.equal(records.get("session-1")?.get("message-1"), "/tmp/artifacts/turn-1")
})

test("applyArtifactRoots overlays roots onto assistant messages only", () => {
  const records = new Map([["assistant-1", "/tmp/artifacts/turn-1"]])
  const messages = [user("user-1"), assistant("assistant-1"), assistant("assistant-2", "/tmp/existing")]

  const next = applyArtifactRoots(messages, records)

  assert.equal(next[0]?.artifactRoot, undefined)
  assert.equal(next[1]?.artifactRoot, "/tmp/artifacts/turn-1")
  assert.equal(next[2]?.artifactRoot, "/tmp/existing")
})

test("ArtifactRootStore round trips persisted artifact roots", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wanta-artifact-roots-"))
  const store = new ArtifactRootStore(root)
  const records = new Map([["session-1", new Map([["message-1", "/tmp/artifacts/turn-1"]])]])

  await store.write(records)

  const next = await store.read()
  assert.equal(next.get("session-1")?.get("message-1"), "/tmp/artifacts/turn-1")
})
