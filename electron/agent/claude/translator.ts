import type { AgentEvent } from "../contract/event.ts"
import type {
  SDKAssistantMessage,
  SDKMessage,
  SDKUserMessage,
  SDKUserMessageReplay,
} from "@anthropic-ai/claude-agent-sdk"

// Claude Agent SDK message -> normalized AgentEvent translation (BYOA phase 1).
//
// One translator instance per live query: it keeps the per-session correlation
// state (assistant message ids already started, streaming block registry, and
// the tool_use id -> issuing assistant message map) that the contract needs for
// stable message/part ids across deltas of the same item.
//
// Message shapes verified against @anthropic-ai/claude-agent-sdk@0.3.226
// (sdk.d.ts; CLI 2.1.226): stream_event wraps BetaRawMessageStreamEvent, full
// assistant messages carry BetaMessage, tool results arrive as user messages
// with tool_result content blocks.

const LOGIN_HINT = "Run `claude` in a terminal and sign in, then retry."

type StreamBlock = { kind: "text" | "thinking"; partId: string; text: string } | { kind: "tool"; callId: string }

interface ToolCallRecord {
  messageId: string
  tool: string
  input: Record<string, unknown>
}

export interface ClaudeTurnTranslator {
  translate(message: SDKMessage): AgentEvent[]
}

// The peer package @anthropic-ai/sdk is not hoisted by pnpm, so its param
// block types are derived structurally from the agent SDK's exported shapes.
type UserContentBlock = Exclude<SDKUserMessage["message"]["content"], string>[number]
type ToolResultContent = Extract<UserContentBlock, { type: "tool_result" }>["content"]

function isReplayUserMessage(message: SDKUserMessage | SDKUserMessageReplay): message is SDKUserMessageReplay {
  return "isReplay" in message && message.isReplay === true
}

/** Flatten a tool_result content payload into the single string the contract carries. */
function stringifyToolResultContent(content: ToolResultContent): string {
  if (content === undefined) {
    return ""
  }
  if (typeof content === "string") {
    return content
  }
  const texts = content.filter((block) => block.type === "text").map((block) => block.text)
  if (texts.length > 0) {
    return texts.join("\n")
  }
  return JSON.stringify(content)
}

function assistantErrorMessage(kind: string): string {
  const base = `Claude Code reported an error: ${kind}.`
  return kind === "authentication_failed" ? `${base} ${LOGIN_HINT}` : base
}

