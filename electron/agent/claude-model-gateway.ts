import type { WantaReasoningLevel } from "./reasoning.ts"
import type { JSONValue, ModelMessage, ToolSet } from "ai"
import type { LanguageModel } from "ai"
import type { IncomingMessage, Server, ServerResponse } from "node:http"

import { createOpenAI } from "@ai-sdk/openai"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { jsonSchema, streamText, tool } from "ai"
import { randomBytes, randomUUID } from "node:crypto"
import { createServer } from "node:http"
import { errorMessage, logDiagnostic } from "../diagnostics-log.ts"

export type ClaudeGatewayProviderKind = "openai-compatible" | "openai-responses"

/** A credential-bearing route. It never leaves Electron main. */
export interface ClaudeModelRoute {
  apiKey: string
  baseUrl: string
  contextWindow?: number
  displayName: string
  maxOutputTokens?: number
  modelId: string
  providerKind: ClaudeGatewayProviderKind
  reasoningLevel?: WantaReasoningLevel
  reasoningStyle?: "effort" | "qwen-thinking"
}

export interface ClaudeModelGatewayDescriptor {
  /** Anthropic-compatible API root injected into one Claude Code session. */
  baseUrl: string
  /** Opaque, session-scoped loopback credential. */
  token: string
  /** Stable alias seen by Claude Code; the actual upstream model stays host-owned. */
  model: string
}

interface GatewayLease {
  route: ClaudeModelRoute
  sessionId: string
  token: string
}

interface AnthropicMessageRequest {
  max_tokens?: number
  messages: AnthropicMessage[]
  model?: string
  stop_sequences?: string[]
  stream?: boolean
  system?: string | AnthropicTextBlock[]
  temperature?: number
  tools?: AnthropicTool[]
  top_p?: number
}

interface AnthropicMessage {
  content: string | AnthropicContentBlock[]
  role: "assistant" | "user"
}

interface AnthropicTextBlock {
  text: string
  type: "text"
}

type AnthropicContentBlock =
  | AnthropicTextBlock
  | { type: "image"; source: { type: "base64"; data: string; media_type: string } | { type: "url"; url: string } }
  | { type: "thinking"; thinking?: string; signature?: string }
  | { type: "redacted_thinking"; data?: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content?: string | AnthropicContentBlock[]; is_error?: boolean }

interface AnthropicTool {
  description?: string
  input_schema?: Record<string, unknown>
  name: string
}

interface AnthropicUsage {
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
  input_tokens: number
  output_tokens: number
}

const CLAUDE_GATEWAY_MODEL_ALIAS = "wanta-selected-model"
const MAX_REQUEST_BYTES = 32 * 1024 * 1024

/**
 * Authenticated loopback adapter from Claude Code's Anthropic Messages API to
 * the model route selected in Wanta. The opaque lease is mutable, so changing
 * the Wanta model between turns does not require a new Claude native session.
 */
export class ClaudeModelGateway {
  private connectionValue: { baseUrl: string } | null = null
  private disposed = false
  private readonly leaseBySessionId = new Map<string, GatewayLease>()
  private readonly leaseByToken = new Map<string, GatewayLease>()
  private readonly server: Server
  private startPromise: Promise<{ baseUrl: string }> | null = null

  public constructor() {
    this.server = createServer((request, response) => {
      void this.handle(request, response).catch((error: unknown) => {
        logDiagnostic("claude-model-gateway", "request failed", { error: errorMessage(error) }, "error")
        respondAnthropicError(response, 500, "api_error", errorMessage(error))
      })
    })
  }

