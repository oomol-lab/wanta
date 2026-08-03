import type { DingTalkCliState } from "./common.ts"
import type { ChildProcess } from "node:child_process"

import { execFile, spawn } from "node:child_process"
import { chmod, mkdir, stat } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"
import { sanitizeDingTalkEnvironment } from "../dingtalk-cli-environment.ts"
import { ServiceEvent } from "../service-events.ts"

const execFileAsync = promisify(execFile)
const authorizationTimeoutMs = 16 * 60_000
const logoutTimeoutMs = 30_000
const maxOutputBytes = 512 * 1024

interface DingTalkCliManagerOptions {
  binaryPath: string
  onRuntimeChanged?: () => Promise<void> | void
  openExternalUrl: (url: string) => void
  rootDir: string
  skillsDir: string
}

export interface DingTalkCliRuntime {
  binaryPath: string
  configDir: string
  keychainDir: string
  skillsDir: string
  version: string
}

interface DingTalkAuthStatus {
  accountLabel?: string
  authenticated: boolean
  connection: "connected" | "disconnected" | "expired"
  profile?: string
}

export class DingTalkCliManager {
  private readonly binaryPath: string
  private readonly configDir: string
  private readonly keychainDir: string
  private readonly onRuntimeChanged?: () => Promise<void> | void
  private readonly openExternalUrl: (url: string) => void
  private readonly rootDir: string
  private readonly skillsDir: string
  private activeAuthorizationUrl: string | null = null
  private activeChild: ChildProcess | null = null
  private cancelRequested = false
  private operation: { kind: "connect" | "disconnect"; promise: Promise<DingTalkCliState> } | null = null
  private state: DingTalkCliState = {
    activeVersion: null,
    available: false,
    canReopenAuthorization: false,
    connection: "disconnected",
    phase: "idle",
  }
  public readonly stateChanged = new ServiceEvent<DingTalkCliState>()

  public constructor(options: DingTalkCliManagerOptions) {
    this.binaryPath = options.binaryPath
    this.configDir = path.join(options.rootDir, "config")
    this.keychainDir = path.join(options.rootDir, "keychain")
    this.onRuntimeChanged = options.onRuntimeChanged
    this.openExternalUrl = options.openExternalUrl
    this.rootDir = options.rootDir
    this.skillsDir = options.skillsDir
  }

  public async getState(): Promise<DingTalkCliState> {
    if (this.operation) return this.state
    try {
      const runtime = await this.activeRuntime()
      if (!runtime) throw new Error("The bundled DingTalk CLI runtime is unavailable.")
      await this.ensurePrivateDirectories()
      const auth = await this.readAuthState()
      this.setState({
        accountLabel: auth.accountLabel,
        activeVersion: runtime.version,
        available: true,
        canReopenAuthorization: false,
        connection: auth.connection,
        error: undefined,
        phase: "idle",
      })
    } catch (error) {
      this.setState({
        accountLabel: undefined,
        activeVersion: null,
        available: false,
        canReopenAuthorization: false,
        connection: "disconnected",
        error: errorMessage(error),
        phase: "idle",
      })
    }
    return this.state
  }

  public connect(): Promise<DingTalkCliState> {
    if (this.operation) {
      return this.operation.kind === "connect"
        ? this.operation.promise
        : Promise.reject(new Error("A DingTalk CLI disconnect operation is already running."))
    }
    this.cancelRequested = false
    const operation = this.connectNow()
      .catch((error: unknown) => {
        this.setState({
          canReopenAuthorization: false,
          error: this.cancelRequested ? undefined : errorMessage(error),
          phase: "idle",
        })
        throw error
      })
      .finally(() => {
        if (this.operation?.promise === operation) this.operation = null
        this.activeAuthorizationUrl = null
        this.cancelRequested = false
      })
    this.operation = { kind: "connect", promise: operation }
    return operation
  }

  public disconnect(): Promise<DingTalkCliState> {
    if (this.operation) {
      return this.operation.kind === "disconnect"
        ? this.operation.promise
        : Promise.reject(new Error("A DingTalk CLI connection operation is already running."))
    }
    const operation = this.disconnectNow()
      .catch((error: unknown) => {
        this.setState({ error: errorMessage(error), phase: "idle" })
        throw error
      })
      .finally(() => {
        if (this.operation?.promise === operation) this.operation = null
      })
    this.operation = { kind: "disconnect", promise: operation }
    return operation
  }

  public cancelConnection(): void {
    if (this.operation?.kind !== "connect") return
    this.cancelRequested = true
    const child = this.activeChild
    child?.kill()
    if (child) {
      const escalation = setTimeout(() => {
        if (this.activeChild !== child) return
        child.kill("SIGKILL")
        this.activeChild = null
      }, 5_000)
      escalation.unref()
      child.once("exit", () => clearTimeout(escalation))
    }
    this.activeAuthorizationUrl = null
    this.setState({ canReopenAuthorization: false, phase: "idle" })
  }

