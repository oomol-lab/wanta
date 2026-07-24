import type { ChildProcess } from "node:child_process"
import type { Dirent } from "node:fs"

import { spawn } from "node:child_process"
import { constants as fsConstants } from "node:fs"
import { access, chmod, cp, mkdir, readFile, readdir, rename, rm, stat } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

interface BootstrapConfig {
  env?: Record<string, string>
  userDataDir?: string
}

export interface AuthState {
  hasOomolCookie: boolean
  hasProfile: boolean
  isLoggedIn: boolean
}

export interface DevAuthPaths {
  captureUserDataDir: string
  machineRoot: string
  snapshotDir: string
  worktreeUserDataDir: string
}

const dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.join(dirname, "..")
const bootstrapJsonPath = path.join(repoRoot, ".wanta-dev", "bootstrap.json")
const authJsonName = "auth.json"
const oomolCookieName = "oomol-token"

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
  const config = await readBootstrapConfig()
  const paths = resolveDevAuthPaths(config)

  switch (command) {
    case "capture":
      await captureLoggedInState(config, paths)
      return
    case "save":
      await saveCapturedState(paths)
      return
    case "restore":
      await restoreSnapshot(paths)
      return
    case "clean":
      await cleanWorktreeUserData(paths)
      return
    case "status":
      await printStatus(paths)
      return
    default:
      throw new Error(`unknown auth command "${command}"; expected capture, save, restore, clean, or status`)
  }
}

export function resolveDevAuthPaths(config: BootstrapConfig, homeDir = os.homedir()): DevAuthPaths {
  const machineRoot = path.resolve(process.env["WANTA_MACHINE_DEV_DIR"]?.trim() || path.join(homeDir, "wanta-dev"))
  const configuredUserData = config.userDataDir ?? config.env?.["WANTA_USER_DATA_DIR"]
  if (!configuredUserData) {
    throw new Error("bootstrap config does not define WANTA_USER_DATA_DIR; run `corepack pnpm run bootstrap` first")
  }

  return {
    captureUserDataDir: path.join(machineRoot, "login-user-data"),
    machineRoot,
    snapshotDir: path.join(machineRoot, "login-state"),
    worktreeUserDataDir: path.resolve(repoRoot, configuredUserData),
  }
}

export async function inspectAuthState(userDataDir: string): Promise<AuthState> {
  const [hasProfile, hasOomolCookie] = await Promise.all([
    hasPersistedProfile(path.join(userDataDir, authJsonName)),
    hasCookieMarker(userDataDir),
  ])

  return {
    hasOomolCookie,
    hasProfile,
    isLoggedIn: hasProfile && hasOomolCookie,
  }
}

async function readBootstrapConfig(): Promise<BootstrapConfig> {
  try {
    return JSON.parse(await readFile(bootstrapJsonPath, "utf-8")) as BootstrapConfig
  } catch (error) {
    throw new Error(`bootstrap config missing or invalid; run \`corepack pnpm run bootstrap\` first: ${error}`)
  }
}

async function captureLoggedInState(config: BootstrapConfig, paths: DevAuthPaths): Promise<void> {
  await prepareMachineRoot(paths)
  await rm(paths.captureUserDataDir, { force: true, recursive: true })
  await mkdir(paths.captureUserDataDir, { mode: 0o700, recursive: true })
  await chmod(paths.captureUserDataDir, 0o700).catch(() => undefined)

  console.log("[wanta] starting dev app with a machine-level login capture userData dir")
  console.log(`[wanta] capture user data: ${paths.captureUserDataDir}`)
  console.log("[wanta] sign in in the Electron window; the script will save the snapshot after login is detected")

  await runDevUntilLoggedIn(paths.captureUserDataDir, {
    ...config.env,
    WANTA_USER_DATA_DIR: paths.captureUserDataDir,
    WANTA_SKIP_PROTOCOL_REGISTRATION: "0",
  })

  await saveCapturedState(paths)
}

async function runDevUntilLoggedIn(userDataDir: string, env: Record<string, string> = {}): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(commandName("corepack"), ["pnpm", "run", "dev"], {
      cwd: repoRoot,
      detached: process.platform !== "win32",
      env: { ...process.env, ...env },
      stdio: "inherit",
    })
    let finalized = false
    let loginDetected = false

    const finish = (error?: Error): void => {
      if (finalized) return
      finalized = true
      clearInterval(authCheckInterval)
      process.off("SIGINT", onSignal)
      process.off("SIGTERM", onSignal)
      if (error) {
        reject(error)
        return
      }
      resolve()
    }

    const onSignal = (): void => {
      stopChild(child)
    }

    const authCheckInterval = setInterval(() => {
      void inspectAuthState(userDataDir)
        .then((state) => {
          if (!state.isLoggedIn || loginDetected) return
          loginDetected = true
          console.log("[wanta] login detected; stopping dev app before saving snapshot")
          stopChild(child)
        })
        .catch(() => undefined)
    }, 2_000)

    process.once("SIGINT", onSignal)
    process.once("SIGTERM", onSignal)
    child.once("error", finish)
    child.once("exit", (code, signal) => {
      if (loginDetected || code === 0 || code === 130 || signal === "SIGINT" || signal === "SIGTERM") {
        finish()
        return
      }
      finish(new Error(`dev app exited with ${signal ?? `exit code ${code}`}`))
    })
  })
}

