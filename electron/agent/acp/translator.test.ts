import type { SessionUpdate } from "@agentclientprotocol/sdk"

import { describe, expect, test } from "vitest"
import { agentEventIssues } from "../contract/event.ts"
import { createAcpSessionTranslator, sanitizeAcpMessages } from "./translator.ts"

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

  test("drops codex-acp skill-budget warnings instead of rendering them as assistant text", () => {
    const translator = createAcpSessionTranslator(SESSION_ID)
    translator.noteTurnStarted()
    expect(
      translator.translate(
        textChunk(
          "Warning: Skill descriptions were shortened to fit the skills context budget. Codex can still see every skill, but some descriptions are shorter.\n\n",
        ),
      ),
    ).toEqual([])
    expect(translator.translate(textChunk("Actual answer."))).toMatchObject([
      { event: "messageStarted" },
      { event: "messageDelta", data: { text: "Actual answer." } },
    ])
  })

  test("strips a codex-acp skill-budget warning while preserving model text in the same chunk", () => {
    const translator = createAcpSessionTranslator(SESSION_ID)
    translator.noteTurnStarted()
    expect(
      translator.translate(
        textChunk(
          "Warning: Skill descriptions were shortened to fit the skills context budget. More detail.\n\nActual answer.",
        ),
      ),
    ).toMatchObject([
      { event: "messageStarted" },
      { event: "messageDelta", data: { delta: "Actual answer.", text: "Actual answer." } },
    ])
  })

  test("projects context compaction as lifecycle activity instead of assistant text", () => {
    const translator = createAcpSessionTranslator(SESSION_ID)
    translator.noteTurnStarted()
    expect(translator.translate(textChunk("Compacting..."))).toEqual([
      { event: "assistantActivity", data: { sessionId: SESSION_ID, phase: "compacting" } },
    ])
    expect(translator.translate(textChunk("\n\nCompacting completed."))).toEqual([
      { event: "assistantActivity", data: { sessionId: SESSION_ID, phase: "resuming" } },
    ])
    expect(translator.translate(textChunk("Actual answer."))).toMatchObject([
      { event: "messageStarted" },
      { event: "messageDelta", data: { text: "Actual answer." } },
    ])
  })

  test("preserves real narration appended after a compaction notice", () => {
    const translator = createAcpSessionTranslator(SESSION_ID)
    translator.noteTurnStarted()
    expect(translator.translate(textChunk("Compacting...\n\nCompacting completed.\n\nContinuing now."))).toMatchObject([
      { event: "assistantActivity", data: { phase: "resuming" } },
      { event: "messageStarted" },
      { event: "messageDelta", data: { text: "Continuing now.", delta: "Continuing now." } },
    ])
  })
})

