import type { RunWikiGraphCLIInput } from "wiki-graph"

import { runWikiGraphCLI } from "wiki-graph"

const dangerousWikiGraphEnvNames = [
  "WIKIGRAPH_DEV",
  "WIKIGRAPH_ENV_POLICY",
  "WIKIGRAPH_QUEUE_DISABLE_AUTOSTART",
  "WIKIGRAPH_STATE_DIR",
] as const

function wikiGraphEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: "1" }
  for (const name of dangerousWikiGraphEnvNames) env[name] = undefined
  return env
}

async function main(): Promise<void> {
  const stateDir = process.env["WANTA_WIKIGRAPH_STATE_DIR"]?.trim()
  if (!stateDir) {
    process.stderr.write("Wanta WikiGraph state directory is unavailable\n")
    process.exitCode = 1
    return
  }

  const input: RunWikiGraphCLIInput = {
    argv: process.argv.slice(2),
    env: wikiGraphEnv(),
    stateDir,
    stderr: process.stderr,
    stderrIsTTY: process.stderr.isTTY,
    stdin: process.stdin,
    stdinIsTTY: process.stdin.isTTY,
    stdout: process.stdout,
    stdoutIsTTY: process.stdout.isTTY,
  }
  const result = await runWikiGraphCLI(input)
  process.exitCode = result.exitCode
}

await main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
