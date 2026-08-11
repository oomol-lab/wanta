import type { SessionUpdate } from "@agentclientprotocol/sdk"

import { describe, expect, test } from "vitest"
import { agentEventIssues } from "../contract/event.ts"
import { createAcpSessionTranslator } from "./translator.ts"

// Unit tests for the ACP session/update -> AgentEvent mapping. Synthetic
// message ids are minted from a process-global sequence, so assertions capture
// ids from emitted events instead of hardcoding them.

const SESSION_ID = "wanta-session-1"

function textChunk(text: string, messageId?: string): SessionUpdate {
  return {
    sessionUpdate: "agent_message_chunk",
    content: { type: "text", text },
    ...(messageId !== undefined ? { messageId } : {}),
  }
}

function thoughtChunk(text: string, messageId?: string): SessionUpdate {
  return {
    sessionUpdate: "agent_thought_chunk",
    content: { type: "text", text },
    ...(messageId !== undefined ? { messageId } : {}),
  }
}

function messageIdOf(event: { event: string; data: unknown }): string {
  return (event.data as { messageId: string }).messageId
}

describe("agent_message_chunk", () => {
  test("accumulates cumulative text under an explicit messageId", () => {
    const translator = createAcpSessionTranslator(SESSION_ID)
    translator.noteTurnStarted()
    expect(translator.translate(textChunk("Hel", "m1"))).toEqual([
      { event: "messageStarted", data: { sessionId: SESSION_ID, messageId: "m1", role: "assistant" } },
      {
        event: "messageDelta",
        data: { sessionId: SESSION_ID, messageId: "m1", partId: "m1:text", text: "Hel", delta: "Hel" },
      },
    ])
    expect(translator.translate(textChunk("lo", "m1"))).toEqual([
      {
        event: "messageDelta",
        data: { sessionId: SESSION_ID, messageId: "m1", partId: "m1:text", text: "Hello", delta: "lo" },
      },
    ])
  })

  test("mints a stable synthetic message id when messageId is absent", () => {
    const translator = createAcpSessionTranslator(SESSION_ID)
    translator.noteTurnStarted()
    const first = translator.translate(textChunk("a"))
    expect(first.map((event) => event.event)).toEqual(["messageStarted", "messageDelta"])
    const syntheticId = messageIdOf(first[0]!)
    expect(syntheticId).not.toBe("")
    const second = translator.translate(textChunk("b"))
    expect(second).toEqual([
      {
        event: "messageDelta",
        data: {
          sessionId: SESSION_ID,
          messageId: syntheticId,
          partId: `${syntheticId}:text`,
          text: "ab",
          delta: "b",
        },
      },
    ])
  })

  test("noteTurnStarted rotates the synthetic message id", () => {
    const translator = createAcpSessionTranslator(SESSION_ID)
    translator.noteTurnStarted()
    const first = translator.translate(textChunk("turn one"))
    translator.noteTurnStarted()
    const second = translator.translate(textChunk("turn two"))
    expect(second.map((event) => event.event)).toEqual(["messageStarted", "messageDelta"])
    expect(messageIdOf(second[0]!)).not.toBe(messageIdOf(first[0]!))
  })

  test("renders resource_link blocks as markdown links", () => {
    const translator = createAcpSessionTranslator(SESSION_ID)
    translator.noteTurnStarted()
    const events = translator.translate({
      sessionUpdate: "agent_message_chunk",
      content: { type: "resource_link", uri: "file:///a.ts", name: "a.ts" },
      messageId: "m1",
    })
    expect(events).toEqual([
      { event: "messageStarted", data: { sessionId: SESSION_ID, messageId: "m1", role: "assistant" } },
      {
        event: "messageDelta",
        data: {
          sessionId: SESSION_ID,
          messageId: "m1",
          partId: "m1:text",
          text: "[a.ts](file:///a.ts)",
          delta: "[a.ts](file:///a.ts)",
        },
      },
    ])
  })

  test("content blocks without a text projection produce no events", () => {
    const translator = createAcpSessionTranslator(SESSION_ID)
    translator.noteTurnStarted()
    const events = translator.translate({
      sessionUpdate: "agent_message_chunk",
      content: { type: "image", data: "aGk=", mimeType: "image/png" },
      messageId: "m1",
    })
    expect(events).toEqual([])
  })
})

