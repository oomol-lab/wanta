import type { WorkspaceTeamScope } from "./oo-guard-core.ts"

import { spawn } from "node:child_process"
import { readFile } from "node:fs/promises"
import {
  bindOomolWorkspace,
  hasWorkspaceSelector,
  isConnectorBusinessCommand,
  redactConnectorOutput,
  resolveGuardWorkspaceTeam,
  stripIdentityIndependentWorkspaceSelectors,
} from "./oo-guard-core.ts"

const maxCapturedOutputBytes = 32 * 1024 * 1024

async function currentWorkspaceTeam(): Promise<string> {
  const scopePath = process.env.WANTA_TEAM_SCOPE_PATH?.trim()
  if (!scopePath) return ""
  const parsed = JSON.parse(await readFile(scopePath, "utf8")) as WorkspaceTeamScope
  return resolveGuardWorkspaceTeam(parsed)
}

function appendBounded(chunks: Buffer[], chunk: Buffer, size: number): number {
  const nextSize = size + chunk.length
  if (nextSize > maxCapturedOutputBytes) {
    throw new Error("Connector output exceeded Wanta's 32 MiB safety limit.")
  }
  chunks.push(chunk)
  return nextSize
}

function killWithEscalation(child: ReturnType<typeof spawn>): void {
  child.kill("SIGTERM")
  const timer = setTimeout(() => child.kill("SIGKILL"), 5_000)
  timer.unref()
  child.once("close", () => clearTimeout(timer))
}

async function runGuarded(command: string, args: string[]): Promise<number> {
  const child = spawn(command, args, { env: process.env, stdio: ["inherit", "pipe", "pipe"] })
  const stdout: Buffer[] = []
  const stderr: Buffer[] = []
  let stdoutSize = 0
  let stderrSize = 0
  let captureError: Error | null = null

  child.stdout.on("data", (chunk: Buffer) => {
    if (captureError) return
    try {
      stdoutSize = appendBounded(stdout, chunk, stdoutSize)
    } catch (error) {
      captureError = error instanceof Error ? error : new Error(String(error))
      killWithEscalation(child)
    }
  })
  child.stderr.on("data", (chunk: Buffer) => {
    if (captureError) return
    try {
      stderrSize = appendBounded(stderr, chunk, stderrSize)
    } catch (error) {
      captureError = error instanceof Error ? error : new Error(String(error))
      killWithEscalation(child)
    }
  })

  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once("error", reject)
    child.once("close", (code, signal) => {
      resolve(code ?? (signal ? 1 : 0))
    })
  })
  if (captureError) throw captureError
  process.stdout.write(redactConnectorOutput(Buffer.concat(stdout).toString("utf8")))
  process.stderr.write(redactConnectorOutput(Buffer.concat(stderr).toString("utf8")))
  return exitCode
}

async function runPassthrough(command: string, args: string[]): Promise<number> {
  const child = spawn(command, args, { env: process.env, stdio: "inherit" })
  return await new Promise<number>((resolve, reject) => {
    child.once("error", reject)
    child.once("close", (code, signal) => resolve(code ?? (signal ? 1 : 0)))
  })
}

async function main(): Promise<void> {
  const command = process.env.WANTA_REAL_OO_BIN?.trim()
  if (!command) {
    throw new Error("WANTA_REAL_OO_BIN is required for the managed oo command.")
  }
  const originalArgs = stripIdentityIndependentWorkspaceSelectors(process.argv.slice(2))
  const needsOomolBinding =
    process.env.WANTA_LINK_RUNTIME === "oomol" &&
    isConnectorBusinessCommand(originalArgs) &&
    !hasWorkspaceSelector(originalArgs)
  const args = needsOomolBinding ? bindOomolWorkspace(originalArgs, await currentWorkspaceTeam()) : originalArgs
  const exitCode = isConnectorBusinessCommand(args)
    ? await runGuarded(command, args)
    : await runPassthrough(command, args)
  process.exitCode = exitCode
}

await main().catch((error: unknown) => {
  process.stderr.write(`Wanta oo guard: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
