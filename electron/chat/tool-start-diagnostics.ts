interface ToolStartGeneration {
  callIds: Set<string>
  generationId: string | undefined
}

/** Deduplicates diagnostic starts without discarding ACP progress events. */
export class ToolStartDiagnostics {
  private readonly generations = new Map<string, ToolStartGeneration>()

  public begin(sessionId: string, generationId: string): void {
    this.generations.set(sessionId, { callIds: new Set(), generationId })
  }

  public first(sessionId: string, generationId: string | undefined, callId: string): boolean {
    let generation = this.generations.get(sessionId)
    if (!generation || generation.generationId !== generationId) {
      generation = { callIds: new Set(), generationId }
      this.generations.set(sessionId, generation)
    }
    if (generation.callIds.has(callId)) return false
    generation.callIds.add(callId)
    return true
  }

  public clear(sessionId: string, generationId?: string): void {
    const generation = this.generations.get(sessionId)
    if (generationId && generation?.generationId !== generationId) return
    this.generations.delete(sessionId)
  }

  public reset(): void {
    this.generations.clear()
  }
}