export function createClaudeTurnTranslator(sessionId: string): ClaudeTurnTranslator {
  /** Assistant message ids that already got their messageStarted event. */
  const startedAssistantMessages = new Set<string>()
  /** API message id currently streaming through stream_event frames. */
  let streamMessageId: string | undefined
  /** content block index -> registered block state of the streaming message. */
  const streamBlocks = new Map<number, StreamBlock>()
  /** tool_use id -> issuing assistant message + recorded name/input. */
  const toolCalls = new Map<string, ToolCallRecord>()

  function ensureAssistantMessageStarted(messageId: string, events: AgentEvent[]): void {
    if (startedAssistantMessages.has(messageId)) {
      return
    }
    startedAssistantMessages.add(messageId)
    events.push({ event: "messageStarted", data: { sessionId, messageId, role: "assistant" } })
  }

  function startToolCall(
    messageId: string,
    callId: string,
    tool: string,
    input: Record<string, unknown>,
    events: AgentEvent[],
  ): void {
    toolCalls.set(callId, { messageId, tool, input })
    ensureAssistantMessageStarted(messageId, events)
    events.push({
      event: "toolCallStarted",
      data: { sessionId, messageId, partId: callId, callId, tool, input, status: "running" },
    })
  }

  function translateStreamEvent(message: Extract<SDKMessage, { type: "stream_event" }>): AgentEvent[] {
    const events: AgentEvent[] = []
    const streamEvent = message.event
    switch (streamEvent.type) {
      case "message_start": {
        streamMessageId = streamEvent.message.id
        streamBlocks.clear()
        ensureAssistantMessageStarted(streamMessageId, events)
        return events
      }
      case "content_block_start": {
        const messageId = streamMessageId
        if (messageId === undefined) {
          return events
        }
        const block = streamEvent.content_block
        if (block.type === "tool_use") {
          streamBlocks.set(streamEvent.index, { kind: "tool", callId: block.id })
          startToolCall(messageId, block.id, block.name, {}, events)
          return events
        }
        if (block.type === "text") {
          streamBlocks.set(streamEvent.index, {
            kind: "text",
            partId: `${messageId}:${streamEvent.index}`,
            text: block.text,
          })
          return events
        }
        if (block.type === "thinking") {
          streamBlocks.set(streamEvent.index, {
            kind: "thinking",
            partId: `${messageId}:${streamEvent.index}`,
            text: block.thinking,
          })
        }
        return events
      }
      case "content_block_delta": {
        const messageId = streamMessageId
        if (messageId === undefined) {
          return events
        }
        const delta = streamEvent.delta
        if (delta.type !== "text_delta" && delta.type !== "thinking_delta") {
          // input_json_delta and the remaining delta kinds produce no contract
          // event; tool input arrives complete on the full assistant message.
          return events
        }
        const kind = delta.type === "text_delta" ? "text" : "thinking"
        let block = streamBlocks.get(streamEvent.index)
        if (!block || block.kind !== kind) {
          // Defensive lazy registration for deltas whose start frame was missed.
          block = { kind, partId: `${messageId}:${streamEvent.index}`, text: "" }
          streamBlocks.set(streamEvent.index, block)
        }
        const chunk = delta.type === "text_delta" ? delta.text : delta.thinking
        block.text += chunk
        ensureAssistantMessageStarted(messageId, events)
        events.push({
          event: delta.type === "text_delta" ? "messageDelta" : "messageReasoningDelta",
          data: { sessionId, messageId, partId: block.partId, text: block.text, delta: chunk },
        })
        return events
      }
      default:
        return events
    }
  }

  function translateAssistantMessage(message: SDKAssistantMessage): AgentEvent[] {
    const events: AgentEvent[] = []
    const messageId = message.message.id
    ensureAssistantMessageStarted(messageId, events)
    message.message.content.forEach((block, index) => {
      if (block.type === "text") {
        // Authoritative upsert: full text replaces whatever streamed (no delta).
        events.push({
          event: "messageDelta",
          data: { sessionId, messageId, partId: `${messageId}:${index}`, text: block.text },
        })
        return
      }
      if (block.type === "thinking") {
        events.push({
          event: "messageReasoningDelta",
          data: { sessionId, messageId, partId: `${messageId}:${index}`, text: block.thinking },
        })
        return
      }
      if (block.type === "tool_use") {
        startToolCall(messageId, block.id, block.name, (block.input ?? {}) as Record<string, unknown>, events)
      }
    })
    if (message.error !== undefined) {
      events.push({ event: "agentError", data: { sessionId, message: assistantErrorMessage(message.error) } })
    }
    return events
  }

  function translateUserMessage(message: SDKUserMessage | SDKUserMessageReplay): AgentEvent[] {
    const events: AgentEvent[] = []
    const content = message.message.content
    const blocks = typeof content === "string" ? [] : content
    for (const block of blocks) {
      if (block.type !== "tool_result") {
        continue
      }
      const callId = block.tool_use_id
      const record = toolCalls.get(callId)
      toolCalls.delete(callId)
      const text = stringifyToolResultContent(block.content)
      const status = block.is_error === true ? "error" : "completed"
      events.push({
        event: "toolCallResult",
        data: {
          sessionId,
          messageId: record?.messageId ?? callId,
          partId: callId,
          callId,
          tool: record?.tool ?? "tool",
          status,
          input: record?.input ?? {},
          ...(status === "error" ? { error: text } : { output: text }),
        },
      })
    }
    if (events.length > 0) {
      return events
    }
    // Plain user text only surfaces from replay frames (echo of sent prompts);
    // synthetic messages are internal expansions and must stay invisible.
    if (!isReplayUserMessage(message) || message.isSynthetic === true) {
      return events
    }
    const messageId = String(message.uuid)
    const texts =
      typeof content === "string"
        ? [content]
        : content.filter((block) => block.type === "text").map((block) => block.text)
    let emittedStart = false
    texts.forEach((text, index) => {
      if (!emittedStart) {
        emittedStart = true
        events.push({ event: "messageStarted", data: { sessionId, messageId, role: "user" } })
      }
      events.push({
        event: "messageDelta",
        data: { sessionId, messageId, partId: `${messageId}:${index}`, text },
      })
    })
    return events
  }

  function translate(message: SDKMessage): AgentEvent[] {
    switch (message.type) {
      case "stream_event":
        return translateStreamEvent(message)
      case "assistant":
        return translateAssistantMessage(message)
      case "user":
        return translateUserMessage(message)
      case "result": {
        const events: AgentEvent[] = [{ event: "messageCompleted", data: { sessionId } }]
        if (message.subtype !== "success") {
          events.push({
            event: "agentError",
            data: { sessionId, message: `Claude Code turn failed (${message.subtype}): ${message.errors.join("; ")}` },
          })
        }
        return events
      }
      case "system": {
        switch (message.subtype) {
          case "status":
            return message.status === "compacting"
              ? [{ event: "assistantActivity", data: { sessionId, phase: "compacting" } }]
              : []
          case "api_retry":
            return [
              {
                event: "assistantActivity",
                data: { sessionId, phase: "retrying", attempt: message.attempt, message: message.error },
              },
            ]
          case "compact_boundary":
            return [{ event: "assistantActivity", data: { sessionId, phase: "resuming" } }]
          default:
            return []
        }
      }
      default:
        // Unknown or irrelevant SDK message kinds are ignored, never thrown on.
        return []
    }
  }

  return { translate }
}
