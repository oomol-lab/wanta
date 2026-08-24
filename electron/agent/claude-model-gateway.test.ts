import type { AddressInfo } from "node:net"

import assert from "node:assert/strict"
import { createServer } from "node:http"
import { afterEach, test } from "vitest"
import { ClaudeModelGateway } from "./claude-model-gateway.ts"

const disposers: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.allSettled(disposers.splice(0).map((dispose) => dispose()))
})

test("serves authenticated Anthropic streaming and token-count endpoints", async () => {
  const upstream = await mockOpenAiUpstream()
  const gateway = new ClaudeModelGateway()
  disposers.push(() => gateway.dispose(), upstream.dispose)
  const descriptor = await gateway.issue("session-a", route(upstream.baseUrl, "model-a"))

  const unauthorized = await fetch(`${descriptor.baseUrl}/v1/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages: [], max_tokens: 10 }),
  })
  assert.equal(unauthorized.status, 401)

  const count = await fetch(`${descriptor.baseUrl}/v1/messages/count_tokens`, {
    method: "POST",
    headers: authHeaders(descriptor.token),
    body: JSON.stringify({ messages: [{ role: "user", content: "hello" }] }),
  })
  assert.equal(count.status, 200)
  assert.ok(((await count.json()) as { input_tokens: number }).input_tokens > 0)

  const response = await fetch(`${descriptor.baseUrl}/v1/messages`, {
    method: "POST",
    headers: authHeaders(descriptor.token),
    body: JSON.stringify({
      model: descriptor.model,
      max_tokens: 100,
      stream: true,
      system: [{ type: "text", text: "Be concise." }],
      messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
    }),
  })
  assert.equal(response.status, 200)
  const body = await response.text()
  assert.match(body, /event: message_start/u)
  assert.match(body, /"type":"text_delta","text":"hello from upstream"/u)
  assert.match(body, /"stop_reason":"end_turn"/u)
  assert.match(body, /event: message_stop/u)
  assert.equal(upstream.requests.length, 1)
  assert.equal(upstream.requests[0]?.model, "model-a")
  assert.equal(upstream.requests[0]?.messages?.[0]?.role, "system")
})

test("updates one Claude session to the newly selected Wanta model without changing its token", async () => {
  const upstream = await mockOpenAiUpstream()
  const gateway = new ClaudeModelGateway()
  disposers.push(() => gateway.dispose(), upstream.dispose)
  const first = await gateway.issue("session-a", route(upstream.baseUrl, "model-a"))
  const second = await gateway.issue("session-a", route(upstream.baseUrl, "model-b"))
  assert.equal(second.token, first.token)

  const response = await fetch(`${second.baseUrl}/v1/messages`, {
    method: "POST",
    headers: authHeaders(second.token),
    body: JSON.stringify({
      model: second.model,
      max_tokens: 100,
      stream: false,
      messages: [
        {
          role: "assistant",
          content: [{ type: "tool_use", id: "tool-1", name: "read_file", input: { path: "README.md" } }],
        },
        {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "tool-1", content: "file body" }],
        },
      ],
    }),
  })
  assert.equal(response.status, 200)
  const body = (await response.json()) as { content: Array<{ text?: string }>; model: string; usage: unknown }
  assert.equal(body.model, "model-b")
  assert.equal(body.content[0]?.text, "hello from upstream")
  assert.ok(body.usage)
  assert.equal(upstream.requests[0]?.model, "model-b")
  assert.equal(upstream.requests[0]?.messages?.[0]?.role, "assistant")
  assert.equal(upstream.requests[0]?.messages?.[1]?.role, "tool")

  gateway.revokeSession("session-a")
  const revoked = await fetch(`${second.baseUrl}/v1/messages/count_tokens`, {
    method: "POST",
    headers: authHeaders(second.token),
    body: JSON.stringify({ messages: [] }),
  })
  assert.equal(revoked.status, 401)
})

function route(baseUrl: string, modelId: string) {
  return {
    apiKey: "upstream-secret",
    baseUrl,
    displayName: modelId,
    modelId,
    providerKind: "openai-compatible" as const,
    reasoningLevel: "low" as const,
  }
}

function authHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, "content-type": "application/json" }
}

async function mockOpenAiUpstream(): Promise<{
  baseUrl: string
  dispose: () => Promise<void>
  requests: Array<{ messages?: Array<{ role?: string }>; model?: string }>
}> {
  const requests: Array<{ messages?: Array<{ role?: string }>; model?: string }> = []
  const server = createServer((request, response) => {
    void (async () => {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      requests.push(JSON.parse(Buffer.concat(chunks).toString("utf8")) as (typeof requests)[number])
      response.writeHead(200, { "content-type": "text/event-stream" })
      response.write(
        `data: ${JSON.stringify({
          id: "chatcmpl-1",
          object: "chat.completion.chunk",
          created: 1,
          model: "mock",
          choices: [{ index: 0, delta: { role: "assistant", content: "hello from upstream" }, finish_reason: null }],
        })}\n\n`,
      )
      response.write(
        `data: ${JSON.stringify({
          id: "chatcmpl-1",
          object: "chat.completion.chunk",
          created: 1,
          model: "mock",
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 },
        })}\n\n`,
      )
      response.end("data: [DONE]\n\n")
    })()
  })
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject)
      resolve()
    })
  })
  const address = server.address() as AddressInfo
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    requests,
    dispose: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
        server.closeAllConnections()
      }),
  }
}
