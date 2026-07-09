import type {
  ChatAttachment,
  ChatContextMention,
  ChatMessage,
  ChatQuestionRequest,
} from "../../electron/chat/common.ts"

import { describe, expect, it } from "vitest"
import {
  applyCancelledToolParts,
  appendOptimisticConversationTurn,
  coalesceTextDeltaEvent,
  ensureMessage,
  hasVisibleMessageDelta,
  markAssistantMessageToolsCancelled,
  markLatestAssistantToolsCancelled,
  markQuestionToolAnswered,
  markQuestionToolsCancelled,
  markSessionCompletedUnread,
  markSessionViewed,
  mergeFetchedMessages,
  setConnectionStatusPart,
  setErrorPart,
  visibleChatError,
} from "./chat-message-state.ts"

const pdfAttachment: ChatAttachment = {
  id: "att-1",
  name: "report.pdf",
  mime: "application/pdf",
  size: 12,
  path: "/Users/me/report.pdf",
  kind: "file",
}

const skillMention: ChatContextMention = {
  id: "gpt-image-2",
  kind: "skill",
  name: "gpt-image-2",
}

describe("chat message identity reconciliation", () => {
  it("keeps the user bubble client identity when the real user message arrives", () => {
    const optimistic = appendOptimisticConversationTurn([], "Convert this PDF", [pdfAttachment])
    const localUser = optimistic[0]
    const localAssistant = optimistic[1]

    const reconciled = ensureMessage(optimistic, "real-user-1", "user")

    expect(reconciled).toHaveLength(2)
    expect(reconciled[0]?.id).toBe("real-user-1")
    expect(reconciled[0]?.clientId).toBe(localUser?.clientId)
    expect(reconciled[0]?.parts).toEqual(localUser?.parts)
    expect(reconciled[1]).toEqual(localAssistant)
  })

  it("keeps the assistant bubble client identity when the real assistant message arrives", () => {
    const optimistic = appendOptimisticConversationTurn([], "Convert this PDF", [pdfAttachment])
    const localAssistant = optimistic[1]

    const reconciled = ensureMessage(optimistic, "real-assistant-1", "assistant")

    expect(reconciled).toHaveLength(2)
    expect(reconciled[1]?.id).toBe("real-assistant-1")
    expect(reconciled[1]?.clientId).toBe(localAssistant?.clientId)
    expect(reconciled[1]?.parts).toEqual([])
  })

  it("preserves client identity when full history reloads after streaming", () => {
    const current = ensureMessage(
      ensureMessage(appendOptimisticConversationTurn([], "Convert this PDF", [pdfAttachment]), "real-user-1", "user"),
      "real-assistant-1",
      "assistant",
    )
    const fetched: ChatMessage[] = [
      {
        id: "real-user-1",
        role: "user",
        parts: current[0]?.parts ?? [],
        createdAt: 1,
      },
      {
        id: "real-assistant-1",
        role: "assistant",
        parts: [{ kind: "text", partId: "text-1", text: "Done" }],
        createdAt: 2,
      },
    ]

    const merged = mergeFetchedMessages(current, fetched)

    expect(merged[0]?.clientId).toBe(current[0]?.clientId)
    expect(merged[1]?.clientId).toBe(current[1]?.clientId)
    expect(merged[1]?.parts).toEqual([{ kind: "text", partId: "text-1", text: "Done" }])
  })

  it("keeps unchanged message references when full history reloads", () => {
    const current: ChatMessage[] = [
      {
        id: "real-user-1",
        clientId: "client-user-1",
        role: "user",
        parts: [{ kind: "text", partId: "text-user-1", text: "Create a Notion page" }],
        createdAt: 1,
      },
      {
        id: "real-assistant-1",
        clientId: "client-assistant-1",
        role: "assistant",
        parts: [
          {
            kind: "tool",
            partId: "tool-1",
            callId: "call-1",
            tool: "notion.create_page",
            status: "completed",
            input: { parent: "workspace" },
            output: "ok",
            timing: { start: 1, end: 2 },
          },
          { kind: "text", partId: "text-1", text: "Done" },
        ],
        createdAt: 2,
      },
    ]
    const fetched: ChatMessage[] = current.map((message) => ({
      ...message,
      clientId: undefined,
      parts: message.parts.map((part) => ({ ...part })),
    }))

    const merged = mergeFetchedMessages(current, fetched)

    expect(merged).toBe(current)
    expect(merged[0]).toBe(current[0])
    expect(merged[1]).toBe(current[1])
    expect(merged[1]?.parts[0]).toBe(current[1]?.parts[0])
  })

  it("preserves local context mentions when full history reloads", () => {
    const current = appendOptimisticConversationTurn([], "Generate an image", [], [skillMention])
    const fetched: ChatMessage[] = [
      {
        id: "real-user-1",
        role: "user",
        parts: current[0]?.parts ?? [],
        createdAt: 1,
      },
    ]

    const merged = mergeFetchedMessages(current, fetched)

    expect(merged[0]?.contextMentions).toEqual([skillMention])
  })

  it("keeps missing optimistic user messages in timeline order after a reload", () => {
    const projectUser: ChatMessage = {
      id: "server-user-project",
      role: "user",
      parts: [{ kind: "text", partId: "text-1", text: "List projects" }],
      createdAt: 100,
    }
    const projectAssistant: ChatMessage = {
      id: "server-assistant-project",
      role: "assistant",
      parts: [{ kind: "text", partId: "text-2", text: "Here are the projects." }],
      createdAt: 200,
    }
    const localEventUser: ChatMessage = {
      id: "local-user-event",
      role: "user",
      parts: [{ kind: "text", partId: "local", text: "List tracked events" }],
      createdAt: 300,
    }

    const merged = mergeFetchedMessages(
      [projectUser, projectAssistant, localEventUser],
      [projectUser, projectAssistant],
    )

    expect(merged.map((message) => message.id)).toEqual([
      "server-user-project",
      "server-assistant-project",
      "local-user-event",
    ])
  })

  it("preserves a newer duplicate optimistic user message when fetched history only has the older copy", () => {
    const serverUser: ChatMessage = {
      id: "server-user-repeat",
      role: "user",
      parts: [{ kind: "text", partId: "text-1", text: "Repeat this question" }],
      createdAt: 100,
    }
    const localUser: ChatMessage = {
      id: "local-user-repeat",
      role: "user",
      parts: [{ kind: "text", partId: "local", text: "Repeat this question" }],
      createdAt: 300,
    }

    const merged = mergeFetchedMessages([serverUser, localUser], [serverUser])

    expect(merged.map((message) => message.id)).toEqual(["server-user-repeat", "local-user-repeat"])
  })

  it("adds an optimistic turn when the same prompt already exists in fetched history", () => {
    const current: ChatMessage[] = [
      {
        id: "server-user-repeat",
        role: "user",
        parts: [{ kind: "text", partId: "text-1", text: "Repeat this question" }],
        createdAt: 100,
      },
    ]

    const updated = appendOptimisticConversationTurn(current, "Repeat this question")

    expect(updated).toHaveLength(3)
    expect(updated.at(-2)?.id).toMatch(/^local-user-/)
    expect(updated.at(-1)?.id).toMatch(/^local-assistant-/)
  })

  it("attaches message errors to the latest assistant bubble", () => {
    const current = appendOptimisticConversationTurn([], "Create a report", [])
    const updated = setErrorPart(current, {
      sessionId: "s1",
      partId: "error-1",
      message: "Payment Required: account is in deficit",
      errorKind: "payment_required",
      errorCode: "OOMOL_INSUFFICIENT_CREDIT",
    })

    expect(updated[1]?.parts).toEqual([
      {
        kind: "error",
        partId: "error-1",
        errorText: "Payment Required: account is in deficit",
        errorKind: "payment_required",
        errorCode: "OOMOL_INSUFFICIENT_CREDIT",
      },
    ])
  })

  it("deduplicates repeated message errors with different part ids", () => {
    const current = appendOptimisticConversationTurn([], "Create a report", [])
    const first = setErrorPart(current, {
      sessionId: "s1",
      partId: "error-1",
      message: "The selected model does not exist.",
      errorKind: "unknown",
    })
    const updated = setErrorPart(first, {
      sessionId: "s1",
      partId: "error-2",
      message: "The selected model does not exist.",
      errorKind: "unknown",
    })

    expect(updated[1]?.parts).toEqual([
      {
        kind: "error",
        partId: "error-1",
        errorText: "The selected model does not exist.",
        errorKind: "unknown",
      },
    ])
  })

  it("does not attach connection status without message id to historical assistant replies", () => {
    const current: ChatMessage[] = [
      {
        id: "assistant-1",
        role: "assistant",
        parts: [{ kind: "text", partId: "text-1", text: "Done" }],
        createdAt: 1,
      },
    ]

    const updated = setConnectionStatusPart(current, {
      sessionId: "s1",
      status: "failed",
      attempt: 5,
      maxAttempts: 5,
      createdAt: 100,
    })

    expect(updated[0]).toEqual(current[0])
    expect(updated[1]).toMatchObject({
      id: "local-assistant-status-100",
      role: "assistant",
      parts: [{ kind: "status", partId: "connection-failed-5-100", statusType: "connectionFailed" }],
    })
  })

  it("preserves local error parts when full history reloads", () => {
    const current: ChatMessage[] = [
      {
        id: "assistant-1",
        role: "assistant",
        parts: [{ kind: "error", partId: "error-1", errorText: "Payment Required" }],
        createdAt: 1,
      },
    ]
    const fetched: ChatMessage[] = [
      {
        id: "assistant-1",
        role: "assistant",
        parts: [],
        createdAt: 1,
      },
    ]

    expect(mergeFetchedMessages(current, fetched)[0]?.parts).toEqual([
      { kind: "error", partId: "error-1", errorText: "Payment Required" },
    ])
  })

  it("does not preserve a local error part when fetched history already has the same error", () => {
    const current: ChatMessage[] = [
      {
        id: "assistant-1",
        role: "assistant",
        parts: [{ kind: "error", partId: "local-error-1", errorText: "The selected model does not exist." }],
        createdAt: 1,
      },
    ]
    const fetched: ChatMessage[] = [
      {
        id: "assistant-1",
        role: "assistant",
        parts: [{ kind: "error", partId: "message-error-APIError", errorText: "The selected model does not exist." }],
        createdAt: 1,
      },
    ]

    expect(mergeFetchedMessages(current, fetched)[0]?.parts).toEqual([
      { kind: "error", partId: "message-error-APIError", errorText: "The selected model does not exist." },
    ])
  })

  it("deduplicates classified realtime errors against unclassified fetched history errors", () => {
    const current: ChatMessage[] = [
      {
        id: "assistant-1",
        role: "assistant",
        parts: [
          {
            kind: "error",
            partId: "local-error-1",
            errorText: "The selected model does not exist.",
            errorKind: "unknown",
          },
        ],
        createdAt: 1,
      },
    ]
    const fetched: ChatMessage[] = [
      {
        id: "assistant-1",
        role: "assistant",
        parts: [{ kind: "error", partId: "message-error-APIError", errorText: "The selected model does not exist." }],
        createdAt: 1,
      },
    ]

    expect(mergeFetchedMessages(current, fetched)[0]?.parts).toEqual([
      { kind: "error", partId: "message-error-APIError", errorText: "The selected model does not exist." },
    ])
  })

  it("tracks completed sessions as unread only when they are not visible", () => {
    const current = new Set<string>()

    expect(markSessionCompletedUnread(current, "s1", "s1")).toBe(current)

    const unread = markSessionCompletedUnread(current, "s2", "s1")
    expect([...unread]).toEqual(["s2"])
    expect(markSessionCompletedUnread(unread, "s2", "s1")).toBe(unread)

    const viewed = markSessionViewed(unread, "s2")
    expect([...viewed]).toEqual([])
    expect(markSessionViewed(viewed, "s2")).toBe(viewed)
  })

  it("marks locally stopped running tools as cancelled and freezes their timing", () => {
    const current: ChatMessage[] = [
      {
        id: "assistant-1",
        role: "assistant",
        createdAt: 1,
        parts: [
          {
            kind: "tool",
            partId: "tool-1",
            callId: "tool-1",
            tool: "bash",
            status: "running",
            input: {},
            timing: { start: 1000 },
          },
        ],
      },
    ]

    const { messages, partIds } = markLatestAssistantToolsCancelled(current, 2600)

    expect(partIds).toEqual(["tool-1"])
    expect(messages[0]?.parts[0]).toMatchObject({
      partId: "tool-1",
      cancelled: true,
      timing: { start: 1000, end: 2600 },
    })
  })

  it("marks stopped tools on the event target assistant instead of the latest assistant", () => {
    const current: ChatMessage[] = [
      {
        id: "assistant-1",
        role: "assistant",
        createdAt: 1,
        parts: [
          {
            kind: "tool",
            partId: "question-tool",
            callId: "question-tool",
            tool: "question",
            status: "running",
            input: {},
            timing: { start: 1000 },
          },
        ],
      },
      {
        id: "assistant-2",
        role: "assistant",
        createdAt: 2,
        parts: [
          {
            kind: "tool",
            partId: "new-tool",
            callId: "new-tool",
            tool: "search_actions",
            status: "running",
            input: {},
            timing: { start: 2000 },
          },
        ],
      },
    ]

    const { messages, partIds } = markAssistantMessageToolsCancelled(current, "assistant-1", ["question-tool"], 2600)

    expect(partIds).toEqual(["question-tool"])
    expect(messages[0]?.parts[0]).toMatchObject({
      partId: "question-tool",
      cancelled: true,
      timing: { start: 1000, end: 2600 },
    })
    expect(messages[1]?.parts[0]).not.toHaveProperty("cancelled")
  })

  it("does not cancel assistant tools when the event target part list is empty", () => {
    const current: ChatMessage[] = [
      {
        id: "assistant-1",
        role: "assistant",
        createdAt: 1,
        parts: [
          {
            kind: "tool",
            partId: "tool-1",
            callId: "tool-1",
            tool: "bash",
            status: "running",
            input: {},
            timing: { start: 1000 },
          },
        ],
      },
    ]

    const { messages, partIds } = markAssistantMessageToolsCancelled(current, "assistant-1", [], 2600)

    expect(partIds).toEqual([])
    expect(messages).toBe(current)
    expect(messages[0]?.parts[0]).not.toHaveProperty("cancelled")
  })

  it("marks an answered question tool as completed and keeps the submitted answers", () => {
    const request: ChatQuestionRequest = {
      id: "question-1",
      sessionId: "s1",
      questions: [{ header: "文章标题", question: "标题叫什么？", options: [] }],
      tool: { messageId: "assistant-1", callId: "call-1" },
    }
    const current: ChatMessage[] = [
      {
        id: "assistant-1",
        role: "assistant",
        createdAt: 1,
        parts: [
          {
            kind: "tool",
            partId: "question-tool",
            callId: "call-1",
            tool: "question",
            status: "running",
            input: {},
            timing: { start: 1000 },
          },
        ],
      },
    ]

    const messages = markQuestionToolAnswered(current, request, [["测试文章"]], 2600)

    expect(messages[0]?.parts[0]).toMatchObject({
      partId: "question-tool",
      status: "completed",
      cancelled: false,
      metadata: { answers: [["测试文章"]] },
      timing: { start: 1000, end: 2600 },
    })
  })

  it("marks only linked question tools as cancelled", () => {
    const request: ChatQuestionRequest = {
      id: "question-1",
      sessionId: "s1",
      questions: [{ header: "文章标题", question: "标题叫什么？", options: [] }],
      tool: { messageId: "assistant-1", callId: "call-1" },
    }
    const current: ChatMessage[] = [
      {
        id: "assistant-1",
        role: "assistant",
        createdAt: 1,
        parts: [
          {
            kind: "tool",
            partId: "question-tool",
            callId: "call-1",
            tool: "question",
            status: "running",
            input: {},
            timing: { start: 1000 },
          },
          {
            kind: "tool",
            partId: "other-tool",
            callId: "call-2",
            tool: "bash",
            status: "running",
            input: {},
            timing: { start: 1200 },
          },
        ],
      },
    ]

    const { messages, partIds } = markQuestionToolsCancelled(current, [request], 2600)

    expect(partIds).toEqual(["question-tool"])
    expect(messages[0]?.parts[0]).toMatchObject({
      partId: "question-tool",
      cancelled: true,
      timing: { start: 1000, end: 2600 },
    })
    expect(messages[0]?.parts[1]).not.toHaveProperty("cancelled")
  })

  it("reapplies cancelled tool overlays with frozen timing after reload", () => {
    const current: ChatMessage[] = [
      {
        id: "assistant-1",
        role: "assistant",
        createdAt: 1,
        parts: [
          {
            kind: "tool",
            partId: "tool-1",
            callId: "tool-1",
            tool: "bash",
            status: "running",
            input: {},
            timing: { start: 1000 },
          },
        ],
      },
    ]

    const messages = applyCancelledToolParts(current, new Set(["tool-1"]), 2600)

    expect(messages[0]?.parts[0]).toMatchObject({
      partId: "tool-1",
      cancelled: true,
      timing: { start: 1000, end: 2600 },
    })
  })

  it("keeps finalizing activity for empty assistant text deltas", () => {
    expect(hasVisibleMessageDelta({ sessionId: "s1", messageId: "a1", partId: "text-1", text: "" })).toBe(false)
    expect(
      hasVisibleMessageDelta({ sessionId: "s1", messageId: "a1", partId: "text-1", text: "  ", delta: "\n" }),
    ).toBe(false)
    expect(hasVisibleMessageDelta({ sessionId: "s1", messageId: "a1", partId: "text-1", text: "Done" })).toBe(true)
    expect(hasVisibleMessageDelta({ sessionId: "s1", messageId: "a1", partId: "text-1", text: "", delta: "D" })).toBe(
      true,
    )
  })

  it("coalesces delta-only text events before a render flush", () => {
    const first = { sessionId: "s1", messageId: "a1", partId: "text-1", text: "", delta: "Hel" }
    const second = { sessionId: "s1", messageId: "a1", partId: "text-1", text: "", delta: "lo" }

    expect(coalesceTextDeltaEvent(first, second)).toEqual({
      sessionId: "s1",
      messageId: "a1",
      partId: "text-1",
      text: "",
      delta: "Hello",
    })
  })

  it("coalesces delta-only text events after cumulative text", () => {
    const current = { sessionId: "s1", messageId: "a1", partId: "text-1", text: "Hello" }
    const next = { sessionId: "s1", messageId: "a1", partId: "text-1", text: "", delta: " world" }

    expect(coalesceTextDeltaEvent(current, next)).toEqual({
      sessionId: "s1",
      messageId: "a1",
      partId: "text-1",
      text: "Hello world",
      delta: undefined,
    })
  })

  it("keeps pending delta text when a blank text event arrives before render flush", () => {
    const current = { sessionId: "s1", messageId: "a1", partId: "text-1", text: "", delta: "Hello" }
    const next = { sessionId: "s1", messageId: "a1", partId: "text-1", text: "" }

    expect(coalesceTextDeltaEvent(current, next)).toEqual(current)
  })

  it("shows session-scoped banner errors only for the active session", () => {
    expect(visibleChatError({ background: "Background failed" }, null, "active")).toBeNull()
    expect(visibleChatError({ active: "Active failed" }, null, "active")).toBe("Active failed")
    expect(visibleChatError({}, "Global failed", "active")).toBe("Global failed")
    expect(visibleChatError({ active: "Active failed" }, "Global failed", "active")).toBe("Active failed")
  })
})
