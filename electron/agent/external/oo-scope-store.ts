import path from "node:path"
import { externalAgentKindForSessionId, externalSessionUuid } from "./session-id.ts"

export type ExternalOoRuntime = "none" | "oomol" | "openconnector"

/** The adapter's deterministic ACP default cwd for an external Wanta session. */
export function externalSessionScratchCwd(scratchRootDir: string, sessionId: string): string | undefined {
  const kind = externalAgentKindForSessionId(sessionId)
  const uuid = externalSessionUuid(sessionId)
  return kind && uuid ? path.join(scratchRootDir, kind, uuid) : undefined
}

interface ActiveExternalTurn {
  cwdRoots: readonly string[]
  runtime: ExternalOoRuntime
  teamName: string
}

/** Running external turns whose shared OO guard must resolve one safe workspace. */
export class ExternalOoScopeStore {
  private runtime: ExternalOoRuntime = "none"
  private readonly activeTurns = new Map<string, ActiveExternalTurn>()

  public activate(
    sessionId: string,
    runtime: ExternalOoRuntime,
    teamName: string | undefined,
    cwdRoots: readonly string[] = [],
  ): Promise<void> {
    this.runtime = runtime
    this.activeTurns.set(sessionId, {
      cwdRoots: [...new Set(cwdRoots.filter((root) => root.trim()))],
      runtime,
      teamName: teamName?.trim() ?? "",
    })
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
    sessionCwdRoots: Record<string, readonly string[]>
    sessionRuntimes: Record<string, ExternalOoRuntime>
    sessionTeams: Record<string, string>
  } {
    return {
      external: true,
      runtime: this.runtime,
      sessionCwdRoots: Object.fromEntries([...this.activeTurns].map(([sessionId, turn]) => [sessionId, turn.cwdRoots])),
      sessionRuntimes: Object.fromEntries([...this.activeTurns].map(([sessionId, turn]) => [sessionId, turn.runtime])),
      sessionTeams: Object.fromEntries([...this.activeTurns].map(([sessionId, turn]) => [sessionId, turn.teamName])),
    }
  }
}
