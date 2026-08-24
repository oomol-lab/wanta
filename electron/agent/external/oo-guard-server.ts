import type { WorkspaceTeamScope } from "../oo-guard-core.ts"
import type { IncomingMessage, Server, ServerResponse } from "node:http"

import { spawn } from "node:child_process"
import { randomBytes } from "node:crypto"
import { createServer } from "node:http"
import {
  bindExternalConnectorWorkspace,
  isConnectorBusinessCommand,
  isManagedExternalOoCommand,
  redactConnectorOutput,
  stripIdentityIndependentWorkspaceSelectors,
} from "../oo-guard-core.ts"

const maxCapturedOutputBytes = 32 * 1024 * 1024
const maxRequestBytes = 256 * 1024

export interface ExternalOoGuardDescriptor {
  token: string
  url: string
}

export interface ExternalOoGuardServerOptions {
  command: string
  env?: NodeJS.ProcessEnv
  scope: () => WorkspaceTeamScope
}

/** Electron-owned execution boundary for the external Agent's managed `oo`. */
export class ExternalOoGuardServer {
  private connectionValue: { url: string } | null = null
  private disposed = false
  private readonly server: Server
  private startPromise: Promise<{ url: string }> | null = null
  private readonly token = randomBytes(32).toString("base64url")

  public constructor(private readonly options: ExternalOoGuardServerOptions) {
    this.server = createServer((request, response) => {
      void this.handle(request, response).catch((error: unknown) => {
        respondJson(response, 500, { error: error instanceof Error ? error.message : String(error) })
      })
    })
  }

  public async descriptor(): Promise<ExternalOoGuardDescriptor> {
    if (this.disposed) throw new Error("External OO guard server has been disposed.")
    const connection = await this.connection()
    return { token: this.token, url: connection.url }
  }

  public async dispose(): Promise<void> {
    this.disposed = true
    if (!this.server.listening) return
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => (error ? reject(error) : resolve()))
      this.server.closeAllConnections()
    })
  }

  private connection(): Promise<{ url: string }> {
    if (this.connectionValue) return Promise.resolve(this.connectionValue)
    this.startPromise ??= new Promise((resolve, reject) => {
      this.server.once("error", reject)
      this.server.listen(0, "127.0.0.1", () => {
        this.server.off("error", reject)
        const address = this.server.address()
        if (!address || typeof address === "string") {
          reject(new Error("External OO guard server did not expose a loopback port."))
          return
        }
        this.connectionValue = { url: `http://127.0.0.1:${address.port}/run` }
        resolve(this.connectionValue)
      })
    })
    return this.startPromise
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.headers.authorization !== `Bearer ${this.token}`) {
      respondJson(response, 401, { error: "Invalid Wanta OO guard credential." })
      return
    }
    if (request.method !== "POST" || request.url !== "/run") {
      respondJson(response, 404, { error: "Not found." })
      return
    }
    const body = await readRequest(request)
    if (!body || typeof body !== "object" || !Array.isArray((body as { args?: unknown }).args)) {
      respondJson(response, 400, { error: "Managed OO request is missing args." })
      return
    }
    const rawArgs = (body as { args: unknown[] }).args
    if (rawArgs.some((arg) => typeof arg !== "string")) {
      respondJson(response, 400, { error: "Managed OO request args must be strings." })
      return
    }
    const originalArgs = stripIdentityIndependentWorkspaceSelectors(rawArgs as string[])
    if (!isManagedExternalOoCommand(originalArgs)) {
      respondJson(response, 403, { error: "Only managed connector discovery and action commands are allowed." })
      return
    }
    const args = isConnectorBusinessCommand(originalArgs)
      ? bindExternalConnectorWorkspace(originalArgs, this.options.scope())
      : originalArgs
    const result = await runOo(this.options.command, args, this.options.env ?? process.env)
    respondJson(response, 200, result)
  }
}

async function runOo(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<{ exitCode: number; stderr: string; stdout: string }> {
  const child = spawn(command, args, { env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true })
  const stdout: Buffer[] = []
  const stderr: Buffer[] = []
  let stdoutSize = 0
  let stderrSize = 0
  let captureError: Error | null = null
  const append = (chunks: Buffer[], chunk: Buffer, size: number): number => {
    const nextSize = size + chunk.length
    if (nextSize > maxCapturedOutputBytes) throw new Error("Connector output exceeded Wanta's 32 MiB safety limit.")
    chunks.push(chunk)
    return nextSize
  }
  const terminate = (): void => {
    child.kill("SIGTERM")
    const timer = setTimeout(() => child.kill("SIGKILL"), 5_000)
    timer.unref()
    child.once("close", () => clearTimeout(timer))
  }
  child.stdout.on("data", (chunk: Buffer) => {
    if (captureError) return
    try {
      stdoutSize = append(stdout, chunk, stdoutSize)
    } catch (error) {
      captureError = error instanceof Error ? error : new Error(String(error))
      terminate()
    }
  })
  child.stderr.on("data", (chunk: Buffer) => {
    if (captureError) return
    try {
      stderrSize = append(stderr, chunk, stderrSize)
    } catch (error) {
      captureError = error instanceof Error ? error : new Error(String(error))
      terminate()
    }
  })
  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once("error", reject)
    child.once("close", (code, signal) => resolve(code ?? (signal ? 1 : 0)))
  })
  if (captureError) throw captureError
  return {
    exitCode,
    stdout: redactConnectorOutput(Buffer.concat(stdout).toString("utf8")),
    stderr: redactConnectorOutput(Buffer.concat(stderr).toString("utf8")),
  }
}

async function readRequest(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > maxRequestBytes) throw new Error("Managed OO request is too large.")
    chunks.push(buffer)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown
  } catch {
    throw new Error("Managed OO request is not valid JSON.")
  }
}

function respondJson(response: ServerResponse, status: number, body: unknown): void {
  if (response.destroyed || response.writableEnded) return
  response.writeHead(status, { "cache-control": "no-store", "content-type": "application/json" })
  response.end(JSON.stringify(body))
}
