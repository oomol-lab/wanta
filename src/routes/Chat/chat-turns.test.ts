import type { ChatMessage, ChatMessagePart } from "../../../electron/chat/common.ts"

import { describe, expect, it } from "vitest"
import {
  activityForChatTurn,
  assistantMessageIdsKey,
  assistantTextParts,
  chatTurnProcessStatus,
  chatTurnInputKey,
  groupChatTurns,
  isLiveTurnProcess,
  latestAssistantMessage,
  retrySourceFromTurn,
  reuseStableChatTurns,
  shouldShowPlainTurnActivity,
  shouldShowTurnProcess,
  settlingToolPartId,
  summarizeTurnProcess,
  updateChatTurnGrouping,
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

  it("updates only the changed turn and keeps ID associations stable during streaming", () => {
    const user1 = message("u1", "user", [text("u1-text", "first")])
    const assistant1 = message("a1", "assistant", [text("a1-text", "done")])
    const user2 = message("u2", "user", [text("u2-text", "second")])
    const assistant2 = message("a2", "assistant", [text("a2-text", "partial")])
    const initialMessages = [user1, assistant1, user2, assistant2]
    const initialTurns = groupChatTurns(initialMessages)
    const previous = {
      associationTurns: initialTurns,
      assistantMessageIdsKey: assistantMessageIdsKey(initialMessages),
      messages: initialMessages,
      turns: initialTurns,
    }
    const updatedAssistant2 = message("a2", "assistant", [text("a2-text", "partial answer")])

    const next = updateChatTurnGrouping(previous, [user1, assistant1, user2, updatedAssistant2])

    expect(next.turns[0]).toBe(initialTurns[0])
    expect(next.turns[1]).not.toBe(initialTurns[1])
    expect(next.turns[1]?.assistants).toEqual([updatedAssistant2])
    expect(next.associationTurns).toBe(initialTurns)
    expect(next.assistantMessageIdsKey).toBe(previous.assistantMessageIdsKey)
  })

  it("rebuilds ID associations when the message structure changes", () => {
    const user = message("u1", "user")
    const assistant = message("a1", "assistant")
    const initialMessages = [user, assistant]
    const initialTurns = groupChatTurns(initialMessages)
    const previous = {
      associationTurns: initialTurns,
      assistantMessageIdsKey: assistantMessageIdsKey(initialMessages),
      messages: initialMessages,
      turns: initialTurns,
    }
    const nextAssistant = message("a2", "assistant")

    const next = updateChatTurnGrouping(previous, [user, assistant, nextAssistant])

    expect(next.associationTurns).toBe(next.turns)
    expect(next.assistantMessageIdsKey).toBe("a1\na2")
    expect(next.turns[0]?.assistants).toEqual([assistant, nextAssistant])
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

describe("assistantMessageIdsKey", () => {
  it("keeps only assistant message ids in render order", () => {
    expect(
      assistantMessageIdsKey([
        message("u1", "user"),
        message("a1", "assistant"),
        message("a2", "assistant"),
        message("u2", "user"),
      ]),
    ).toBe("a1\na2")
  })
})

describe("summarizeTurnProcess", () => {
  it("collects tools and visible outcome state for a whole turn", () => {
    const turn = groupChatTurns([
      message("u1", "user", [text("u1-text", "report")]),
      message("a1", "assistant", [tool("tool-1", { timing: { start: 1000, end: 1800 } })]),
      message("a2", "assistant", [tool("tool-2", { status: "running", timing: { start: 2000 } })]),
      message("a3", "assistant", [text("a3-text", "final")]),
    ])[0]

    expect(turn).toBeDefined()
    const process = summarizeTurnProcess(turn!, { sessionId: "s1", messageId: "a2", phase: "thinking" }, "a2")

    expect(process.tools.map((part) => part.partId)).toEqual(["tool-1", "tool-2"])
    expect(process.hasVisibleOutcome).toBe(true)
    expect(process.hasActiveTool).toBe(true)
    expect(process.activity?.phase).toBe("thinking")
    expect(process.startedAt).toBe(1000)
  })

  it("groups repeated authorization failures for the same connector target", () => {
    const authOutput = JSON.stringify({
      status: "authorization_required",
      service: "posthog",
      displayName: "PostHog",
      errorCode: "app_not_found",
    })
    const turn = groupChatTurns([
      message("u1", "user", [text("u1-text", "analyze every project")]),
      message(
        "a1",
        "assistant",
        Array.from({ length: 6 }, (_, index) =>
          tool(`tool-${index}`, {
            input: { service: "posthog", action: "run_query" },
            output: authOutput,
          }),
        ),
      ),
    ])[0]

    const process = summarizeTurnProcess(turn!, null)

    expect(process.authorizationIssues).toHaveLength(1)
    expect(process.authorizationIssues[0]).toMatchObject({ count: 6, inconsistent: false, service: "posthog" })
  })

  it("keeps a cached connection block visible as an authorization issue", () => {
    const turn = groupChatTurns([
      message("u1", "user", [text("u1-text", "continue PostHog analysis")]),
      message("a1", "assistant", [
        tool("tool-skipped", {
          input: { action: "run_query" },
          output: JSON.stringify({
            status: "skipped",
            reason: "connection_blocked",
            service: "posthog",
            action: "run_query",
            errorCode: "app_not_found",
          }),
        }),
      ]),
    ])[0]

    const process = summarizeTurnProcess(turn!, null)
    expect(process.hasAuthorization).toBe(true)
    expect(process.authorizationIssues).toMatchObject([{ count: 1, service: "posthog" }])
  })

  it("uses authorization services to keep missing-input targets separate", () => {
    const blocked = (service: string) =>
      JSON.stringify({ status: "authorization_required", service, displayName: service })
    const turn = groupChatTurns([
      message("u1", "user"),
      message("a1", "assistant", [
        tool("tool-gmail", { output: blocked("gmail") }),
        tool("tool-slack", { output: blocked("slack") }),
      ]),
    ])[0]

    expect(summarizeTurnProcess(turn!, null).authorizationIssues.map((issue) => issue.service)).toEqual([
      "gmail",
      "slack",
    ])
  })

  it("marks authorization as inconsistent after the same connection target succeeded", () => {
    const turn = groupChatTurns([
      message("u1", "user", [text("u1-text", "analyze PostHog")]),
      message("a1", "assistant", [
        tool("tool-success", {
          input: { service: "posthog", action: "run_query" },
          output: JSON.stringify({ data: { results: [] } }),
        }),
        tool("tool-auth", {
          input: { service: "posthog", action: "run_query" },
          output: JSON.stringify({
            status: "authorization_required",
            service: "posthog",
            displayName: "PostHog",
            errorCode: "app_not_found",
          }),
        }),
      ]),
    ])[0]

    const process = summarizeTurnProcess(turn!, null)

    expect(process.authorizationIssues).toHaveLength(1)
    expect(process.authorizationIssues[0]?.inconsistent).toBe(true)
  })

  it("keeps authorization issues for different selected accounts separate", () => {
    const authOutput = JSON.stringify({
      status: "authorization_required",
      service: "gmail",
      displayName: "Gmail",
      errorCode: "credential_expired",
    })
    const turn = groupChatTurns([
      message("u1", "user", [text("u1-text", "read both inboxes")]),
      message("a1", "assistant", [
        tool("tool-work", {
          input: { service: "gmail", action: "fetch_emails", connectionName: "work" },
          output: authOutput,
        }),
        tool("tool-primary", {
          input: { service: "gmail", action: "fetch_emails", connectionName: "primary" },
          output: authOutput,
        }),
      ]),
    ])[0]

    const process = summarizeTurnProcess(turn!, null)

    expect(process.authorizationIssues).toHaveLength(2)
    expect(process.authorizationIssues.map((issue) => issue.connectionName)).toEqual(["work", "primary"])
  })

  it("keeps completed tool history running while the turn is still active", () => {
    const turn = groupChatTurns([
      message("u1", "user", [text("u1-text", "create a page")]),
      message("a1", "assistant", [
        text("a1-text", "I will check the connector."),
        tool("tool-1", { status: "completed", timing: { start: 1000, end: 1800 } }),
      ]),
      message("a2", "assistant", [text("a2-text", "Now I can continue.")]),
    ])[0]

    expect(turn).toBeDefined()
    const process = summarizeTurnProcess(turn!, null, "a2")

    expect(process.hasActiveTool).toBe(false)
    expect(process.hasVisibleOutcome).toBe(true)
    expect(isLiveTurnProcess(process, true)).toBe(true)
    expect(chatTurnProcessStatus(process, true)).toBe("running")
    expect(chatTurnProcessStatus(process, false)).toBe("completed")
    expect(settlingToolPartId(process, chatTurnProcessStatus(process, true))).toBe("tool-1")
    expect(settlingToolPartId(process, chatTurnProcessStatus(process, false))).toBeUndefined()
  })

  it("keeps the loading shimmer on the active tool instead of a previous completed tool", () => {
    const turn = groupChatTurns([
      message("u1", "user", [text("u1-text", "create a page")]),
      message("a1", "assistant", [tool("tool-1"), tool("tool-2", { status: "running" })]),
    ])[0]

    const process = summarizeTurnProcess(turn!, null, "a1")

    expect(settlingToolPartId(process, chatTurnProcessStatus(process, true))).toBeUndefined()
  })

  it("does not shimmer a failed tool while the live turn recovers", () => {
    const turn = groupChatTurns([
      message("u1", "user", [text("u1-text", "create a page")]),
      message("a1", "assistant", [tool("tool-1", { status: "error", error: "temporary failure" })]),
    ])[0]

    const process = summarizeTurnProcess(turn!, null, "a1")

    expect(settlingToolPartId(process, chatTurnProcessStatus(process, true))).toBeUndefined()
  })

  it("does not treat a text-only live answer as an active process", () => {
    const turn = groupChatTurns([
      message("u1", "user", [text("u1-text", "hello")]),
      message("a1", "assistant", [text("a1-text", "Hi there.")]),
    ])[0]

    expect(turn).toBeDefined()
    const process = summarizeTurnProcess(turn!, null, "a1")

    expect(process.tools).toEqual([])
    expect(isLiveTurnProcess(process, true)).toBe(false)
    expect(chatTurnProcessStatus(process, true)).toBe("completed")
  })

  it("does not treat unauthenticated search results as an authorization blocker", () => {
    const turn = groupChatTurns([
      message("u1", "user", [text("u1-text", "分析一下 TikHub 的公开内容")]),
      message("a1", "assistant", [
        tool("tool-1", {
          tool: "search_actions",
          input: { query: "TikHub public social research" },
          output: JSON.stringify([{ service: "tikhub", name: "search_posts", authenticated: false }]),
        }),
      ]),
      message("a2", "assistant", [text("a2-text", "已完成公开内容分析。")]),
    ])[0]

    expect(turn).toBeDefined()
    const process = summarizeTurnProcess(turn!, null)

    expect(process.hasAuthorization).toBe(false)
    expect(process.authorizationIssues).toEqual([])
    expect(chatTurnProcessStatus(process)).toBe("completed")
  })

  it("uses activity without message id for the current turn", () => {
    const turn = groupChatTurns([message("u1", "user", [text("u1-text", "hello")]), message("a1", "assistant")])[0]

    expect(turn).toBeDefined()
    const process = summarizeTurnProcess(turn!, { sessionId: "s1", phase: "thinking" })

    expect(process.activity?.phase).toBe("thinking")
    expect(process.hasVisibleOutcome).toBe(false)
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

  it("treats tool errors followed by a visible outcome as non-blocking", () => {
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
    expect(process.hasVisibleOutcome).toBe(true)
    expect(process.hasBlockingError).toBe(false)
  })

  it("keeps tool errors blocking when no visible outcome exists", () => {
    const turn = groupChatTurns([
      message("u1", "user", [text("u1-text", "find images")]),
      message("a1", "assistant", [
        tool("tool-1", { status: "error", error: "Ripgrep JSON record exceeded 65536 bytes" }),
      ]),
    ])[0]

    expect(turn).toBeDefined()
    const process = summarizeTurnProcess(turn!, null)

    expect(process.hasToolError).toBe(true)
    expect(process.hasVisibleOutcome).toBe(false)
    expect(process.hasBlockingError).toBe(true)
  })

  it("does not let folded progress text downgrade a blocking tool error", () => {
    const turn = groupChatTurns([
      message("u1", "user", [text("u1-text", "find images")]),
      message("a1", "assistant", [
        text("progress", "I will try the image search now."),
        tool("tool-1", { status: "error", error: "Image search unavailable" }),
      ]),
    ])[0]

    expect(turn).toBeDefined()
    const process = summarizeTurnProcess(turn!, null, undefined, { hasVisibleOutcome: false })

    expect(process.hasVisibleOutcome).toBe(false)
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