  public async issue(sessionId: string, route: ClaudeModelRoute): Promise<ClaudeModelGatewayDescriptor> {
    if (this.disposed) throw new Error("Claude model gateway has been disposed.")
    const connection = await this.connection()
    const existing = this.leaseBySessionId.get(sessionId)
    if (existing) {
      existing.route = route
      return { baseUrl: connection.baseUrl, token: existing.token, model: CLAUDE_GATEWAY_MODEL_ALIAS }
    }
    const lease: GatewayLease = { route, sessionId, token: randomBytes(32).toString("base64url") }
    this.leaseBySessionId.set(sessionId, lease)
    this.leaseByToken.set(lease.token, lease)
    return { baseUrl: connection.baseUrl, token: lease.token, model: CLAUDE_GATEWAY_MODEL_ALIAS }
  }

  public update(sessionId: string, route: ClaudeModelRoute): void {
    const lease = this.leaseBySessionId.get(sessionId)
    if (!lease) throw new Error("Claude model route has not been issued for this session.")
    lease.route = route
  }

  public revokeSession(sessionId: string): void {
    const lease = this.leaseBySessionId.get(sessionId)
    if (!lease) return
    this.leaseBySessionId.delete(sessionId)
    this.leaseByToken.delete(lease.token)
  }

  public async dispose(): Promise<void> {
    this.disposed = true
    this.leaseBySessionId.clear()
    this.leaseByToken.clear()
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
          reject(new Error("Claude model gateway did not expose a loopback port."))
          return
        }
        this.connectionValue = { baseUrl: `http://127.0.0.1:${address.port}` }
        resolve(this.connectionValue)
      })
    })
    return this.startPromise
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const token = requestToken(request)
    const lease = token ? this.leaseByToken.get(token) : undefined
    if (!lease) {
      respondAnthropicError(response, 401, "authentication_error", "Invalid Wanta model route.")
      return
    }
    const pathname = request.url ? new URL(request.url, "http://127.0.0.1").pathname : ""
    if (request.method === "POST" && pathname === "/v1/messages/count_tokens") {
      const body = await readJsonBody(request)
      respondJson(response, 200, { input_tokens: estimateInputTokens(body) })
      return
    }
    if (request.method === "GET" && pathname === "/v1/models") {
      respondJson(response, 200, {
        data: [
          {
            id: CLAUDE_GATEWAY_MODEL_ALIAS,
            created_at: new Date().toISOString(),
            display_name: lease.route.displayName,
            type: "model",
          },
        ],
        first_id: CLAUDE_GATEWAY_MODEL_ALIAS,
        has_more: false,
        last_id: CLAUDE_GATEWAY_MODEL_ALIAS,
      })
      return
    }
    if (request.method !== "POST" || pathname !== "/v1/messages") {
      respondAnthropicError(response, 404, "not_found_error", "Not found.")
      return
    }
    const body = asMessageRequest(await readJsonBody(request))
    logDiagnostic(
      "claude-model-gateway",
      "request routed",
      {
        modelId: lease.route.modelId,
        providerKind: lease.route.providerKind,
        sessionId: lease.sessionId,
        stream: body.stream !== false,
      },
      "trace",
    )
    await this.complete(response, lease.route, body)
  }

  private async complete(
    response: ServerResponse,
    route: ClaudeModelRoute,
    request: AnthropicMessageRequest,
  ): Promise<void> {
    const controller = new AbortController()
    response.once("close", () => {
      if (!response.writableEnded) controller.abort()
    })
    const model = createLanguageModel(route)
    const tools = createTools(request.tools ?? [])
    const result = streamText({
      model,
      messages: toModelMessages(request),
      allowSystemInMessages: true,
      ...(Object.keys(tools).length > 0 ? { tools } : {}),
      abortSignal: controller.signal,
      maxOutputTokens: boundedMaxOutputTokens(request.max_tokens, route.maxOutputTokens),
      maxRetries: 1,
      ...(request.stop_sequences?.length ? { stopSequences: request.stop_sequences } : {}),
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      ...(request.top_p !== undefined ? { topP: request.top_p } : {}),
      providerOptions: reasoningProviderOptions(route),
    })
    if (request.stream === false) {
      const events = await collectCompletion(result.fullStream)
      respondJson(response, 200, completionResponse(route, events))
      return
    }
    await streamCompletion(response, route, result.fullStream)
  }
}

