import type { ChatEmit } from "../agent/event-translator.ts"
import type { ChatActiveRun, ChatRunPhase, ChatRunWorkspace } from "./common.ts"

import { sessionScopesEqual } from "../session/common.ts"

type ActiveRunUpdate = {
  ended?: { endedAt: number; endedRunId: string }
  run: ChatActiveRun | null
  sessionId: string
}

type RunPatch = Partial<
  Pick<ChatActiveRun, "activeAssistantMessageId" | "activeToolPartIds" | "blockingRequestIds" | "phase">
>

/** 集中维护 active run 与阻塞请求的状态转换，service 只负责把变化广播到渲染层。 */
export class ActiveRunRegistry {
  private readonly runs = new Map<string, ChatActiveRun>()
  private readonly blockingPhases = new Map<
    string,
    Map<string, Extract<ChatRunPhase, "awaiting_permission" | "awaiting_question">>
  >()
  private readonly onUpdated: (update: ActiveRunUpdate) => void

  public constructor(onUpdated: (update: ActiveRunUpdate) => void) {
    this.onUpdated = onUpdated
  }

  public get size(): number {
    return this.runs.size
  }

  public get(sessionId: string): ChatActiveRun | undefined {
    return this.runs.get(sessionId)
  }

  public values(): IterableIterator<ChatActiveRun> {
    return this.runs.values()
  }

  public keys(): IterableIterator<string> {
    return this.runs.keys()
  }

  public create(sessionId: string, generationId: string, workspace: ChatRunWorkspace): void {
    const now = Date.now()
    const run: ChatActiveRun = {
      activeToolPartIds: [],
      blockingRequestIds: [],
      generationId,
      phase: "sending",
      runId: generationId,
      sessionId,
      startedAt: now,
      updatedAt: now,
      workspace,
    }
    this.blockingPhases.delete(sessionId)
    this.runs.set(sessionId, run)
    this.onUpdated({ run, sessionId })
  }

  public update(sessionId: string, patch: RunPatch): void {
    const current = this.runs.get(sessionId)
    if (!current) {
      return
    }
    const blockingPhase = this.blockingPhase(sessionId)
    const requestedPhase = patch.phase
    const phase =
      requestedPhase === "awaiting_permission" || requestedPhase === "awaiting_question"
        ? requestedPhase
        : (blockingPhase ?? requestedPhase ?? current.phase)
    const next: ChatActiveRun = {
      ...current,
      ...(patch.activeAssistantMessageId === undefined
        ? {}
        : { activeAssistantMessageId: patch.activeAssistantMessageId }),
      ...(patch.activeToolPartIds === undefined ? {} : { activeToolPartIds: patch.activeToolPartIds }),
      ...(patch.blockingRequestIds === undefined ? {} : { blockingRequestIds: patch.blockingRequestIds }),
      phase,
      updatedAt: Date.now(),
    }
    if (sameActiveRun(current, next)) {
      return
    }
    this.runs.set(sessionId, next)
    this.onUpdated({ run: next, sessionId })
  }

  public delete(sessionId: string, generationId?: string): void {
    const current = this.runs.get(sessionId)
    if (!current || (generationId && current.generationId !== generationId)) {
      return
    }
    this.runs.delete(sessionId)
    this.blockingPhases.delete(sessionId)
    this.onUpdated({
      ended: { endedAt: Date.now(), endedRunId: current.runId },
      run: null,
      sessionId,
    })
  }

  public clear(): void {
    for (const sessionId of this.runs.keys()) {
      this.delete(sessionId)
    }
    this.runs.clear()
    this.blockingPhases.clear()
  }

  public blockingPhase(sessionId: string): Extract<ChatRunPhase, "awaiting_permission" | "awaiting_question"> | null {
    const blocks = this.blockingPhases.get(sessionId)
    if (!blocks || blocks.size === 0) {
      return null
    }
    return [...blocks.values()].includes("awaiting_permission") ? "awaiting_permission" : "awaiting_question"
  }

  public addBlockingRequest(
    sessionId: string,
    requestId: string,
    phase: Extract<ChatRunPhase, "awaiting_permission" | "awaiting_question">,
  ): void {
    if (!this.runs.has(sessionId)) {
      return
    }
    const blocks = this.blockingPhases.get(sessionId) ?? new Map()
    blocks.set(requestId, phase)
    this.blockingPhases.set(sessionId, blocks)
    this.update(sessionId, { blockingRequestIds: [...blocks.keys()], phase })
  }

  public removeBlockingRequest(sessionId: string, requestId: string): void {
    const blocks = this.blockingPhases.get(sessionId)
    if (blocks) {
      blocks.delete(requestId)
      if (blocks.size === 0) {
        this.blockingPhases.delete(sessionId)
      }
    }
    this.update(sessionId, {
      blockingRequestIds: blocks && blocks.size > 0 ? [...blocks.keys()] : [],
      phase: this.blockingPhase(sessionId) ?? "thinking",
    })
  }

  public applyEvent(event: ChatEmit): void {
    const sessionId = event.data.sessionId
    if (!sessionId) {
      return
    }
    switch (event.event) {
      case "assistantActivity":
        this.update(sessionId, {
          activeAssistantMessageId: event.data.messageId,
          phase: event.data.phase === "retrying" ? "submitted" : "thinking",
        })
        break
      case "messageDelta":
        this.update(sessionId, {
          activeAssistantMessageId: event.data.messageId,
          phase: event.data.text || event.data.delta ? "answering" : "thinking",
        })
        break
      case "messageReasoningDelta":
        this.update(sessionId, { activeAssistantMessageId: event.data.messageId, phase: "thinking" })
        break
      case "messageStarted":
        if (event.data.role === "assistant") {
          this.update(sessionId, { activeAssistantMessageId: event.data.messageId, phase: "thinking" })
        }
        break
      case "permissionAsked":
        this.addBlockingRequest(sessionId, event.data.request.id, "awaiting_permission")
        break
      case "permissionReplied":
        this.removeBlockingRequest(sessionId, event.data.requestId)
        break
      case "questionAsked":
        this.addBlockingRequest(sessionId, event.data.request.id, "awaiting_question")
        break
      case "questionRejected":
      case "questionReplied":
        this.removeBlockingRequest(sessionId, event.data.requestId)
        break
      default:
        break
    }
  }
}

function sameActiveRun(left: ChatActiveRun, right: ChatActiveRun): boolean {
  return (
    left.activeAssistantMessageId === right.activeAssistantMessageId &&
    left.generationId === right.generationId &&
    left.phase === right.phase &&
    left.runId === right.runId &&
    left.sessionId === right.sessionId &&
    left.startedAt === right.startedAt &&
    sessionScopesEqual(left.workspace, right.workspace) &&
    sameStringArray(left.activeToolPartIds, right.activeToolPartIds) &&
    sameStringArray(left.blockingRequestIds, right.blockingRequestIds)
  )
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}
