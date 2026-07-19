import assert from "node:assert/strict"
import { test, vi } from "vitest"
import { ActiveRunRegistry } from "./active-run-registry.ts"

test("permission blocking takes precedence until every blocking request is removed", () => {
  const updates = vi.fn()
  const registry = new ActiveRunRegistry(updates)
  registry.create("session-1", "generation-1", {
    teamId: "team-id",
    teamName: "team-name",
  })

  registry.addBlockingRequest("session-1", "question-1", "awaiting_question")
  registry.addBlockingRequest("session-1", "permission-1", "awaiting_permission")
  registry.update("session-1", { phase: "answering" })
  assert.equal(registry.get("session-1")?.phase, "awaiting_permission")

  registry.removeBlockingRequest("session-1", "permission-1")
  assert.equal(registry.get("session-1")?.phase, "awaiting_question")
  registry.removeBlockingRequest("session-1", "question-1")
  assert.equal(registry.get("session-1")?.phase, "thinking")
})

test("late cleanup cannot delete a replacement active run", () => {
  const registry = new ActiveRunRegistry(() => undefined)
  registry.create("session-1", "generation-1", {
    teamId: "team-id",
    teamName: "team-name",
  })
  registry.create("session-1", "generation-2", {
    teamId: "team-id",
    teamName: "team-name",
  })

  registry.delete("session-1", "generation-1")
  assert.equal(registry.get("session-1")?.generationId, "generation-2")
})

test("assistant events advance active run presentation phases", () => {
  const registry = new ActiveRunRegistry(() => undefined)
  registry.create("session-1", "generation-1", {
    teamId: "team-id",
    teamName: "team-name",
  })
  registry.applyEvent({
    event: "messageDelta",
    data: { delta: "hello", messageId: "message-1", partId: "part-1", sessionId: "session-1", text: "hello" },
  })

  assert.equal(registry.get("session-1")?.activeAssistantMessageId, "message-1")
  assert.equal(registry.get("session-1")?.phase, "answering")
})
