import type { AgentEvent } from "../contract/event.ts"
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk"

import { describe, expect, it } from "vitest"
import { createClaudeTurnTranslator } from "./translator.ts"

function findAgentError(events: AgentEvent[]): Extract<AgentEvent, { event: "agentError" }> | undefined {
  return events.find((event): event is Extract<AgentEvent, { event: "agentError" }> => event.event === "agentError")
}

// Pure unit tests over hand-built SDK message fixtures. Envelope fields the
// translator never reads (uuid, session_id, usage, ...) are minimized and the
// fixtures are cast through `as unknown as SDKMessage`.

const sessionId = "wanta-ext:claude-code:11111111-1111-4111-8111-111111111111"

function streamEvent(event: unknown): SDKMessage {
  return {
    type: "stream_event",
    event,
    parent_tool_use_id: null,
    uuid: "aaaaaaaa-0000-4000-8000-000000000001",
    session_id: "sdk-session",
  } as unknown as SDKMessage
}

function messageStart(id: string): SDKMessage {
  return streamEvent({ type: "message_start", message: { id, type: "message", role: "assistant", content: [] } })
}

function blockStart(index: number, contentBlock: unknown): SDKMessage {
  return streamEvent({ type: "content_block_start", index, content_block: contentBlock })
}

function blockDelta(index: number, delta: unknown): SDKMessage {
  return streamEvent({ type: "content_block_delta", index, delta })
}

function assistantMessage(id: string, content: unknown[], error?: string): SDKMessage {
  return {
    type: "assistant",
    message: { id, type: "message", role: "assistant", content },
    parent_tool_use_id: null,
    ...(error !== undefined ? { error } : {}),
    uuid: "aaaaaaaa-0000-4000-8000-000000000002",
    session_id: "sdk-session",
  } as unknown as SDKMessage
}

function userMessage(
  content: unknown,
  extra: { isReplay?: boolean; isSynthetic?: boolean; uuid?: string } = {},
): SDKMessage {
  return {
    type: "user",
    message: { role: "user", content },
    parent_tool_use_id: null,
    ...(extra.isReplay !== undefined ? { isReplay: extra.isReplay } : {}),
    ...(extra.isSynthetic !== undefined ? { isSynthetic: extra.isSynthetic } : {}),
    ...(extra.uuid !== undefined ? { uuid: extra.uuid } : {}),
    session_id: "sdk-session",
  } as unknown as SDKMessage
}

