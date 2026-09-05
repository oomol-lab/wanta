/** Mutable tokens are private to one hook instance, never persisted or sent over IPC. */
export interface ChatRunToken {
  runId?: string
  ended: boolean
  optimistic: boolean
}

/** Owns callback identity across optimistic submission, host acknowledgement and termination. */
export class ChatRunOwnership {
  private readonly sessions = new Map<string, ChatRunToken>()

  public beginSubmission(sessionId: string): ChatRunToken {
    const token = { ended: false, optimistic: true }
    this.sessions.set(sessionId, token)
    return token
  }

  public capture(sessionId: string): ChatRunToken {
    let token = this.sessions.get(sessionId)
    if (!token) {
      token = { ended: false, optimistic: false }
      this.sessions.set(sessionId, token)
    }
    return token
  }

  public isCurrent(sessionId: string, token: ChatRunToken): boolean {
    return this.sessions.get(sessionId) === token && !token.ended
  }

  public hasActiveRun(sessionId: string): boolean {
    const token = this.sessions.get(sessionId)
    return Boolean(token?.runId && !token.ended)
  }

  public acceptsTerminal(sessionId: string, runId?: string): boolean {
    const current = this.sessions.get(sessionId)
    if (!current) return true
    // Untagged legacy events cannot end a known or optimistically pending run.
    if (!runId) return !current.runId && !current.optimistic
    return current.runId === runId
  }

  public applyRun(sessionId: string, runId: string | null, endedRunId?: string): boolean {
    const current = this.sessions.get(sessionId)
    if (runId) {
      if (current?.runId === runId) return !current.ended
      if (current?.optimistic && !current.runId) {
        // Bind the server identity without invalidating this send's callback.
        current.runId = runId
        current.optimistic = false
      } else {
        this.sessions.set(sessionId, { runId, ended: false, optimistic: false })
      }
      return true
    }
    // An empty snapshot during dispatch is not an acknowledgement that the
    // optimistic submission ended; wait for the host to bind or reject it.
    if (!endedRunId && current?.optimistic) return false
    if (endedRunId && current && current.runId !== endedRunId) return false
    if (current) current.ended = true
    else if (endedRunId) this.sessions.set(sessionId, { runId: endedRunId, ended: true, optimistic: false })
    return true
  }

  public forget(sessionId: string): void {
    this.sessions.delete(sessionId)
  }

  public reset(): void {
    this.sessions.clear()
  }
}
