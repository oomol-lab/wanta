import type { ChatMessage, ChatMessagePart, ChatTokenUsage } from "../../chat/common.ts"
import type { AgentEvent } from "../contract/event.ts"

// In-memory transcript built from the adapter's own contract events. External
// agents have no queryable server history, so this recorder is what backs
// getMessages(), turn-completion verification, and session reloads within one
// app run. It deliberately mirrors the shapes the chat layer expects from the
// OpenCode history path.

interface TranscriptMessage {
  message: ChatMessage
  parts: Map<string, ChatMessagePart>
  order: string[]
}

export class ExternalTranscriptRecorder {
  private readonly sessions = new Map<string, Map<string, TranscriptMessage>>()
  /** Usage reported before the turn's assistant message exists; applied on arrival. */
  private readonly pendingUsage = new Map<string, ChatTokenUsage>()

  public record(event: AgentEvent): void {
    switch (event.event) {
      case "messageStarted": {
        const entry = this.ensureMessage(event.data.sessionId, event.data.messageId, event.data.role)
        if (event.data.finishReason !== undefined) {
          entry.message.finishReason = event.data.finishReason
        }
        if (event.data.completedAt !== undefined) {
          entry.message.completedAt = event.data.completedAt
        }
        return
      }
      case "messageDelta": {
        if (event.data.synthetic === true) {
          return
        }
        const entry = this.ensureMessage(event.data.sessionId, event.data.messageId, "assistant")
        this.upsertPart(entry, { kind: "text", partId: event.data.partId, text: event.data.text })
        return
      }
      case "messageReasoningDelta": {
        const entry = this.ensureMessage(event.data.sessionId, event.data.messageId, "assistant")
        this.upsertPart(entry, { kind: "reasoning", partId: event.data.partId, text: event.data.text })
        return
      }
      case "messageAttachment": {
        const entry = this.ensureMessage(event.data.sessionId, event.data.messageId, "assistant")
        this.upsertPart(entry, {
          kind: "attachment",
          partId: event.data.partId,
          attachment: event.data.attachment,
        })
        return
      }
      case "toolCallStarted": {
        const entry = this.ensureMessage(event.data.sessionId, event.data.messageId, "assistant")
        this.upsertPart(entry, {
          kind: "tool",
          partId: event.data.partId,
          callId: event.data.callId,
          tool: event.data.tool,
          status: event.data.status,
          input: event.data.input,
          ...(event.data.title ? { title: event.data.title } : {}),
          ...(event.data.metadata ? { metadata: event.data.metadata } : {}),
          ...(event.data.timing ? { timing: event.data.timing } : {}),
        })
        return
      }
      case "toolCallResult": {
        const entry = this.ensureMessage(event.data.sessionId, event.data.messageId, "assistant")
        this.upsertPart(entry, {
          kind: "tool",
          partId: event.data.partId,
          callId: event.data.callId,
          tool: event.data.tool,
          status: event.data.status,
          input: event.data.input,
          ...(event.data.output !== undefined ? { output: event.data.output } : {}),
          ...(event.data.error !== undefined ? { error: event.data.error } : {}),
          ...(event.data.title ? { title: event.data.title } : {}),
          ...(event.data.metadata ? { metadata: event.data.metadata } : {}),
          ...(event.data.timing ? { timing: event.data.timing } : {}),
          ...(event.data.attachmentsCount !== undefined ? { attachmentsCount: event.data.attachmentsCount } : {}),
          ...(event.data.authorization ? { authorization: event.data.authorization } : {}),
        })
        return
      }
      case "messagePartRemoved": {
        const entry = this.sessions.get(event.data.sessionId)?.get(event.data.messageId)
        if (!entry) {
          return
        }
        entry.parts.delete(event.data.partId)
        entry.order = entry.order.filter((partId) => partId !== event.data.partId)
        return
      }
      case "messageCompleted": {
        // The turn-completion check reads finishReason/completedAt off the
        // latest assistant message, so completion must be materialized here.
        const assistant = this.latestAssistant(event.data.sessionId)
        if (assistant && assistant.message.completedAt === undefined) {
          assistant.message.completedAt = Date.now()
          assistant.message.finishReason ??= "stop"
        }
        return
      }
      case "usageUpdated": {
        // The usage meter reads tokenUsage off the latest assistant message,
        // mirroring where the kernel history path carries it.
        const assistant = this.latestAssistant(event.data.sessionId)
        if (assistant) {
          assistant.message.tokenUsage = event.data.tokenUsage
        } else {
          this.pendingUsage.set(event.data.sessionId, event.data.tokenUsage)
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
   * so the internal parts-map and order rebuild directly. No-op when live
   * state already exists — disk never overrides an in-flight session.
   */
  public restore(sessionId: string, messages: ChatMessage[]): void {
    if (this.sessions.has(sessionId)) {
      return
    }
    const entries = new Map<string, TranscriptMessage>()
    for (const message of messages) {
      entries.set(message.id, {
        message: { ...message, parts: [] },
        parts: new Map(message.parts.map((part) => [part.partId, part])),
        order: message.parts.map((part) => part.partId),
      })
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
      parts: entry.order
        .map((partId) => entry.parts.get(partId))
        .filter((part): part is ChatMessagePart => Boolean(part)),
    }))
  }

  public forgetSession(sessionId: string): void {
    this.sessions.delete(sessionId)
    this.pendingUsage.delete(sessionId)
  }

  private latestAssistant(sessionId: string): TranscriptMessage | undefined {
    const messages = this.sessions.get(sessionId)
    if (!messages) {
      return undefined
    }
    return [...messages.values()].filter((entry) => entry.message.role === "assistant").at(-1)
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
        order: [],
      }
      messages.set(messageId, entry)
      if (role === "assistant") {
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
    if (!entry.parts.has(part.partId)) {
      entry.order.push(part.partId)
    }
    entry.parts.set(part.partId, part)
  }
}
