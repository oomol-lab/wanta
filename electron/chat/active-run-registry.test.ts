import assert from "node:assert/strict"
import { test, vi } from "vitest"
import { ActiveRunRegistry } from "./active-run-registry.ts"

test("permission blocking takes precedence until every blocking request is removed", () => {
  const updates = vi.fn()
  const registry = new ActiveRunRegistry(updates)
  registry.create("session-1", "generation-1", {
    kind: "team",
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
    kind: "team",
    teamId: "team-id",
    teamName: "team-name",
  })
  registry.create("session-1", "generation-2", {
    kind: "team",
    teamId: "team-id",
    teamName: "team-name",
  })

  registry.delete("session-1", "generation-1")
  assert.equal(registry.get("session-1")?.generationId, "generation-2")
})

test("assistant events advance active run presentation phases", () => {
  const registry = new ActiveRunRegistry(() => undefined)
  registry.create("session-1", "generation-1", {
    kind: "team",
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

test("a user prompt echo never flips the run to answering", () => {
  const registry = new ActiveRunRegistry(() => undefined)
  registry.create("session-1", "generation-1", {
    kind: "team",
    teamId: "team-id",
    teamName: "team-name",
  })
  registry.update("session-1", { phase: "submitted" })
  // External adapters synthesize the user turn back into the stream.
  registry.applyEvent({
    event: "messageStarted",
    data: { messageId: "user-1", role: "user", sessionId: "session-1" },
  })
  registry.applyEvent({
    event: "messageDelta",
    data: {
      delta: "the prompt",
      messageId: "user-1",
      partId: "user-1:text",
      sessionId: "session-1",
      text: "the prompt",
    },
  })

  assert.equal(registry.get("session-1")?.phase, "submitted")
  assert.equal(registry.get("session-1")?.activeAssistantMessageId, undefined)

  // Real assistant output still advances the phase as before.
  registry.applyEvent({
    event: "messageDelta",
    data: { delta: "hi", messageId: "assistant-1", partId: "part-1", sessionId: "session-1", text: "hi" },
  })
  assert.equal(registry.get("session-1")?.phase, "answering")
  assert.equal(registry.get("session-1")?.activeAssistantMessageId, "assistant-1")
})

test("a delayed reply for an unknown blocking request cannot reset the current tool phase", () => {
  const registry = new ActiveRunRegistry(() => undefined)
  registry.create("session", "new-run", { kind: "local", workspaceId: "local", workspaceName: "Local" })
  registry.update("session", { phase: "tool_running", activeToolPartIds: ["new-tool"] })
  const before = registry.get("session")
  registry.removeBlockingRequest("session", "old-permission")
  assert.equal(registry.get("session"), before)
})
