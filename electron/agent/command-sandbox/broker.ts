import type { PolicyReviewerTarget, PrivateNetworkScope } from "./policy-reviewer.ts"
import type { PrivateNetworkGrant } from "./policy.ts"
import type { Server } from "node:http"

import { createServer } from "node:http"
import { classifyNetworkAddress, normalizeAddress } from "./network-address.ts"
import { reviewPrivateNetworkAccess } from "./policy-reviewer.ts"

interface CommandSandboxSessionContext {
  modelTarget: PolicyReviewerTarget
  origin: "main" | "subagent"
  userMessage: string
}

export interface CommandSandboxBrokerOptions {
  authKey: string
  onGrantsChanged: (sessionId: string, grants: PrivateNetworkGrant[]) => Promise<void>
  review?: typeof reviewPrivateNetworkAccess
}

export class CommandSandboxBroker {
  private readonly authKey: string
  private readonly grants = new Map<string, PrivateNetworkGrant[]>()
  private readonly onGrantsChanged: CommandSandboxBrokerOptions["onGrantsChanged"]
  private readonly review: typeof reviewPrivateNetworkAccess
  private readonly sessions = new Map<string, CommandSandboxSessionContext>()
  private server: Server | undefined
  private url: string | undefined

  public constructor({ authKey, onGrantsChanged, review = reviewPrivateNetworkAccess }: CommandSandboxBrokerOptions) {
    this.authKey = authKey
    this.onGrantsChanged = onGrantsChanged
    this.review = review
  }

  public async start(): Promise<string> {
    if (this.url) return this.url
    const server = createServer((request, response) => {
      void this.handleRequest(request, response)
    })
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject)
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject)
        resolve()
      })
    })
    const address = server.address()
    if (!address || typeof address === "string") {
      server.close()
      throw new Error("Command Sandbox broker did not report its port.")
    }
    this.server = server
    this.url = `http://127.0.0.1:${address.port}`
    return this.url
  }

  public setSession(
    sessionId: string,
    context: CommandSandboxSessionContext,
    grants: readonly PrivateNetworkGrant[] = [],
  ): void {
    this.sessions.set(sessionId, context)
    this.grants.set(sessionId, [...grants])
  }

  public async close(): Promise<void> {
    const server = this.server
    this.server = undefined
    this.url = undefined
    this.sessions.clear()
    if (!server) return
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error && (error as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING") reject(error)
        else resolve()
      })
    })
  }

  private async handleRequest(
    request: import("node:http").IncomingMessage,
    response: import("node:http").ServerResponse,
  ): Promise<void> {
    if (
      request.method !== "POST" ||
      request.url !== "/private-network" ||
      request.headers.authorization !== `Bearer ${this.authKey}`
    ) {
      response.writeHead(404).end()
      return
    }
    try {
      const body = await readJsonBody(request)
      const scope = parseScope(body)
      const sessionId =
        body && typeof body === "object" && typeof (body as { sessionId?: unknown }).sessionId === "string"
          ? (body as { sessionId: string }).sessionId
          : ""
      const context = this.sessions.get(sessionId)
      if (!scope || !context || classifyNetworkAddress(scope.address) !== "private") {
        writeJson(response, { allow: false })
        return
      }
      const grants = this.grants.get(sessionId) ?? []
      if (hasGrant(grants, scope)) {
        writeJson(response, { allow: true })
        return
      }
      const decision = await this.review(
        {
          existingScopes: grants.map((grant) => ({
            address: normalizeAddress(grant.address),
            host: normalizeAddress(grant.address),
            port: grant.port ?? scope.port,
            protocol: "tcp",
          })),
          origin: context.origin,
          requestedScope: scope,
          userMessage: context.userMessage,
        },
        context.modelTarget,
      )
      if (decision.decision !== "approve") {
        writeJson(response, { allow: false })
        return
      }
      const nextGrants = [...grants, { address: scope.address, port: scope.port }]
      this.grants.set(sessionId, nextGrants)
      await this.onGrantsChanged(sessionId, nextGrants)
      writeJson(response, { allow: true })
    } catch {
      writeJson(response, { allow: false })
    }
  }
}

async function readJsonBody(request: import("node:http").IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > 16_384) throw new Error("Command sandbox broker request is too large.")
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"))
}

function parseScope(value: unknown): PrivateNetworkScope | null {
  if (!value || typeof value !== "object") return null
  const candidate = value as { address?: unknown; host?: unknown; port?: unknown; protocol?: unknown }
  if (
    typeof candidate.address !== "string" ||
    typeof candidate.host !== "string" ||
    !Number.isInteger(candidate.port) ||
    (candidate.port as number) < 1 ||
    (candidate.port as number) > 65_535 ||
    candidate.protocol !== "tcp"
  ) {
    return null
  }
  return {
    address: normalizeAddress(candidate.address),
    host: candidate.host,
    port: candidate.port as number,
    protocol: "tcp",
  }
}

function hasGrant(grants: readonly PrivateNetworkGrant[], scope: PrivateNetworkScope): boolean {
  return grants.some(
    (grant) =>
      normalizeAddress(grant.address) === scope.address && (grant.port === undefined || grant.port === scope.port),
  )
}

function writeJson(response: import("node:http").ServerResponse, body: unknown): void {
  response.writeHead(200, { "Content-Type": "application/json" })
  response.end(JSON.stringify(body))
}
