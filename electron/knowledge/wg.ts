import type { RunWikiGraphCLIInput } from "wiki-graph"

import { runWikiGraphCLI } from "wiki-graph"

const stateDirFlag = "--wanta-state-dir"
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

function parseInvocation(argv: string[]): { stateDir: string; wikiGraphArgv: string[] } {
  if (argv[0] !== stateDirFlag || !argv[1]?.trim() || argv[2] !== "--") {
    throw new Error("Wanta WikiGraph command is missing its managed state directory.")
  }
  return { stateDir: argv[1], wikiGraphArgv: argv.slice(3) }
}

async function main(): Promise<void> {
  const { stateDir, wikiGraphArgv } = parseInvocation(process.argv.slice(2))
  const input: RunWikiGraphCLIInput = {
    argv: wikiGraphArgv,
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
