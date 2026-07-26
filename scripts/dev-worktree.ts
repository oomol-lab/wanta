import type { BootstrapConfig } from "./bootstrap.ts"

import { spawn } from "node:child_process"
import { cp, mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, stat } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { createBootstrapConfig, writeBootstrapFiles } from "./bootstrap.ts"

const dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.join(dirname, "..")
const bootstrapJsonPath = path.join(repoRoot, ".wanta-dev", "bootstrap.json")
const requiredEnvKeys = ["WANTA_DEV_SERVER_PORT", "WANTA_SKIP_PROTOCOL_REGISTRATION", "WANTA_USER_DATA_DIR"]

export function isMainModule(): boolean {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
}

if (isMainModule()) {
  await main()
}

async function main(): Promise<void> {
  let config = await readBootstrapConfig()
  await initializeWorktreeUserData(config)
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
  await initializeWorktreeUserData(config)
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

export async function initializeWorktreeUserData(
  config: BootstrapConfig,
): Promise<"copied" | "empty-source" | "self" | "kept"> {
  const target = path.resolve(config.userDataDir)
  if (!(await isDirectoryMissingOrEmpty(target))) {
    console.log(`[wanta] keeping existing worktree userData: ${target}`)
    return "kept"
  }

  const source = await resolveCanonicalUserDataDir(repoRoot)
  if (source === undefined) {
    console.log("[wanta] canonical dev userData not found; starting with a clean worktree profile")
    return "empty-source"
  }
  if (await isSamePath(source, target)) {
    console.log(`[wanta] current checkout is the canonical dev userData source: ${target}`)
    return "self"
  }
  if (await isDirectoryMissingOrEmpty(source)) {
    console.log(`[wanta] canonical dev userData is empty: ${source}; starting with a clean worktree profile`)
    return "empty-source"
  }

  await copyDirectoryOnce(source, target)
  console.log(`[wanta] initialized worktree userData from canonical source: ${source} -> ${target}`)
  return "copied"
}

export async function resolveCanonicalUserDataDir(currentRepoRoot: string): Promise<string | undefined> {
  const configured = process.env["WANTA_DEV_AUTH_SOURCE_DIR"]?.trim()
  if (configured) {
    return path.resolve(configured)
  }

  const worktrees = await listGitWorktrees(currentRepoRoot)
  const mainWorktree = worktrees.find((worktree) => worktree.branch === "refs/heads/main")
  const canonicalRoot = mainWorktree?.path ?? worktrees[0]?.path
  return canonicalRoot === undefined ? undefined : path.join(canonicalRoot, "wanta")
}

interface GitWorktreeInfo {
  branch?: string
  path: string
}

async function listGitWorktrees(cwd: string): Promise<GitWorktreeInfo[]> {
  const result = await run(commandName("git"), ["worktree", "list", "--porcelain"], {}, cwd)
  if (!result.ok) {
    return []
  }
  const worktrees: GitWorktreeInfo[] = []
  let current: Partial<GitWorktreeInfo> = {}
  for (const line of result.output.split("\n")) {
    if (line.startsWith("worktree ")) {
      if (current.path) worktrees.push(current as GitWorktreeInfo)
      current = { path: line.slice("worktree ".length) }
    } else if (line.startsWith("branch ")) {
      current.branch = line.slice("branch ".length)
    }
  }
  if (current.path) worktrees.push(current as GitWorktreeInfo)
  return worktrees.filter((worktree) => path.isAbsolute(worktree.path))
}

async function isDirectoryMissingOrEmpty(target: string): Promise<boolean> {
  try {
    const info = await stat(target)
    if (!info.isDirectory()) {
      return false
    }
    return (await readdir(target)).length === 0
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return true
    }
    throw error
  }
}

async function isSamePath(left: string, right: string): Promise<boolean> {
  const [leftReal, rightReal] = await Promise.all([safeRealpath(left), safeRealpath(right)])
  return (leftReal ?? path.resolve(left)) === (rightReal ?? path.resolve(right))
}

async function safeRealpath(target: string): Promise<string | undefined> {
  try {
    return await realpath(target)
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined
    }
    throw error
  }
}

async function copyDirectoryOnce(source: string, target: string): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true })
  const temp = await mkdtemp(path.join(path.dirname(target), `.${path.basename(target)}.tmp-`))
  try {
    await cp(source, temp, { recursive: true })
    await rm(target, { force: true, recursive: true })
    await rename(temp, target)
  } catch (error) {
    await rm(temp, { force: true, recursive: true }).catch(() => undefined)
    throw error
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!isRecord(value)) return false
  return Object.values(value).every((entry) => typeof entry === "string")
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error
}

interface RunResult {
  message: string
  ok: boolean
  output: string
}

async function run(command: string, args: string[], env: Record<string, string>, cwd = repoRoot): Promise<RunResult> {
  return await new Promise<RunResult>((resolve, reject) => {
    let output = ""
    const child = spawn(command, args, {
      cwd,
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
