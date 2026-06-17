import type { QueuedChatMessage } from "./chat-queue.ts"

import assert from "node:assert/strict"
import { describe, test } from "vitest"
import {
  appendQueuedMessage,
  clearQueuedMessages,
  consumeLatestQueuedMessage,
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

  test("consumes only the latest queued message and keeps earlier messages", () => {
    const queues = {
      "session-1": [message("first"), message("second")],
      "session-2": [message("other", "session-2")],
    }

    const result = consumeLatestQueuedMessage(queues, "session-1")

    assert.equal(result.message?.id, "second")
    assert.deepEqual(
      result.queues["session-1"]?.map((item) => item.id),
      ["first"],
    )
    assert.deepEqual(
      result.queues["session-2"]?.map((item) => item.id),
      ["other"],
    )
  })

  test("drops the session bucket after consuming its only queued message", () => {
    const result = consumeLatestQueuedMessage({ "session-1": [message("only")] }, "session-1")

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
    assert.equal(shouldDispatchQueuedMessage("ready", false), true)
    assert.equal(shouldDispatchQueuedMessage("ready", true), false)
    assert.equal(shouldDispatchQueuedMessage("submitted", false), false)
    assert.equal(shouldDispatchQueuedMessage("streaming", false), false)
    assert.equal(shouldDispatchQueuedMessage("error", false), false)
  })
})
