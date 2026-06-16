import type { ChatMessage, ChatMessagePart } from "../../../electron/chat/common.ts"

import { describe, expect, it } from "vitest"
import { assistantTextParts, groupChatTurns, summarizeTurnProcess } from "./chat-turns.ts"

function message(id: string, role: ChatMessage["role"], parts: ChatMessagePart[] = []): ChatMessage {
  return { id, role, parts, createdAt: Number(id.replace(/\D/g, "")) || 1 }
}

function text(partId: string, value: string): ChatMessagePart {
  return { kind: "text", partId, text: value }
}

function tool(partId: string, extra: Partial<ChatMessagePart> = {}): ChatMessagePart {
  return {
    kind: "tool",
    partId,
    callId: partId,
    tool: "call_action",
    status: "completed",
    input: {},
    ...extra,
  }
}

describe("groupChatTurns", () => {
  it("groups assistant messages under the preceding user request", () => {
    const user1 = message("u1", "user", [text("u1-text", "first")])
    const assistant1 = message("a1", "assistant", [tool("tool-1")])
    const assistant2 = message("a2", "assistant", [text("a2-text", "answer")])
    const user2 = message("u2", "user", [text("u2-text", "second")])
    const assistant3 = message("a3", "assistant", [text("a3-text", "done")])

    const turns = groupChatTurns([user1, assistant1, assistant2, user2, assistant3])

    expect(turns).toHaveLength(2)
    expect(turns[0]?.user).toBe(user1)
    expect(turns[0]?.assistants).toEqual([assistant1, assistant2])
    expect(turns[1]?.user).toBe(user2)
    expect(turns[1]?.assistants).toEqual([assistant3])
  })
})

describe("summarizeTurnProcess", () => {
  it("collects tools and final answer state for a whole turn", () => {
    const turn = groupChatTurns([
      message("u1", "user", [text("u1-text", "report")]),
      message("a1", "assistant", [tool("tool-1", { timing: { start: 1000, end: 1800 } })]),
      message("a2", "assistant", [tool("tool-2", { status: "running", timing: { start: 2000 } })]),
      message("a3", "assistant", [text("a3-text", "final")]),
    ])[0]

    expect(turn).toBeDefined()
    const process = summarizeTurnProcess(turn!, { sessionId: "s1", messageId: "a2", phase: "thinking" }, "a2")

    expect(process.tools.map((part) => part.partId)).toEqual(["tool-1", "tool-2"])
    expect(process.hasFinalAnswer).toBe(true)
    expect(process.hasActiveTool).toBe(true)
    expect(process.activity?.phase).toBe("thinking")
    expect(process.startedAt).toBe(1000)
  })

  it("uses activity without message id for the current turn", () => {
    const turn = groupChatTurns([message("u1", "user", [text("u1-text", "hello")]), message("a1", "assistant")])[0]

    expect(turn).toBeDefined()
    const process = summarizeTurnProcess(turn!, { sessionId: "s1", phase: "thinking" })

    expect(process.activity?.phase).toBe("thinking")
    expect(process.hasFinalAnswer).toBe(false)
  })

  it("keeps reasoning out of assistant answer text parts", () => {
    const parts = assistantTextParts(
      message("a1", "assistant", [
        { kind: "reasoning", partId: "r1", text: "internal work" },
        text("t1", "visible answer"),
      ]),
    )

    expect(parts).toEqual([text("t1", "visible answer")])
  })

  it("treats semantically cancelled tool errors as stopped instead of blocking", () => {
    const turn = groupChatTurns([
      message("u1", "user", [text("u1-text", "stop")]),
      message("a1", "assistant", [
        tool("tool-1", { status: "error", error: "AbortError: The operation was aborted." }),
      ]),
    ])[0]

    expect(turn).toBeDefined()
    const process = summarizeTurnProcess(turn!, null)

    expect(process.hasStoppedTool).toBe(true)
    expect(process.hasBlockingError).toBe(false)
  })
})
