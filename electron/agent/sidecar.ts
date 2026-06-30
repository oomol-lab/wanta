import type { Config, OpencodeClient } from "@opencode-ai/sdk/v2/client"
import type { ChildProcessWithoutNullStreams } from "node:child_process"

import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"
import { spawn } from "node:child_process"
import { mkdir } from "node:fs/promises"
import path from "node:path"

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
  hostname?: string
  startupTimeoutMs?: number
}

/** OpenCode 本地 sidecar：spawn `opencode serve`、解析 URL、提供 SDK client、随 app 退出回收。 */
export class OpencodeSidecar {
  private readonly options: SidecarOptions
  private proc: ChildProcessWithoutNullStreams | null = null
  private opencodeClient: OpencodeClient | null = null
  private serverUrl = ""

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
    })
    this.proc = proc

    let output = ""
    const url = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`opencode serve startup timeout after ${timeoutMs}ms\n${output}`))
      }, timeoutMs)
      const onData = (chunk: Buffer): void => {
        output += chunk.toString()
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
      const detach = (): void => {
        proc.stdout.off("data", onData)
        proc.off("exit", onExit)
        proc.off("error", onError)
      }
      proc.stdout.on("data", onData)
      proc.stderr.on("data", (chunk: Buffer) => {
        output += chunk.toString()
      })
      proc.on("exit", onExit)
      proc.on("error", onError)
    })

    this.serverUrl = url
    const headers: Record<string, string> = {}
    if (serverPassword) {
      const token = Buffer.from(`opencode:${serverPassword}`).toString("base64")
      headers.Authorization = `Basic ${token}`
    }
    this.opencodeClient = createOpencodeClient({ baseUrl: url, headers, directory: workspaceDir })
  }

  public dispose(): void {
    if (this.proc) {
      this.proc.kill("SIGTERM")
      this.proc = null
    }
    this.opencodeClient = null
    this.serverUrl = ""
  }
}
