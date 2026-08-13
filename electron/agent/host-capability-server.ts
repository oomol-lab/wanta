import type { HostMcpServer } from "./external/host-mcp.ts"
import type { HostCapabilityContext, HostToolContent, HostToolDefinition, HostToolResult } from "./host-capability.ts"
import type { IncomingMessage, Server, ServerResponse } from "node:http"

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { randomBytes, randomUUID } from "node:crypto"
import { createServer } from "node:http"
import { HostCapabilityLease } from "./host-capability-lease.ts"
import { HostCapabilityKernel } from "./host-capability.ts"

interface CapabilitySession {
  descriptor: HostMcpServer
  lease: HostCapabilityLease
  mcp: McpServer
  transport: StreamableHTTPServerTransport
}

export interface HostCapabilityServerOptions {
  capabilityIds: readonly string[]
  instructions?: string
  kernel: HostCapabilityKernel
  name: string
  version: string
}

/** Authenticated loopback MCP transport for one or more host capabilities. */
export class HostCapabilityServer {
  private connectionValue: { url: string } | null = null
  private disposed = false
  private readonly issuingBySessionId = new Map<string, Promise<HostMcpServer>>()
  private readonly options: HostCapabilityServerOptions
  private readonly revokedSessionIds = new Set<string>()
  private readonly sessions = new Map<string, CapabilitySession>()
  private readonly tokenBySessionId = new Map<string, string>()
  private readonly server: Server
  private startPromise: Promise<{ url: string }> | null = null

  public constructor(options: HostCapabilityServerOptions) {
    this.options = options
    this.assertToolNamesUnique()
    this.server = createServer((request, response) => void this.handle(request, response))
  }

  public async issue(context: HostCapabilityContext): Promise<HostMcpServer> {
    if (this.disposed) throw new Error(`Host MCP server "${this.options.name}" has been disposed.`)
    if (this.revokedSessionIds.has(context.sessionId)) {
      throw new Error("Host capability session has been revoked.")
    }
    const existingToken = this.tokenBySessionId.get(context.sessionId)
    const existing = existingToken ? this.sessions.get(existingToken) : undefined
    if (existing) {
      existing.lease.update(context)
      return existing.descriptor
    }
    const pending = this.issuingBySessionId.get(context.sessionId)
    if (pending) {
      const descriptor = await pending
      const token = this.tokenBySessionId.get(context.sessionId)
      const session = token ? this.sessions.get(token) : undefined
      if (!session) throw new Error("Host capability session disappeared while it was being issued.")
      session.lease.update(context)
      return descriptor
    }
    const issuance = this.issueNew(context).finally(() => this.issuingBySessionId.delete(context.sessionId))
    this.issuingBySessionId.set(context.sessionId, issuance)
    return issuance
  }

