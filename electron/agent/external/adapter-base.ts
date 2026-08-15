import type { AgentPermissionMode, ChatMessage, ChatPermissionRequest, ChatQuestionRequest } from "../../chat/common.ts"
import type { AgentEvent } from "../contract/event.ts"
import type { AgentInput, AgentSendOptions } from "../contract/input.ts"
import type { ExternalAgentRuntimeStatus } from "./probe.ts"

import { logDiagnostic } from "../../diagnostics-log.ts"
import { BaseAgentAdapter } from "../contract/adapter.ts"
import { ExternalTranscriptStore } from "./transcript-store.ts"
import { ExternalTranscriptRecorder } from "./transcript.ts"

// Shared skeleton for external (BYOA) adapters. On top of the contract base it
// provides the chat-layer backend surface the built-in kernel gets from the
// OpenCode server: transcript-backed history, pending-permission queries, and
// readiness — all derived purely from the adapter's own emitted events.
// Transcripts are additionally mirrored to disk (when a directory is
// configured) so reopening a session after an app restart shows its history.

const TRANSCRIPT_SAVE_DEBOUNCE_MS = 500

export interface ExternalAgentAdapterOptions {
  /** Directory for per-session transcript JSON files; omitted = in-memory only. */
  transcriptDir?: string
}

export abstract class ExternalAgentAdapter extends BaseAgentAdapter {
  private readonly transcript = new ExternalTranscriptRecorder()
  private readonly pendingPermissionRequests = new Map<string, ChatPermissionRequest>()
  private readonly transcriptStore: ExternalTranscriptStore | undefined
  /** sessionId -> memoized one-shot hydration of the on-disk transcript. */
  private readonly transcriptHydrations = new Map<string, Promise<void>>()
  /** sessionId -> debounce timer of a scheduled transcript save. */
  private readonly pendingTranscriptSaves = new Map<string, ReturnType<typeof setTimeout>>()
  /** sessionId -> serialized tail of pending disk operations (saves, removal). */
  private readonly transcriptOps = new Map<string, Promise<void>>()
  /**
   * Sessions the host deleted. Late events from a still-draining native
   * process must neither re-record them in memory nor resurrect their file.
   */
  private readonly forgottenSessions = new Set<string>()
  /**
   * Sessions whose on-disk transcript held ANY content before sanitizing.
   * The native side may own their id even when every restored message was
   * scrubbed as noise, so resume decisions must use this, not the survivors.
   */
  private readonly sessionsWithDiskHistory = new Set<string>()

  private userTurnSeq = 0

  protected constructor(options: ExternalAgentAdapterOptions = {}) {
    super()
    this.transcriptStore = options.transcriptDir ? new ExternalTranscriptStore(options.transcriptDir) : undefined
  }

  /**
   * External agents never echo the user turn back during a live turn (the
   * Claude CLI only replays it on resume; ACP agents not at all), so every
   * adapter synthesizes it before dispatching the prompt. Emits the
   * messageStarted/messageDelta pair so the transcript and streaming overlays
   * see the user turn immediately, and returns the message id used.
   */
  protected emitUserTurn(input: { sessionId: string; messageId?: string; text: string }): string {
    this.userTurnSeq += 1
    const userMessageId = input.messageId ?? `${this.kind}-user-${this.userTurnSeq}`
    this.emit({
      event: "messageStarted",
      data: { sessionId: input.sessionId, messageId: userMessageId, role: "user" },
    })
    this.emit({
      event: "messageDelta",
      data: {
        sessionId: input.sessionId,
        messageId: userMessageId,
        partId: `${userMessageId}:text`,
        text: input.text,
        delta: input.text,
      },
    })
    return userMessageId
  }

  protected override emit(event: AgentEvent): void {
    const sessionId = "sessionId" in event.data ? event.data.sessionId : undefined
    if (typeof sessionId === "string" && this.forgottenSessions.has(sessionId)) {
      return
    }
    this.transcript.record(event)
    if (event.event === "permissionAsked") {
      this.pendingPermissionRequests.set(event.data.request.id, event.data.request)
    } else if (event.event === "permissionReplied") {
      this.pendingPermissionRequests.delete(event.data.requestId)
    }
    super.emit(event)
    this.scheduleTranscriptSave(event)
  }

