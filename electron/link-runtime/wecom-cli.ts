import type { WecomCliState } from "./common.ts"
import type { ChildProcess } from "node:child_process"

import { execFile, spawn } from "node:child_process"
import { chmod, mkdir, rm, stat } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"
import { logDiagnostic } from "../diagnostics-log.ts"
import { ServiceEvent } from "../service-events.ts"

const execFileAsync = promisify(execFile)
const authorizationTimeoutMs = 6 * 60_000
const maxOutputBytes = 512 * 1024

interface WecomCliManagerOptions {
  binaryPath: string
  onRuntimeChanged?: () => Promise<void> | void
  openExternalUrl: (url: string) => void
  rootDir: string
  skillsDir: string
}

export interface WecomCliRuntime {
  binaryPath: string
  skillsDir: string
  version: string
}

export class WecomCliManager {
  private readonly binaryPath: string
  private readonly configDir: string
  private readonly onRuntimeChanged?: () => Promise<void> | void
  private readonly openExternalUrl: (url: string) => void
  private readonly rootDir: string
  private readonly skillsDir: string
  private readonly temporaryDir: string
  private activeChild: ChildProcess | null = null
  private activeAuthorizationUrl: string | null = null
  private cancelRequested = false
  private operation: { kind: "connect" | "disconnect"; promise: Promise<WecomCliState> } | null = null
  private runtimeStateObserved = false
  private state: WecomCliState = {
    activeVersion: null,
    available: false,
    canReopenAuthorization: false,
    connection: "disconnected",
    phase: "idle",
  }
  public readonly stateChanged = new ServiceEvent<WecomCliState>()

  public constructor(options: WecomCliManagerOptions) {
    this.binaryPath = options.binaryPath
    this.configDir = path.join(options.rootDir, "config")
    this.onRuntimeChanged = options.onRuntimeChanged
    this.openExternalUrl = options.openExternalUrl
    this.rootDir = options.rootDir
    this.skillsDir = options.skillsDir
    this.temporaryDir = path.join(options.rootDir, "tmp")
  }

  public async getState(options: { notifyRuntimeChange?: boolean } = {}): Promise<WecomCliState> {
    if (this.operation) return this.state
    const previousConnection = this.state.connection
    try {
      const runtime = await this.availableRuntime()
      if (!runtime) throw new Error("The bundled WeCom CLI runtime is unavailable.")
      const auth = await this.readAuthState()
      this.state = {
        ...this.state,
        accountLabel: auth.accountLabel,
        activeVersion: runtime.version,
        available: true,
        connection: auth.connected ? "connected" : "disconnected",
        error: undefined,
        phase: "idle",
      }
    } catch (error) {
      this.state = {
        ...this.state,
        accountLabel: undefined,
        activeVersion: null,
        available: false,
        connection: "disconnected",
        error: errorMessage(error),
        phase: "idle",
      }
    }
    this.observeRuntimeState(previousConnection, options.notifyRuntimeChange ?? true)
    return this.state
  }

  public connect(): Promise<WecomCliState> {
    if (this.operation) {
      return this.operation.kind === "connect"
        ? this.operation.promise
        : Promise.reject(new Error("A WeCom CLI disconnect operation is already running."))
    }
    this.cancelRequested = false
    const operation = this.connectNow()
      .catch((error: unknown) => {
        this.setState({ error: this.cancelRequested ? undefined : errorMessage(error), phase: "idle" })
        throw error
      })
      .finally(() => {
        if (this.operation?.promise === operation) this.operation = null
        this.activeAuthorizationUrl = null
        if (this.state.canReopenAuthorization) this.setState({ canReopenAuthorization: false })
        this.cancelRequested = false
      })
    this.operation = { kind: "connect", promise: operation }
    return operation
  }

