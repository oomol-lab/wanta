import type { ChatQuestionInfo, ChatQuestionRequest } from "../chat/common.ts"

import { randomUUID } from "node:crypto"

interface PendingHostQuestion {
  reject: (error: Error) => void
  request: ChatQuestionRequest
  resolve: (answers: string[][]) => void
}

/** Bridges a blocking host tool call to Wanta's native structured-question UI. */
export class HostQuestionBroker {
  private readonly pending = new Map<string, PendingHostQuestion>()
  private onAsked: ((request: ChatQuestionRequest) => void) | undefined

  public setAskedHandler(handler: (request: ChatQuestionRequest) => void): () => void {
    this.onAsked = handler
    return () => {
      if (this.onAsked === handler) this.onAsked = undefined
    }
  }

  public ask(sessionId: string, questions: ChatQuestionInfo[]): Promise<string[][]> {
    if (!this.onAsked) throw new Error("Wanta's structured-question UI is unavailable.")
    const request: ChatQuestionRequest = { id: `host-question-${randomUUID()}`, questions, sessionId }
    return new Promise((resolve, reject) => {
      this.pending.set(request.id, { reject, request, resolve })
      try {
        this.onAsked?.(request)
      } catch (error) {
        this.pending.delete(request.id)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  public requests(sessionIds?: readonly string[]): ChatQuestionRequest[] {
    const allowed = sessionIds ? new Set(sessionIds) : undefined
    return [...this.pending.values()]
      .map((entry) => entry.request)
      .filter((request) => !allowed || allowed.has(request.sessionId))
  }

  public answer(sessionId: string, requestId: string, answers: string[][]): boolean {
    const pending = this.pending.get(requestId)
    if (!pending || pending.request.sessionId !== sessionId) return false
    this.pending.delete(requestId)
    pending.resolve(answers)
    return true
  }

  public reject(sessionId: string, requestId: string): boolean {
    const pending = this.pending.get(requestId)
    if (!pending || pending.request.sessionId !== sessionId) return false
    this.pending.delete(requestId)
    pending.reject(new Error("The user declined the structured question."))
    return true
  }

  public cancelSession(sessionId: string): void {
    for (const [id, pending] of this.pending) {
      if (pending.request.sessionId !== sessionId) continue
      this.pending.delete(id)
      pending.reject(new Error("The Wanta session ended before the question was answered."))
    }
  }

  public dispose(): void {
    for (const pending of this.pending.values()) pending.reject(new Error("Wanta is shutting down."))
    this.pending.clear()
    this.onAsked = undefined
  }
}