  public override async send(input: AgentInput, options?: AgentSendOptions): Promise<void> {
    if (input.type === "prompt" && typeof input.sessionId === "string") {
      // An explicit new prompt reopens a forgotten session id; the tombstone
      // only exists to block LATE events from a still-draining native process.
      this.forgottenSessions.delete(input.sessionId)
      // A prompt into a restored-but-not-yet-viewed session must hydrate first,
      // or the next save would overwrite the on-disk history with only the new
      // turn. getMessages() hydrates the viewing path; this covers sending.
      await this.hydrateTranscript(input.sessionId)
    }
    return super.send(input, options)
  }

  public override async stop(): Promise<void> {
    await super.stop()
    const sessionIds = [...this.pendingTranscriptSaves.keys()]
    for (const sessionId of sessionIds) {
      void this.flushTranscript(sessionId)
    }
    await Promise.all(this.transcriptOps.values())
  }

  public isReady(): boolean {
    return this.isStarted
  }

  public async getMessages(sessionId: string): Promise<ChatMessage[]> {
    await this.hydrateTranscript(sessionId)
    return this.transcript.messages(sessionId)
  }

  public getPendingPermissions(sessionId: string): Promise<ChatPermissionRequest[]> {
    return this.getPendingPermissionsForSessions([sessionId])
  }

  public getPendingPermissionsForSessions(sessionIds: readonly string[]): Promise<ChatPermissionRequest[]> {
    const requested = new Set(sessionIds)
    return Promise.resolve(
      [...this.pendingPermissionRequests.values()].filter((request) => requested.has(request.sessionId)),
    )
  }

  /** External adapters have no structured-question channel; the profile declares it off. */
  public getPendingQuestionsForSessions(_sessionIds: readonly string[]): Promise<ChatQuestionRequest[]> {
    return Promise.resolve([])
  }

  /**
   * Last user-chosen agent-native model/effort for a session. The adapter's
   * desired-state stash is the authority; the renderer reads it back so a
   * window reload cannot desync the pickers from what the agent will use.
   */
  public sessionSelection(_sessionId: string): { modelId?: string; effortId?: string } {
    return {}
  }

  /**
   * Optional pre-population of the model/effort catalog before any session
   * exists (called when the user focuses the agent in the composer). Default:
   * nothing to warm.
   */
  public warmCatalog(): Promise<void> {
    return Promise.resolve()
  }

  /** Release all in-memory state of a deleted session and its on-disk transcript. */
  public forgetSession(sessionId: string): void {
    this.forgottenSessions.add(sessionId)
    this.sessionsWithDiskHistory.delete(sessionId)
    this.transcript.forgetSession(sessionId)
    this.transcriptHydrations.delete(sessionId)
    const timer = this.pendingTranscriptSaves.get(sessionId)
    if (timer !== undefined) {
      clearTimeout(timer)
      this.pendingTranscriptSaves.delete(sessionId)
    }
    const store = this.transcriptStore
    if (store) {
      void this.queueTranscriptOp(sessionId, () => store.remove(sessionId))
    }
    for (const [requestId, request] of this.pendingPermissionRequests) {
      if (request.sessionId === sessionId) {
        this.pendingPermissionRequests.delete(requestId)
      }
    }
    this.handleForgetSession(sessionId)
  }

  /** Subclass hook to release native per-session resources (subprocesses, id maps). */
  protected handleForgetSession(_sessionId: string): void {}

  /** Subclass hook to scrub agent-internal noise from a restored transcript. */
  protected sanitizeRestoredMessages(messages: ChatMessage[]): ChatMessage[] {
    return messages
  }

  /**
   * Whether this session already carries persisted history (hydrated from a
   * previous run or an earlier crashed process). Lets adapters pick a
   * resume-style native session start instead of creating a fresh one.
   */
  protected hasPersistedHistory(sessionId: string): boolean {
    return this.sessionsWithDiskHistory.has(sessionId) || this.transcript.messageCount(sessionId) > 0
  }

  /** Bounded host transcript used when a native runtime cannot load its own previous session. */
  protected restoredConversationContext(sessionId: string, maxCharacters = 100_000): string | undefined {
    const serialized: string[] = []
    let size = 0
    for (const message of this.transcript.messages(sessionId).reverse()) {
      const value = JSON.stringify({ role: message.role, parts: message.parts })
      if (size + value.length > maxCharacters) break
      serialized.push(value)
      size += value.length
    }
    if (serialized.length === 0) return undefined
    return [
      "<wanta_restored_conversation>",
      "This is Wanta's persisted transcript for the same task. Continue it as prior conversation context; do not repeat it to the user.",
      ...serialized.reverse(),
      "</wanta_restored_conversation>",
    ].join("\n")
  }

