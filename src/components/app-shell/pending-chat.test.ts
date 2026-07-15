import type { ChatMessage } from "../../../electron/chat/common.ts"
import type { PendingChatTransition } from "./pending-chat.ts"

import assert from "node:assert/strict"
import { describe, test } from "vitest"
import { isPendingChatCaughtUp } from "./pending-chat.ts"

function pending(sessionId: string | null = "session-1"): PendingChatTransition {
  return {
    sessionId,
    scopeKey: "organization:acme",
    text: "今天杭州天气怎么样",
    attachments: [],
    createdAt: 1_700_000_000_000,
  }
}

function message(message: Partial<ChatMessage> & Pick<ChatMessage, "role" | "parts">): ChatMessage {
  return {
    id: `${message.role}-1`,
    createdAt: 1_700_000_000_000,
    ...message,
  }
}

describe("isPendingChatCaughtUp", () => {
  test("waits until the pending session is active and assigned", () => {
    const messages = [message({ role: "user", parts: [{ kind: "text", partId: "text-1", text: "hello" }] })]

    assert.equal(isPendingChatCaughtUp(null, "session-1", messages), false)
    assert.equal(isPendingChatCaughtUp(pending(null), "session-1", messages), false)
    assert.equal(isPendingChatCaughtUp(pending("session-1"), "session-2", messages), false)
  })

  test("catches up as soon as the optimistic user message is visible", () => {
    const messages = [
      message({ role: "user", id: "local-user-1", parts: [{ kind: "text", partId: "text-1", text: "hello" }] }),
      message({ role: "assistant", id: "local-assistant-1", parts: [] }),
    ]

    assert.equal(isPendingChatCaughtUp(pending("session-1"), "session-1", messages), true)
  })

  test("ignores visible user messages created before the pending transition", () => {
    const messages = [
      message({
        role: "user",
        id: "old-user-1",
        createdAt: 1_699_999_999_999,
        parts: [{ kind: "text", partId: "text-1", text: "old hello" }],
      }),
    ]

    assert.equal(isPendingChatCaughtUp(pending("session-1"), "session-1", messages), false)
  })

  test("catches up when the matching server user message has an earlier timestamp", () => {
    const messages = [
      message({
        role: "user",
        id: "server-user-1",
        createdAt: 1_699_999_999_999,
        parts: [{ kind: "text", partId: "text-1", text: "今天杭州天气怎么样" }],
      }),
    ]

    assert.equal(isPendingChatCaughtUp(pending("session-1"), "session-1", messages), true)
  })

  test("does not catch up from an old duplicate user message", () => {
    const messages = [
      message({
        role: "user",
        id: "old-user-1",
        createdAt: 1_699_999_900_000,
        parts: [{ kind: "text", partId: "text-1", text: "今天杭州天气怎么样" }],
      }),
    ]

    assert.equal(isPendingChatCaughtUp(pending("session-1"), "session-1", messages), false)
  })

  test("treats attachment-only user messages as visible", () => {
    const messages = [
      message({
        role: "user",
        parts: [
          {
            kind: "attachment",
            partId: "attachment-1",
            attachment: {
              id: "attachment-1",
              name: "weather.png",
              mime: "image/png",
              size: 10,
              path: "/tmp/weather.png",
            },
          },
        ],
      }),
    ]

    assert.equal(isPendingChatCaughtUp(pending("session-1"), "session-1", messages), true)
  })

  test("does not catch up on an empty assistant placeholder alone", () => {
    const messages = [message({ role: "assistant", id: "local-assistant-1", parts: [] })]

    assert.equal(isPendingChatCaughtUp(pending("session-1"), "session-1", messages), false)
  })
})
