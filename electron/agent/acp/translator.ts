import type { AssistantActivityPhase, ChatMessage } from "../../chat/common.ts"
import type { AgentEvent } from "../contract/event.ts"
import type { ContentBlock, SessionUpdate, ToolCallContent } from "@agentclientprotocol/sdk"

import { randomUUID } from "node:crypto"
import { classifyToolFailure } from "../tool-failure.ts"

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
  /** Resolve an ACP call id to its current Wanta host-tool projection. */
  wantaHostToolForCall(toolCallId: string): string | undefined
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
}

interface AcpCompactionStatus {
  phase: Extract<AssistantActivityPhase, "compacting" | "resuming" | "retrying">
  remainder: string
}

/**
 * claude-agent-acp 0.70 projects Claude's context-compaction lifecycle onto
 * ordinary agent_message_chunk text. Recover the lifecycle signal here so it
 * follows the same assistantActivity path as OpenCode instead of becoming a
 * persisted assistant paragraph. A remainder is preserved defensively in case
 * an agent appends real narration to the same chunk.
 */
export function extractAcpCompactionStatus(text: string): AcpCompactionStatus | undefined {
  let remainder = text.trimStart()
  let phase: AcpCompactionStatus["phase"] | undefined
  if (remainder.startsWith("Compacting...")) {
    phase = "compacting"
    remainder = remainder.slice("Compacting...".length).trimStart()
  }
  if (remainder.startsWith("Compacting completed.")) {
    phase = "resuming"
    remainder = remainder.slice("Compacting completed.".length).trimStart()
  } else if (remainder.startsWith("Compacting failed")) {
    phase = "retrying"
    const newline = remainder.indexOf("\n")
    remainder = newline >= 0 ? remainder.slice(newline + 1).trimStart() : ""
  }
  return phase ? { phase, remainder } : undefined
}

/** Remove lifecycle-only text already persisted by older ACP translations. */
export function sanitizeAcpMessages(
  messages: ChatMessage[],
  wantaHostServerNames: ReadonlySet<string> = new Set(),
): ChatMessage[] {
  return messages.flatMap((message) => {
    const parts = message.parts.flatMap((part) => {
      if (part.kind === "text" && typeof part.text === "string") {
        const status = extractAcpCompactionStatus(part.text)
        return status ? (status.remainder ? [{ ...part, text: status.remainder }] : []) : [part]
      }
      if (part.kind === "tool" && part.tool === "other") {
        const tool = nativeWantaMcpToolName(part.title, wantaHostServerNames)
        if (tool === "startup") return []
        if (!tool) return [part]
        const title = normalizedAcpToolTitle(tool, asRecord(part.input), part.title)
        return [{ ...part, tool, ...(title ? { title } : {}) }]
      }
      return [part]
    })
    return parts.length > 0 ? [{ ...message, parts }] : []
  })
}

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
 * ACP bridges expose MCP calls in two shapes. codex-acp uses the generic
 * `{server, tool, arguments}` envelope, while claude-agent-acp names the native
 * tool `mcp__<server>__<tool>` and sends its arguments directly. Normalize the
 * latter so both agents reach the same host-tool UI vocabulary.
 */
function nativeWantaMcpToolName(
  value: string | undefined,
  wantaHostServerNames: ReadonlySet<string>,
): string | undefined {
  if (!value) return undefined
  for (const serverName of wantaHostServerNames) {
    const prefix = `mcp__${serverName}__`
    if (value.startsWith(prefix) && value.length > prefix.length) return value.slice(prefix.length)
  }
  // Historical transcripts are hydrated before a native session has supplied
  // its concrete server set. Wanta-owned MCP names are stable and reserved.
  return value.match(/^mcp__wanta_[a-z0-9_]+__(.+)$/iu)?.[1]
}

