import type { AgentEvent } from "../contract/event.ts"
import type { ContentBlock, SessionUpdate, ToolCallContent } from "@agentclientprotocol/sdk"

// ACP session/update -> AgentEvent translation (BYOA phase 2).
//
// One translator instance per Wanta session, created by AcpAgentAdapter when
// the ACP session is opened. The translator is the only stateful part of the
// mapping: it tracks message identity (agent-provided messageId or a synthetic
// one rotated per turn and after each tool call), cumulative text per part, and
// per-call tool snapshots merged across tool_call_update notifications. All
// emitted events carry the WANTA session id, never the ACP one.
//
// Verified against @agentclientprotocol/sdk@1.3.0 (dist/schema/types.gen.d.ts):
// ContentChunk.messageId is optional/null; ToolCallUpdate carries only changed
// fields; ToolCallContent is content | diff | terminal.

export interface AcpSessionTranslator {
  /** Translate one session/update payload into zero or more contract events. */
  translate(update: SessionUpdate): AgentEvent[]
  /** Mark a new prompt turn so following narration starts a fresh bubble. */
  noteTurnStarted(): void
}

/** Merged view of a tool call across its tool_call/tool_call_update stream. */
interface ToolCallSnapshot {
  /** Assistant message the call was attached to; stable across all its events. */
  messageId: string
  name?: string
  kind?: string
  title?: string
  rawInput?: unknown
  rawOutput?: unknown
  content: ToolCallContent[]
  /** Once completed/failed was emitted, later updates are dropped. */
  terminal: boolean
}

/**
 * Global sequence for synthetic message ids. Translator instances for the same
 * Wanta session can be recreated (agent respawn after a crash), so ids must
 * stay unique across instances or transcript bubbles would merge.
 */
let translatorSeq = 0

