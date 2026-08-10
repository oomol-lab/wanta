import type { AgentPermissionMode, ChatMessage, ChatPermissionRequest, ChatQuestionRequest } from "../../chat/common.ts"
import type { AgentEvent } from "../contract/event.ts"
import type { ExternalAgentRuntimeStatus } from "./probe.ts"

import { BaseAgentAdapter } from "../contract/adapter.ts"
import { ExternalTranscriptRecorder } from "./transcript.ts"

// Shared skeleton for external (BYOA) adapters. On top of the contract base it
// provides the chat-layer backend surface the built-in kernel gets from the
// OpenCode server: transcript-backed history, pending-permission queries, and
// readiness — all derived purely from the adapter's own emitted events.

export abstract class ExternalAgentAdapter extends BaseAgentAdapter {
  private readonly transcript = new ExternalTranscriptRecorder()
  private readonly pendingPermissionRequests = new Map<string, ChatPermissionRequest>()

  protected override emit(event: AgentEvent): void {
    this.transcript.record(event)
    if (event.event === "permissionAsked") {
      this.pendingPermissionRequests.set(event.data.request.id, event.data.request)
    } else if (event.event === "permissionReplied") {
      this.pendingPermissionRequests.delete(event.data.requestId)
    }
    super.emit(event)
  }

  public isReady(): boolean {
    return this.isStarted
  }

  public getMessages(sessionId: string): Promise<ChatMessage[]> {
    return Promise.resolve(this.transcript.messages(sessionId))
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

  /** Release all in-memory state of a deleted session. */
  public forgetSession(sessionId: string): void {
    this.transcript.forgetSession(sessionId)
    for (const [requestId, request] of this.pendingPermissionRequests) {
      if (request.sessionId === sessionId) {
        this.pendingPermissionRequests.delete(requestId)
      }
    }
    this.handleForgetSession(sessionId)
  }

  /** Subclass hook to release native per-session resources (subprocesses, id maps). */
  protected handleForgetSession(_sessionId: string): void {}

  /**
   * Optional capability: project Wanta's permission mode onto the agent's own
   * approval policy (Claude Code permission modes, ACP session modes). The chat
   * layer calls it generically when present — never behind a kind check.
   */
  public applyPermissionMode?(sessionId: string, mode: AgentPermissionMode): Promise<void>

  /** Current probe snapshot (binary + login state) for the UI resource. */
  public abstract runtimeStatus(): Promise<ExternalAgentRuntimeStatus>
}
