import type { HostCapabilityContext } from "./host-capability.ts"
import type { IncomingMessage, ServerResponse } from "node:http"

import { randomBytes } from "node:crypto"
import { createServer } from "node:http"
import { HostCapabilityKernel } from "./host-capability.ts"

const maxRequestBytes = 256 * 1024

export interface HostCapabilityInvokeConnection {
  token: string
  url: string
}

/** Session-aware transport for a multiplexed built-in sidecar. */
export class HostCapabilityInvokeServer {
  private readonly contexts = new Map<string, HostCapabilityContext>()
  private readonly allowed: ReadonlySet<string>
  private readonly token = randomBytes(32).toString("base64url")
  private readonly server = createServer((request, response) => void this.handle(request, response))
  private connectionValue: HostCapabilityInvokeConnection | undefined
  private startPromise: Promise<HostCapabilityInvokeConnection> | undefined

  public constructor(
    private readonly kernel: HostCapabilityKernel,
    capabilityIds: readonly string[],
  ) {
    this.allowed = new Set(capabilityIds)
  }

  public update(context: HostCapabilityContext): void {
    this.contexts.set(context.sessionId, context)
  }

  public disableSession(sessionId: string): void {
    this.contexts.delete(sessionId)
  }

  public disableAll(): void {
    this.contexts.clear()
  }

  public connection(): Promise<HostCapabilityInvokeConnection> {
    if (this.connectionValue) return Promise.resolve(this.connectionValue)
    this.startPromise ??= new Promise((resolve, reject) => {
      this.server.once("error", reject)
      this.server.listen(0, "127.0.0.1", () => {
        this.server.off("error", reject)
        const address = this.server.address()
        if (!address || typeof address === "string") return reject(new Error("Host invoke server has no port."))
        this.connectionValue = { token: this.token, url: `http://127.0.0.1:${address.port}` }
        resolve(this.connectionValue)
      })
    })
    return this.startPromise
  }

  public async dispose(): Promise<void> {
    this.contexts.clear()
    if (!this.server.listening) return
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => (error ? reject(error) : resolve()))
      this.server.closeAllConnections()
    })
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (
      request.method !== "POST" ||
      request.url !== "/v1/invoke" ||
      request.headers.authorization !== `Bearer ${this.token}`
    ) {
      respond(response, 404, { error: "Not found." })
      return
    }
    try {
      const body = await readBody(request)
      const sessionId = requiredString(body.sessionId)
      const capability = requiredString(body.capability)
      const tool = requiredString(body.tool)
      if (!this.allowed.has(capability)) throw new Error("Host capability is not exposed to the sidecar.")
      const context = this.contexts.get(sessionId)
      if (!context) throw new Error("Wanta host capability context is unavailable for this session.")
      const result = await this.kernel.execute(capability, tool, context, body.input ?? {})
      respond(response, 200, { result: result.text })
    } catch (error) {
      respond(response, 400, { error: error instanceof Error ? error.message : String(error) })
    }
  }
}

async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > maxRequestBytes) throw new Error("Host capability request is too large.")
    chunks.push(buffer)
  }
  const value = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Request body must be an object.")
  return value as Record<string, unknown>
}

function requiredString(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("Required string is missing.")
  return value
}

function respond(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "cache-control": "no-store", "content-type": "application/json" })
  response.end(JSON.stringify(body))
}
