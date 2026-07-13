import { execFile } from "node:child_process"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { logDiagnosticOnChange } from "./diagnostics-log.ts"
import { getOoPath } from "./oo-command.ts"

const execFileAsync = promisify(execFile)
const shellPathTimeoutMs = 2_000
const maxShellPathBuffer = 64 * 1024
const pathStartMarker = "__WANTA_PATH_START__"
const pathEndMarker = "__WANTA_PATH_END__"
const windowsUserEnvironmentKey = "HKCU\\Environment"
const windowsMachineEnvironmentKey = "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment"

export interface ResolveUserCommandPathOptions {
  env?: NodeJS.ProcessEnv
  homeDirectory?: string
  platform?: NodeJS.Platform
  preferredDirectories?: readonly string[]
  shell?: string
  shellPathReader?: (shell: string, env: NodeJS.ProcessEnv) => Promise<string | undefined>
  windowsPathReader?: (env: NodeJS.ProcessEnv) => Promise<readonly string[]>
}

let loginShellPathInFlight: Promise<string | undefined> | undefined
let windowsRegistryPathsInFlight: Promise<readonly string[]> | undefined

export function mergePathValues(
  values: readonly (string | undefined)[],
  delimiter = path.delimiter,
  caseInsensitive = false,
): string {
  const seen = new Set<string>()
  const parts: string[] = []

  for (const value of values) {
    for (const part of value?.split(delimiter) ?? []) {
      const trimmedPart = part.trim()
      const identity = caseInsensitive ? trimmedPart.toLowerCase() : trimmedPart
      if (!trimmedPart || seen.has(identity)) {
        continue
      }

      seen.add(identity)
      parts.push(trimmedPart)
    }
  }

  return parts.join(delimiter)
}

function environmentValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const directValue = env[name]
  if (directValue) {
    return directValue
  }
  return Object.entries(env).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1]
}

function userShell(platform: NodeJS.Platform, explicitShell: string | undefined): string | undefined {
  const configuredShell = explicitShell?.trim()
  if (configuredShell) {
    return configuredShell
  }

  try {
    const accountShell = os.userInfo().shell?.trim()
    if (accountShell) {
      return accountShell
    }
  } catch {
    // 账号信息不可读时使用平台默认值继续，不让 PATH 恢复阻断 agent 启动。
  }

  if (platform === "darwin") {
    return "/bin/zsh"
  }
  return platform === "win32" ? undefined : "/bin/sh"
}

function parseMarkedPath(stdout: string): string | undefined {
  const start = stdout.lastIndexOf(pathStartMarker)
  if (start < 0) {
    return undefined
  }
  const valueStart = start + pathStartMarker.length
  const end = stdout.indexOf(pathEndMarker, valueStart)
  if (end < 0) {
    return undefined
  }
  return stdout.slice(valueStart, end).trim() || undefined
}

async function readLoginShellPath(shell: string, env: NodeJS.ProcessEnv): Promise<string | undefined> {
  try {
    const command = `printf '${pathStartMarker}%s${pathEndMarker}\\n' "$PATH"`
    const { stdout } = await execFileAsync(shell, ["-ilc", command], {
      env,
      maxBuffer: maxShellPathBuffer,
      timeout: shellPathTimeoutMs,
    })
    const shellPath = parseMarkedPath(stdout)
    if (!shellPath) {
      throw new Error("login shell output did not contain a PATH marker")
    }
    return shellPath
  } catch (error) {
    logDiagnosticOnChange(
      `command-path:login-shell:${shell}`,
      "command-path",
      "login shell path unavailable",
      { error: error instanceof Error ? error.message : String(error), shell },
      "trace",
      { shell },
    )
    return undefined
  }
}

export function expandWindowsEnvironmentVariables(value: string, env: NodeJS.ProcessEnv): string {
  return value.replace(/%([^%]+)%/g, (match, name: string) => environmentValue(env, name) ?? match)
}

export function parseWindowsRegistryPath(output: string, env: NodeJS.ProcessEnv): string | undefined {
  const match = output.match(/^\s*Path\s+REG_(?:EXPAND_)?SZ\s+(.+)$/im)
  const value = match?.[1]?.trim()
  return value ? expandWindowsEnvironmentVariables(value, env) : undefined
}

async function readWindowsRegistryPath(
  regExe: string,
  registryKey: string,
  scope: "machine" | "user",
  env: NodeJS.ProcessEnv,
): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync(regExe, ["query", registryKey, "/v", "Path"], {
      env,
      maxBuffer: maxShellPathBuffer,
      timeout: shellPathTimeoutMs,
      windowsHide: true,
    })
    const registryPath = parseWindowsRegistryPath(stdout, env)
    if (!registryPath) {
      throw new Error("registry output did not contain a Path value")
    }
    return registryPath
  } catch (error) {
    logDiagnosticOnChange(
      `command-path:windows-registry:${scope}`,
      "command-path",
      "Windows registry path unavailable",
      { error: error instanceof Error ? error.message : String(error), scope },
      "trace",
      { scope },
    )
    return undefined
  }
}

async function readWindowsRegistryPaths(env: NodeJS.ProcessEnv): Promise<readonly string[]> {
  const systemRoot = environmentValue(env, "SystemRoot") ?? "C:\\Windows"
  const regExe = path.win32.join(systemRoot, "System32", "reg.exe")
  const [machinePath, userPath] = await Promise.all([
    readWindowsRegistryPath(regExe, windowsMachineEnvironmentKey, "machine", env),
    readWindowsRegistryPath(regExe, windowsUserEnvironmentKey, "user", env),
  ])
  return [machinePath, userPath].filter((value): value is string => Boolean(value))
}

export async function resolveUserCommandPath(options: ResolveUserCommandPathOptions = {}): Promise<string> {
  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform
  const shell = userShell(platform, options.shell ?? env["SHELL"])
  let shellPath: string | undefined
  let windowsRegistryPaths: readonly string[] = []

  if (platform === "win32") {
    const reader = options.windowsPathReader ?? readWindowsRegistryPaths
    if (env === process.env && !options.windowsPathReader) {
      windowsRegistryPaths = await (windowsRegistryPathsInFlight ??= reader(env))
    } else {
      windowsRegistryPaths = await reader(env)
    }
  } else if (shell) {
    const reader = options.shellPathReader ?? readLoginShellPath
    if (env === process.env && !options.shellPathReader && options.shell === undefined) {
      const promise = (loginShellPathInFlight ??= reader(shell, env))
      shellPath = await promise
      if (!shellPath && loginShellPathInFlight === promise) {
        loginShellPathInFlight = undefined
      }
    } else {
      shellPath = await reader(shell, env)
    }
  }

  const fallbackEnv = options.homeDirectory
    ? { ...env, HOME: options.homeDirectory, USERPROFILE: options.homeDirectory }
    : env
  const delimiter = platform === "win32" ? ";" : ":"
  return mergePathValues(
    [...(options.preferredDirectories ?? []), ...windowsRegistryPaths, shellPath, getOoPath(fallbackEnv, platform)],
    delimiter,
    platform === "win32",
  )
}

export function resetUserCommandPathCacheForTest(): void {
  loginShellPathInFlight = undefined
  windowsRegistryPathsInFlight = undefined
}
