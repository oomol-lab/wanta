import type { Dirent } from "node:fs"

import { spawnSync } from "node:child_process"
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.join(dirname, "..")
const authJsonName = "auth.json"
const cleanProfileMarkerName = ".wanta-clean-profile"
const oomolCookieName = "oomol-token"
const sqlite3Binary = process.platform === "darwin" ? "/usr/bin/sqlite3" : "sqlite3"

export interface AuthState {
  hasOomolCookie: boolean
  hasProfile: boolean
  isLoggedIn: boolean
  oomolCookieExpiresAtMs?: number
}

interface BootstrapConfig {
  env?: Record<string, string>
  userDataDir?: string
}

export function isMainModule(): boolean {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
}

if (isMainModule()) {
  void main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(`[wanta] ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  })
}

async function main(args: string[]): Promise<void> {
  const command = args[0] ?? "status"
  const userDataDir = await resolveDevUserDataDir()

  switch (command) {
    case "status":
      await printStatus(userDataDir)
      return
    case "clean":
      await cleanDevUserData(userDataDir)
      return
    case "capture":
    case "save":
    case "restore":
      throw new Error(
        `auth:${command} is deprecated. Dev Electron userData now lives at ./wanta, and dev:worktree initializes from the canonical repo ./wanta when the target is empty. This command no longer reads or writes ~/wanta-dev.`,
      )
    default:
      throw new Error(`unknown auth command "${command}"; expected status or clean`)
  }
}

export async function resolveDevUserDataDir(config?: BootstrapConfig): Promise<string> {
  const loadedConfig = config ?? (await readBootstrapConfig().catch(() => undefined))
  const configuredUserData = loadedConfig?.userDataDir ?? loadedConfig?.env?.["WANTA_USER_DATA_DIR"]
  return path.resolve(repoRoot, configuredUserData?.trim() || "wanta")
}

export async function inspectAuthState(userDataDir: string): Promise<AuthState> {
  const [hasProfile, cookieState] = await Promise.all([
    hasPersistedProfile(path.join(userDataDir, authJsonName)),
    readCookieState(userDataDir),
  ])

  return {
    hasOomolCookie: cookieState.hasMarker,
    hasProfile,
    isLoggedIn: hasProfile && cookieState.hasMarker && !isExpired(cookieState.expiresAtMs),
    ...(cookieState.expiresAtMs === undefined ? {} : { oomolCookieExpiresAtMs: cookieState.expiresAtMs }),
  }
}

async function readBootstrapConfig(): Promise<BootstrapConfig> {
  const bootstrapJsonPath = path.join(repoRoot, ".wanta-dev", "bootstrap.json")
  return JSON.parse(await readFile(bootstrapJsonPath, "utf-8")) as BootstrapConfig
}

async function cleanDevUserData(userDataDir: string): Promise<void> {
  await rm(userDataDir, { force: true, recursive: true })
  await mkdir(userDataDir, { mode: 0o700, recursive: true })
  await writeFile(
    path.join(userDataDir, cleanProfileMarkerName),
    "This marker keeps dev:worktree from initializing this intentionally clean signed-out profile.\n",
    "utf-8",
  )
  console.log(`[wanta] reset dev userData to a clean signed-out state: ${userDataDir}`)
}

async function printStatus(userDataDir: string): Promise<void> {
  console.log("[wanta] auth snapshot commands are deprecated; dev userData now lives in ./wanta")
  printAuthState("dev userData", userDataDir, await inspectAuthState(userDataDir))
}

function printAuthState(label: string, dir: string, state: AuthState): void {
  const status = state.isLoggedIn ? "logged-in" : "not logged-in"
  console.log(`[wanta] ${label}: ${status}`)
  console.log(`[wanta]   dir: ${dir}`)
  console.log(`[wanta]   profile: ${state.hasProfile ? "present" : "missing"}`)
  console.log(`[wanta]   oomol-token cookie marker: ${state.hasOomolCookie ? "present" : "missing"}`)
  console.log(`[wanta]   oomol-token expires: ${formatExpiry(state.oomolCookieExpiresAtMs)}`)
}

async function hasPersistedProfile(authJsonPath: string): Promise<boolean> {
  try {
    const auth = JSON.parse(await readFile(authJsonPath, "utf-8")) as {
      accounts?: Array<{ id?: unknown }>
      currentId?: unknown
    }
    const accounts = Array.isArray(auth.accounts) ? auth.accounts : []
    if (accounts.length === 0) return false
    if (typeof auth.currentId !== "string" || auth.currentId.length === 0) return true
    return accounts.some((account) => account.id === auth.currentId)
  } catch {
    return false
  }
}

interface CookieState {
  expiresAtMs?: number
  hasMarker: boolean
}

async function readCookieState(userDataDir: string): Promise<CookieState> {
  if (!(await pathExists(userDataDir))) {
    return { hasMarker: false }
  }

  let expiresAtMs: number | undefined
  let hasMarker = false
  for await (const filePath of walkFiles(userDataDir)) {
    if (!isCookieStorageFile(path.basename(filePath))) {
      continue
    }
    const cookieExpiresAtMs = readCookieExpiry(filePath)
    if (cookieExpiresAtMs !== undefined) {
      expiresAtMs = Math.max(expiresAtMs ?? 0, cookieExpiresAtMs)
      hasMarker = true
    } else if (await fileContains(filePath, oomolCookieName)) {
      hasMarker = true
    }
  }
  return {
    ...(expiresAtMs === undefined ? {} : { expiresAtMs }),
    hasMarker,
  }
}

function isCookieStorageFile(fileName: string): boolean {
  return fileName === "Cookies" || fileName.startsWith("Cookies-")
}

function readCookieExpiry(cookieDbPath: string): number | undefined {
  if (path.basename(cookieDbPath) !== "Cookies") {
    return undefined
  }
  const result = spawnSync(
    sqlite3Binary,
    [
      "-readonly",
      cookieDbPath,
      `select expires_utc from cookies where name = '${oomolCookieName}' order by expires_utc desc limit 1;`,
    ],
    {
      encoding: "utf-8",
    },
  )
  if (result.status !== 0) {
    return undefined
  }
  const raw = result.stdout.trim()
  if (!raw) {
    return undefined
  }
  const chromiumTime = BigInt(raw)
  if (chromiumTime <= 0n) {
    return undefined
  }
  return chromiumTimeToUnixMs(chromiumTime)
}

export function chromiumTimeToUnixMs(chromiumTime: bigint | string): number {
  const value = typeof chromiumTime === "bigint" ? chromiumTime : BigInt(chromiumTime)
  const unixMicroseconds = value - 11_644_473_600_000_000n
  return Number(unixMicroseconds / 1000n)
}

function isExpired(expiresAtMs: number | undefined, now = Date.now()): boolean {
  return expiresAtMs !== undefined && expiresAtMs <= now
}

export function formatExpiry(expiresAtMs: number | undefined, now = Date.now()): string {
  if (expiresAtMs === undefined) {
    return "unknown"
  }
  const days = (expiresAtMs - now) / 86_400_000
  return `${new Date(expiresAtMs).toISOString()} (${days.toFixed(1)} days remaining)`
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await stat(target)
    return true
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return false
    }
    throw error
  }
}

async function fileContains(filePath: string, needle: string): Promise<boolean> {
  try {
    return (await readFile(filePath, "utf-8")).includes(needle)
  } catch {
    return false
  }
}

async function* walkFiles(root: string): AsyncGenerator<string> {
  let entries: Dirent[]
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const entryPath = path.join(root, entry.name)
    if (entry.isDirectory()) {
      yield* walkFiles(entryPath)
    } else if (entry.isFile()) {
      yield entryPath
    }
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error
}

export async function createAuthFixture(root: string): Promise<string> {
  const dir = await mkdir(path.join(root, "wanta-auth-fixture"), { recursive: true })
  const userDataDir = dir ?? path.join(root, "wanta-auth-fixture")
  await writeFile(
    path.join(userDataDir, authJsonName),
    `${JSON.stringify({ accounts: [{ id: "u1", name: "User" }], currentId: "u1" })}\n`,
  )
  await mkdir(path.join(userDataDir, "Default", "Network"), { recursive: true })
  await writeFile(path.join(userDataDir, "Default", "Network", "Cookies"), "sqlite bytes oomol-token redacted")
  return userDataDir
}

export function tempAuthRoot(): string {
  return path.join(os.tmpdir(), `wanta-auth-${process.pid}`)
}
