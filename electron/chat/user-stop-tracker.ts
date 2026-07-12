import type { ChatEmit } from "../agent/event-translator.ts"

const userStopAbortWindowMs = 30_000

export function isAbortErrorMessage(message: string): boolean {
  const normalized = message
    .trim()
    .replace(/[.!。]+$/, "")
    .toLowerCase()
  return (
    normalized === "aborted" ||
    normalized === "aborterror" ||
    normalized.startsWith("aborterror:") ||
    normalized === "abort error" ||
    normalized === "the operation was aborted" ||
    normalized === "this operation was aborted" ||
    normalized.includes("operation was aborted")
  )
}

/** 记录用户主动停止后的短暂 abort 窗口，避免把预期的取消事件重新展示为运行错误。 */
export class UserStopTracker {
  private readonly stoppedSessions = new Map<string, number>()

  public clear(): void {
    this.stoppedSessions.clear()
  }

  public delete(sessionId: string): void {
    this.stoppedSessions.delete(sessionId)
  }

  public mark(sessionId: string): void {
    const expiresAt = Date.now() + userStopAbortWindowMs
    this.stoppedSessions.set(sessionId, expiresAt)
    const timer = setTimeout(() => {
      if (this.stoppedSessions.get(sessionId) === expiresAt) {
        this.stoppedSessions.delete(sessionId)
      }
    }, userStopAbortWindowMs)
    timer.unref?.()
  }

  public consumeAbort(sessionId: string, message: string): boolean {
    if (!this.isActive(sessionId) || !isAbortErrorMessage(message)) {
      return false
    }
    return true
  }

  public shouldSuppressEvent(translated: ChatEmit): boolean {
    if (!this.isActive(translated.data.sessionId)) {
      return false
    }
    return translated.event !== "messageCompleted"
  }

  private isActive(sessionId: string | undefined): boolean {
    if (!sessionId) {
      return false
    }
    const expiresAt = this.stoppedSessions.get(sessionId)
    if (!expiresAt) {
      return false
    }
    if (Date.now() <= expiresAt) {
      return true
    }
    this.stoppedSessions.delete(sessionId)
    return false
  }
}