function createLanguageModel(route: ClaudeModelRoute): LanguageModel {
  if (route.providerKind === "openai-responses") {
    return createOpenAI({ apiKey: route.apiKey, baseURL: route.baseUrl, name: "wanta" }).responses(route.modelId)
  }
  return createOpenAICompatible({
    apiKey: route.apiKey,
    baseURL: route.baseUrl,
    includeUsage: true,
    name: "wanta",
    ...(route.reasoningStyle === "qwen-thinking" && route.reasoningLevel !== undefined
      ? {
          transformRequestBody: (body: Record<string, unknown>) => ({
            ...body,
            enable_thinking: route.reasoningLevel !== "low",
          }),
        }
      : {}),
  }).languageModel(route.modelId)
}

function reasoningProviderOptions(
  route: ClaudeModelRoute,
): Record<string, Record<string, JSONValue | undefined>> | undefined {
  const level = route.reasoningLevel
  if (!level || level === "default" || route.reasoningStyle === "qwen-thinking") return undefined
  const effort = level === "max" && route.providerKind === "openai-responses" ? "xhigh" : level
  return { [route.providerKind === "openai-responses" ? "openai" : "wanta"]: { reasoningEffort: effort } }
}

function boundedMaxOutputTokens(requested: number | undefined, configured: number | undefined): number {
  const requestValue = positiveInteger(requested) ?? 8_192
  return configured ? Math.min(requestValue, configured) : requestValue
}

function positiveInteger(value: number | undefined): number | undefined {
  return Number.isSafeInteger(value) && (value ?? 0) > 0 ? value : undefined
}

function createTools(definitions: readonly AnthropicTool[]): ToolSet {
  return Object.fromEntries(
    definitions.map((definition) => [
      definition.name,
      tool({
        description: definition.description,
        inputSchema: jsonSchema(definition.input_schema ?? { type: "object", properties: {} }),
      }),
    ]),
  )
}

function toModelMessages(request: AnthropicMessageRequest): ModelMessage[] {
  const messages: ModelMessage[] = []
  const system = systemText(request.system)
  if (system) messages.push({ role: "system", content: system })
  const toolNames = new Map<string, string>()
  for (const message of request.messages) {
    const blocks: AnthropicContentBlock[] =
      typeof message.content === "string" ? [{ type: "text", text: message.content }] : message.content
    if (message.role === "assistant") {
      const content: Array<
        { type: "text"; text: string } | { type: "tool-call"; toolCallId: string; toolName: string; input: unknown }
      > = []
      for (const block of blocks) {
        if (block.type === "text") content.push({ type: "text", text: block.text })
        // Anthropic thinking signatures are provider-specific and cannot be
        // replayed safely to another model family. The visible answer and tool
        // call remain the portable conversation state.
        if (block.type === "tool_use") {
          toolNames.set(block.id, block.name)
          content.push({ type: "tool-call", toolCallId: block.id, toolName: block.name, input: block.input })
        }
      }
      if (content.length > 0) messages.push({ role: "assistant", content })
      continue
    }
    const toolResults = blocks.filter(
      (block): block is Extract<AnthropicContentBlock, { type: "tool_result" }> => block.type === "tool_result",
    )
    if (toolResults.length > 0) {
      messages.push({
        role: "tool",
        content: toolResults.map((block) => ({
          type: "tool-result",
          toolCallId: block.tool_use_id,
          toolName: toolNames.get(block.tool_use_id) ?? "unknown_tool",
          output: block.is_error
            ? { type: "error-text", value: toolResultText(block.content) }
            : { type: "text", value: toolResultText(block.content) },
        })),
      })
    }
    const content: Array<{ type: "text"; text: string } | { type: "image"; image: string | URL; mediaType?: string }> =
      []
    for (const block of blocks) {
      if (block.type === "text") content.push({ type: "text", text: block.text })
      if (block.type === "image") {
        if (block.source.type === "url") content.push({ type: "image", image: new URL(block.source.url) })
        else content.push({ type: "image", image: block.source.data, mediaType: block.source.media_type })
      }
    }
    if (content.length > 0) messages.push({ role: "user", content })
  }
  return messages
}

