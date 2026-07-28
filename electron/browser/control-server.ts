import type { BrowserControlRequest, BrowserManager } from "./node.ts"
import type { IncomingMessage, Server, ServerResponse } from "node:http"

import { randomBytes } from "node:crypto"
import { createServer } from "node:http"

const maxRequestBytes = 128 * 1024

export interface BrowserControlConnection {
  token: string
  url: string
}

export class BrowserControlServer {
  private connectionValue: BrowserControlConnection | null = null
  private readonly browser: BrowserManager
  private readonly server: Server
  private startPromise: Promise<BrowserControlConnection> | null = null
  private readonly token = randomBytes(32).toString("base64url")

  public constructor(browser: BrowserManager) {
    this.browser = browser
    this.server = createServer((request, response) => {
      void this.handle(request, response)
    })
  }

  public connection(): Promise<BrowserControlConnection> {
    if (this.connectionValue) return Promise.resolve(this.connectionValue)
    this.startPromise ??= new Promise<BrowserControlConnection>((resolve, reject) => {
      this.server.once("error", reject)
      this.server.listen(0, "127.0.0.1", () => {
        this.server.off("error", reject)
        const address = this.server.address()
        if (!address || typeof address === "string") {
          reject(new Error("Browser control server did not expose a loopback port."))
          return
        }
        const connection = {
          token: this.token,
          url: `http://127.0.0.1:${address.port}`,
        }
        this.connectionValue = connection
        resolve(connection)
      })
    })
    return this.startPromise
  }

  public async dispose(): Promise<void> {
    if (!this.server.listening) return
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => {
        if (error) reject(error)
        else resolve()
      })
      this.server.closeAllConnections()
    })
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (
      request.method !== "POST" ||
      request.url !== "/v1/browser" ||
      request.headers.authorization !== `Bearer ${this.token}`
    ) {
      respond(response, 404, { error: "Not found." })
      return
    }

    const controller = new AbortController()
    response.once("close", () => {
      if (!response.writableEnded) controller.abort()
    })
    try {
      const body = await readJsonBody(request)
      const input = parseBrowserControlRequest(body)
      const result = await this.browser.execute(input, controller.signal)
      respond(response, 200, { result })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      respond(response, 400, { error: message })
    }
  }
}

export function parseBrowserControlRequest(value: unknown): BrowserControlRequest {
  const body = plainObject(value, "Browser request")
  const action = requiredString(body["action"], "Browser action")
  const sessionId = requiredString(body["sessionId"], "Browser session ID")
  const args = body["args"] === undefined ? {} : plainObject(body["args"], "Browser arguments")

  switch (action) {
    case "navigate":
      return { action, sessionId, url: requiredString(args["url"], "URL") }
    case "read":
      return { action, sessionId, target: optionalString(args["target"]) }
    case "click":
      return { action, sessionId, target: requiredString(args["target"], "Browser target") }
    case "type":
      return {
        action,
        key: optionalString(args["key"]),
        sessionId,
        submit: args["submit"] === true,
        target: requiredString(args["target"], "Browser target"),
        text: optionalString(args["text"], true),
      }
    case "scroll":
      return {
        action,
        deltaY: clampScrollDelta(args["deltaY"]),
        sessionId,
        target: optionalString(args["target"]),
      }
    case "screenshot":
      return { action, fullPage: args["fullPage"] === true, sessionId }
    case "dialog":
      return {
        accept: args["accept"] === true,
        action,
        promptText: optionalString(args["promptText"], true),
        sessionId,
      }
    default:
      throw new Error(`Unsupported browser action: ${action}`)
  }
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > maxRequestBytes) throw new Error("Browser request is too large.")
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"))
}

function plainObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`)
  return value as Record<string, unknown>
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`)
  return value.trim()
}

function optionalString(value: unknown, preserveWhitespace = false): string | undefined {
  if (typeof value !== "string") return undefined
  const normalized = preserveWhitespace ? value : value.trim()
  return normalized || (preserveWhitespace ? "" : undefined)
}

function clampScrollDelta(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 600
  return Math.max(-5_000, Math.min(5_000, Math.round(value)))
}

function respond(response: ServerResponse, status: number, body: unknown): void {
  if (response.destroyed || response.writableEnded) return
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
  })
  response.end(JSON.stringify(body))
}