  public disconnect(): Promise<WecomCliState> {
    if (this.operation) {
      return this.operation.kind === "disconnect"
        ? this.operation.promise
        : Promise.reject(new Error("A WeCom CLI connection operation is already running."))
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
    this.setState({ phase: "idle" })
  }

  public reopenAuthorization(): boolean {
    if (this.operation?.kind !== "connect" || !this.activeAuthorizationUrl) return false
    this.openExternalUrl(this.activeAuthorizationUrl)
    return true
  }

  public async availableRuntime(): Promise<WecomCliRuntime | null> {
    try {
      const [binary, skills, version] = await Promise.all([
        stat(this.binaryPath),
        stat(this.skillsDir),
        this.readVersion(),
      ])
      if (!binary.isFile() || !skills.isDirectory()) return null
      return { binaryPath: this.binaryPath, skillsDir: this.skillsDir, version }
    } catch {
      return null
    }
  }

  /** Expose the managed CLI to the Agent only while its isolated bot identity is connected. */
  public async agentRuntime(): Promise<WecomCliRuntime | null> {
    const state = await this.getState({ notifyRuntimeChange: false })
    if (state.connection !== "connected") return null
    return this.availableRuntime()
  }

  private async connectNow(): Promise<WecomCliState> {
    this.setState({ canReopenAuthorization: false, error: undefined, phase: "preparing" })
    const runtime = await this.availableRuntime()
    if (!runtime) throw new Error("The bundled WeCom CLI runtime is unavailable.")
    await this.ensurePrivateDirectories()
    const current = await this.readAuthState()
    this.assertNotCancelled()
    if (!current.connected) {
      this.setState({ phase: "waiting_for_scan" })
      await this.runAuthorizationCommand()
    }
    this.assertNotCancelled()
    this.setState({ phase: "verifying" })
    const auth = await this.readAuthState()
    if (!auth.connected) throw new Error("WeCom CLI did not confirm the bot connection.")
    this.setState({
      accountLabel: auth.accountLabel,
      activeVersion: runtime.version,
      available: true,
      canReopenAuthorization: false,
      connection: "connected",
      error: undefined,
      phase: "idle",
    })
    this.runtimeStateObserved = true
    this.notifyRuntimeChanged()
    return this.state
  }

  private async disconnectNow(): Promise<WecomCliState> {
    this.setState({ error: undefined, phase: "disconnecting" })
    await Promise.all([
      rm(this.configDir, { force: true, recursive: true }),
      rm(this.temporaryDir, { force: true, recursive: true }),
    ])
    await this.ensurePrivateDirectories()
    this.setState({
      accountLabel: undefined,
      canReopenAuthorization: false,
      connection: "disconnected",
      phase: "idle",
    })
    this.runtimeStateObserved = true
    this.notifyRuntimeChanged()
    return this.state
  }

  private async ensurePrivateDirectories(): Promise<void> {
    await mkdir(this.rootDir, { mode: 0o700, recursive: true })
    await Promise.all([
      mkdir(this.configDir, { mode: 0o700, recursive: true }),
      mkdir(this.temporaryDir, { mode: 0o700, recursive: true }),
    ])
    if (process.platform !== "win32") {
      await Promise.all([chmod(this.rootDir, 0o700), chmod(this.configDir, 0o700), chmod(this.temporaryDir, 0o700)])
    }
  }

  private observeRuntimeState(previousConnection: WecomCliState["connection"], notify: boolean): void {
    const changed = this.runtimeStateObserved && previousConnection !== this.state.connection
    this.runtimeStateObserved = true
    if (changed && notify) this.notifyRuntimeChanged()
  }

  private notifyRuntimeChanged(): void {
    void Promise.resolve(this.onRuntimeChanged?.()).catch(() => undefined)
  }

  private commandEnvironment(): NodeJS.ProcessEnv {
    const environment: NodeJS.ProcessEnv = {
      ...process.env,
      WECOM_CLI_CONFIG_DIR: this.configDir,
      WECOM_CLI_TMP_DIR: this.temporaryDir,
    }
    delete environment.WECOM_CLI_LOG_FILE
    delete environment.WECOM_CLI_LOG_LEVEL
    return environment
  }

  private async readVersion(): Promise<string> {
    const result = await this.runCommand(["--version"], 10_000)
    const version = `${result.stdout}\n${result.stderr}`.match(/\b(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\b/u)?.[1]
    if (!version) throw new Error("WeCom CLI returned an unreadable version.")
    return version
  }

  private async readAuthState(): Promise<{ accountLabel?: string; connected: boolean }> {
    await this.ensurePrivateDirectories()
    const status = await this.runCommand(["auth", "show", "--auth-status"], 10_000)
    if (status.stdout.trim() !== "authorized") return { connected: false }
    const identity = await this.runCommand(["auth", "show"], 10_000)
    try {
      const value = JSON.parse(identity.stdout) as { id?: unknown }
      return { accountLabel: typeof value.id === "string" && value.id ? value.id : undefined, connected: true }
    } catch {
      return { connected: true }
    }
  }

  private async runCommand(args: string[], timeout: number): Promise<{ stderr: string; stdout: string }> {
    try {
      return await execFileAsync(this.binaryPath, args, {
        encoding: "utf-8",
        env: this.commandEnvironment(),
        maxBuffer: maxOutputBytes,
        timeout,
      })
    } catch (error) {
      const candidate = error as Error & { stderr?: string; stdout?: string }
      throw new Error(
        redactWecomCliOutput(`${candidate.stderr ?? ""}\n${candidate.stdout ?? ""}\n${candidate.message}`),
      )
    }
  }

  private runAuthorizationCommand(): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.binaryPath, ["init", "--noninteractive", "--no-open"], {
        env: this.commandEnvironment(),
        stdio: ["ignore", "pipe", "pipe"],
      })
      this.activeChild = child
      let output = ""
      let openedUrl = false
      const consume = (chunk: Buffer | string): void => {
        if (Buffer.byteLength(output) < maxOutputBytes) {
          output += chunk.toString().slice(0, maxOutputBytes - Buffer.byteLength(output))
        }
        if (!openedUrl) {
          const lastNewline = output.lastIndexOf("\n")
          const settledOutput = lastNewline === -1 ? "" : output.slice(0, lastNewline + 1)
          const url = findOfficialWecomAuthorizationUrl(settledOutput)
          if (url) {
            openedUrl = true
            this.activeAuthorizationUrl = url
            this.setState({ canReopenAuthorization: true })
            this.openExternalUrl(url)
          }
        }
      }
      child.stdout?.on("data", consume)
      child.stderr?.on("data", consume)
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error("WeCom QR-code connection timed out."))
      }, authorizationTimeoutMs)
      timeout.unref()
      child.once("error", (error) => {
        clearTimeout(timeout)
        if (this.activeChild === child) this.activeChild = null
        reject(new Error(redactWecomCliOutput(error.message)))
      })
      child.once("exit", (code, signal) => {
        clearTimeout(timeout)
        if (this.activeChild === child) this.activeChild = null
        if (this.cancelRequested) {
          reject(new Error("WeCom QR-code connection cancelled."))
        } else if (code === 0) {
          resolve()
        } else {
          reject(new Error(redactWecomCliOutput(output, code, signal)))
        }
      })
    })
  }

  private assertNotCancelled(): void {
    if (this.cancelRequested) throw new Error("WeCom QR-code connection cancelled.")
  }

  private setState(patch: Partial<WecomCliState>): void {
    this.state = { ...this.state, ...patch }
    this.stateChanged.emit(this.state)
  }
}