function stopChild(child: ChildProcess): void {
  if (child.exitCode !== null || child.signalCode !== null) {
    return
  }
  if (process.platform !== "win32" && child.pid !== undefined) {
    try {
      process.kill(-child.pid, "SIGINT")
      return
    } catch {
      // Fall back to the direct child if the process group is already gone.
    }
  }
  try {
    child.kill("SIGINT")
  } catch {
    // The process may have exited between the state check and the signal.
  }
}

async function saveCapturedState(paths: DevAuthPaths): Promise<void> {
  const state = await inspectAuthState(paths.captureUserDataDir)
  if (!state.isLoggedIn) {
    throw new Error(
      authStateFailureMessage("captured login userData is not logged in", paths.captureUserDataDir, state),
    )
  }

  await prepareMachineRoot(paths)
  await replaceDirectory(paths.captureUserDataDir, paths.snapshotDir)
  await chmod(paths.snapshotDir, 0o700).catch(() => undefined)
  console.log(`[wanta] saved logged-in snapshot: ${paths.snapshotDir}`)
}

async function restoreSnapshot(paths: DevAuthPaths): Promise<void> {
  const state = await inspectAuthState(paths.snapshotDir)
  if (!state.isLoggedIn) {
    throw new Error(authStateFailureMessage("machine login snapshot is not ready", paths.snapshotDir, state))
  }

  await replaceDirectory(paths.snapshotDir, paths.worktreeUserDataDir)
  await chmod(paths.worktreeUserDataDir, 0o700).catch(() => undefined)
  console.log(`[wanta] restored logged-in userData to: ${paths.worktreeUserDataDir}`)
}

async function cleanWorktreeUserData(paths: DevAuthPaths): Promise<void> {
  await rm(paths.worktreeUserDataDir, { force: true, recursive: true })
  await mkdir(paths.worktreeUserDataDir, { mode: 0o700, recursive: true })
  await chmod(paths.worktreeUserDataDir, 0o700).catch(() => undefined)
  console.log(`[wanta] reset worktree userData to a clean signed-out state: ${paths.worktreeUserDataDir}`)
}

async function printStatus(paths: DevAuthPaths): Promise<void> {
  const [snapshot, worktree] = await Promise.all([
    inspectAuthState(paths.snapshotDir),
    inspectAuthState(paths.worktreeUserDataDir),
  ])

  console.log(`[wanta] machine root: ${paths.machineRoot}`)
  printAuthState("machine login snapshot", paths.snapshotDir, snapshot)
  printAuthState("worktree userData", paths.worktreeUserDataDir, worktree)
}

function printAuthState(label: string, dir: string, state: AuthState): void {
  const status = state.isLoggedIn ? "logged-in" : "not logged-in"
  console.log(`[wanta] ${label}: ${status}`)
  console.log(`[wanta]   dir: ${dir}`)
  console.log(`[wanta]   profile: ${state.hasProfile ? "present" : "missing"}`)
  console.log(`[wanta]   oomol-token cookie marker: ${state.hasOomolCookie ? "present" : "missing"}`)
}

function authStateFailureMessage(prefix: string, dir: string, state: AuthState): string {
  return [
    `${prefix}: ${dir}`,
    `profile=${state.hasProfile ? "present" : "missing"}`,
    `oomol-token cookie marker=${state.hasOomolCookie ? "present" : "missing"}`,
    "Run `corepack pnpm run auth:capture` on this machine, or use `corepack pnpm run auth:clean` for login/auth work.",
  ].join("; ")
}

async function prepareMachineRoot(paths: DevAuthPaths): Promise<void> {
  await mkdir(paths.machineRoot, { mode: 0o700, recursive: true })
  await chmod(paths.machineRoot, 0o700).catch(() => undefined)
}

async function replaceDirectory(source: string, target: string): Promise<void> {
  await assertDirectory(source)
  await mkdir(path.dirname(target), { recursive: true })
  const temp = path.join(path.dirname(target), `.${path.basename(target)}.tmp-${process.pid}-${Date.now()}`)
  await rm(temp, { force: true, recursive: true })
  await cp(source, temp, { recursive: true })
  await rm(target, { force: true, recursive: true })
  await rename(temp, target)
}

async function assertDirectory(target: string): Promise<void> {
  const info = await stat(target)
  if (!info.isDirectory()) {
    throw new Error(`${target} is not a directory`)
  }
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

async function hasCookieMarker(userDataDir: string): Promise<boolean> {
  if (!(await pathExists(userDataDir))) {
    return false
  }

  for await (const filePath of walkFiles(userDataDir)) {
    if (!isCookieStorageFile(path.basename(filePath))) {
      continue
    }
    if (await fileContains(filePath, oomolCookieName)) {
      return true
    }
  }
  return false
}

function isCookieStorageFile(fileName: string): boolean {
  return fileName === "Cookies" || fileName.startsWith("Cookies-")
}

async function* walkFiles(dir: string): AsyncGenerator<string> {
  let entries: Array<Dirent<string>>
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    const next = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      yield* walkFiles(next)
      continue
    }
    if (entry.isFile()) {
      yield next
    }
  }
}

async function fileContains(filePath: string, needle: string): Promise<boolean> {
  try {
    return (await readFile(filePath)).includes(Buffer.from(needle, "utf-8"))
  } catch {
    return false
  }
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target, fsConstants.F_OK)
    return true
  } catch {
    return false
  }
}

function commandName(command: string): string {
  return process.platform === "win32" ? `${command}.cmd` : command
}
