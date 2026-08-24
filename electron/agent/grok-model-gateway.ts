import type { ClaudeModelRoute } from "./claude-model-gateway.ts"
import type { ModelMessage, ToolSet } from "ai"
import type { IncomingMessage, Server, ServerResponse } from "node:http"

import { jsonSchema, streamText, tool } from "ai"
import { randomBytes, randomUUID } from "node:crypto"
import { createServer } from "node:http"
import { errorMessage, logDiagnostic } from "../diagnostics-log.ts"
import { boundedMaxOutputTokens, createLanguageModel, reasoningProviderOptions } from "./claude-model-gateway.ts"

const GROK_GATEWAY_MODEL_ALIAS = "wanta-selected-model"
const MAX_REQUEST_BYTES = 32 * 1024 * 1024

export interface GrokModelGatewayDescriptor {
  baseUrl: string
  model: string
  token: string
}

interface GrokGatewayRoute {
  route: ClaudeModelRoute
  sessionId: string
}

interface ChatCompletionRequest {
  max_completion_tokens?: number
  max_tokens?: number
  messages: ChatMessage[]
  model?: string
  stop?: string | string[]
  stream?: boolean
  temperature?: number
  tools?: ChatTool[]
  top_p?: number
}

type ChatMessage =
  | { role: "system" | "developer"; content?: unknown }
  | { role: "user"; content?: unknown }
  | { role: "assistant"; content?: unknown; tool_calls?: ChatToolCall[] }
  | { role: "tool"; content?: unknown; tool_call_id?: string }

interface ChatToolCall {
  id?: string
  function?: { arguments?: string; name?: string }
  type?: string
}

interface ChatTool {
  function?: { description?: string; name?: string; parameters?: Record<string, unknown> }
  type?: string
}

/**
 * Process-scoped OpenAI-compatible route used by the Grok ACP harness. Grok
 * receives only an opaque loopback key; selected Wanta credentials stay in
 * Electron main. The adapter serializes Grok turns before updating this route.
 */
export class GrokModelGateway {
  private connectionValue: { baseUrl: string } | null = null
  private currentRoute: GrokGatewayRoute | null = null
  private disposed = false
  private readonly server: Server
  private startPromise: Promise<{ baseUrl: string }> | null = null
  private readonly token = randomBytes(32).toString("base64url")

  public constructor() {
    this.server = createServer((request, response) => {
      void this.handle(request, response).catch((error: unknown) => {
        logDiagnostic("grok-model-gateway", "request failed", { error: errorMessage(error) }, "error")
        respondError(response, 500, errorMessage(error))
      })
    })
  }

  public prepare(sessionId: string, route: ClaudeModelRoute): void {
    if (this.disposed) throw new Error("Grok model gateway has been disposed.")
    this.currentRoute = { route, sessionId }
  }

  public async descriptor(): Promise<GrokModelGatewayDescriptor> {
    if (this.disposed) throw new Error("Grok model gateway has been disposed.")
    const connection = await this.connection()
    return { baseUrl: connection.baseUrl, model: GROK_GATEWAY_MODEL_ALIAS, token: this.token }
  }

  public revokeSession(sessionId: string): void {
    if (this.currentRoute?.sessionId === sessionId) this.currentRoute = null
  }

