import type { BootstrapConfig } from "./bootstrap.ts"

import { spawn } from "node:child_process"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { createBootstrapConfig, writeBootstrapFiles } from "./bootstrap.ts"

const dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.join(dirname, "..")
const bootstrapJsonPath = path.join(repoRoot, ".wanta-dev", "bootstrap.json")
const requiredEnvKeys = ["WANTA_DEV_SERVER_PORT", "WANTA_SKIP_PROTOCOL_REGISTRATION", "WANTA_USER_DATA_DIR"]

await main()

async function main(): Promise<void> {
  let config = await readBootstrapConfig()
  let result = await run(commandName("corepack"), ["pnpm", "run", "dev"], config.env)
  if (result.ok) {
    return
  }
  if (!isPortInUseFailure(result.output)) {
    throw new Error(result.message)
  }

  console.warn("[wanta] configured dev server port is already in use; selecting another worktree port")
  config = await createBootstrapConfig()
  await writeBootstrapFiles(config)
  result = await run(commandName("corepack"), ["pnpm", "run", "dev"], config.env)
  if (!result.ok) {
    throw new Error(result.message)
  }
}

async function readBootstrapConfig(): Promise<BootstrapConfig> {
  try {
    return parseBootstrapConfig(JSON.parse(await readFile(bootstrapJsonPath, "utf-8")))
  } catch (error) {
    throw new Error(`bootstrap config missing or invalid; run \`corepack pnpm run bootstrap\` first: ${error}`)
  }
}

function parseBootstrapConfig(value: unknown): BootstrapConfig {
  if (!isRecord(value)) {
    throw new Error("expected an object")
  }
  if (typeof value.devServerPort !== "number" || !Number.isInteger(value.devServerPort)) {
    throw new Error("devServerPort must be an integer")
  }
  if (typeof value.userDataDir !== "string" || value.userDataDir.length === 0) {
    throw new Error("userDataDir must be a non-empty string")
  }
  if (typeof value.generatedAt !== "string" || value.generatedAt.length === 0) {
    throw new Error("generatedAt must be a non-empty string")
  }
  if (typeof value.repoRoot !== "string" || value.repoRoot.length === 0) {
    throw new Error("repoRoot must be a non-empty string")
  }
  if (!isStringRecord(value.env)) {
    throw new Error("env must be an object of string values")
  }
  for (const key of requiredEnvKeys) {
    if (typeof value.env[key] !== "string" || value.env[key].length === 0) {
      throw new Error(`env.${key} must be a non-empty string`)
    }
  }
  if (Number(value.env["WANTA_DEV_SERVER_PORT"]) !== value.devServerPort) {
    throw new Error("env.WANTA_DEV_SERVER_PORT must match devServerPort")
  }
  return {
    devServerPort: value.devServerPort,
    env: value.env,
    generatedAt: value.generatedAt,
    repoRoot: value.repoRoot,
    userDataDir: value.userDataDir,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!isRecord(value)) return false
  return Object.values(value).every((entry) => typeof entry === "string")
}

interface RunResult {
  message: string
  ok: boolean
  output: string
}

async function run(command: string, args: string[], env: Record<string, string>): Promise<RunResult> {
  return await new Promise<RunResult>((resolve, reject) => {
    let output = ""
    const child = spawn(command, args, {
      cwd: repoRoot,
      env: { ...process.env, ...env },
      stdio: ["inherit", "pipe", "pipe"],
    })

    child.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf-8")
      process.stdout.write(chunk)
    })
    child.stderr?.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf-8")
      process.stderr.write(chunk)
    })
    child.once("error", reject)
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve({ message: "", ok: true, output })
        return
      }
      const message = `${command} ${args.join(" ")} failed with ${signal ?? `exit code ${code}`}`
      resolve({ message, ok: false, output })
    })
  })
}

function isPortInUseFailure(output: string): boolean {
  return /\bEADDRINUSE\b/.test(output) || /Port \d+ is already in use/.test(output)
}

function commandName(command: string): string {
  return process.platform === "win32" ? `${command}.cmd` : command
}