describe("agent_thought_chunk", () => {
  test("emits reasoning deltas on a dedicated part of the same message", () => {
    const translator = createAcpSessionTranslator(SESSION_ID)
    translator.noteTurnStarted()
    const thought = translator.translate(thoughtChunk("hmm", "m1"))
    expect(thought).toEqual([
      { event: "messageStarted", data: { sessionId: SESSION_ID, messageId: "m1", role: "assistant" } },
      {
        event: "messageReasoningDelta",
        data: { sessionId: SESSION_ID, messageId: "m1", partId: "m1:thought", text: "hmm", delta: "hmm" },
      },
    ])
    // Following narration for the same message must not re-start it.
    expect(translator.translate(textChunk("answer", "m1"))).toEqual([
      {
        event: "messageDelta",
        data: { sessionId: SESSION_ID, messageId: "m1", partId: "m1:text", text: "answer", delta: "answer" },
      },
    ])
  })

  test("thought and text chunks without messageId share the synthetic message", () => {
    const translator = createAcpSessionTranslator(SESSION_ID)
    translator.noteTurnStarted()
    const thought = translator.translate(thoughtChunk("thinking"))
    const syntheticId = messageIdOf(thought[0]!)
    const narration = translator.translate(textChunk("done"))
    expect(narration).toEqual([
      {
        event: "messageDelta",
        data: {
          sessionId: SESSION_ID,
          messageId: syntheticId,
          partId: `${syntheticId}:text`,
          text: "done",
          delta: "done",
        },
      },
    ])
  })
})

describe("tool_call lifecycle", () => {
  test("attaches to the current message and rotates for following narration", () => {
    const translator = createAcpSessionTranslator(SESSION_ID)
    translator.noteTurnStarted()
    const narration = translator.translate(textChunk("Let me read that file."))
    const narrationMessageId = messageIdOf(narration[0]!)
    const toolEvents = translator.translate({
      sessionUpdate: "tool_call",
      toolCallId: "call-1",
      title: "Read file",
      kind: "read",
      status: "in_progress",
      rawInput: { path: "/tmp/a.txt" },
    })
    expect(toolEvents).toEqual([
      {
        event: "toolCallStarted",
        data: {
          sessionId: SESSION_ID,
          messageId: narrationMessageId,
          partId: "call-1",
          callId: "call-1",
          tool: "read",
          input: { path: "/tmp/a.txt" },
          status: "running",
          title: "Read file",
        },
      },
    ])
    const followup = translator.translate(textChunk("Here is what I found."))
    expect(followup.map((event) => event.event)).toEqual(["messageStarted", "messageDelta"])
    expect(messageIdOf(followup[0]!)).not.toBe(narrationMessageId)
  })

  test("prefers the unstable name over kind for the tool field", () => {
    const translator = createAcpSessionTranslator(SESSION_ID)
    translator.noteTurnStarted()
    const events = translator.translate({
      sessionUpdate: "tool_call",
      toolCallId: "call-1",
      title: "Run command",
      name: "bash",
      kind: "execute",
    })
    expect(events.at(-1)).toMatchObject({ event: "toolCallStarted", data: { tool: "bash" } })
  })

  test("starts its own assistant message when no narration preceded it", () => {
    const translator = createAcpSessionTranslator(SESSION_ID)
    translator.noteTurnStarted()
    const events = translator.translate({
      sessionUpdate: "tool_call",
      toolCallId: "call-1",
      title: "Search",
      kind: "search",
    })
    expect(events.map((event) => event.event)).toEqual(["messageStarted", "toolCallStarted"])
    expect(messageIdOf(events[0]!)).toBe(messageIdOf(events[1]!))
  })

  test("a terminal initial status emits started plus the terminal result", () => {
    const translator = createAcpSessionTranslator(SESSION_ID)
    translator.noteTurnStarted()
    const events = translator.translate({
      sessionUpdate: "tool_call",
      toolCallId: "call-1",
      title: "Read file",
      kind: "read",
      status: "completed",
      rawInput: { path: "/tmp/a.txt" },
      rawOutput: { bytes: 12 },
    })
    expect(events.map((event) => event.event)).toEqual(["messageStarted", "toolCallStarted", "toolCallResult"])
    expect(events.at(-1)).toMatchObject({
      event: "toolCallResult",
      data: { status: "completed", callId: "call-1", output: JSON.stringify({ bytes: 12 }) },
    })
  })

  test("partial updates merge into a running upsert", () => {
    const translator = createAcpSessionTranslator(SESSION_ID)
    translator.noteTurnStarted()
    translator.translate({
      sessionUpdate: "tool_call",
      toolCallId: "call-1",
      title: "Edit file",
      kind: "edit",
    })
    const events = translator.translate({
      sessionUpdate: "tool_call_update",
      toolCallId: "call-1",
      status: "in_progress",
      rawInput: { path: "/tmp/b.txt" },
      title: "Edit b.txt",
    })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      event: "toolCallStarted",
      data: {
        partId: "call-1",
        callId: "call-1",
        tool: "edit",
        status: "running",
        title: "Edit b.txt",
        input: { path: "/tmp/b.txt" },
      },
    })
  })

  test("a completed update emits toolCallResult with concatenated content output", () => {
    const translator = createAcpSessionTranslator(SESSION_ID)
    translator.noteTurnStarted()
    const started = translator.translate({
      sessionUpdate: "tool_call",
      toolCallId: "call-1",
      title: "Edit file",
      kind: "edit",
      rawInput: { path: "/tmp/b.txt" },
    })
    const toolMessageId = messageIdOf(started[0]!)
    const events = translator.translate({
      sessionUpdate: "tool_call_update",
      toolCallId: "call-1",
      status: "completed",
      content: [
        { type: "content", content: { type: "text", text: "wrote 2 lines" } },
        { type: "diff", path: "/tmp/b.txt", newText: "hello" },
      ],
    })
    expect(events).toEqual([
      {
        event: "toolCallResult",
        data: {
          sessionId: SESSION_ID,
          messageId: toolMessageId,
          partId: "call-1",
          callId: "call-1",
          tool: "edit",
          status: "completed",
          input: { path: "/tmp/b.txt" },
          output: "wrote 2 lines\n/tmp/b.txt",
          title: "Edit file",
        },
      },
    ])
  })

  test("a completed update without content falls back to rawOutput JSON", () => {
    const translator = createAcpSessionTranslator(SESSION_ID)
    translator.noteTurnStarted()
    translator.translate({ sessionUpdate: "tool_call", toolCallId: "call-1", title: "Fetch" })
    const events = translator.translate({
      sessionUpdate: "tool_call_update",
      toolCallId: "call-1",
      status: "completed",
      rawOutput: { status: 200 },
    })
    expect(events[0]).toMatchObject({
      event: "toolCallResult",
      data: { status: "completed", output: JSON.stringify({ status: 200 }) },
    })
  })

  test("a failed update emits an error result with best-effort text", () => {
    const translator = createAcpSessionTranslator(SESSION_ID)
    translator.noteTurnStarted()
    translator.translate({ sessionUpdate: "tool_call", toolCallId: "call-1", title: "Run tests" })
    const events = translator.translate({
      sessionUpdate: "tool_call_update",
      toolCallId: "call-1",
      status: "failed",
      content: [{ type: "content", content: { type: "text", text: "2 tests failed" } }],
    })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      event: "toolCallResult",
      data: { status: "error", error: "2 tests failed" },
    })
  })

  test("a failed update without content falls back to a named error", () => {
    const translator = createAcpSessionTranslator(SESSION_ID)
    translator.noteTurnStarted()
    translator.translate({ sessionUpdate: "tool_call", toolCallId: "call-1", title: "Run tests" })
    const events = translator.translate({
      sessionUpdate: "tool_call_update",
      toolCallId: "call-1",
      status: "failed",
    })
    expect(events[0]).toMatchObject({
      event: "toolCallResult",
      data: { status: "error", error: "Run tests failed" },
    })
  })

  test("updates after a terminal status are dropped", () => {
    const translator = createAcpSessionTranslator(SESSION_ID)
    translator.noteTurnStarted()
    translator.translate({ sessionUpdate: "tool_call", toolCallId: "call-1", title: "Fetch", status: "completed" })
    const events = translator.translate({
      sessionUpdate: "tool_call_update",
      toolCallId: "call-1",
      status: "in_progress",
    })
    expect(events).toEqual([])
  })
})

