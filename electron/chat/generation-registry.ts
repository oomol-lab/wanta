export interface SessionGeneration {
  controller: AbortController
  id: string
  userMessageId: string
}

/** 集中持有聊天 generation 与 watchdog，避免 service 同时维护多组互相依赖的 timer map。 */
export class GenerationRegistry {
  private readonly generations = new Map<string, SessionGeneration>()
  private readonly acknowledgementWatchdogs = new Map<string, NodeJS.Timeout>()
  private readonly inactivityWatchdogs = new Map<string, NodeJS.Timeout>()

  public get size(): number {
    return this.generations.size
  }

  public keys(): IterableIterator<string> {
    return this.generations.keys()
  }

  public get(sessionId: string): SessionGeneration | undefined {
    return this.generations.get(sessionId)
  }

  public has(sessionId: string): boolean {
    return this.generations.has(sessionId)
  }

  public begin(
    sessionId: string,
    userMessageId: string,
  ): { generation: SessionGeneration; previous?: SessionGeneration } {
    const previous = this.generations.get(sessionId)
    previous?.controller.abort()
    const generation = { controller: new AbortController(), id: crypto.randomUUID(), userMessageId }
    this.generations.set(sessionId, generation)
    return { generation, ...(previous ? { previous } : {}) }
  }

  public isCurrent(sessionId: string, generationId: string): boolean {
    return this.generations.get(sessionId)?.id === generationId
  }

  public clear(sessionId: string, generationId?: string): SessionGeneration | undefined {
    const generation = this.generations.get(sessionId)
    if (generationId && generation?.id !== generationId) {
      return undefined
    }
    this.clearAcknowledgementWatchdog(sessionId)
    this.clearInactivityWatchdog(sessionId)
    this.generations.delete(sessionId)
    return generation
  }

  public reset(): void {
    for (const generation of this.generations.values()) {
      generation.controller.abort()
    }
    this.generations.clear()
    this.clearAllWatchdogs()
  }

  public scheduleAcknowledgementWatchdog(
    sessionId: string,
    generationId: string,
    timeoutMs: number,
    onTimeout: () => void,
  ): void {
    this.clearAcknowledgementWatchdog(sessionId)
    const timer = setTimeout(() => {
      this.acknowledgementWatchdogs.delete(sessionId)
      if (this.isCurrent(sessionId, generationId)) {
        onTimeout()
      }
    }, timeoutMs)
    timer.unref?.()
    this.acknowledgementWatchdogs.set(sessionId, timer)
  }

  public scheduleInactivityWatchdog(sessionId: string, timeoutMs: number, onTimeout: () => void): void {
    const generation = this.generations.get(sessionId)
    if (!generation) {
      return
    }
    this.clearInactivityWatchdog(sessionId)
    const timer = setTimeout(() => {
      this.inactivityWatchdogs.delete(sessionId)
      if (this.isCurrent(sessionId, generation.id)) {
        onTimeout()
      }
    }, timeoutMs)
    timer.unref?.()
    this.inactivityWatchdogs.set(sessionId, timer)
  }

  public clearAcknowledgementWatchdog(sessionId: string): void {
    clearWatchdog(this.acknowledgementWatchdogs, sessionId)
  }

  public clearInactivityWatchdog(sessionId: string): void {
    clearWatchdog(this.inactivityWatchdogs, sessionId)
  }

  private clearAllWatchdogs(): void {
    for (const timer of [...this.acknowledgementWatchdogs.values(), ...this.inactivityWatchdogs.values()]) {
      clearTimeout(timer)
    }
    this.acknowledgementWatchdogs.clear()
    this.inactivityWatchdogs.clear()
  }
}

function clearWatchdog(watchdogs: Map<string, NodeJS.Timeout>, sessionId: string): void {
  const timer = watchdogs.get(sessionId)
  if (!timer) {
    return
  }
  clearTimeout(timer)
  watchdogs.delete(sessionId)
}
