import type { ChatMessage, ChatMessagePart } from "../../../electron/chat/common.ts"

import { describe, expect, it } from "vitest"
import {
  activityForChatTurn,
  assistantTextParts,
  chatTurnInputKey,
  groupChatTurns,
  latestAssistantMessage,
  retrySourceFromTurn,
  reuseStableChatTurns,
  shouldShowPlainTurnActivity,
  shouldShowTurnProcess,
  summarizeTurnProcess,
} from "./chat-turns.ts"

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

  it("reuses unchanged turn objects across streaming updates", () => {
    const user1 = message("u1", "user", [text("u1-text", "first")])
    const assistant1 = message("a1", "assistant", [text("a1-text", "done")])
    const user2 = message("u2", "user", [text("u2-text", "second")])
    const assistant2 = message("a2", "assistant", [text("a2-text", "partial")])
    const previous = groupChatTurns([user1, assistant1, user2, assistant2])
    const updatedAssistant2 = message("a2", "assistant", [text("a2-text", "partial answer")])
    const next = groupChatTurns([user1, assistant1, user2, updatedAssistant2])

    const stable = reuseStableChatTurns(previous, next)

    expect(stable[0]).toBe(previous[0])
    expect(stable[1]).toBe(next[1])
  })

  it("finds the latest assistant message without changing message order", () => {
    const user1 = message("u1", "user", [text("u1-text", "first")])
    const assistant1 = message("a1", "assistant", [text("a1-text", "one")])
    const assistant2 = message("a2", "assistant", [text("a2-text", "two")])
    const messages = [user1, assistant1, assistant2]

    expect(latestAssistantMessage(messages)).toBe(assistant2)
    expect(messages).toEqual([user1, assistant1, assistant2])
  })

  it("builds retry source from the clicked turn user message", () => {
    const attachment = {
      id: "att-1",
      name: "report.csv",
      mime: "text/csv",
      size: 42,
      path: "/tmp/report.csv",
      kind: "file" as const,
    }
    const turn = groupChatTurns([
      {
        ...message("u1", "user", [text("u1-text", "analyze"), { kind: "attachment", partId: "att", attachment }]),
        clientId: "client-u1",
      },
      message("a1", "assistant", [tool("tool-1")]),
    ])[0]

    expect(turn).toBeDefined()
    const source = retrySourceFromTurn(turn!)

    expect(source).toEqual({
      text: "analyze",
      attachments: [attachment],
      userMessageId: "u1",
      userClientId: "client-u1",
    })
    expect(chatTurnInputKey(source!)).toBe(chatTurnInputKey({ text: "analyze", attachments: [attachment] }))
  })

  it("targets activity to the matching assistant turn only", () => {
    const turns = groupChatTurns([
      message("u1", "user", [text("u1-text", "first")]),
      message("a1", "assistant", [text("a1-text", "done")]),
      message("u2", "user", [text("u2-text", "second")]),
      message("a2", "assistant", [tool("tool-2", { status: "running" })]),
    ])
    const activity = { sessionId: "s1", messageId: "a2", phase: "thinking" as const }

    expect(activityForChatTurn(turns[0]!, activity, "a2", false)).toBeNull()
    expect(activityForChatTurn(turns[1]!, activity, "a2", true)).toBe(activity)
    expect(activityForChatTurn(turns[0]!, { sessionId: "s1", phase: "thinking" }, undefined, false)).toBeNull()
    expect(activityForChatTurn(turns[1]!, { sessionId: "s1", phase: "thinking" }, undefined, true)).toEqual({
      sessionId: "s1",
      phase: "thinking",
    })
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

  it("suggests connecting a single unauthenticated provider from search results", () => {
    const turn = groupChatTurns([
      message("u1", "user", [text("u1-text", "有没有 Supabase 的连接可以用")]),
      message("a1", "assistant", [
        tool("tool-1", {
          tool: "search_actions",
          output: JSON.stringify([
            { service: "supabase", name: "list_projects", authenticated: false },
            { service: "supabase", name: "run_read_only_query", authenticated: false },
          ]),
        }),
      ]),
      message("a2", "assistant", [text("a2-text", "有 Supabase 的连接器可用。")]),
    ])[0]

    expect(turn).toBeDefined()
    const process = summarizeTurnProcess(turn!, null)

    expect(process.hasAuthorization).toBe(false)
    expect(process.suggestedAuthorization).toMatchObject({
      service: "supabase",
      displayName: "Supabase",
      errorCode: "connection_required",
    })
  })

  it("suggests the requested provider when search results include other unauthenticated providers", () => {
    const turn = groupChatTurns([
      message("u1", "user", [text("u1-text", "有没有 Supabase 的连接可以用")]),
      message("a1", "assistant", [
        tool("tool-1", {
          tool: "search_actions",
          input: { keywords: "supabase", query: "Supabase database connection" },
          output: JSON.stringify([
            { service: "supabase", name: "list_projects", authenticated: false },
            { service: "supabase", name: "run_read_only_query", authenticated: false },
            { service: "neon", name: "get_database", authenticated: false },
          ]),
        }),
      ]),
      message("a2", "assistant", [text("a2-text", "有 Supabase 的连接器可用。")]),
    ])[0]

    expect(turn).toBeDefined()
    const process = summarizeTurnProcess(turn!, null)

    expect(process.suggestedAuthorization).toMatchObject({
      service: "supabase",
      displayName: "Supabase",
      errorCode: "connection_required",
    })
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

  it("treats tool errors followed by a final answer as non-blocking", () => {
    const turn = groupChatTurns([
      message("u1", "user", [text("u1-text", "find images")]),
      message("a1", "assistant", [
        tool("tool-1", { status: "error", error: "Ripgrep JSON record exceeded 65536 bytes" }),
      ]),
      message("a2", "assistant", [text("a2-text", "I found the images with another method.")]),
    ])[0]

    expect(turn).toBeDefined()
    const process = summarizeTurnProcess(turn!, null)

    expect(process.hasToolError).toBe(true)
    expect(process.hasFinalAnswer).toBe(true)
    expect(process.hasBlockingError).toBe(false)
  })

  it("keeps tool errors blocking when no final answer exists", () => {
    const turn = groupChatTurns([
      message("u1", "user", [text("u1-text", "find images")]),
      message("a1", "assistant", [
        tool("tool-1", { status: "error", error: "Ripgrep JSON record exceeded 65536 bytes" }),
      ]),
    ])[0]

    expect(turn).toBeDefined()
    const process = summarizeTurnProcess(turn!, null)

    expect(process.hasToolError).toBe(true)
    expect(process.hasFinalAnswer).toBe(false)
    expect(process.hasBlockingError).toBe(true)
  })

  it("does not treat locally cancelled running tools as active", () => {
    const turn = groupChatTurns([
      message("u1", "user", [text("u1-text", "stop")]),
      message("a1", "assistant", [tool("tool-1", { status: "running", cancelled: true })]),
    ])[0]

    expect(turn).toBeDefined()
    const process = summarizeTurnProcess(turn!, null)

    expect(process.hasActiveTool).toBe(false)
    expect(process.hasStoppedTool).toBe(true)
  })

  it("does not show a process panel for plain assistant thinking", () => {
    const turn = groupChatTurns([message("u1", "user", [text("u1-text", "hello")])])[0]

    expect(turn).toBeDefined()
    const process = summarizeTurnProcess(turn!, { sessionId: "s1", phase: "thinking" })

    expect(process.activity?.phase).toBe("thinking")
    expect(shouldShowTurnProcess(process)).toBe(false)
    expect(shouldShowPlainTurnActivity(process)).toBe(true)
  })

  it("shows the process panel for retrying without tool parts", () => {
    const turn = groupChatTurns([message("u1", "user", [text("u1-text", "hello")])])[0]

    expect(turn).toBeDefined()
    const process = summarizeTurnProcess(turn!, { sessionId: "s1", phase: "retrying", attempt: 2 })

    expect(shouldShowTurnProcess(process)).toBe(true)
    expect(shouldShowPlainTurnActivity(process)).toBe(false)
  })

  it("shows the process panel when a tool part exists", () => {
    const turn = groupChatTurns([
      message("u1", "user", [text("u1-text", "inspect")]),
      message("a1", "assistant", [tool("tool-1")]),
    ])[0]

    expect(turn).toBeDefined()
    const process = summarizeTurnProcess(turn!, { sessionId: "s1", messageId: "a1", phase: "finalizing" }, "a1")

    expect(shouldShowTurnProcess(process)).toBe(true)
    expect(shouldShowPlainTurnActivity(process)).toBe(false)
  })

  it("hides plain assistant activity once answer text is visible", () => {
    const turn = groupChatTurns([
      message("u1", "user", [text("u1-text", "hello")]),
      message("a1", "assistant", [text("a1-text", "Hi there.")]),
    ])[0]

    expect(turn).toBeDefined()
    const process = summarizeTurnProcess(turn!, { sessionId: "s1", messageId: "a1", phase: "finalizing" }, "a1")

    expect(shouldShowPlainTurnActivity(process)).toBe(false)
  })
})