describe("persisted compaction notices", () => {
  test("removes lifecycle-only messages and strips a lifecycle prefix from mixed text", () => {
    expect(
      sanitizeAcpMessages([
        {
          id: "status-only",
          role: "assistant",
          createdAt: 1,
          parts: [{ kind: "text", partId: "status-only:text", text: "Compacting...\n\nCompacting completed." }],
        },
        {
          id: "mixed",
          role: "assistant",
          createdAt: 2,
          parts: [
            {
              kind: "text",
              partId: "mixed:text",
              text: "Compacting...\n\nCompacting completed.\n\nVisible answer.",
            },
          ],
        },
        {
          id: "legacy-mcp",
          role: "assistant",
          createdAt: 3,
          parts: [
            {
              kind: "tool",
              partId: "legacy-call",
              callId: "legacy-call",
              tool: "other",
              title: "mcp__wanta_link__call_action",
              status: "completed",
              input: { service: "posthog", action: "run_query" },
            },
          ],
        },
        {
          id: "legacy-startup",
          role: "assistant",
          createdAt: 4,
          parts: [
            {
              kind: "tool",
              partId: "startup-call",
              callId: "startup-call",
              tool: "other",
              title: "mcp__wanta_browser__startup",
              status: "pending",
              input: {},
            },
          ],
        },
      ]),
    ).toEqual([
      {
        id: "mixed",
        role: "assistant",
        createdAt: 2,
        parts: [{ kind: "text", partId: "mixed:text", text: "Visible answer." }],
      },
      {
        id: "legacy-mcp",
        role: "assistant",
        createdAt: 3,
        parts: [
          {
            kind: "tool",
            partId: "legacy-call",
            callId: "legacy-call",
            tool: "call_action",
            title: "mcp__wanta_link__call_action",
            status: "completed",
            input: { service: "posthog", action: "run_query" },
          },
        ],
      },
    ])
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

  test("synthetic message ids use a restart-safe translator namespace", () => {
    const firstTranslator = createAcpSessionTranslator(SESSION_ID, undefined, "11111111-1111-4111-8111-111111111111")
    const secondTranslator = createAcpSessionTranslator(SESSION_ID, undefined, "22222222-2222-4222-8222-222222222222")
    firstTranslator.noteTurnStarted()
    secondTranslator.noteTurnStarted()

    const firstId = messageIdOf(firstTranslator.translate(textChunk("first"))[0]!)
    const secondId = messageIdOf(secondTranslator.translate(textChunk("second"))[0]!)

    expect(firstId).toMatch(/^acp-msg-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}-1$/u)
    expect(secondId).toMatch(/^acp-msg-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}-1$/u)
    expect(secondId).not.toBe(firstId)
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

  test("projects Wanta Link MCP calls as native connector tools", () => {
    const translator = createAcpSessionTranslator(SESSION_ID, new Set(["wanta_link"]))
    translator.noteTurnStarted()
    const events = translator.translate({
      sessionUpdate: "tool_call",
      toolCallId: "call-link",
      title: "mcp.wanta_link.call_action",
      kind: "execute",
      rawInput: {
        server: "wanta_link",
        tool: "call_action",
        arguments: { service: "posthog", action: "run_query" },
      },
    })
    expect(events.at(-1)).toMatchObject({
      event: "toolCallStarted",
      data: { tool: "call_action", input: { service: "posthog", action: "run_query" } },
    })
    expect(translator.wantaHostToolForCall("call-link")).toBe("call_action")
    expect(translator.wantaHostToolForCall("missing")).toBeUndefined()
  })

  test("normalizes claude-agent-acp native MCP names to the same Wanta tool vocabulary", () => {
    const translator = createAcpSessionTranslator(SESSION_ID, new Set(["wanta_link"]))
    translator.noteTurnStarted()
    const events = translator.translate({
      sessionUpdate: "tool_call",
      toolCallId: "call-link",
      title: "mcp__wanta_link__call_action",
      kind: "other",
      rawInput: { service: "posthog", action: "run_query", params: { project_id: 1 } },
    })
    expect(events.at(-1)).toMatchObject({
      event: "toolCallStarted",
      data: {
        tool: "call_action",
        input: { service: "posthog", action: "run_query", params: { project_id: 1 } },
      },
    })
    expect(translator.wantaHostToolForCall("call-link")).toBe("call_action")
  })

  test("turns a native Wanta Skill MCP title into the existing human skill label", () => {
    const translator = createAcpSessionTranslator(SESSION_ID, new Set(["wanta_skills"]))
    translator.noteTurnStarted()
    const events = translator.translate({
      sessionUpdate: "tool_call",
      toolCallId: "load-skill",
      title: "mcp__wanta_skills__load_skill",
      kind: "other",
      status: "in_progress",
      rawInput: { skillId: "oo-posthog" },
    })
    expect(events.at(-1)).toMatchObject({
      event: "toolCallStarted",
      data: { tool: "load_skill", title: "Loaded skill: oo-posthog", input: { skillId: "oo-posthog" } },
    })
  })

  test("replaces native Wanta Skill MCP infrastructure names with readable labels", () => {
    const translator = createAcpSessionTranslator(SESSION_ID, new Set(["wanta_skills"]))
    translator.noteTurnStarted()
    const readEvents = translator.translate({
      sessionUpdate: "tool_call",
      toolCallId: "read-skill-reference",
      title: "mcp__wanta_skills__read_skill_file",
      kind: "other",
      status: "in_progress",
      rawInput: { skillId: "oo", path: "references/search-and-selection.md" },
    })
    expect(readEvents.at(-1)).toMatchObject({
      event: "toolCallStarted",
      data: {
        tool: "read_skill_file",
        title: "Read skill reference: references/search-and-selection.md",
      },
    })

    const listEvents = translator.translate({
      sessionUpdate: "tool_call",
      toolCallId: "list-skills",
      title: "mcp__wanta_skills__list_skills",
      kind: "other",
      status: "in_progress",
      rawInput: {},
    })
    expect(listEvents.at(-1)).toMatchObject({
      event: "toolCallStarted",
      data: { tool: "list_skills", title: "List available skills" },
    })
  })

  test("drops Wanta MCP startup probes instead of creating unfinished tool steps", () => {
    const translator = createAcpSessionTranslator(SESSION_ID, new Set(["wanta_browser"]))
    translator.noteTurnStarted()
    expect(
      translator.translate({
        sessionUpdate: "tool_call",
        toolCallId: "startup-browser",
        title: "mcp__wanta_browser__startup",
        kind: "other",
        status: "in_progress",
        rawInput: {},
      }),
    ).toEqual([])
    expect(
      translator.translate({
        sessionUpdate: "tool_call_update",
        toolCallId: "startup-browser",
        status: "failed",
        rawOutput: "connection closed",
      }),
    ).toEqual([])
  })

  test("does not trust an agent-supplied Wanta-like MCP server name", () => {
    const translator = createAcpSessionTranslator(SESSION_ID, new Set(["wanta_link"]))
    const events = translator.translate({
      sessionUpdate: "tool_call",
      toolCallId: "call-spoofed",
      title: "Bash",
      kind: "execute",
      rawInput: { server: "wanta_forged", tool: "call_action", arguments: { service: "posthog" } },
    })
    expect(events.at(-1)).toMatchObject({ data: { tool: "execute" } })
    expect(translator.wantaHostToolForCall("call-spoofed")).toBeUndefined()
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
