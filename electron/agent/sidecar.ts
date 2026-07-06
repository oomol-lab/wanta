import type { Config, OpencodeClient } from "@opencode-ai/sdk/v2/client"
import type { ChildProcessWithoutNullStreams } from "node:child_process"
import type { Readable } from "node:stream"

import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"
import { spawn } from "node:child_process"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { logDiagnostic } from "../diagnostics-log.ts"

export interface SidecarOptions {
  /** opencode 二进制绝对路径。 */
  opencodeBinPath: string
  /** sidecar 的 cwd：含 .opencode/tools/ 的 workspace。 */
  workspaceDir: string
  /** 经 OPENCODE_CONFIG_CONTENT 内联注入的 OpenCode 配置。 */
  config: Config
  /** 额外注入到 opencode 进程的环境变量（OO_ 系列 / WANTA_ 系列 / PATH 等）。 */
  env: Record<string, string>
  /** 隔离目录根：OPENCODE_CONFIG_DIR / XDG_CONFIG_HOME / XDG_DATA_HOME 指向其下，避免读全局 ~/.config/opencode。 */
  isolationDir: string
  /** 可选 Basic Auth 口令（OPENCODE_SERVER_PASSWORD），用户名固定 opencode。 */
  serverPassword?: string
  /** sidecar ready 后意外退出时通知上层做恢复；dispose 主动结束不会触发。 */
  onExit?: (info: SidecarExitInfo) => void
  hostname?: string
  startupTimeoutMs?: number
}

export interface SidecarExitInfo {
  code?: number | null
  error?: Error
  signal?: NodeJS.Signals | null
}

const startupOutputMaxBytes = 64 * 1024
const runtimeLineMaxLength = 8 * 1024
/** SIGTERM 后给整组进程自行退出的宽限期，超时再 SIGKILL 兜底。 */
const processGroupKillGraceMs = 2_000

/** OpenCode 本地 sidecar：spawn `opencode serve`、解析 URL、提供 SDK client、随 app 退出回收。 */
export class OpencodeSidecar {
  private readonly options: SidecarOptions
  private proc: ChildProcessWithoutNullStreams | null = null
  private opencodeClient: OpencodeClient | null = null
  private serverUrl = ""
  private disposed = false
  private streamLogCleanup: (() => void) | null = null

  public constructor(options: SidecarOptions) {
    this.options = options
  }

  public get client(): OpencodeClient {
    if (!this.opencodeClient) {
      throw new Error("OpencodeSidecar not started")
    }
    return this.opencodeClient
  }

  public get url(): string {
    return this.serverUrl
  }

  public async start(): Promise<void> {
    this.disposed = false
    const { opencodeBinPath, workspaceDir, config, env, isolationDir, serverPassword } = this.options
    const hostname = this.options.hostname ?? "127.0.0.1"
    const timeoutMs = this.options.startupTimeoutMs ?? 30_000

    const opencodeConfigDir = path.join(isolationDir, "opencode-config")
    const xdgConfigHome = path.join(isolationDir, "xdg-config")
    const xdgDataHome = path.join(isolationDir, "xdg-data")
    // 这些隔离目录必须存在：opencode 会向 XDG_DATA_HOME 写会话/状态，缺失会导致服务端 500。
    for (const dir of [opencodeConfigDir, xdgConfigHome, xdgDataHome]) {
      await mkdir(dir, { recursive: true })
    }

    const childEnv: NodeJS.ProcessEnv = {
      ...process.env,
      ...env,
      OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
      OPENCODE_CONFIG_DIR: opencodeConfigDir,
      XDG_CONFIG_HOME: xdgConfigHome,
      XDG_DATA_HOME: xdgDataHome,
    }
    if (serverPassword) {
      childEnv.OPENCODE_SERVER_PASSWORD = serverPassword
      childEnv.OPENCODE_SERVER_USERNAME = "opencode"
    }

    const proc = spawn(opencodeBinPath, ["serve", `--hostname=${hostname}`, "--port=0"], {
      cwd: workspaceDir,
      env: childEnv,
      // unix：让 opencode 自成进程组（pgid === pid），dispose 时可对整组发信号，连同它派生的
      // Bun 工具 worker / oo CLI 一并回收，避免主进程退出后残留孤儿进程。Windows 无对应语义。
      detached: process.platform !== "win32",
    })
    this.proc = proc

    const url = await this.awaitServerUrl(proc, timeoutMs).catch((error: unknown) => {
      // 启动失败（超时/提前退出/spawn 出错）时一定要回收已 spawn 的 opencode，
      // 否则 detached 进程会成为孤儿；recoverRuntime 的重试更会不断叠加。
      this.terminate(proc)
      throw error
    })

    this.serverUrl = url
    this.streamLogCleanup = attachRuntimeStreamDiagnostics(proc)
    proc.once("exit", (code, signal) => {
      this.streamLogCleanup?.()
      this.streamLogCleanup = null
      if (!this.disposed) {
        this.options.onExit?.({ code, signal })
      }
    })
    proc.once("error", (error) => {
      this.streamLogCleanup?.()
      this.streamLogCleanup = null
      if (!this.disposed) {
        this.options.onExit?.({ error })
      }
    })
    const headers: Record<string, string> = {}
    if (serverPassword) {
      const token = Buffer.from(`opencode:${serverPassword}`).toString("base64")
      headers.Authorization = `Basic ${token}`
    }
    this.opencodeClient = createOpencodeClient({ baseUrl: url, headers })
  }