describe("ignored variants", () => {
  const ignoredUpdates: Array<[string, SessionUpdate]> = [
    ["plan", { sessionUpdate: "plan", entries: [{ content: "step", priority: "high", status: "pending" }] }],
    ["plan_update", { sessionUpdate: "plan_update", plan: { type: "markdown", planId: "p1", content: "# Plan" } }],
    ["plan_removed", { sessionUpdate: "plan_removed", planId: "p1" }],
    ["available_commands_update", { sessionUpdate: "available_commands_update", availableCommands: [] }],
    ["current_mode_update", { sessionUpdate: "current_mode_update", currentModeId: "default" }],
    ["config_option_update", { sessionUpdate: "config_option_update", configOptions: [] }],
    ["session_info_update", { sessionUpdate: "session_info_update", title: "New title" }],
    ["usage_update", { sessionUpdate: "usage_update", used: 100, size: 200_000 }],
    ["user_message_chunk", { sessionUpdate: "user_message_chunk", content: { type: "text", text: "hi" } }],
  ]

  test.each(ignoredUpdates)("%s produces no events", (_name, update) => {
    const translator = createAcpSessionTranslator(SESSION_ID)
    translator.noteTurnStarted()
    expect(translator.translate(update)).toEqual([])
  })
})

describe("event integrity", () => {
  test("all emitted events carry the Wanta session id and pass the contract schema", () => {
    const translator = createAcpSessionTranslator(SESSION_ID)
    translator.noteTurnStarted()
    const updates: SessionUpdate[] = [
      thoughtChunk("thinking"),
      textChunk("Reading"),
      {
        sessionUpdate: "tool_call",
        toolCallId: "call-1",
        title: "Read file",
        kind: "read",
        rawInput: { path: "/tmp/a.txt" },
      },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "call-1",
        status: "completed",
        content: [{ type: "content", content: { type: "text", text: "body" } }],
      },
      textChunk("Done"),
    ]
    const events = updates.flatMap((update) => translator.translate(update))
    expect(events.length).toBeGreaterThan(0)
    for (const event of events) {
      expect((event.data as { sessionId: string }).sessionId).toBe(SESSION_ID)
      expect(agentEventIssues(event)).toBeNull()
    }
  })
})
