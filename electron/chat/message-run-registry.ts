/** Bounded message ownership retained across turns, so delayed parts keep their original owner. */
export class MessageRunRegistry {
  private readonly owners = new Map<string, string | undefined>()
  private readonly limit: number

  public constructor(limit = 5_000) {
    this.limit = limit
  }

  public isCurrent(
    sessionId: string,
    messageId: string,
    runId: string | undefined,
    options: { parentMessageId?: string; userMessageId?: string } = {},
  ): boolean {
    const key = `${sessionId}\0${messageId}`
    // Native parent identity also catches an old assistant first observed only
    // after a retry. Never rebind that message to the new turn.
    if (options.parentMessageId && options.userMessageId && options.parentMessageId !== options.userMessageId) {
      this.remember(key, undefined)
      return false
    }
    if (this.owners.has(key)) return this.owners.get(key) === runId
    this.remember(key, runId)
    return true
  }

  public forgetSession(sessionId: string): void {
    for (const key of this.owners.keys()) {
      if (key.startsWith(`${sessionId}\0`)) this.owners.delete(key)
    }
  }

  public clear(): void {
    this.owners.clear()
  }

  private remember(key: string, runId: string | undefined): void {
    if (this.owners.has(key)) return
    while (this.owners.size >= this.limit) {
      const oldest = this.owners.keys().next().value
      if (oldest === undefined) break
      this.owners.delete(oldest)
    }
    this.owners.set(key, runId)
  }
}