  private async issueNew(context: HostCapabilityContext): Promise<HostMcpServer> {
    const connection = await this.connection()
    const token = randomBytes(32).toString("base64url")
    const lease = new HostCapabilityLease(context)
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: randomUUID })
    const mcp = this.createMcp(lease)
    await mcp.connect(transport)
    const descriptor: HostMcpServer = {
      name: this.options.name,
      url: `${connection.url}/mcp`,
      headers: { Authorization: `Bearer ${token}` },
    }
    this.sessions.set(token, { descriptor, lease, mcp, transport })
    this.tokenBySessionId.set(context.sessionId, token)
    return descriptor
  }

  public disableSession(sessionId: string): void {
    const token = this.tokenBySessionId.get(sessionId)
    if (token) this.sessions.get(token)?.lease.disable()
  }

  public disableAll(): void {
    for (const session of this.sessions.values()) session.lease.disable()
  }

  public async revokeSession(sessionId: string): Promise<void> {
    this.revokedSessionIds.add(sessionId)
    await this.issuingBySessionId.get(sessionId)?.catch(() => undefined)
    const token = this.tokenBySessionId.get(sessionId)
    if (!token) return
    this.tokenBySessionId.delete(sessionId)
    await this.revoke(token)
  }

  public async dispose(): Promise<void> {
    this.disposed = true
    await Promise.allSettled(this.issuingBySessionId.values())
    await Promise.all([...this.sessions.keys()].map((token) => this.revoke(token)))
    this.tokenBySessionId.clear()
    if (!this.server.listening) return
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => (error ? reject(error) : resolve()))
      this.server.closeAllConnections()
    })
  }

  private createMcp(lease: HostCapabilityLease): McpServer {
    const capabilities = this.options.capabilityIds.map((id) => this.options.kernel.capability(id))
    const instructions = [this.options.instructions, ...capabilities.map((capability) => capability.instructions)]
      .filter((value): value is string => Boolean(value?.trim()))
      .join("\n\n")
    const mcp = new McpServer(
      { name: this.options.name, version: this.options.version },
      instructions ? { instructions } : undefined,
    )
    for (const capability of capabilities) {
      for (const tool of capability.tools) this.registerTool(mcp, lease, capability.id, tool)
    }
    return mcp
  }

  private registerTool(
    mcp: McpServer,
    lease: HostCapabilityLease,
    capabilityId: string,
    tool: HostToolDefinition,
  ): void {
    mcp.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema,
        ...(tool.annotations ? { annotations: tool.annotations } : {}),
      },
      async (input) => mcpResult(await this.options.kernel.execute(capabilityId, tool.name, lease.context(), input)),
    )
  }

  private assertToolNamesUnique(): void {
    const owners = new Map<string, string>()
    for (const capabilityId of this.options.capabilityIds) {
      for (const tool of this.options.kernel.capability(capabilityId).tools) {
        const owner = owners.get(tool.name)
        if (owner) {
          throw new Error(
            `Host MCP server "${this.options.name}" tool "${tool.name}" conflicts between "${owner}" and "${capabilityId}".`,
          )
        }
        owners.set(tool.name, capabilityId)
      }
    }
  }

  private connection(): Promise<{ url: string }> {
    if (this.connectionValue) return Promise.resolve(this.connectionValue)
    this.startPromise ??= new Promise((resolve, reject) => {
      this.server.once("error", reject)
      this.server.listen(0, "127.0.0.1", () => {
        this.server.off("error", reject)
        const address = this.server.address()
        if (!address || typeof address === "string") {
          reject(new Error(`Host MCP server "${this.options.name}" did not expose a loopback port.`))
          return
        }
        this.connectionValue = { url: `http://127.0.0.1:${address.port}` }
        resolve(this.connectionValue)
      })
    })
    return this.startPromise
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const token = bearerToken(request.headers.authorization)
    const session = token ? this.sessions.get(token) : undefined
    if (request.url !== "/mcp" || !session) {
      response.writeHead(404, { "cache-control": "no-store", "content-type": "application/json" })
      response.end(JSON.stringify({ error: "Not found." }))
      return
    }
    try {
      await session.transport.handleRequest(request, response)
    } catch {
      if (!response.headersSent) {
        response.writeHead(500, { "cache-control": "no-store", "content-type": "application/json" })
      }
      if (!response.writableEnded) response.end(JSON.stringify({ error: "Host capability request failed." }))
    }
  }

  private async revoke(token: string): Promise<void> {
    const session = this.sessions.get(token)
    if (!session) return
    this.sessions.delete(token)
    this.tokenBySessionId.delete(session.lease.sessionId)
    session.lease.revoke()
    await session.mcp.close().catch(() => undefined)
  }
}

function bearerToken(header: string | undefined): string | undefined {
  const match = header?.match(/^Bearer\s+([^\s]+)$/u)
  return match?.[1]
}

function mcpResult(result: HostToolResult): { content: HostToolContent[] } {
  return { content: result.content ? [...result.content] : [{ type: "text", text: result.text }] }
}
