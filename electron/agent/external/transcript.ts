import type { ChatMessage, ChatMessagePart, ChatTokenUsage } from "../../chat/common.ts"
import type { AgentEvent } from "../contract/event.ts"
import type { RedactedExternalAgentEvent } from "./transcript-redaction.ts"

import { redactExternalAgentEvent, redactExternalMessages } from "./transcript-redaction.ts"

// In-memory transcript built from the adapter's own contract events. External
// agents have no queryable server history, so this recorder is what backs
// getMessages(), turn-completion verification, and session reloads within one
// app run. It deliberately mirrors the shapes the chat layer expects from the
// OpenCode history path.

interface TranscriptMessage {
  message: ChatMessage
  /** Parts keyed by partId; Map insertion order IS the display order. */
  parts: Map<string, ChatMessagePart>
}

export class ExternalTranscriptRecorder {
  private readonly sessions = new Map<string, Map<string, TranscriptMessage>>()
  /** Usage reported before the turn's assistant message exists; applied on arrival. */
  private readonly pendingUsage = new Map<string, ChatTokenUsage>()
  /** sessionId -> id of the most recently created assistant message. */
  private readonly latestAssistantIds = new Map<string, string>()

  public record(event: AgentEvent): void {
    this.recordSafe(redactExternalAgentEvent(event))
  }

  /** Record an event already normalized at the external-adapter trust boundary. */
  public recordSafe(safeEvent: RedactedExternalAgentEvent): void {
    switch (safeEvent.event) {
      case "messageStarted": {
        const entry = this.ensureMessage(safeEvent.data.sessionId, safeEvent.data.messageId, safeEvent.data.role)
        if (safeEvent.data.finishReason !== undefined) {
          entry.message.finishReason = safeEvent.data.finishReason
        }
        if (safeEvent.data.completedAt !== undefined) {
          entry.message.completedAt = safeEvent.data.completedAt
        }
        return
      }
      case "messageDelta": {
        if (safeEvent.data.synthetic === true) {
          return
        }
        const entry = this.ensureMessage(safeEvent.data.sessionId, safeEvent.data.messageId, "assistant")
        this.upsertPart(entry, { kind: "text", partId: safeEvent.data.partId, text: safeEvent.data.text })
        return
      }
      case "messageReasoningDelta": {
        const entry = this.ensureMessage(safeEvent.data.sessionId, safeEvent.data.messageId, "assistant")
        this.upsertPart(entry, { kind: "reasoning", partId: safeEvent.data.partId, text: safeEvent.data.text })
        return
      }
      case "messageAttachment": {
        const entry = this.ensureMessage(safeEvent.data.sessionId, safeEvent.data.messageId, "assistant")
        this.upsertPart(entry, {
          kind: "attachment",
          partId: safeEvent.data.partId,
          attachment: safeEvent.data.attachment,
        })
        return
      }
      case "toolCallStarted": {
        const entry = this.ensureMessage(safeEvent.data.sessionId, safeEvent.data.messageId, "assistant")
        this.upsertPart(entry, {
          kind: "tool",
          partId: safeEvent.data.partId,
          callId: safeEvent.data.callId,
          tool: safeEvent.data.tool,
          status: safeEvent.data.status,
          input: safeEvent.data.input,
          ...(safeEvent.data.title ? { title: safeEvent.data.title } : {}),
          ...(safeEvent.data.metadata ? { metadata: safeEvent.data.metadata } : {}),
          ...(safeEvent.data.timing ? { timing: safeEvent.data.timing } : {}),
        })
        return
      }
      case "toolCallResult": {
        const entry = this.ensureMessage(safeEvent.data.sessionId, safeEvent.data.messageId, "assistant")
        this.upsertPart(entry, {
          kind: "tool",
          partId: safeEvent.data.partId,
          callId: safeEvent.data.callId,
          tool: safeEvent.data.tool,
          status: safeEvent.data.status,
          input: safeEvent.data.input,
          ...(safeEvent.data.output !== undefined ? { output: safeEvent.data.output } : {}),
          ...(safeEvent.data.error !== undefined ? { error: safeEvent.data.error } : {}),
          ...(safeEvent.data.title ? { title: safeEvent.data.title } : {}),
          ...(safeEvent.data.metadata ? { metadata: safeEvent.data.metadata } : {}),
          ...(safeEvent.data.timing ? { timing: safeEvent.data.timing } : {}),
          ...(safeEvent.data.attachmentsCount !== undefined
            ? { attachmentsCount: safeEvent.data.attachmentsCount }
            : {}),
          ...(safeEvent.data.authorization ? { authorization: safeEvent.data.authorization } : {}),
          ...(safeEvent.data.failureKind ? { failureKind: safeEvent.data.failureKind } : {}),
          ...(safeEvent.data.userImpact ? { userImpact: safeEvent.data.userImpact } : {}),
        })
        return
      }
      case "messagePartRemoved": {
        this.sessions.get(safeEvent.data.sessionId)?.get(safeEvent.data.messageId)?.parts.delete(safeEvent.data.partId)
        return
      }
      case "messageCompleted": {
        // The turn-completion check reads finishReason/completedAt off the
        // latest assistant message, so completion must be materialized here.
        const assistant = this.latestAssistant(safeEvent.data.sessionId)
        if (assistant && assistant.message.completedAt === undefined) {
          assistant.message.completedAt = Date.now()
          assistant.message.finishReason ??= "stop"
        }
        return
      }
      case "usageUpdated": {
        // The usage meter reads tokenUsage off the latest assistant message,
        // mirroring where the kernel history path carries it.
        const assistant = this.latestAssistant(safeEvent.data.sessionId)
        if (assistant) {
          assistant.message.tokenUsage = safeEvent.data.tokenUsage
        } else {
          this.pendingUsage.set(safeEvent.data.sessionId, safeEvent.data.tokenUsage)
        }
        return
      }
      default:
        return
    }
  }

