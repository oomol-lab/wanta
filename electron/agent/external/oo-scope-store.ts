export type ExternalOoRuntime = "none" | "oomol" | "openconnector"

interface ActiveExternalTurn {
  runtime: ExternalOoRuntime
  teamName: string
}

/** Running external turns whose shared OO guard must resolve one safe workspace. */
export class ExternalOoScopeStore {
  private runtime: ExternalOoRuntime = "none"
  private readonly activeTurns = new Map<string, ActiveExternalTurn>()

  public activate(sessionId: string, runtime: ExternalOoRuntime, teamName: string | undefined): Promise<void> {
    this.runtime = runtime
    this.activeTurns.set(sessionId, { runtime, teamName: teamName?.trim() ?? "" })
    return Promise.resolve()
  }

  public deactivate(sessionId: string): Promise<void> {
    this.activeTurns.delete(sessionId)
    return Promise.resolve()
  }

  public setRuntime(runtime: ExternalOoRuntime): Promise<void> {
    this.runtime = runtime
    return Promise.resolve()
  }

  public snapshot(): {
    external: true
    runtime: ExternalOoRuntime
    sessionRuntimes: Record<string, ExternalOoRuntime>
    sessionTeams: Record<string, string>
  } {
    return {
      external: true,
      runtime: this.runtime,
      sessionRuntimes: Object.fromEntries([...this.activeTurns].map(([sessionId, turn]) => [sessionId, turn.runtime])),
      sessionTeams: Object.fromEntries([...this.activeTurns].map(([sessionId, turn]) => [sessionId, turn.teamName])),
    }
  }
}