  private hydrateTranscript(sessionId: string): Promise<void> {
    const store = this.transcriptStore
    if (!store || this.transcript.has(sessionId) || this.forgottenSessions.has(sessionId)) {
      return Promise.resolve()
    }
    let hydration = this.transcriptHydrations.get(sessionId)
    if (!hydration) {
      // The load rides the per-session op chain so it can never race ahead of
      // a queued removal and resurrect a deleted session's history. The chain
      // also swallows and logs failures, so a broken disk state degrades to an
      // empty history instead of poisoning every later getMessages/send.
      hydration = this.queueTranscriptOp(sessionId, async () => {
        if (this.forgottenSessions.has(sessionId)) {
          return
        }
        const messages = await store.load(sessionId)
        if (messages && messages.length > 0) {
          this.sessionsWithDiskHistory.add(sessionId)
        }
        const sanitized = messages && messages.length > 0 ? this.sanitizeRestoredMessages(messages) : messages
        if (sanitized && sanitized.length > 0 && !this.forgottenSessions.has(sessionId)) {
          this.transcript.restore(sessionId, sanitized)
        }
      })
      this.transcriptHydrations.set(sessionId, hydration)
    }
    return hydration
  }

  private scheduleTranscriptSave(event: AgentEvent): void {
    if (!this.transcriptStore) {
      return
    }
    switch (event.event) {
      case "messageStarted":
      case "messageDelta":
      case "messageReasoningDelta":
      case "messageAttachment":
      case "toolCallStarted":
      case "toolCallResult":
      case "usageUpdated":
      case "messagePartRemoved": {
        const sessionId = event.data.sessionId
        if (!this.pendingTranscriptSaves.has(sessionId)) {
          this.pendingTranscriptSaves.set(
            sessionId,
            setTimeout(() => {
              void this.flushTranscript(sessionId)
            }, TRANSCRIPT_SAVE_DEBOUNCE_MS),
          )
        }
        return
      }
      case "messageCompleted":
        // Completion materializes finishReason/completedAt; flush immediately
        // so a quit right after a finished turn never loses it.
        void this.flushTranscript(event.data.sessionId)
        return
      default:
        return
    }
  }

  private flushTranscript(sessionId: string): Promise<void> {
    const timer = this.pendingTranscriptSaves.get(sessionId)
    if (timer !== undefined) {
      clearTimeout(timer)
      this.pendingTranscriptSaves.delete(sessionId)
    }
    const store = this.transcriptStore
    if (!store) {
      return Promise.resolve()
    }
    // The snapshot is taken when the queued op runs, so a chained save always
    // writes the freshest state and same-session writes never interleave.
    return this.queueTranscriptOp(sessionId, () => store.save(sessionId, this.transcript.messages(sessionId)))
  }

  private queueTranscriptOp(sessionId: string, op: () => Promise<void>): Promise<void> {
    const previous = this.transcriptOps.get(sessionId) ?? Promise.resolve()
    const next = previous.then(op).catch((error: unknown) => {
      logDiagnostic(
        "external-transcript",
        "transcript disk operation failed",
        { adapter: this.kind, sessionId, error },
        "error",
      )
    })
    this.transcriptOps.set(sessionId, next)
    // Drop the entry once the chain drains so idle sessions do not keep a
    // settled promise alive for the app's whole lifetime.
    void next.finally(() => {
      if (this.transcriptOps.get(sessionId) === next) {
        this.transcriptOps.delete(sessionId)
      }
    })
    return next
  }

  /**
   * Optional capability: project Wanta's permission mode onto the agent's own
   * approval policy (Claude Code permission modes, ACP session modes). The chat
   * layer calls it generically when present — never behind a kind check.
   */
  public applyPermissionMode?(sessionId: string, mode: AgentPermissionMode): Promise<void>

  /** Current probe snapshot (binary + login state) for the UI resource. */
  public abstract runtimeStatus(): Promise<ExternalAgentRuntimeStatus>
}