  public async dispose(): Promise<void> {
    this.disposed = true
    this.currentRoute = null
    if (!this.server.listening) return
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => (error ? reject(error) : resolve()))
      this.server.closeAllConnections()
    })
  }

  private connection(): Promise<{ baseUrl: string }> {
    if (this.connectionValue) return Promise.resolve(this.connectionValue)
    this.startPromise ??= new Promise((resolve, reject) => {
      this.server.once("error", reject)
      this.server.listen(0, "127.0.0.1", () => {
        this.server.off("error", reject)
        const address = this.server.address()
        if (!address || typeof address === "string") {
          reject(new Error("Grok model gateway did not expose a loopback port."))
          return
        }
        this.connectionValue = { baseUrl: `http://127.0.0.1:${address.port}/v1` }
        resolve(this.connectionValue)
      })
    })
    return this.startPromise
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (requestToken(request) !== this.token) {
      respondError(response, 401, "Invalid Wanta model gateway credential.")
      return
    }
    const pathname = request.url ? new URL(request.url, "http://127.0.0.1").pathname : ""
    const active = this.currentRoute
    if (request.method === "GET" && pathname === "/v1/models") {
      respondJson(response, 200, {
        object: "list",
        data: [{ id: GROK_GATEWAY_MODEL_ALIAS, object: "model", created: 0, owned_by: "wanta" }],
      })
      return
    }
    if (request.method === "GET" && pathname === "/v1/api-key") {
      respondJson(response, 200, { api_key: { id: "wanta-loopback", name: "Wanta selected model" } })
      return
    }
    // Grok uses Responses for optional native title generation. Returning 404
    // keeps title generation best-effort while all agent turns use Chat
    // Completions, which Wanta translates across every supported model family.
    if (pathname === "/v1/responses") {
      respondError(response, 404, "Responses endpoint is not used by the Wanta-routed Grok harness.")
      return
    }
    if (request.method !== "POST" || pathname !== "/v1/chat/completions") {
      respondError(response, 404, "Not found.")
      return
    }
    if (!active) {
      respondError(response, 409, "No Wanta model is selected for the current Grok turn.")
      return
    }
    const body = asChatCompletionRequest(await readJsonBody(request))
    logDiagnostic(
      "grok-model-gateway",
      "request routed",
      {
        modelId: active.route.modelId,
        providerKind: active.route.providerKind,
        sessionId: active.sessionId,
        stream: body.stream !== false,
      },
      "trace",
    )
    await this.complete(response, active.route, body)
  }

  private async complete(
    response: ServerResponse,
    route: ClaudeModelRoute,
    request: ChatCompletionRequest,
  ): Promise<void> {
    const controller = new AbortController()
    response.once("close", () => {
      if (!response.writableEnded) controller.abort()
    })
    const tools = createTools(request.tools ?? [])
    const result = streamText({
      model: createLanguageModel(route),
      messages: toModelMessages(request.messages),
      allowSystemInMessages: true,
      ...(Object.keys(tools).length > 0 ? { tools } : {}),
      abortSignal: controller.signal,
      maxOutputTokens: boundedMaxOutputTokens(
        request.max_completion_tokens ?? request.max_tokens,
        route.maxOutputTokens,
      ),
      maxRetries: 1,
      ...(request.stop ? { stopSequences: Array.isArray(request.stop) ? request.stop : [request.stop] } : {}),
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      ...(request.top_p !== undefined ? { topP: request.top_p } : {}),
      providerOptions: reasoningProviderOptions(route),
    })
    await streamChatCompletion(response, route, result.fullStream)
  }
}

function createTools(definitions: readonly ChatTool[]): ToolSet {
  return Object.fromEntries(
    definitions.flatMap((definition) => {
      const fn = definition.type === "function" ? definition.function : undefined
      if (!fn?.name) return []
      return [
        [
          fn.name,
          tool({
            description: fn.description,
            inputSchema: jsonSchema(fn.parameters ?? { type: "object", properties: {} }),
          }),
        ],
      ]
    }),
  )
}

function toModelMessages(messages: readonly ChatMessage[]): ModelMessage[] {
  const result: ModelMessage[] = []
  const toolNames = new Map<string, string>()
  for (const message of messages) {
    if (message.role === "system" || message.role === "developer") {
      const text = contentText(message.content)
      if (text) result.push({ role: "system", content: text })
      continue
    }
    if (message.role === "user") {
      const text = contentText(message.content)
      if (text) result.push({ role: "user", content: text })
      continue
    }
    if (message.role === "assistant") {
      const content: Array<
        { type: "text"; text: string } | { type: "tool-call"; toolCallId: string; toolName: string; input: unknown }
      > = []
      const text = contentText(message.content)
      if (text) content.push({ type: "text", text })
      for (const call of message.tool_calls ?? []) {
        const id = call.id ?? randomUUID()
        const name = call.function?.name ?? "unknown_tool"
        toolNames.set(id, name)
        content.push({
          type: "tool-call",
          toolCallId: id,
          toolName: name,
          input: parseArguments(call.function?.arguments),
        })
      }
      if (content.length > 0) result.push({ role: "assistant", content })
      continue
    }
    const toolMessage = message as Extract<ChatMessage, { role: "tool" }>
    const toolCallId = toolMessage.tool_call_id ?? randomUUID()
    result.push({
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId,
          toolName: toolNames.get(toolCallId) ?? "unknown_tool",
          output: { type: "text", value: contentText(toolMessage.content) },
        },
      ],
    })
  }
  return result
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content
    .map((part) => {
      if (!part || typeof part !== "object") return ""
      const item = part as { type?: unknown; text?: unknown; image_url?: { url?: unknown } }
      if (item.type === "text" && typeof item.text === "string") return item.text
      if (item.type === "image_url" && typeof item.image_url?.url === "string") return `[image: ${item.image_url.url}]`
      return ""
    })
    .filter(Boolean)
    .join("\n")
}

function parseArguments(value: string | undefined): unknown {
  if (!value) return {}
  try {
    return JSON.parse(value) as unknown
  } catch {
    return { value }
  }
}

