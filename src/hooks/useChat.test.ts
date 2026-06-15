import type { ChatAttachment, ChatMessage } from "../../electron/chat/common.ts"

import { describe, expect, it } from "vitest"
import { appendOptimisticConversationTurn, ensureMessage, mergeFetchedMessages } from "./useChat.ts"

const pdfAttachment: ChatAttachment = {
  id: "att-1",
  name: "report.pdf",
  mime: "application/pdf",
  size: 12,
  path: "/Users/me/report.pdf",
  kind: "file",
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
})
