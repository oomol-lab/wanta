import type { Config, OpencodeClient } from "@opencode-ai/sdk/v2/client"
import type { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from "node:child_process"
import type { Readable } from "node:stream"

import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"
import { execFile, spawn } from "node:child_process"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"
import { logDiagnostic } from "../diagnostics-log.ts"
import { RuntimeOutputBatch } from "./runtime-output-batch.ts"

const execFileAsync = promisify(execFile)

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

export interface SidecarRuntimeDependencies {
  createDirectory: (directory: string) => Promise<void>
  spawnProcess: (command: string, args: string[], options: SpawnOptionsWithoutStdio) => ChildProcessWithoutNullStreams
}

const defaultSidecarRuntimeDependencies: SidecarRuntimeDependencies = {
  createDirectory: async (directory) => {
    await mkdir(directory, { recursive: true })
  },
  spawnProcess: (command, args, options) => spawn(command, args, options),
}

const startupOutputMaxBytes = 64 * 1024
const runtimeLineMaxLength = 8 * 1024
/** SIGTERM 后给整棵进程树自行退出的宽限期，超时再 SIGKILL 兜底。 */
const processReapGraceMs = 2_000
/** 宽限期内轮询后代是否已全部退出的间隔；一旦全部退出立即提前结束，不空等满宽限期。 */
const processReapPollMs = 100
/** 请求 opencode 自行 dispose 的超时：卡死时不拖累退出，交由 OS 进程树兜底回收。 */
const opencodeDisposeTimeoutMs = 2_000
const runtimeOutputFlushMs = 1_000

export function boundRuntimeOutputLine(line: string): { text: string; truncated: boolean } {
  const truncated = line.length > runtimeLineMaxLength
  return { text: truncated ? line.slice(0, runtimeLineMaxLength) : line, truncated }
}

/** OpenCode 本地 sidecar：spawn `opencode serve`、解析 URL、提供 SDK client、随 app 退出回收。 */
export class OpencodeSidecar {
  private readonly dependencies: SidecarRuntimeDependencies
  private readonly options: SidecarOptions
  private proc: ChildProcessWithoutNullStreams | null = null
  private opencodeClient: OpencodeClient | null = null
  private serverUrl = ""
  private disposed = false
  private disposePromise: Promise<void> | null = null
  private processReapPromise: Promise<void> | null = null
  private startPromise: Promise<void> | null = null
  private streamLogCleanup: (() => void) | null = null

  public constructor(options: SidecarOptions, dependencies: Partial<SidecarRuntimeDependencies> = {}) {
    this.options = options
    this.dependencies = { ...defaultSidecarRuntimeDependencies, ...dependencies }
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

  public start(): Promise<void> {
    if (this.disposed) {
      return Promise.reject(new Error("OpencodeSidecar already disposed"))
    }
    if (!this.startPromise) {
      this.startPromise = this.startOnce()
    }
    return this.startPromise
  }

  private async startOnce(): Promise<void> {
    const { opencodeBinPath, workspaceDir, config, env, isolationDir, serverPassword } = this.options
    const hostname = this.options.hostname ?? "127.0.0.1"
    const timeoutMs = this.options.startupTimeoutMs ?? 30_000

    const opencodeConfigDir = path.join(isolationDir, "opencode-config")
    const xdgConfigHome = path.join(isolationDir, "xdg-config")
    const xdgDataHome = path.join(isolationDir, "xdg-data")
    // 这些隔离目录必须存在：opencode 会向 XDG_DATA_HOME 写会话/状态，缺失会导致服务端 500。
    for (const dir of [opencodeConfigDir, xdgConfigHome, xdgDataHome]) {
      await this.dependencies.createDirectory(dir)
    }
    // dispose 可能在异步建目录期间发生；已处置实例绝不能再创建新进程。
    if (this.disposed) {
      throw new Error("OpencodeSidecar disposed during startup")
    }

    const childEnv: NodeJS.ProcessEnv = {
      ...process.env,
      ...env,
      // 外部 agent skill 由 SkillService 扫描后同步到私有 workspace；sidecar 不直接扫全局根，避免同名旧副本抢占。
      OPENCODE_DISABLE_EXTERNAL_SKILLS: "1",
      OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
      OPENCODE_CONFIG_DIR: opencodeConfigDir,
      XDG_CONFIG_HOME: xdgConfigHome,
      XDG_DATA_HOME: xdgDataHome,
    }
    if (serverPassword) {
      childEnv.OPENCODE_SERVER_PASSWORD = serverPassword
      childEnv.OPENCODE_SERVER_USERNAME = "opencode"
    }

    const proc = this.dependencies.spawnProcess(opencodeBinPath, ["serve", `--hostname=${hostname}`, "--port=0"], {
      cwd: workspaceDir,
      env: childEnv,
      // unix：让 opencode 自成 session/进程组，dev 下与终端信号隔离（Ctrl-C 不直达 opencode），
      // 由主进程的 SIGINT/SIGTERM 处理器统一驱动回收。工具子进程的连根回收不再依赖它（见 reap()：
      // opencode 的工具子进程会各自 setsid 逃逸出本组，改由 opencode 自身 dispose + OS 进程树兜底回收）。
      // Windows 无进程组语义（回收走 taskkill /T）。
      detached: process.platform !== "win32",
    })
    this.proc = proc

    const url = await this.awaitServerUrl(proc, timeoutMs).catch(async (error: unknown) => {
      // 启动失败（超时/提前退出/spawn 出错）时一定要回收已 spawn 的 opencode 及其后代，
      // 否则会成为孤儿；recoverRuntime 的重试更会不断叠加。
      // 此刻 client 尚未建立（awaitServerUrl 失败），传 null 走 OS 进程树兜底回收。
      // dispose 已经摘走 proc 时，它持有的同一回收 Promise 是唯一责任方，避免重复发信号。
      if (this.proc === proc) {
        this.proc = null
        this.processReapPromise ??= this.reap(proc, null)
        await this.processReapPromise
      }
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

  /**
   * 回收 opencode 及其全部工具子进程。两级、互为兜底：
   * 1. 先请 opencode 自己 dispose（`POST /global/dispose`）——它权威地知道自己 spawn 了哪些工具子进程
   *    （bash 工具 / oo CLI，各自 setsid 逃逸出 opencode 进程组），会主动全部回收。**这是跨平台**的主路径
   *    （Windows 同样有效，opencode 用自身机制杀子进程，与 OS 进程组/信号语义无关）；有超时，opencode 卡死不拖累退出。
   * 2. 再按 OS 进程树杀掉 opencode 服务进程本身，并兜底清扫 dispose 可能漏掉的残留
   *    （unix：ps 按 ppid 逐个 + 按组 SIGTERM/SIGKILL；win32：`taskkill /T /F` 连子树）。
   */
  private async reap(proc: ChildProcessWithoutNullStreams, client: OpencodeClient | null): Promise<void> {
    const pid = proc.pid
    // 主路径：让 opencode 回收自己的工具子进程（跨平台、权威、无 ps 竞态）。
    await requestOpencodeDispose(client)
    if (pid === undefined) {
      return
    }
    // 兜底：杀掉 opencode 进程本身 + 清扫任何残留后代（opencode 卡死/dispose 失败时的安全网）。
    try {
      if (process.platform === "win32") {
        await reapWindowsProcessTree(pid, (command, args) => execFileAsync(command, args))
      } else {
        await reapProcessTree(pid, {
          snapshot: listProcessSnapshot,
          kill: (target, signal) => process.kill(target, signal),
          isAlive: isProcessAlive,
          delay: reapDelay,
        })
      }
    } catch (error) {
      // 回收尽力而为，绝不把异常抛出 dispose（退出/重启路径都不能因此卡住）。
      console.warn("[wanta] failed to reap opencode process tree:", error)
      logDiagnostic("opencode-sidecar", "failed to reap opencode process tree", { error, pid }, "warn")
    }
  }

  /**
   * 回收 sidecar：同步摘掉监听与 client 引用，返回回收 Promise。
   * 退出路径应 await 该 Promise（确保 opencode 工具子进程连根回收后再让主进程退出）；
   * 重启路径可 fire-and-forget（回收在后台自完成，不拖慢重启）。
   */
  public dispose(): Promise<void> {
    if (this.disposePromise) {
      return this.disposePromise
    }
    this.disposed = true
    this.streamLogCleanup?.()
    this.streamLogCleanup = null
    const proc = this.proc
    const client = this.opencodeClient
    this.proc = null
    this.opencodeClient = null
    this.serverUrl = ""
    if (proc) {
      this.processReapPromise ??= this.reap(proc, client)
    }
    this.disposePromise = this.processReapPromise ?? Promise.resolve()
    return this.disposePromise
  }
}

export interface ProcessSnapshotEntry {
  pid: number
  ppid: number
  pgid: number
}

/** reapProcessTree 的副作用依赖，便于注入与单测。 */
export interface ProcessTreeReaper {
  /** 快照全系统进程（pid/ppid/pgid），用于按 ppid 收集 root 的全部后代。 */
  snapshot: () => Promise<ProcessSnapshotEntry[]>
  /** 向单进程（正 target）或进程组（负 target）发信号；目标不存在时抛出。 */
  kill: (target: number, signal: NodeJS.Signals) => void
  /** 判断进程是否存活（kill(pid, 0)）。 */
  isAlive: (pid: number) => boolean
  /** 宽限期内的等待实现（便于测试注入即时 resolve）。 */
  delay: (ms: number) => Promise<void>
  graceMs?: number
  pollMs?: number
}

/** 解析 `ps -eo pid=,ppid=,pgid=` 输出为进程快照。非法/空行跳过。 */
export function parsePsSnapshot(stdout: string): ProcessSnapshotEntry[] {
  const entries: ProcessSnapshotEntry[] = []
  for (const line of stdout.split("\n")) {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)$/)
    if (match) {
      entries.push({ pid: Number(match[1]), ppid: Number(match[2]), pgid: Number(match[3]) })
    }
  }
  return entries
}

/** 按 ppid 从 root 深度收集整棵进程树（含 root 自身，root 在首位）。 */
export function collectDescendantTree(rootPid: number, snapshot: ProcessSnapshotEntry[]): number[] {
  const childrenByParent = new Map<number, number[]>()
  for (const entry of snapshot) {
    const siblings = childrenByParent.get(entry.ppid)
    if (siblings) {
      siblings.push(entry.pid)
    } else {
      childrenByParent.set(entry.ppid, [entry.pid])
    }
  }
  const ordered: number[] = []
  const seen = new Set<number>()
  const stack = [rootPid]
  while (stack.length > 0) {
    const pid = stack.pop()
    if (pid === undefined || seen.has(pid)) {
      continue
    }
    seen.add(pid)
    ordered.push(pid)
    for (const child of childrenByParent.get(pid) ?? []) {
      stack.push(child)
    }
  }
  return ordered
}

/**
 * 收集进程树内可安全按组回收的 pgid：仅当组长（pgid 所指进程）本身也在树内时才纳入，
 * 绝不向组长在树外的进程组发信号，避免误伤无关进程。用于连带回收后代同组的兄弟进程。
 */
export function distinctProcessGroups(pids: number[], snapshot: ProcessSnapshotEntry[]): number[] {
  const treePids = new Set(pids)
  const pgidByPid = new Map(snapshot.map((entry) => [entry.pid, entry.pgid]))
  const groups = new Set<number>()
  for (const pid of pids) {
    const pgid = pgidByPid.get(pid)
    if (pgid !== undefined && pgid > 1 && treePids.has(pgid)) {
      groups.add(pgid)
    }
  }
  return [...groups]
}

/**
 * 回收一棵进程树（unix）。opencode 的工具子进程（bash 工具 / Bun 工具 worker / oo CLI）会各自
 * setsid 到独立 session/进程组，无法靠单一 `kill(-opencodePgid)` 命中——必须先快照、按 ppid
 * 收集整棵树，再对每个后代 pid 及其所在进程组逐个 SIGTERM；宽限期内轮询，全部退出即提前结束，
 * 否则 SIGKILL 兜底。快照必须在发信号前完成：一旦 opencode 死亡，其子进程会 reparent 到
 * launchd（ppid=1）而失去关联。Windows 走 reapWindowsProcessTree（taskkill /T）。
 */
export async function reapProcessTree(rootPid: number, deps: ProcessTreeReaper): Promise<void> {
  const safeKill = (target: number, signal: NodeJS.Signals): void => {
    try {
      deps.kill(target, signal)
    } catch {
      // 目标已退出或无权限：尽力而为，忽略。
    }
  }

  const snapshot = await deps.snapshot().catch(() => [] as ProcessSnapshotEntry[])
  const hasSnapshot = snapshot.length > 0
  const pids = hasSnapshot ? collectDescendantTree(rootPid, snapshot) : [rootPid]
  // 快照失败的降级：opencode 以 detached spawn（pgid === pid），至少按其自身进程组回收，
  // 恢复到"单一进程组 kill"的旧行为，不至于连同组的直接子进程都漏掉。
  const groups = hasSnapshot ? distinctProcessGroups(pids, snapshot) : [rootPid]

  // SIGTERM：先按组（连带同组兄弟），再逐个 pid（组长已死时的兜底）。
  for (const group of groups) {
    safeKill(-group, "SIGTERM")
  }
  for (const pid of pids) {
    safeKill(pid, "SIGTERM")
  }

  // 宽限期内轮询；后代全部退出即提前返回，避免空等。
  const graceMs = deps.graceMs ?? processReapGraceMs
  const pollMs = deps.pollMs ?? processReapPollMs
  for (let waited = 0; waited < graceMs; waited += pollMs) {
    await deps.delay(pollMs)
    if (!pids.some((pid) => deps.isAlive(pid))) {
      return
    }
  }

  // 宽限期后仍有存活：SIGKILL 兜底。
  for (const group of groups) {
    safeKill(-group, "SIGKILL")
  }
  for (const pid of pids) {
    safeKill(pid, "SIGKILL")
  }
}

/**
 * 请 opencode 自行 dispose（`POST /global/dispose`）——由 opencode 主动回收它 spawn 的全部工具子进程
 * （权威、跨平台，不依赖 OS 进程组/信号语义）。带超时：opencode 卡死或已不可达时不拖累退出，
 * 交由后续 OS 进程树回收兜底。尽力而为，任何错误都吞掉。
 */
async function requestOpencodeDispose(client: OpencodeClient | null): Promise<void> {
  if (!client) {
    return
  }
  try {
    await client.global.dispose({ signal: AbortSignal.timeout(opencodeDisposeTimeoutMs) })
  } catch (error) {
    // 已退出/卡死/超时：忽略，兜底回收会处理。
    logDiagnostic("opencode-sidecar", "opencode self-dispose request failed", { error }, "trace")
  }
}

/**
 * Windows 进程树回收：`taskkill /PID <pid> /T /F` 连带终止整棵子树（含孙子进程）。
 * /T 按 ParentProcessId 递归，/F 强制。目标不存在时 taskkill 以非零码退出——吞掉即可。
 */
export async function reapWindowsProcessTree(
  rootPid: number,
  run: (command: string, args: string[]) => Promise<unknown>,
): Promise<void> {
  try {
    await run("taskkill", ["/PID", String(rootPid), "/T", "/F"])
  } catch {
    // 进程已退出或无权限：尽力而为，忽略。
  }
}

async function listProcessSnapshot(): Promise<ProcessSnapshotEntry[]> {
  // execFile（异步子进程，非同步 fs）：主进程纪律允许；仅在回收路径按需调用。
  const { stdout } = await execFileAsync("ps", ["-eo", "pid=,ppid=,pgid="], { maxBuffer: 8 * 1024 * 1024 })
  return parsePsSnapshot(stdout)
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function reapDelay(ms: number): Promise<void> {
  // 刻意不 unref：退出路径 await 本回收链时需保持事件循环存活，直到 SIGKILL 兜底送达。
  return new Promise((resolve) => setTimeout(resolve, ms))
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
  let flushTimer: NodeJS.Timeout | undefined
  const batch = new RuntimeOutputBatch()
  const flush = (): void => {
    if (flushTimer) {
      clearTimeout(flushTimer)
      flushTimer = undefined
    }
    const snapshot = batch.take()
    if (!snapshot) {
      return
    }
    if (source === "stderr") {
      console.warn("[wanta] opencode stderr batch:", snapshot)
    }
    logDiagnostic("opencode-sidecar", `opencode ${source}`, { ...snapshot }, source === "stderr" ? "warn" : "trace")
  }
  const queue = (line: string, truncated: boolean): void => {
    const text = line.trim()
    if (!text) {
      return
    }
    batch.add(text, truncated)
    if (flushTimer) {
      return
    }
    flushTimer = setTimeout(flush, runtimeOutputFlushMs)
    flushTimer.unref?.()
  }
  const onData = (chunk: Buffer): void => {
    pending += chunk.toString()
    const lines = pending.split(/\r?\n/)
    pending = lines.pop() ?? ""
    if (pending.length > runtimeLineMaxLength) {
      queue(pending.slice(0, runtimeLineMaxLength), true)
      pending = ""
    }
    for (const line of lines) {
      const bounded = boundRuntimeOutputLine(line)
      queue(bounded.text, bounded.truncated)
    }
  }
  stream.on("data", onData)
  return () => {
    stream.off("data", onData)
    if (pending.trim()) {
      const bounded = boundRuntimeOutputLine(pending)
      queue(bounded.text, bounded.truncated)
    }
    pending = ""
    flush()
  }
}
