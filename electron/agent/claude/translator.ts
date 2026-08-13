import type { AgentEvent } from "../contract/event.ts"
import type {
  SDKAssistantMessage,
  SDKMessage,
  SDKUserMessage,
  SDKUserMessageReplay,
} from "@anthropic-ai/claude-agent-sdk"

import { agentLoginHint } from "../contract/profile.ts"
import { numberOrZero } from "../event-translator.ts"

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

const LOGIN_HINT = agentLoginHint("claude-code")

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

/**
 * CLI-internal user frames: slash-command bookkeeping the CLI records in the
 * session (e.g. `<local-command-stdout>Set model to ...</local-command-stdout>`
 * after a setModel call). They are not user prompts and must never render.
 */
const localCommandTagPattern =
  /^<(?:command-name|command-message|command-args|local-command-stdout|local-command-stderr|local-command-caveat)>/u

export function isLocalCommandText(text: string): boolean {
  return localCommandTagPattern.test(text.trimStart())
}

/**
 * Map the turn's usage onto the contract's usage event. Context occupancy must
 * come from the LAST main-loop API call (its input + cache tokens ARE the
 * context): the result frame's `usage` is a per-turn accounting SUM over every
 * API call, which re-counts the whole context once per tool round-trip and
 * would peg the meter far above real occupancy. The result frame is only the
 * fallback when no assistant frame carried usage, and stays the source of the
 * context window (modelUsage). Returns null when nothing measurable exists.
 */
function translateResultUsage(
  sessionId: string,
  message: SDKMessage,
  lastApiUsage: Record<string, unknown> | undefined,
): AgentEvent | null {
  const frame = message as {
    usage?: Record<string, unknown>
    modelUsage?: Record<string, { contextWindow?: unknown }>
  }
  const usage = lastApiUsage ?? frame.usage
  const input = numberOrZero(usage?.["input_tokens"])
  const output = numberOrZero(usage?.["output_tokens"])
  const cacheRead = numberOrZero(usage?.["cache_read_input_tokens"])
  const cacheWrite = numberOrZero(usage?.["cache_creation_input_tokens"])
  const total = input + output + cacheRead + cacheWrite
  let contextWindow = 0
  for (const entry of Object.values(frame.modelUsage ?? {})) {
    contextWindow = Math.max(contextWindow, numberOrZero(entry.contextWindow))
  }
  if (total <= 0 && contextWindow <= 0) {
    return null
  }
  return {
    event: "usageUpdated",
    data: {
      sessionId,
      tokenUsage: {
        total,
        input,
        output,
        reasoning: 0,
        cache: { read: cacheRead, write: cacheWrite },
        ...(contextWindow > 0 ? { contextWindow } : {}),
      },
    },
  }
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
  /** API message id -> content blocks already delivered by earlier complete-message frames. */
  const deliveredBlockCounts = new Map<string, number>()
  /** Per-call usage of the latest MAIN-LOOP assistant frame (context occupancy source). */
  let lastApiUsage: Record<string, unknown> | undefined

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
    const normalizedTool = tool.replace(/^mcp__wanta_[a-z0-9_-]+__/u, "")
    toolCalls.set(callId, { messageId, tool: normalizedTool, input })
    ensureAssistantMessageStarted(messageId, events)
    events.push({
      event: "toolCallStarted",
      data: { sessionId, messageId, partId: callId, callId, tool: normalizedTool, input, status: "running" },
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
    const frameUsage = (message.message as { usage?: unknown }).usage
    if (message.parent_tool_use_id === null && frameUsage && typeof frameUsage === "object") {
      lastApiUsage = frameUsage as Record<string, unknown>
    }
    // The CLI emits one complete assistant message PER content block, all
    // sharing the same API message id, so a block's true index is its offset
    // plus every block already delivered under that id. Deriving part ids from
    // the local offset alone would land the authoritative upsert on a partId
    // different from the streamed one and render the same content twice.
    const baseIndex = deliveredBlockCounts.get(messageId) ?? 0
    message.message.content.forEach((block, offset) => {
      const index = baseIndex + offset
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
    deliveredBlockCounts.set(messageId, baseIndex + message.message.content.length)
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
    const texts = (
      typeof content === "string"
        ? [content]
        : content.filter((block) => block.type === "text").map((block) => block.text)
    ).filter((text) => !isLocalCommandText(text))
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
        // Per-block bookkeeping is per turn; a finished turn's message ids never
        // receive further complete-message frames.
        deliveredBlockCounts.clear()
        const events: AgentEvent[] = []
        const usageEvent = translateResultUsage(sessionId, message, lastApiUsage)
        lastApiUsage = undefined
        if (usageEvent) {
          // Usage precedes completion so the transcript's completion flush
          // already carries it.
          events.push(usageEvent)
        }
        events.push({ event: "messageCompleted", data: { sessionId } })
        if (message.subtype !== "success") {
          // `errors` is declared on every failure variant, but a frame from a
          // newer CLI must not throw inside translation and kill the turn.
          const detail = Array.isArray(message.errors) ? message.errors.join("; ") : ""
          events.push({
            event: "agentError",
            data: {
              sessionId,
              message: detail
                ? `Claude Code turn failed (${message.subtype}): ${detail}`
                : `Claude Code turn failed (${message.subtype}).`,
            },
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
