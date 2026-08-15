import type { RunWikiGraphCLIInput } from "wiki-graph"

import { Readable, Writable } from "node:stream"
import { runWikiGraphCLI } from "wiki-graph"

const MAX_OUTPUT_BYTES = 2 * 1024 * 1024
const dangerousEnvironmentNames = [
  "WIKIGRAPH_DEV",
  "WIKIGRAPH_ENV_POLICY",
  "WIKIGRAPH_QUEUE_DISABLE_AUTOSTART",
  "WIKIGRAPH_STATE_DIR",
] as const

export interface WikiGraphQueryExecutor {
  run(argv: readonly string[]): Promise<string>
}

/** Read-only, bounded WikiGraph execution used by every agent-facing transport. */
export class WikiGraphQueryRunner implements WikiGraphQueryExecutor {
  public constructor(private readonly stateDir: string) {}

  public async run(argv: readonly string[]): Promise<string> {
    const stdout = new BoundedTextWriter()
    const stderr = new BoundedTextWriter()
    const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: "1" }
    for (const name of dangerousEnvironmentNames) env[name] = undefined
    const input: RunWikiGraphCLIInput = {
      argv: [...argv],
      env,
      stateDir: this.stateDir,
      stderr,
      stderrIsTTY: false,
      stdin: Readable.from([]),
      stdinIsTTY: false,
      stdout,
      stdoutIsTTY: false,
    }
    const result = await runWikiGraphCLI(input)
    const output = stdout.text().trim()
    if (result.exitCode !== 0) {
      throw new Error(stderr.text().trim() || output || `WikiGraph query failed with exit code ${result.exitCode}.`)
    }
    return output
  }
}

class BoundedTextWriter extends Writable {
  private readonly chunks: Buffer[] = []
  private size = 0

  public override _write(chunk: Buffer | string, encoding: BufferEncoding, callback: (error?: Error | null) => void) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding)
    this.size += buffer.length
    if (this.size > MAX_OUTPUT_BYTES) {
      callback(new Error("WikiGraph output exceeded the 2 MiB safety limit."))
      return
    }
    this.chunks.push(buffer)
    callback()
  }

  public text(): string {
    return Buffer.concat(this.chunks).toString("utf8")
  }
}