export function findOfficialWecomAuthorizationUrl(output: string): string | undefined {
  for (const match of output.matchAll(/https:\/\/[^\s"'<>]+/gu)) {
    const raw = match[0].replace(/[),.;，。；]+$/u, "")
    try {
      const url = new URL(raw)
      if (
        url.hostname.toLowerCase() === "work.weixin.qq.com" &&
        (!url.port || url.port === "443") &&
        url.pathname === "/ai/qc/gen" &&
        url.searchParams.has("scode")
      ) {
        return raw
      }
    } catch {
      // Ignore partial output until a complete official URL is present.
    }
  }
  return undefined
}

export function redactWecomCliOutput(output: string, code?: number | null, signal?: NodeJS.Signals | null): string {
  const redacted = output
    .replaceAll(/https:\/\/[^\s"'<>]+/gu, "[authorization-url]")
    .replaceAll(/("?(?:secret|bot_secret|access_token|refresh_token|scode)"?\s*[:=]\s*)[^\s,}\]]+/giu, "$1[redacted]")
    .replaceAll(/(Secret\s*[:：]\s*)\S+/giu, "$1[redacted]")
    .trim()
  const suffix = code === undefined ? "" : ` (exit ${code ?? "null"}${signal ? `, ${signal}` : ""})`
  return `${redacted || "WeCom CLI command failed"}${suffix}`
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  logDiagnostic("wecom-cli", "WeCom CLI operation failed", { error: redactWecomCliOutput(message) }, "warn")
  return redactWecomCliOutput(message)
}