function systemText(system: AnthropicMessageRequest["system"]): string {
  if (typeof system === "string") return system
  return (system ?? [])
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n\n")
}

function toolResultText(content: string | AnthropicContentBlock[] | undefined): string {
  if (typeof content === "string") return content
  if (!content) return ""
  return content
    .map((block) => {
      if (block.type === "text") return block.text
      if (block.type === "image") return "[image]"
      return JSON.stringify(block)
    })
    .join("\n")
}

interface CompletionEvents {
  blocks: Array<
    | { type: "text"; text: string }
    | { type: "thinking"; thinking: string; signature: string }
    | { type: "tool_use"; id: string; name: string; input: unknown }
  >
  finishReason: string
  usage: AnthropicUsage
}

async function collectCompletion(stream: AsyncIterable<unknown>): Promise<CompletionEvents> {
  const state = emptyCompletionEvents()
  for await (const rawPart of stream) applyStreamPart(state, rawPart as StreamPart)
  return state
}

async function streamCompletion(
  response: ServerResponse,
  route: ClaudeModelRoute,
  stream: AsyncIterable<unknown>,
): Promise<void> {
  response.writeHead(200, {
    "cache-control": "no-cache, no-store",
    connection: "keep-alive",
    "content-type": "text/event-stream; charset=utf-8",
  })
  const messageId = `msg_${randomUUID().replaceAll("-", "")}`
  writeSse(response, "message_start", {
    type: "message_start",
    message: {
      id: messageId,
      type: "message",
      role: "assistant",
      content: [],
      model: route.modelId,
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    },
  })
  const state = emptyCompletionEvents()
  const streamingBlocks: StreamingBlocks = { emittedToolIds: new Set(), nextIndex: 0, open: new Map() }
  try {
    for await (const rawPart of stream) {
      const part = rawPart as StreamPart
      streamPartAsAnthropic(response, state, streamingBlocks, part)
      applyStreamPart(state, part)
    }
    for (const block of [...streamingBlocks.open.values()].sort((a, b) => a.index - b.index)) {
      if (block.kind === "thinking") {
        writeSse(response, "content_block_delta", {
          type: "content_block_delta",
          index: block.index,
          delta: { type: "signature_delta", signature: "wanta-model-gateway" },
        })
      }
      writeSse(response, "content_block_stop", { type: "content_block_stop", index: block.index })
    }
    writeSse(response, "message_delta", {
      type: "message_delta",
      delta: { stop_reason: anthropicStopReason(state.finishReason), stop_sequence: null },
      usage: state.usage,
    })
    writeSse(response, "message_stop", { type: "message_stop" })
    response.end()
  } catch (error) {
    writeSse(response, "error", {
      type: "error",
      error: { type: "api_error", message: errorMessage(error) },
    })
    response.end()
  }
}

type StreamPart =
  | { type: "text-start" | "text-end" | "reasoning-start" | "reasoning-end" | "tool-input-end"; id: string }
  | { type: "text-delta" | "reasoning-delta"; id: string; text: string }
  | { type: "tool-input-start"; id: string; toolName: string }
  | { type: "tool-input-delta"; id: string; delta: string }
  | { type: "tool-call"; toolCallId: string; toolName: string; input: unknown }
  | {
      type: "finish"
      finishReason: string
      totalUsage: {
        inputTokens?: number
        outputTokens?: number
        inputTokenDetails?: { cacheReadTokens?: number; cacheWriteTokens?: number }
      }
    }
  | { type: "error"; error: unknown }