  public reopenAuthorization(): boolean {
    if (this.operation?.kind !== "connect" || !this.activeAuthorizationUrl) return false
    this.openExternalUrl(this.activeAuthorizationUrl)
    return true
  }

  public async activeRuntime(): Promise<DingTalkCliRuntime | null> {
    try {
      const [binary, skills, version] = await Promise.all([
        stat(this.binaryPath),
        stat(path.join(this.skillsDir, "dws", "SKILL.md")),
        this.readVersion(),
      ])
      if (!binary.isFile() || !skills.isFile()) return null
      return {
        binaryPath: this.binaryPath,
        configDir: this.configDir,
        keychainDir: this.keychainDir,
        skillsDir: this.skillsDir,
        version,
      }
    } catch {
      return null
    }
  }

  private async connectNow(): Promise<DingTalkCliState> {
    const runtime = await this.activeRuntime()
    if (!runtime) throw new Error("The bundled DingTalk CLI runtime is unavailable.")
    await this.ensurePrivateDirectories()
    this.setState({
      activeVersion: runtime.version,
      available: true,
      canReopenAuthorization: false,
      error: undefined,
      phase: "opening_browser",
    })
    await this.runAuthorizationCommand()
    this.assertNotCancelled()
    this.setState({ canReopenAuthorization: false, phase: "verifying" })
    const auth = await this.readAuthState()
    if (!auth.authenticated) throw new Error("DingTalk CLI authorization did not produce a usable account.")
    this.setState({
      accountLabel: auth.accountLabel,
      activeVersion: runtime.version,
      available: true,
      canReopenAuthorization: false,
      connection: "connected",
      error: undefined,
      phase: "idle",
    })
    void Promise.resolve(this.onRuntimeChanged?.()).catch(() => undefined)
    return this.state
  }

  private async disconnectNow(): Promise<DingTalkCliState> {
    await this.ensurePrivateDirectories()
    const auth = await this.readAuthState()
    if (!auth.authenticated) {
      this.setState({ accountLabel: undefined, connection: "disconnected", error: undefined, phase: "idle" })
      return this.state
    }
    if (!auth.profile) throw new Error("DingTalk CLI did not report an exact account identity to disconnect.")
    this.setState({ error: undefined, phase: "disconnecting" })
    await this.runCommand(["auth", "logout", "--profile", auth.profile], logoutTimeoutMs)
    this.setState({
      accountLabel: undefined,
      canReopenAuthorization: false,
      connection: "disconnected",
      error: undefined,
      phase: "idle",
    })
    void Promise.resolve(this.onRuntimeChanged?.()).catch(() => undefined)
    return this.state
  }

  private async readVersion(): Promise<string> {
    const result = await this.runCommand(["version", "--format", "json"], 10_000)
    const value = parseJsonOutput(result.stdout) as { version?: unknown }
    if (typeof value.version !== "string" || !/^v?\d+\.\d+\.\d+/u.test(value.version)) {
      throw new Error("DingTalk CLI returned an unreadable version.")
    }
    return value.version.replace(/^v/u, "")
  }

  private async readAuthState(): Promise<DingTalkAuthStatus> {
    const result = await this.runCommand(["auth", "status", "--format", "json"], 30_000)
    return parseDingTalkAuthStatus(parseJsonOutput(result.stdout))
  }

  private environment(): NodeJS.ProcessEnv {
    const environment: NodeJS.ProcessEnv = {
      ...process.env,
      DWS_CONFIG_DIR: this.configDir,
      DWS_KEYCHAIN_DIR: this.keychainDir,
    }
    return sanitizeDingTalkEnvironment(environment)
  }

  private async ensurePrivateDirectories(): Promise<void> {
    await Promise.all([
      mkdir(this.rootDir, { mode: 0o700, recursive: true }),
      mkdir(this.configDir, { mode: 0o700, recursive: true }),
      mkdir(this.keychainDir, { mode: 0o700, recursive: true }),
    ])
    if (process.platform !== "win32") {
      await Promise.all([chmod(this.rootDir, 0o700), chmod(this.configDir, 0o700), chmod(this.keychainDir, 0o700)])
    }
  }

  private async runCommand(args: string[], timeout: number): Promise<{ stderr: string; stdout: string }> {
    try {
      return await execFileAsync(this.binaryPath, args, {
        encoding: "utf-8",
        env: this.environment(),
        maxBuffer: maxOutputBytes,
        timeout,
      })
    } catch (error) {
      const failure = error as { code?: unknown; stderr?: unknown; stdout?: unknown }
      const output = [failure.stderr, failure.stdout]
        .filter((value): value is string => typeof value === "string")
        .join("\n")
      throw new Error(redactDingTalkCliError(output, typeof failure.code === "number" ? failure.code : undefined))
    }
  }

