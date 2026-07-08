import type { QueuedChatMessage } from "./chat-queue.ts"

import assert from "node:assert/strict"
import { describe, test } from "vitest"
import { createQueuedChatMessage } from "./app-shell-model.ts"
import {
  appendQueuedMessage,
  clearQueuedMessages,
  consumeNextQueuedMessage,
  latestQueuedMessage,
  moveQueuedMessage,
  removeQueuedMessage,
  shouldDispatchQueuedMessage,
} from "./chat-queue.ts"

function message(id: string, sessionId = "session-1"): QueuedChatMessage {
  return {
    id,
    sessionId,
    text: id,
    attachments: [],
    createdAt: 1_700_000_000_000,
  }
}

describe("chat queue", () => {
  test("appends queued messages per session", () => {
    const queues = appendQueuedMessage(appendQueuedMessage({}, message("first")), message("second"))

    assert.deepEqual(
      queues["session-1"]?.map((item) => item.id),
      ["first", "second"],
    )
  })

  test("consumes the oldest queued message and keeps later messages", () => {
    const queues = {
      "session-1": [message("first"), message("second")],
      "session-2": [message("other", "session-2")],
    }

    const result = consumeNextQueuedMessage(queues, "session-1")

    assert.equal(result.message?.id, "first")
    assert.deepEqual(
      result.queues["session-1"]?.map((item) => item.id),
      ["second"],
    )
    assert.deepEqual(
      result.queues["session-2"]?.map((item) => item.id),
      ["other"],
    )
  })

  test("peeks the latest queued message without mutating the queue", () => {
    const queues = { "session-1": [message("first"), message("second")] }

    assert.equal(latestQueuedMessage(queues, "session-1")?.id, "second")
    assert.deepEqual(
      queues["session-1"]?.map((item) => item.id),
      ["first", "second"],
    )
  })

  test("drops the session bucket after consuming its only queued message", () => {
    const result = consumeNextQueuedMessage({ "session-1": [message("only")] }, "session-1")

    assert.equal(result.message?.id, "only")
    assert.equal(result.queues["session-1"], undefined)
  })

  test("removes a queued message and drops the empty session bucket", () => {
    const queues = { "session-1": [message("first"), message("second")] }
    const withoutFirst = removeQueuedMessage(queues, "session-1", "first")
    const empty = removeQueuedMessage(withoutFirst, "session-1", "second")

    assert.deepEqual(
      withoutFirst["session-1"]?.map((item) => item.id),
      ["second"],
    )
    assert.equal(empty["session-1"], undefined)
  })

  test("moves a queued message before the target", () => {
    const queues = { "session-1": [message("first"), message("second"), message("third")] }

    const result = moveQueuedMessage(queues, "session-1", "third", "first", "before")

    assert.deepEqual(
      result["session-1"]?.map((item) => item.id),
      ["third", "first", "second"],
    )
  })

  test("moves a queued message after the target", () => {
    const queues = { "session-1": [message("first"), message("second"), message("third")] }

    const result = moveQueuedMessage(queues, "session-1", "first", "third", "after")

    assert.deepEqual(
      result["session-1"]?.map((item) => item.id),
      ["second", "third", "first"],
    )
  })

  test("keeps the queue unchanged when move ids are invalid", () => {
    const queues = { "session-1": [message("first"), message("second")] }

    assert.equal(moveQueuedMessage(queues, "session-1", "missing", "first", "before"), queues)
    assert.equal(moveQueuedMessage(queues, "session-1", "first", "missing", "before"), queues)
    assert.equal(moveQueuedMessage(queues, "session-1", "first", "first", "before"), queues)
  })

  test("clears queued messages for one session", () => {
    const queues = {
      "session-1": [message("first")],
      "session-2": [message("other", "session-2")],
    }

    const result = clearQueuedMessages(queues, "session-1")

    assert.equal(result["session-1"], undefined)
    assert.equal(result["session-2"]?.[0]?.id, "other")
  })

  test("dispatches queued messages only after the active turn is ready", () => {
    assert.equal(shouldDispatchQueuedMessage("ready", false, false), true)
    assert.equal(shouldDispatchQueuedMessage("ready", true, false), false)
    assert.equal(shouldDispatchQueuedMessage("ready", false, true), false)
    assert.equal(shouldDispatchQueuedMessage("ready", false, false, true), false)
    assert.equal(shouldDispatchQueuedMessage("submitted", false, false), false)
    assert.equal(shouldDispatchQueuedMessage("streaming", false, false), false)
    assert.equal(shouldDispatchQueuedMessage("error", false, false), false)
  })

  test("resumes queued messages after a manual stop returns the session to ready", () => {
    assert.equal(shouldDispatchQueuedMessage("streaming", false, false), false)
    assert.equal(shouldDispatchQueuedMessage("ready", false, false), true)
  })

  test("preserves workspace context on queued messages", () => {
    const queued = createQueuedChatMessage(
      "session-1",
      "hello",
      [],
      undefined,
      undefined,
      undefined,
      "build",
      "default",
      [{ id: "skill-1", name: "Skill" }],
      { id: "project-1", name: "Project", path: "/tmp/project" },
      { type: "organization", organizationId: "org-1", organizationName: "acme" },
    )

    assert.deepEqual(queued.organizationSkills, [{ id: "skill-1", name: "Skill" }])
    assert.deepEqual(queued.projectContext, { id: "project-1", name: "Project", path: "/tmp/project" })
    assert.deepEqual(queued.sessionScope, { type: "organization", organizationId: "org-1", organizationName: "acme" })
  })
})