function emptyCompletionEvents(): CompletionEvents {
  return { blocks: [], finishReason: "stop", usage: { input_tokens: 0, output_tokens: 0 } }
}

function applyStreamPart(state: CompletionEvents, part: StreamPart): void {
  if (part.type === "text-delta") appendBlockText(state, "text", part.text)
  if (part.type === "reasoning-delta") appendBlockText(state, "thinking", part.text)
  if (part.type === "tool-call") {
    const existing = state.blocks.find((block) => block.type === "tool_use" && block.id === part.toolCallId)
    if (!existing) state.blocks.push({ type: "tool_use", id: part.toolCallId, name: part.toolName, input: part.input })
  }
  if (part.type === "finish") {
    state.finishReason = part.finishReason
    state.usage = usageFromAiSdk(part.totalUsage)
  }
  if (part.type === "error") throw part.error
}

function appendBlockText(state: CompletionEvents, type: "text" | "thinking", delta: string): void {
  const last = state.blocks.at(-1)
  if (type === "text") {
    if (last?.type === "text") last.text += delta
    else state.blocks.push({ type: "text", text: delta })
    return
  }
  if (last?.type === "thinking") last.thinking += delta
  else state.blocks.push({ type: "thinking", thinking: delta, signature: "wanta-model-gateway" })
}

function streamPartAsAnthropic(
  response: ServerResponse,
  state: CompletionEvents,
  blocks: StreamingBlocks,
  part: StreamPart,
): void {
  if (part.type === "text-start") openContentBlock(response, blocks, part.id, "text", { type: "text", text: "" })
  if (part.type === "reasoning-start")
    openContentBlock(response, blocks, part.id, "thinking", { type: "thinking", thinking: "", signature: "" })
  if (part.type === "tool-input-start")
    openContentBlock(response, blocks, part.id, "tool", {
      type: "tool_use",
      id: part.id,
      name: part.toolName,
      input: {},
    })
  if (part.type === "text-delta")
    writeBlockDelta(response, blocks.open, part.id, { type: "text_delta", text: part.text })
  if (part.type === "reasoning-delta")
    writeBlockDelta(response, blocks.open, part.id, { type: "thinking_delta", thinking: part.text })
  if (part.type === "tool-input-delta")
    writeBlockDelta(response, blocks.open, part.id, { type: "input_json_delta", partial_json: part.delta })
  if (part.type === "text-end" || part.type === "reasoning-end" || part.type === "tool-input-end")
    closeContentBlock(response, blocks.open, part.id)
  if (
    part.type === "tool-call" &&
    !blocks.emittedToolIds.has(part.toolCallId) &&
    !state.blocks.some((block) => block.type === "tool_use" && block.id === part.toolCallId)
  ) {
    const index = blocks.nextIndex++
    blocks.emittedToolIds.add(part.toolCallId)
    writeSse(response, "content_block_start", {
      type: "content_block_start",
      index,
      content_block: { type: "tool_use", id: part.toolCallId, name: part.toolName, input: {} },
    })
    writeSse(response, "content_block_delta", {
      type: "content_block_delta",
      index,
      delta: { type: "input_json_delta", partial_json: JSON.stringify(part.input) },
    })
    writeSse(response, "content_block_stop", { type: "content_block_stop", index })
  }
}

function openContentBlock(
  response: ServerResponse,
  blocks: StreamingBlocks,
  id: string,
  kind: "text" | "thinking" | "tool",
  contentBlock: unknown,
): void {
  if (blocks.open.has(id)) return
  const index = blocks.nextIndex++
  blocks.open.set(id, { index, kind })
  if (kind === "tool") blocks.emittedToolIds.add(id)
  writeSse(response, "content_block_start", { type: "content_block_start", index, content_block: contentBlock })
}