  /** 解析 opencode 启动输出，拿到 "listening on <url>"；超时/提前退出/出错则 reject。 */
  private awaitServerUrl(proc: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      let output = ""
      const appendStartupOutput = (chunk: Buffer): void => {
        output = appendBoundedOutput(output, chunk.toString(), startupOutputMaxBytes)
      }
      const timer = setTimeout(() => {
        reject(new Error(`opencode serve startup timeout after ${timeoutMs}ms\n${output}`))
      }, timeoutMs)
      const onData = (chunk: Buffer): void => {
        appendStartupOutput(chunk)
        const match = output.match(/listening on\s+(https?:\/\/\S+)/i)
        if (match) {
          clearTimeout(timer)
          detach()
          resolve(match[1])
        }
      }
      const onExit = (code: number | null): void => {
        clearTimeout(timer)
        detach()
        reject(new Error(`opencode serve exited (code ${code}) before becoming ready\n${output}`))
      }
      const onError = (error: Error): void => {
        clearTimeout(timer)
        detach()
        reject(error)
      }
      const onStderrData = (chunk: Buffer): void => {
        appendStartupOutput(chunk)
      }
      const detach = (): void => {
        proc.stdout.off("data", onData)
        proc.stderr.off("data", onStderrData)
        proc.off("exit", onExit)
        proc.off("error", onError)
      }
      proc.stdout.on("data", onData)
      proc.stderr.on("data", onStderrData)
      proc.on("exit", onExit)
      proc.on("error", onError)
    })
  }

  /** 回收 opencode 及其全部后代（unix 按进程组 SIGTERM，宽限期后 SIGKILL 兜底）。 */
  private terminate(proc: ChildProcessWithoutNullStreams): void {
    if (proc.pid === undefined) {
      return
    }
    terminateProcessTree(proc.pid, {
      platform: process.platform,
      killGroup: (groupId, signal) => process.kill(groupId, signal),
      killSelf: (signal) => proc.kill(signal),
      schedule: (fn, ms) => {
        const timer = setTimeout(fn, ms)
        timer.unref?.()
      },
    })
  }

  public dispose(): void {
    this.disposed = true
    this.streamLogCleanup?.()
    this.streamLogCleanup = null
    const proc = this.proc
    this.proc = null
    this.opencodeClient = null
    this.serverUrl = ""
    if (proc) {
      this.terminate(proc)
    }
  }
}

/** terminateProcessTree 的副作用依赖，便于注入与单测。 */
export interface ProcessTreeTerminator {
  platform: NodeJS.Platform
  /** 向进程组发信号（groupId 传负 pid 表示整组）；组不存在时抛出。 */
  killGroup: (groupId: number, signal: NodeJS.Signals) => void
  /** 单进程兜底 kill（Windows 无进程组语义时使用）。 */
  killSelf: (signal: NodeJS.Signals) => void
  /** 调度 SIGKILL 兜底（实现应 unref，绝不可阻止进程退出）。 */
  schedule: (fn: () => void, ms: number) => void
}

/**
 * 回收一棵进程树。unix 下目标进程以 detached 方式 spawn，自成进程组（pgid === pid），
 * 故对 -pid 发 SIGTERM 可命中它及其所有后代（Bun 工具 worker / oo CLI）；宽限期后再 SIGKILL 兜底。
 * Windows 无对应语义，退回单进程 kill（与既有行为一致，不处理孙子进程）。
 */
export function terminateProcessTree(pid: number, deps: ProcessTreeTerminator): void {
  if (deps.platform === "win32") {
    deps.killSelf("SIGTERM")
    return
  }
  try {
    deps.killGroup(-pid, "SIGTERM")
  } catch {
    // 组已消失或无权限：退回单进程，尽力而为。
    deps.killSelf("SIGTERM")
  }
  deps.schedule(() => {
    try {
      deps.killGroup(-pid, "SIGKILL")
    } catch {
      // 组已在宽限期内退出，无需处理。
    }
  }, processGroupKillGraceMs)
}

function appendBoundedOutput(current: string, next: string, maxBytes: number): string {
  const combined = current + next
  if (Buffer.byteLength(combined, "utf8") <= maxBytes) {
    return combined
  }
  return combined.slice(-maxBytes)
}

function attachRuntimeStreamDiagnostics(proc: ChildProcessWithoutNullStreams): () => void {
  const cleanupStdout = attachStreamDiagnostics(proc.stdout, "stdout")
  const cleanupStderr = attachStreamDiagnostics(proc.stderr, "stderr")
  return () => {
    cleanupStdout()
    cleanupStderr()
  }
}

function attachStreamDiagnostics(stream: Readable, source: "stdout" | "stderr"): () => void {
  let pending = ""
  const onData = (chunk: Buffer): void => {
    pending += chunk.toString()
    const lines = pending.split(/\r?\n/)
    pending = lines.pop() ?? ""
    if (pending.length > runtimeLineMaxLength) {
      emitRuntimeLine(source, pending.slice(0, runtimeLineMaxLength), true)
      pending = ""
    }
    for (const line of lines) {
      emitRuntimeLine(source, line, false)
    }
  }
  stream.on("data", onData)
  return () => {
    stream.off("data", onData)
    if (pending.trim()) {
      emitRuntimeLine(source, pending, false)
    }
    pending = ""
  }
}

function emitRuntimeLine(source: "stdout" | "stderr", line: string, truncated: boolean): void {
  const text = line.trim()
  if (!text) {
    return
  }
  if (source === "stderr") {
    console.warn("[wanta] opencode stderr:", text)
  }
  logDiagnostic(
    "opencode-sidecar",
    `opencode ${source}`,
    {
      line: text,
      ...(truncated ? { truncated: true } : {}),
    },
    source === "stderr" ? "warn" : "trace",
  )
}
