import { execFile } from "node:child_process"
import path from "node:path"
import { promisify } from "node:util"
import { logDiagnostic } from "./diagnostics-log.ts"
import { recordOperationHistory } from "./operation-history.ts"

const execFileAsync = promisify(execFile)
const maxOoBuffer = 1024 * 1024 * 8

export interface OoCommandResult {
  message?: string
  ok: boolean
  stderr: string
  stdout: string
}

export interface RunOoCommandOptions {
  env?: Record<string, string | undefined>
  owner: string
  rejectOnFailure?: boolean
  timeoutMs?: number
}

interface ExecFailure {
  message?: string
  stderr?: string
  stdout?: string
}

export async function runOoCommand(args: string[], options: RunOoCommandOptions): Promise<OoCommandResult> {
  const command = getOoCommand()
  const rejectOnFailure = options.rejectOnFailure ?? true
  const startedAtMs = Date.now()

  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      env: {
        ...process.env,
        ...options.env,
        PATH: getOoPath(),
      },
      maxBuffer: maxOoBuffer,
      timeout: options.timeoutMs ?? 60_000,
      killSignal: "SIGTERM",
    })
    const result = {
      ok: true,
      stderr,
      stdout,
    }
    await recordOperation(args, command, options.owner, startedAtMs, result)

    return result
  } catch (cause) {
    const error = cause as ExecFailure
    const message = error.stderr || error.stdout || error.message || "Failed to run oo-cli"
    const result = {
      ok: false,
      message,
      stderr: error.stderr || (error.stdout ? "" : message),
      stdout: error.stdout || "",
    }
    await recordOperation(args, command, options.owner, startedAtMs, result)

    if (!rejectOnFailure) {
      return result
    }

    throw Object.assign(new Error(message), { cause })
  }
}

export function getOoCommand(): string {
  return process.env["OO_CLI_PATH"] || process.env["WANTA_OO_BIN"] || "oo"
}

export function getEnvironmentValue(
  env: NodeJS.ProcessEnv,
  name: string,
  platform: NodeJS.Platform,
): string | undefined {
  const directValue = env[name]
  if (directValue || platform !== "win32") {
    return directValue
  }

  const entry = Object.entries(env).find(([key]) => key.toLowerCase() === name.toLowerCase())
  return entry?.[1]
}

export function getOoPath(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
  const homeDirectory = getEnvironmentValue(env, platform === "win32" ? "USERPROFILE" : "HOME", platform)
  const pathValue = getEnvironmentValue(env, "PATH", platform)
  const appData = getEnvironmentValue(env, "APPDATA", platform)
  const localAppData = getEnvironmentValue(env, "LOCALAPPDATA", platform)
  const programData = getEnvironmentValue(env, "ProgramData", platform)
  const pathParts =
    platform === "win32"
      ? [
          pathValue,
          appData ? path.win32.join(appData, "npm") : undefined,
          homeDirectory ? path.win32.join(homeDirectory, "scoop", "shims") : undefined,
          programData ? path.win32.join(programData, "chocolatey", "bin") : undefined,
          localAppData ? path.win32.join(localAppData, "Microsoft", "WinGet", "Links") : undefined,
        ]
      : [
          pathValue,
          "/opt/homebrew/bin",
          "/usr/local/bin",
          "/usr/bin",
          "/bin",
          homeDirectory ? path.join(homeDirectory, ".local", "bin") : undefined,
        ]

  return pathParts.filter((part): part is string => Boolean(part)).join(platform === "win32" ? ";" : ":")
}

export function normalizeOoCliVersion(output: string): string | undefined {
  const trimmedOutput = output.trim()

  if (!trimmedOutput) {
    return undefined
  }

  try {
    const parsed = JSON.parse(trimmedOutput) as unknown
    if (parsed && typeof parsed === "object" && typeof (parsed as { version?: unknown }).version === "string") {
      return (parsed as { version: string }).version.trim() || undefined
    }
  } catch {
    // 兼容非 JSON 调用点；新代码优先使用 `oo version --json`。
  }

  const firstLine = trimmedOutput.split(/\r?\n/, 1)[0]?.trim()
  const versionMatch = firstLine?.match(/^(?:Version|版本)\s*[:：]\s*(.+)$/i)

  return (versionMatch?.[1] ?? firstLine)?.trim() || undefined
}

async function recordOperation(
  args: string[],
  command: string,
  owner: string,
  startedAtMs: number,
  result: OoCommandResult,
): Promise<void> {
  try {
    await recordOperationHistory({
      args,
      command,
      durationMs: Date.now() - startedAtMs,
      ok: result.ok,
      owner,
      stderr: result.stderr,
      stdout: result.stdout,
    })
  } catch (error) {
    console.warn("[wanta] failed to record operation history", error)
    logDiagnostic("oo-command", "failed to record operation history", { error, owner }, "warn")
  }
}