function writeBlockDelta(
  response: ServerResponse,
  openBlocks: Map<string, { index: number }>,
  id: string,
  delta: unknown,
): void {
  const block = openBlocks.get(id)
  if (!block) return
  writeSse(response, "content_block_delta", { type: "content_block_delta", index: block.index, delta })
}

function closeContentBlock(
  response: ServerResponse,
  openBlocks: Map<string, { index: number; kind: "text" | "thinking" | "tool" }>,
  id: string,
): void {
  const block = openBlocks.get(id)
  if (!block) return
  if (block.kind === "thinking")
    writeBlockDelta(response, openBlocks, id, { type: "signature_delta", signature: "wanta-model-gateway" })
  writeSse(response, "content_block_stop", { type: "content_block_stop", index: block.index })
  openBlocks.delete(id)
}

interface StreamingBlocks {
  emittedToolIds: Set<string>
  nextIndex: number
  open: Map<string, { index: number; kind: "text" | "thinking" | "tool" }>
}

function completionResponse(route: ClaudeModelRoute, events: CompletionEvents): unknown {
  return {
    id: `msg_${randomUUID().replaceAll("-", "")}`,
    type: "message",
    role: "assistant",
    content: events.blocks,
    model: route.modelId,
    stop_reason: anthropicStopReason(events.finishReason),
    stop_sequence: null,
    usage: events.usage,
  }
}

function anthropicStopReason(reason: string): "end_turn" | "max_tokens" | "stop_sequence" | "tool_use" {
  if (reason === "length") return "max_tokens"
  if (reason === "tool-calls") return "tool_use"
  return reason === "stop" ? "end_turn" : "stop_sequence"
}

function usageFromAiSdk(usage: {
  inputTokens?: number
  outputTokens?: number
  inputTokenDetails?: { cacheReadTokens?: number; cacheWriteTokens?: number }
}): AnthropicUsage {
  return {
    input_tokens: usage.inputTokens ?? 0,
    output_tokens: usage.outputTokens ?? 0,
    ...(usage.inputTokenDetails?.cacheReadTokens
      ? { cache_read_input_tokens: usage.inputTokenDetails.cacheReadTokens }
      : {}),
    ...(usage.inputTokenDetails?.cacheWriteTokens
      ? { cache_creation_input_tokens: usage.inputTokenDetails.cacheWriteTokens }
      : {}),
  }
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_REQUEST_BYTES) throw new Error("Claude model request is too large.")
    chunks.push(buffer)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown
  } catch {
    throw new Error("Claude model request is not valid JSON.")
  }
}

function asMessageRequest(value: unknown): AnthropicMessageRequest {
  if (!value || typeof value !== "object") throw new Error("Claude model request must be an object.")
  const request = value as Partial<AnthropicMessageRequest>
  if (!Array.isArray(request.messages)) throw new Error("Claude model request is missing messages.")
  return request as AnthropicMessageRequest
}

function estimateInputTokens(value: unknown): number {
  const serialized = JSON.stringify(value)
  return Math.max(1, Math.ceil(serialized.length / 4))
}

function requestToken(request: IncomingMessage): string | undefined {
  const bearer = request.headers.authorization?.match(/^Bearer\s+([^\s]+)$/u)?.[1]
  if (bearer) return bearer
  const apiKey = request.headers["x-api-key"]
  return Array.isArray(apiKey) ? apiKey[0] : apiKey
}

function writeSse(response: ServerResponse, event: string, data: unknown): void {
  if (!response.destroyed && !response.writableEnded)
    response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

function respondAnthropicError(
  response: ServerResponse,
  status: number,
  type: "api_error" | "authentication_error" | "not_found_error",
  message: string,
): void {
  respondJson(response, status, { type: "error", error: { type, message } })
}

function respondJson(response: ServerResponse, status: number, body: unknown): void {
  if (response.destroyed || response.writableEnded) return
  if (!response.headersSent)
    response.writeHead(status, { "cache-control": "no-store", "content-type": "application/json" })
  response.end(JSON.stringify(body))
}