describe("createClaudeTurnTranslator", () => {
  it("streams text deltas as cumulative messageDelta after a single messageStarted", () => {
    const translator = createClaudeTurnTranslator(sessionId)

    expect(translator.translate(messageStart("msg_1"))).toEqual([
      { event: "messageStarted", data: { sessionId, messageId: "msg_1", role: "assistant" } },
    ])
    expect(translator.translate(blockStart(0, { type: "text", text: "" }))).toEqual([])
    expect(translator.translate(blockDelta(0, { type: "text_delta", text: "Hel" }))).toEqual([
      { event: "messageDelta", data: { sessionId, messageId: "msg_1", partId: "msg_1:0", text: "Hel", delta: "Hel" } },
    ])
    expect(translator.translate(blockDelta(0, { type: "text_delta", text: "lo" }))).toEqual([
      { event: "messageDelta", data: { sessionId, messageId: "msg_1", partId: "msg_1:0", text: "Hello", delta: "lo" } },
    ])
  })

  it("streams thinking deltas as cumulative messageReasoningDelta", () => {
    const translator = createClaudeTurnTranslator(sessionId)
    translator.translate(messageStart("msg_1"))
    translator.translate(blockStart(0, { type: "thinking", thinking: "", signature: "" }))

    expect(translator.translate(blockDelta(0, { type: "thinking_delta", thinking: "Consider " }))).toEqual([
      {
        event: "messageReasoningDelta",
        data: { sessionId, messageId: "msg_1", partId: "msg_1:0", text: "Consider ", delta: "Consider " },
      },
    ])
    expect(translator.translate(blockDelta(0, { type: "thinking_delta", thinking: "this" }))).toEqual([
      {
        event: "messageReasoningDelta",
        data: { sessionId, messageId: "msg_1", partId: "msg_1:0", text: "Consider this", delta: "this" },
      },
    ])
  })

  it("emits toolCallStarted for streamed tool_use blocks and no events for input_json_delta", () => {
    const translator = createClaudeTurnTranslator(sessionId)
    translator.translate(messageStart("msg_1"))

    expect(translator.translate(blockStart(1, { type: "tool_use", id: "toolu_1", name: "Bash", input: {} }))).toEqual([
      {
        event: "toolCallStarted",
        data: {
          sessionId,
          messageId: "msg_1",
          partId: "toolu_1",
          callId: "toolu_1",
          tool: "Bash",
          input: {},
          status: "running",
        },
      },
    ])
    expect(translator.translate(blockDelta(1, { type: "input_json_delta", partial_json: '{"command":' }))).toEqual([])
  })

  it("pairs tool results with the recorded start: partId, messageId, tool, and input correlate", () => {
    const translator = createClaudeTurnTranslator(sessionId)
    translator.translate(messageStart("msg_1"))
    translator.translate(blockStart(0, { type: "tool_use", id: "toolu_1", name: "Bash", input: {} }))
    // The authoritative upsert refreshes the recorded input before the result.
    translator.translate(
      assistantMessage("msg_1", [{ type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "ls" } }]),
    )

    const events = translator.translate(
      userMessage([{ type: "tool_result", tool_use_id: "toolu_1", content: "ok", is_error: false }]),
    )
    expect(events).toEqual([
      {
        event: "toolCallResult",
        data: {
          sessionId,
          messageId: "msg_1",
          partId: "toolu_1",
          callId: "toolu_1",
          tool: "Bash",
          status: "completed",
          input: { command: "ls" },
          output: "ok",
        },
      },
    ])
  })

  it("maps is_error tool results to error status with the stringified content as error", () => {
    const translator = createClaudeTurnTranslator(sessionId)
    translator.translate(
      assistantMessage("msg_1", [{ type: "tool_use", id: "toolu_2", name: "Read", input: { file_path: "/x" } }]),
    )

    const events = translator.translate(
      userMessage([
        {
          type: "tool_result",
          tool_use_id: "toolu_2",
          content: [{ type: "text", text: "no such file" }],
          is_error: true,
        },
      ]),
    )
    expect(events).toEqual([
      {
        event: "toolCallResult",
        data: {
          sessionId,
          messageId: "msg_1",
          partId: "toolu_2",
          callId: "toolu_2",
          tool: "Read",
          status: "error",
          input: { file_path: "/x" },
          error: "no such file",
        },
      },
    ])
  })

  it("falls back to callId and generic tool name for unmatched tool results", () => {
    const translator = createClaudeTurnTranslator(sessionId)
    const events = translator.translate(userMessage([{ type: "tool_result", tool_use_id: "toolu_x", content: "late" }]))
    expect(events).toEqual([
      {
        event: "toolCallResult",
        data: {
          sessionId,
          messageId: "toolu_x",
          partId: "toolu_x",
          callId: "toolu_x",
          tool: "tool",
          status: "completed",
          input: {},
          output: "late",
        },
      },
    ])
  })

  it("upserts full assistant messages authoritatively without deltas", () => {
    const translator = createClaudeTurnTranslator(sessionId)
    translator.translate(messageStart("msg_1"))
    translator.translate(blockStart(0, { type: "text", text: "" }))
    translator.translate(blockDelta(0, { type: "text_delta", text: "Hel" }))

    const events = translator.translate(
      assistantMessage("msg_1", [
        { type: "text", text: "Hello world" },
        { type: "thinking", thinking: "hidden", signature: "" },
      ]),
    )
    // messageStarted was already emitted for msg_1 by the stream: not repeated.
    expect(events).toEqual([
      { event: "messageDelta", data: { sessionId, messageId: "msg_1", partId: "msg_1:0", text: "Hello world" } },
      {
        event: "messageReasoningDelta",
        data: { sessionId, messageId: "msg_1", partId: "msg_1:1", text: "hidden" },
      },
    ])
  })

  it("emits messageStarted before content for a full assistant message with no prior stream", () => {
    const translator = createClaudeTurnTranslator(sessionId)
    const events = translator.translate(assistantMessage("msg_9", [{ type: "text", text: "hi" }]))
    expect(events).toEqual([
      { event: "messageStarted", data: { sessionId, messageId: "msg_9", role: "assistant" } },
      { event: "messageDelta", data: { sessionId, messageId: "msg_9", partId: "msg_9:0", text: "hi" } },
    ])
  })

  it("appends the login hint for authentication_failed assistant errors", () => {
    const translator = createClaudeTurnTranslator(sessionId)
    const events = translator.translate(assistantMessage("msg_1", [], "authentication_failed"))
    const errorEvent = findAgentError(events)
    expect(errorEvent?.data.message).toContain("authentication_failed")
    expect(errorEvent?.data.message).toContain("Run `claude` in a terminal and sign in, then retry.")
  })

  it("includes the error kind for non-auth assistant errors without the login hint", () => {
    const translator = createClaudeTurnTranslator(sessionId)
    const events = translator.translate(assistantMessage("msg_1", [], "billing_error"))
    const errorEvent = findAgentError(events)
    expect(errorEvent?.data.message).toContain("billing_error")
    expect(errorEvent?.data.message).not.toContain("sign in")
  })

  it("surfaces replayed user text as a user message, ignoring synthetic and non-replay frames", () => {
    const translator = createClaudeTurnTranslator(sessionId)

    expect(translator.translate(userMessage("hi there", { isReplay: true, uuid: "user-uuid-1" }))).toEqual([
      { event: "messageStarted", data: { sessionId, messageId: "user-uuid-1", role: "user" } },
      {
        event: "messageDelta",
        data: { sessionId, messageId: "user-uuid-1", partId: "user-uuid-1:0", text: "hi there" },
      },
    ])
    expect(
      translator.translate(userMessage("internal", { isReplay: true, isSynthetic: true, uuid: "user-uuid-2" })),
    ).toEqual([])
    expect(translator.translate(userMessage("not a replay"))).toEqual([])
  })

  it("maps result success to messageCompleted only", () => {
    const translator = createClaudeTurnTranslator(sessionId)
    const events = translator.translate({
      type: "result",
      subtype: "success",
      is_error: false,
      result: "done",
    } as unknown as SDKMessage)
    expect(events).toEqual([{ event: "messageCompleted", data: { sessionId } }])
  })

  it("adds an agentError with joined errors for error results", () => {
    const translator = createClaudeTurnTranslator(sessionId)
    const events = translator.translate({
      type: "result",
      subtype: "error_during_execution",
      is_error: true,
      errors: ["boom", "again"],
    } as unknown as SDKMessage)
    expect(events[0]).toEqual({ event: "messageCompleted", data: { sessionId } })
    const errorEvent = findAgentError(events)
    expect(errorEvent?.data.sessionId).toBe(sessionId)
    expect(errorEvent?.data.message).toContain("boom; again")
    expect(errorEvent?.data.message).toContain("error_during_execution")
  })

  it("maps system status/api_retry/compact_boundary to assistantActivity phases", () => {
    const translator = createClaudeTurnTranslator(sessionId)

    expect(
      translator.translate({ type: "system", subtype: "status", status: "compacting" } as unknown as SDKMessage),
    ).toEqual([{ event: "assistantActivity", data: { sessionId, phase: "compacting" } }])
    expect(
      translator.translate({ type: "system", subtype: "status", status: "requesting" } as unknown as SDKMessage),
    ).toEqual([])
    expect(
      translator.translate({
        type: "system",
        subtype: "api_retry",
        attempt: 2,
        max_retries: 5,
        retry_delay_ms: 1000,
        error_status: 529,
        error: "overloaded",
      } as unknown as SDKMessage),
    ).toEqual([
      { event: "assistantActivity", data: { sessionId, phase: "retrying", attempt: 2, message: "overloaded" } },
    ])
    expect(
      translator.translate({
        type: "system",
        subtype: "compact_boundary",
        compact_metadata: { trigger: "auto", pre_tokens: 1000 },
      } as unknown as SDKMessage),
    ).toEqual([{ event: "assistantActivity", data: { sessionId, phase: "resuming" } }])
  })

  it("ignores unknown message types instead of throwing", () => {
    const translator = createClaudeTurnTranslator(sessionId)
    expect(translator.translate({ type: "system", subtype: "init" } as unknown as SDKMessage)).toEqual([])
    expect(
      translator.translate({
        type: "tool_progress",
        tool_use_id: "t",
        tool_name: "Bash",
        elapsed_time_seconds: 1,
      } as unknown as SDKMessage),
    ).toEqual([])
    expect(
      translator.translate({ type: "auth_status", isAuthenticating: true, output: [] } as unknown as SDKMessage),
    ).toEqual([])
    expect(translator.translate(streamEvent({ type: "message_stop" }))).toEqual([])
  })
})