type GatewayStreamPart =
  | { type: "text-delta" | "reasoning-delta"; id: string; text: string }
  | { type: "tool-input-start"; id: string; toolName: string }
  | { type: "tool-input-delta"; id: string; delta: string }
  | { type: "tool-call"; toolCallId: string; toolName: string; input: unknown }
  | {
      type: "finish"
      finishReason: string
      totalUsage: { inputTokens?: number; outputTokens?: number }
    }
  | { type: "error"; error: unknown }
  | {
      type: "text-start" | "text-end" | "reasoning-start" | "reasoning-end" | "tool-input-end" | "start"
      id?: string
    }

async function streamChatCompletion(
  response: ServerResponse,
  route: ClaudeModelRoute,
  stream: AsyncIterable<unknown>,
): Promise<void> {
  response.writeHead(200, {
    "cache-control": "no-cache, no-store",
    connection: "keep-alive",
    "content-type": "text/event-stream; charset=utf-8",
  })
  const id = `chatcmpl-${randomUUID()}`
  const created = Math.floor(Date.now() / 1000)
  const toolIndexes = new Map<string, number>()
  writeChunk(response, id, created, route.modelId, { role: "assistant" }, null)
  try {
    for await (const raw of stream) {
      const part = raw as GatewayStreamPart
      if (part.type === "text-delta") writeChunk(response, id, created, route.modelId, { content: part.text }, null)
      if (part.type === "reasoning-delta")
        writeChunk(response, id, created, route.modelId, { reasoning_content: part.text }, null)
      if (part.type === "tool-input-start") {
        const index = toolIndexes.size
        toolIndexes.set(part.id, index)
        writeChunk(
          response,
          id,
          created,
          route.modelId,
          { tool_calls: [{ index, id: part.id, type: "function", function: { name: part.toolName, arguments: "" } }] },
          null,
        )
      }
      if (part.type === "tool-input-delta") {
        const index = toolIndexes.get(part.id) ?? 0
        writeChunk(
          response,
          id,
          created,
          route.modelId,
          { tool_calls: [{ index, function: { arguments: part.delta } }] },
          null,
        )
      }
      if (part.type === "tool-call" && !toolIndexes.has(part.toolCallId)) {
        const index = toolIndexes.size
        toolIndexes.set(part.toolCallId, index)
        writeChunk(
          response,
          id,
          created,
          route.modelId,
          {
            tool_calls: [
              {
                index,
                id: part.toolCallId,
                type: "function",
                function: { name: part.toolName, arguments: JSON.stringify(part.input) },
              },
            ],
          },
          null,
        )
      }
      if (part.type === "finish") {
        writeChunk(response, id, created, route.modelId, {}, chatFinishReason(part.finishReason), {
          prompt_tokens: part.totalUsage.inputTokens ?? 0,
          completion_tokens: part.totalUsage.outputTokens ?? 0,
          total_tokens: (part.totalUsage.inputTokens ?? 0) + (part.totalUsage.outputTokens ?? 0),
        })
      }
      if (part.type === "error") throw part.error
    }
    response.end("data: [DONE]\n\n")
  } catch (error) {
    response.write(`data: ${JSON.stringify({ error: { message: errorMessage(error), type: "api_error" } })}\n\n`)
    response.end("data: [DONE]\n\n")
  }
}

function chatFinishReason(reason: string): "stop" | "length" | "tool_calls" {
  if (reason === "length") return "length"
  return reason === "tool-calls" ? "tool_calls" : "stop"
}

function writeChunk(
  response: ServerResponse,
  id: string,
  created: number,
  model: string,
  delta: unknown,
  finishReason: string | null,
  usage?: unknown,
): void {
  if (response.destroyed || response.writableEnded) return
  response.write(
    `data: ${JSON.stringify({
      id,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [{ index: 0, delta, finish_reason: finishReason }],
      ...(usage ? { usage } : {}),
    })}\n\n`,
  )
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_REQUEST_BYTES) throw new Error("Grok model request is too large.")
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown
}

function asChatCompletionRequest(value: unknown): ChatCompletionRequest {
  if (!value || typeof value !== "object") throw new Error("Grok model request must be an object.")
  const request = value as Partial<ChatCompletionRequest>
  if (!Array.isArray(request.messages)) throw new Error("Grok model request is missing messages.")
  return request as ChatCompletionRequest
}

function requestToken(request: IncomingMessage): string | undefined {
  return request.headers.authorization?.match(/^Bearer\s+([^\s]+)$/u)?.[1]
}

function respondError(response: ServerResponse, status: number, message: string): void {
  respondJson(response, status, { error: { message, type: "invalid_request_error" } })
}

function respondJson(response: ServerResponse, status: number, body: unknown): void {
  if (response.destroyed || response.writableEnded) return
  response.writeHead(status, { "cache-control": "no-store", "content-type": "application/json" })
  response.end(JSON.stringify(body))
}