  private runAuthorizationCommand(): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.binaryPath, ["auth", "login", "--yes", "--format", "json", "--no-browser"], {
        env: this.environment(),
        stdio: ["ignore", "pipe", "pipe"],
      })
      this.activeChild = child
      child.stdout?.setEncoding("utf-8")
      child.stderr?.setEncoding("utf-8")
      let output = ""
      let openedUrl: string | null = null
      const timeout = setTimeout(() => child.kill(), authorizationTimeoutMs)
      timeout.unref()

      const consume = (chunk: string) => {
        output += chunk
        if (Buffer.byteLength(output) > maxOutputBytes) {
          child.kill()
          reject(new Error("DingTalk CLI authorization output exceeded the safety limit."))
          return
        }
        const url = extractOfficialDingTalkAuthorizationUrl(output)
        if (url && url !== openedUrl) {
          openedUrl = url
          this.activeAuthorizationUrl = url
          this.openExternalUrl(url)
          this.setState({ canReopenAuthorization: true, phase: "waiting_for_authorization" })
        }
        if (/尚未开启 CLI 数据访问权限|等待管理员审批/u.test(output)) {
          this.setState({ canReopenAuthorization: Boolean(this.activeAuthorizationUrl), phase: "waiting_for_admin" })
        }
      }
      child.stdout?.on("data", consume)
      child.stderr?.on("data", consume)
      child.once("error", () => reject(new Error("Unable to start DingTalk CLI authorization.")))
      child.once("close", (code, signal) => {
        clearTimeout(timeout)
        if (this.activeChild === child) this.activeChild = null
        if (code === 0) resolve()
        else reject(new Error(redactDingTalkCliError(output, code, signal)))
      })
    })
  }

  private assertNotCancelled(): void {
    if (this.cancelRequested) throw new Error("DingTalk CLI authorization was cancelled.")
  }

  private setState(patch: Partial<DingTalkCliState>): void {
    this.state = { ...this.state, ...patch }
    this.stateChanged.emit(this.state)
  }
}

export function parseDingTalkAuthStatus(value: unknown): DingTalkAuthStatus {
  if (!isRecord(value) || typeof value.authenticated !== "boolean") {
    throw new Error("DingTalk CLI returned an incompatible authentication status.")
  }
  const corpId = stringValue(value.corp_id)
  const userId = stringValue(value.user_id)
  const corpName = stringValue(value.corp_name)
  const userName = stringValue(value.user_name)
  const authenticated = value.authenticated
  const expired = !authenticated && value.reason === "token_refresh_failed"
  const label = accountLabel(corpName, userName, corpId, userId)
  return {
    authenticated,
    connection: authenticated ? "connected" : expired ? "expired" : "disconnected",
    ...(corpId && userId ? { profile: `${corpId}:${userId}` } : {}),
    ...(label ? { accountLabel: label } : {}),
  }
}

export function extractOfficialDingTalkAuthorizationUrl(output: string): string | null {
  for (const match of output.matchAll(/https:\/\/[^\s"'<>()[\]{}]+/gu)) {
    const raw = match[0].replace(/[),.;，。；]+$/u, "")
    try {
      const url = new URL(raw)
      if (
        url.protocol === "https:" &&
        url.hostname === "login.dingtalk.com" &&
        url.port === "" &&
        url.username === "" &&
        url.password === "" &&
        url.pathname === "/oauth2/auth"
      ) {
        return url.toString()
      }
    } catch {
      // Ignore malformed command output and continue scanning.
    }
  }
  return null
}

export function redactDingTalkCliError(output: string, code?: number | null, signal?: NodeJS.Signals | null): string {
  const redacted = output
    .replaceAll(/https:\/\/[^\s"'<>]+/gu, "[authorization-url]")
    .replaceAll(
      /("?(?:client_secret|access_token|refresh_token|authCode|code)"?\s*[:=]\s*)[^\s,}\]]+/giu,
      "$1[redacted]",
    )
    .trim()
  const suffix = code === undefined ? "" : ` (exit ${code ?? "null"}${signal ? `, ${signal}` : ""})`
  return `${redacted || "DingTalk CLI command failed"}${suffix}`
}

function accountLabel(corpName: string, userName: string, corpId: string, userId: string): string | undefined {
  if (corpName && userName) return `${corpName} · ${userName}`
  return userName || corpName || userId || corpId || undefined
}

function parseJsonOutput(stdout: string): unknown {
  try {
    return JSON.parse(stdout)
  } catch {
    throw new Error("DingTalk CLI returned output that is not valid JSON.")
  }
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
