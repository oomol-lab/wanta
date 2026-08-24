import { mkdir } from "node:fs/promises"
import path from "node:path"
import { atomicWriteText } from "../../atomic-file.ts"

export type ExternalOoRuntime = "none" | "oomol" | "openconnector"

/** Running external turns whose shared OO guard must resolve one safe workspace. */
export class ExternalOoScopeStore {
  private readonly filePathValue: string
  private runtime: ExternalOoRuntime = "none"
  private readonly sessionTeams = new Map<string, string>()
  private writeTail: Promise<void> = Promise.resolve()

  public constructor(filePath: string) {
    this.filePathValue = filePath
  }

  public get filePath(): string {
    return this.filePathValue
  }

  public activate(sessionId: string, runtime: ExternalOoRuntime, teamName: string | undefined): Promise<void> {
    this.runtime = runtime
    this.sessionTeams.set(sessionId, teamName?.trim() ?? "")
    return this.write()
  }

  public deactivate(sessionId: string): Promise<void> {
    this.sessionTeams.delete(sessionId)
    return this.write()
  }

  public setRuntime(runtime: ExternalOoRuntime): Promise<void> {
    if (runtime !== this.runtime) this.sessionTeams.clear()
    this.runtime = runtime
    return this.write()
  }

  private write(): Promise<void> {
    const content = `${JSON.stringify({
      external: true,
      runtime: this.runtime,
      sessionTeams: Object.fromEntries(this.sessionTeams),
    })}\n`
    this.writeTail = this.writeTail
      .catch(() => undefined)
      .then(async () => {
        await mkdir(path.dirname(this.filePathValue), { recursive: true })
        await atomicWriteText(this.filePathValue, content)
      })
    return this.writeTail
  }
}