function toolProjection(
  snapshot: ToolCallSnapshot,
  wantaHostServerNames: ReadonlySet<string>,
): { input: Record<string, unknown>; tool: string } {
  const rawInput = asRecord(snapshot.rawInput)
  if (
    typeof rawInput["server"] === "string" &&
    wantaHostServerNames.has(rawInput["server"]) &&
    typeof rawInput["tool"] === "string"
  ) {
    return { tool: rawInput["tool"], input: asRecord(rawInput["arguments"]) }
  }
  const nativeTool = nativeWantaMcpToolName(snapshot.name ?? snapshot.title, wantaHostServerNames)
  if (nativeTool) {
    return { tool: nativeTool, input: rawInput }
  }
  return { tool: snapshot.name ?? snapshot.kind ?? "other", input: rawInput }
}

function normalizedAcpToolTitle(
  tool: string,
  input: Record<string, unknown>,
  fallback: string | undefined,
): string | undefined {
  if (tool === "load_skill" && typeof input["skillId"] === "string") {
    return `Loaded skill: ${input["skillId"]}`
  }
  if (tool === "read_skill_file" && typeof input["path"] === "string") {
    return `Read skill reference: ${input["path"]}`
  }
  if (tool === "list_skills") {
    return "List available skills"
  }
  return fallback
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

export function createAcpSessionTranslator(
  wantaSessionId: string,
  wantaHostServerNames: ReadonlySet<string> = new Set(),
  syntheticIdNamespace = randomUUID(),
): AcpSessionTranslator {
  // Agent-provided message ids are optional. The fallback must remain unique
  // after an Electron main restart; a process-local counter would reset and
  // merge new turn parts into persisted transcript messages from an older run.
  let messageSeq = 0
  /** Message the next chunk/tool call belongs to when the agent omits messageId. */
  let currentMessageId: string | undefined
  const startedMessageIds = new Set<string>()
  const cumulativeTextByPartId = new Map<string, string>()
  /** Live (non-terminal) tool calls; snapshots are dropped once terminal. */
  const toolCallsById = new Map<string, ToolCallSnapshot>()
  /** Ids whose completed/failed result was emitted; later updates are dropped. */
  const terminalToolCallIds = new Set<string>()
  /** MCP bridge startup probes are runtime health, never user-requested tools. */
  const ignoredStartupToolCallIds = new Set<string>()

  function mintMessageId(): string {
    messageSeq += 1
    return `acp-msg-${syntheticIdNamespace}-${messageSeq}`
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
    const projection = toolProjection(snapshot, wantaHostServerNames)
    const title = normalizedAcpToolTitle(projection.tool, projection.input, snapshot.title)
    return {
      event: "toolCallStarted",
      data: {
        sessionId: wantaSessionId,
        messageId: snapshot.messageId,
        partId: toolCallId,
        callId: toolCallId,
        tool: projection.tool,
        input: projection.input,
        status: "running",
        ...(title !== undefined ? { title } : {}),
      },
    }
  }

  function resultEvent(toolCallId: string, snapshot: ToolCallSnapshot, acpStatus: "completed" | "failed"): AgentEvent {
    const projection = toolProjection(snapshot, wantaHostServerNames)
    const tool = projection.tool
    const title = normalizedAcpToolTitle(tool, projection.input, snapshot.title)
    const text = toolOutputText(snapshot)
    const base = {
      sessionId: wantaSessionId,
      messageId: snapshot.messageId,
      partId: toolCallId,
      callId: toolCallId,
      tool,
      input: projection.input,
      ...(title !== undefined ? { title } : {}),
    }
    if (acpStatus === "completed") {
      return {
        event: "toolCallResult",
        data: { ...base, status: "completed", ...(text ? { output: text } : {}) },
      }
    }
    return {
      event: "toolCallResult",
      data: {
        ...base,
        status: "error",
        error: text || `${snapshot.title ?? tool} failed`,
        ...classifyToolFailure(text || `${snapshot.title ?? tool} failed`),
      },
    }
  }

  function adoptSnapshot(toolCallId: string, events: AgentEvent[]): ToolCallSnapshot {
    const messageId = currentMessageId ?? mintMessageId()
    currentMessageId = messageId
    ensureStarted(messageId, events)
    const snapshot: ToolCallSnapshot = { messageId, content: [] }
    toolCallsById.set(toolCallId, snapshot)
    return snapshot
  }

  type ToolCallLike = Extract<SessionUpdate, { sessionUpdate: "tool_call" | "tool_call_update" }>

  /**
   * Shared tool_call/tool_call_update handling. `announce` (the tool_call
   * announcement) always emits a started event and rotates the narration
   * bubble; a plain update emits started only while the call keeps running.
   * A re-announced call id merges into the existing snapshot; a fresh adoption
   * would fork the call into a second transcript part and strand the first one
   * in "running" forever. Updates after the terminal result are dropped.
   */
  function handleToolCall(update: ToolCallLike, announce: boolean): AgentEvent[] {
    const events: AgentEvent[] = []
    if (ignoredStartupToolCallIds.has(update.toolCallId)) {
      if (update.status === "completed" || update.status === "failed")
        ignoredStartupToolCallIds.delete(update.toolCallId)
      return events
    }
    if (terminalToolCallIds.has(update.toolCallId)) {
      return events
    }
    if (
      announce &&
      nativeWantaMcpToolName(update.name ?? update.title ?? undefined, wantaHostServerNames) === "startup"
    ) {
      ignoredStartupToolCallIds.add(update.toolCallId)
      return events
    }
    const snapshot = toolCallsById.get(update.toolCallId) ?? adoptSnapshot(update.toolCallId, events)
    mergeToolCallFields(snapshot, update)
    const finished = update.status === "completed" || update.status === "failed"
    if (announce || !finished) {
      events.push(startedEvent(update.toolCallId, snapshot))
    }
    if (finished) {
      terminalToolCallIds.add(update.toolCallId)
      toolCallsById.delete(update.toolCallId)
      events.push(resultEvent(update.toolCallId, snapshot, update.status as "completed" | "failed"))
    }
    if (announce) {
      // Rotate so narration after the tool call starts a new bubble.
      currentMessageId = undefined
    }
    return events
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
      // Finished parts can never receive another chunk (message ids rotate per
      // turn), so their cumulative buffers are dead weight after the turn.
      cumulativeTextByPartId.clear()
    },

    wantaHostToolForCall(toolCallId: string): string | undefined {
      const snapshot = toolCallsById.get(toolCallId)
      if (!snapshot) return undefined
      const rawInput = asRecord(snapshot.rawInput)
      const envelopeTool =
        typeof rawInput["server"] === "string" &&
        wantaHostServerNames.has(rawInput["server"]) &&
        typeof rawInput["tool"] === "string"
          ? rawInput["tool"]
          : undefined
      return envelopeTool ?? nativeWantaMcpToolName(snapshot.name ?? snapshot.title, wantaHostServerNames)
    },

    translate(update: SessionUpdate): AgentEvent[] {
      switch (update.sessionUpdate) {
        case "agent_message_chunk":
          if (update.content.type === "text") {
            const compaction = extractAcpCompactionStatus(update.content.text)
            if (compaction) {
              // A compaction is a context boundary, not part of the preceding
              // answer. Rotate before any real narration that shares the chunk.
              currentMessageId = undefined
              const activity: AgentEvent = {
                event: "assistantActivity",
                data: { sessionId: wantaSessionId, phase: compaction.phase },
              }
              return compaction.remainder
                ? [
                    activity,
                    ...translateChunk(
                      { ...update, content: { ...update.content, text: compaction.remainder } },
                      "text",
                    ),
                  ]
                : [activity]
            }
            const warning = "Warning: Skill descriptions were shortened to fit the skills context budget."
            if (update.content.text.startsWith(warning)) {
              const newline = update.content.text.indexOf("\n")
              const remainder = newline >= 0 ? update.content.text.slice(newline + 1).replace(/^\s+/u, "") : ""
              if (remainder) {
                return translateChunk({ ...update, content: { ...update.content, text: remainder } }, "text")
              }
              // codex-acp projects Codex runtime notices onto the assistant text
              // channel. This is neither the model's answer nor actionable in a
              // Wanta task, so do not persist or render it as chat content.
              return []
            }
          }
          return translateChunk(update, "text")
        case "agent_thought_chunk":
          return translateChunk(update, "thought")
        case "tool_call":
          return handleToolCall(update, true)
        case "tool_call_update":
          return handleToolCall(update, false)
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
