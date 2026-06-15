import type { ChatMessage } from "./common.ts"
import type { StoppedGenerations } from "./stopped-generations.ts"

import assert from "node:assert/strict"
import { mkdtemp } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { test } from "vitest"
import { applyStoppedGenerations, recordStoppedGeneration, StoppedGenerationStore } from "./stopped-generations.ts"

function assistantMessage(): ChatMessage {
  return {
    id: "assistant-1",
    role: "assistant",
    createdAt: 1,
    parts: [
      {
        kind: "tool",
        partId: "tool-completed",
        callId: "call-completed",
        tool: "search_actions",
        status: "completed",
        input: {},
      },
      {
        kind: "tool",
        partId: "tool-stopped",
        callId: "call-stopped",
        tool: "call_action",
        status: "error",
        input: {},
        error: "Task failed",
      },
      {
        kind: "tool",
        partId: "tool-other",
        callId: "call-other",
        tool: "inspect_action",
        status: "error",
        input: {},
        error: "Permission denied",
      },
    ],
  }
}

test("applyStoppedGenerations marks only captured tool parts as cancelled", () => {
  const records: StoppedGenerations = new Map()
  recordStoppedGeneration(records, "session-1", "assistant-1", ["tool-stopped"], 100)

  const [message] = applyStoppedGenerations([assistantMessage()], records.get("session-1"))

  assert.equal(message?.parts[0]?.cancelled, undefined)
  assert.equal(message?.parts[1]?.cancelled, true)
  assert.equal(message?.parts[2]?.cancelled, undefined)
})

test("applyStoppedGenerations uses message fallback without cancelling completed tools", () => {
  const records: StoppedGenerations = new Map()
  recordStoppedGeneration(records, "session-1", "assistant-1", [], 100)

  const [message] = applyStoppedGenerations([assistantMessage()], records.get("session-1"))

  assert.equal(message?.parts[0]?.cancelled, undefined)
  assert.equal(message?.parts[1]?.cancelled, true)
  assert.equal(message?.parts[2]?.cancelled, true)
})

test("StoppedGenerationStore persists stopped generation overlays", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lumo-stopped-generations-"))
  const store = new StoppedGenerationStore(root)
  const records: StoppedGenerations = new Map()
  recordStoppedGeneration(records, "session-1", "assistant-1", ["tool-stopped"], 100)

  await store.write(records)

  const restored = await store.read()
  assert.equal(restored.get("session-1")?.get("assistant-1")?.stoppedAt, 100)
  assert.deepEqual([...(restored.get("session-1")?.get("assistant-1")?.partIds ?? [])], ["tool-stopped"])
})