function contentBlockText(block: ContentBlock): string {
  switch (block.type) {
    case "text":
      return block.text
    case "resource_link":
      return `[${block.name}](${block.uri})`
    default:
      // Image/audio/embedded-resource blocks have no text projection here.
      return ""
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return {}
}

/**
 * Best-effort human-readable output of a tool call: text content blocks and
 * diff path lines, else the raw output serialized, else empty.
 */
function toolOutputText(snapshot: ToolCallSnapshot): string {
  const lines: string[] = []
  for (const item of snapshot.content) {
    if (item.type === "content") {
      const text = contentBlockText(item.content)
      if (text) {
        lines.push(text)
      }
    } else if (item.type === "diff") {
      lines.push(item.path)
    }
  }
  if (lines.length > 0) {
    return lines.join("\n")
  }
  if (snapshot.rawOutput !== undefined) {
    return JSON.stringify(snapshot.rawOutput)
  }
  return ""
}

export function createAcpSessionTranslator(wantaSessionId: string): AcpSessionTranslator {
  const seed = ++translatorSeq
  let messageSeq = 0
  /** Message the next chunk/tool call belongs to when the agent omits messageId. */
  let currentMessageId: string | undefined
  const startedMessageIds = new Set<string>()
  const cumulativeTextByPartId = new Map<string, string>()
  const toolCallsById = new Map<string, ToolCallSnapshot>()

  function mintMessageId(): string {
    messageSeq += 1
    return `acp-msg-${seed}-${messageSeq}`
  }

  function ensureStarted(messageId: string, events: AgentEvent[]): void {
    if (startedMessageIds.has(messageId)) {
      return
    }
    startedMessageIds.add(messageId)
    events.push({
      event: "messageStarted",
      data: { sessionId: wantaSessionId, messageId, role: "assistant" },
    })
  }

  function translateChunk(
    chunk: { content: ContentBlock; messageId?: string | null },
    channel: "text" | "thought",
  ): AgentEvent[] {
    const messageId = chunk.messageId ?? currentMessageId ?? mintMessageId()
    currentMessageId = messageId
    const chunkText = contentBlockText(chunk.content)
    if (!chunkText) {
      return []
    }
    const events: AgentEvent[] = []
    ensureStarted(messageId, events)
    const partId = `${messageId}:${channel}`
    const cumulative = (cumulativeTextByPartId.get(partId) ?? "") + chunkText
    cumulativeTextByPartId.set(partId, cumulative)
    events.push({
      event: channel === "text" ? "messageDelta" : "messageReasoningDelta",
      data: { sessionId: wantaSessionId, messageId, partId, text: cumulative, delta: chunkText },
    })
    return events
  }

  function startedEvent(toolCallId: string, snapshot: ToolCallSnapshot): AgentEvent {
    return {
      event: "toolCallStarted",
      data: {
        sessionId: wantaSessionId,
        messageId: snapshot.messageId,
        partId: toolCallId,
        callId: toolCallId,
        tool: snapshot.name ?? snapshot.kind ?? "other",
        input: asRecord(snapshot.rawInput),
        status: "running",
        ...(snapshot.title !== undefined ? { title: snapshot.title } : {}),
      },
    }
  }

  function resultEvent(toolCallId: string, snapshot: ToolCallSnapshot, acpStatus: "completed" | "failed"): AgentEvent {
    const tool = snapshot.name ?? snapshot.kind ?? "other"
    const text = toolOutputText(snapshot)
    const base = {
      sessionId: wantaSessionId,
      messageId: snapshot.messageId,
      partId: toolCallId,
      callId: toolCallId,
      tool,
      input: asRecord(snapshot.rawInput),
      ...(snapshot.title !== undefined ? { title: snapshot.title } : {}),
    }
    if (acpStatus === "completed") {
      return {
        event: "toolCallResult",
        data: { ...base, status: "completed", ...(text ? { output: text } : {}) },
      }
    }
    return {
      event: "toolCallResult",
      data: { ...base, status: "error", error: text || `${snapshot.title ?? tool} failed` },
    }
  }

  function adoptSnapshot(toolCallId: string, events: AgentEvent[]): ToolCallSnapshot {
    const messageId = currentMessageId ?? mintMessageId()
    currentMessageId = messageId
    ensureStarted(messageId, events)
    const snapshot: ToolCallSnapshot = { messageId, content: [], terminal: false }
    toolCallsById.set(toolCallId, snapshot)
    return snapshot
  }

  function mergeToolCallFields(
    snapshot: ToolCallSnapshot,
    update: {
      name?: string | null
      kind?: string | null
      title?: string | null
      rawInput?: unknown
      rawOutput?: unknown
      content?: ToolCallContent[] | null
    },
  ): void {
    if (update.name != null) {
      snapshot.name = update.name
    }
    if (update.kind != null) {
      snapshot.kind = update.kind
    }
    if (update.title != null) {
      snapshot.title = update.title
    }
    if (update.rawInput !== undefined) {
      snapshot.rawInput = update.rawInput
    }
    if (update.rawOutput !== undefined) {
      snapshot.rawOutput = update.rawOutput
    }
    if (update.content != null) {
      // Per protocol, content on an update replaces the previous list.
      snapshot.content = update.content
    }
  }

  return {
    noteTurnStarted(): void {
      currentMessageId = undefined
    },

    translate(update: SessionUpdate): AgentEvent[] {
      switch (update.sessionUpdate) {
        case "agent_message_chunk":
          return translateChunk(update, "text")
        case "agent_thought_chunk":
          return translateChunk(update, "thought")
        case "tool_call": {
          const events: AgentEvent[] = []
          // A re-announced call id must merge into the existing snapshot; a
          // fresh adoption would fork the call into a second transcript part
          // and strand the first one in "running" forever.
          const snapshot = toolCallsById.get(update.toolCallId) ?? adoptSnapshot(update.toolCallId, events)
          if (snapshot.terminal) {
            return events
          }
          mergeToolCallFields(snapshot, update)
          events.push(startedEvent(update.toolCallId, snapshot))
          if (update.status === "completed" || update.status === "failed") {
            snapshot.terminal = true
            events.push(resultEvent(update.toolCallId, snapshot, update.status))
          }
          // Rotate so narration after the tool call starts a new bubble.
          currentMessageId = undefined
          return events
        }
        case "tool_call_update": {
          const events: AgentEvent[] = []
          const snapshot = toolCallsById.get(update.toolCallId) ?? adoptSnapshot(update.toolCallId, events)
          if (snapshot.terminal) {
            return events
          }
          mergeToolCallFields(snapshot, update)
          if (update.status === "completed" || update.status === "failed") {
            snapshot.terminal = true
            events.push(resultEvent(update.toolCallId, snapshot, update.status))
          } else {
            events.push(startedEvent(update.toolCallId, snapshot))
          }
          return events
        }
        default:
          // plan, plan_update, plan_removed, available_commands_update,
          // current_mode_update, config_option_update, session_info_update,
          // usage_update, user_message_chunk: nothing to fabricate for the
          // chat timeline; the adapter traces them.
          return []
      }
    },
  }
}
