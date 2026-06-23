import type { ChatMessage } from "./common.ts"
import type { StoppedGenerations } from "./stopped-generations.ts"

import assert from "node:assert/strict"
import { mkdtemp, readdir } from "node:fs/promises"
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

test("applyStoppedGenerations freezes cancelled running tool timing", () => {
  const records: StoppedGenerations = new Map()
  recordStoppedGeneration(records, "session-1", "assistant-1", ["tool-running"], 2600)
  const messages: ChatMessage[] = [
    {
      id: "assistant-1",
      role: "assistant",
      createdAt: 1,
      parts: [
        {
          kind: "tool",
          partId: "tool-running",
          callId: "call-running",
          tool: "bash",
          status: "running",
          input: {},
          timing: { start: 1000 },
        },
      ],
    },
  ]

  const [message] = applyStoppedGenerations(messages, records.get("session-1"))

  assert.equal(message?.parts[0]?.cancelled, true)
  assert.deepEqual(message?.parts[0]?.timing, { start: 1000, end: 2600 })
})

test("StoppedGenerationStore persists stopped generation overlays", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wanta-stopped-generations-"))
  const store = new StoppedGenerationStore(root)
  const records: StoppedGenerations = new Map()
  recordStoppedGeneration(records, "session-1", "assistant-1", ["tool-stopped"], 100)

  await store.write(records)

  const restored = await store.read()
  assert.equal(restored.get("session-1")?.get("assistant-1")?.stoppedAt, 100)
  assert.deepEqual([...(restored.get("session-1")?.get("assistant-1")?.partIds ?? [])], ["tool-stopped"])
})

test("StoppedGenerationStore supports concurrent writes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wanta-stopped-generations-"))
  const store = new StoppedGenerationStore(root)
  const first: StoppedGenerations = new Map()
  const second: StoppedGenerations = new Map()
  recordStoppedGeneration(first, "session-1", "assistant-1", ["tool-a"], 100)
  recordStoppedGeneration(second, "session-2", "assistant-2", ["tool-b"], 200)

  await Promise.all([store.write(first), store.write(second)])

  const restored = await store.read()
  assert.equal(restored.size, 1)
  assert.deepEqual(
    (await readdir(root)).filter((file) => file.includes(".tmp-")),
    [],
  )
})