  /** Whether any live state for the session is held in memory. */
  public has(sessionId: string): boolean {
    return this.sessions.has(sessionId)
  }

  /**
   * Rehydrate a session from a previously serialized messages() snapshot.
   * The flattened ChatMessage[] shape is lossless (parts carry their partId),
   * so the internal parts-map rebuilds directly. No-op when live state
   * already exists — disk never overrides an in-flight session.
   */
  public restore(sessionId: string, messages: ChatMessage[]): void {
    if (this.sessions.has(sessionId)) {
      return
    }
    const entries = new Map<string, TranscriptMessage>()
    for (const message of redactExternalMessages(messages)) {
      entries.set(message.id, {
        message: { ...message, parts: [] },
        parts: new Map(message.parts.map((part) => [part.partId, part])),
      })
      if (message.role === "assistant") {
        this.latestAssistantIds.set(sessionId, message.id)
      }
    }
    this.sessions.set(sessionId, entries)
  }

  public messages(sessionId: string): ChatMessage[] {
    const entries = this.sessions.get(sessionId)
    if (!entries) {
      return []
    }
    return [...entries.values()].map((entry) => ({
      ...entry.message,
      parts: [...entry.parts.values()],
    }))
  }

  /** Number of recorded messages, without cloning them. */
  public messageCount(sessionId: string): number {
    return this.sessions.get(sessionId)?.size ?? 0
  }

  public forgetSession(sessionId: string): void {
    this.sessions.delete(sessionId)
    this.pendingUsage.delete(sessionId)
    this.latestAssistantIds.delete(sessionId)
  }

  private latestAssistant(sessionId: string): TranscriptMessage | undefined {
    const latestId = this.latestAssistantIds.get(sessionId)
    if (latestId === undefined) {
      return undefined
    }
    return this.sessions.get(sessionId)?.get(latestId)
  }

  private ensureMessage(sessionId: string, messageId: string, role: ChatMessage["role"]): TranscriptMessage {
    let messages = this.sessions.get(sessionId)
    if (!messages) {
      messages = new Map()
      this.sessions.set(sessionId, messages)
    }
    let entry = messages.get(messageId)
    if (!entry) {
      entry = {
        message: { id: messageId, role, parts: [], createdAt: Date.now() },
        parts: new Map(),
      }
      messages.set(messageId, entry)
      if (role === "assistant") {
        this.latestAssistantIds.set(sessionId, messageId)
        const parked = this.pendingUsage.get(sessionId)
        if (parked) {
          entry.message.tokenUsage = parked
          this.pendingUsage.delete(sessionId)
        }
      }
    }
    return entry
  }

  private upsertPart(entry: TranscriptMessage, part: ChatMessagePart): void {
    entry.parts.set(part.partId, part)
  }
}
