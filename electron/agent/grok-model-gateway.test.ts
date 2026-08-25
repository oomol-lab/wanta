import type { AddressInfo } from "node:net"

import assert from "node:assert/strict"
import { createServer } from "node:http"
import { afterEach, test } from "vitest"
import { GrokModelGateway } from "./grok-model-gateway.ts"

const disposers: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.allSettled(disposers.splice(0).map((dispose) => dispose()))
})

test("serves authenticated OpenAI-compatible model and chat endpoints", async () => {
  const upstream = await mockOpenAiUpstream()
  const gateway = new GrokModelGateway()
  disposers.push(() => gateway.dispose(), upstream.dispose)
  gateway.prepare("session-a", route(upstream.baseUrl, "model-a"))
  const descriptor = await gateway.descriptor()

  const unauthorized = await fetch(`${descriptor.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages: [] }),
  })
  assert.equal(unauthorized.status, 401)

  const models = await fetch(`${descriptor.baseUrl}/models`, { headers: authHeaders(descriptor.token) })
  assert.equal(models.status, 200)
  assert.deepEqual(
    ((await models.json()) as { data: Array<{ id: string }> }).data.map((item) => item.id),
    [descriptor.model],
  )

  const response = await fetch(`${descriptor.baseUrl}/chat/completions`, {
    method: "POST",
    headers: authHeaders(descriptor.token),
    body: JSON.stringify({
      model: descriptor.model,
      stream: true,
      messages: [{ role: "user", content: "hello" }],
    }),
  })
  assert.equal(response.status, 200)
  const body = await response.text()
  assert.match(body, /"content":"hello from upstream"/u)
  assert.match(body, /"finish_reason":"stop"/u)
  assert.match(body, /data: \[DONE\]/u)
  assert.equal(upstream.requests[0]?.model, "model-a")
})

test("routes the next serialized Grok turn through the newly selected Wanta model", async () => {
  const upstream = await mockOpenAiUpstream()
  const gateway = new GrokModelGateway()
  disposers.push(() => gateway.dispose(), upstream.dispose)
  const descriptor = await gateway.descriptor()
  gateway.prepare("session-a", route(upstream.baseUrl, "model-a"))
  gateway.prepare("session-b", route(upstream.baseUrl, "model-b"))

  const response = await fetch(`${descriptor.baseUrl}/chat/completions`, {
    method: "POST",
    headers: authHeaders(descriptor.token),
    body: JSON.stringify({ model: descriptor.model, stream: true, messages: [{ role: "user", content: "hello" }] }),
  })
  assert.equal(response.status, 200)
  await response.text()
  assert.equal(upstream.requests[0]?.model, "model-b")

  gateway.revokeSession("session-b")
  const unavailable = await fetch(`${descriptor.baseUrl}/chat/completions`, {
    method: "POST",
    headers: authHeaders(descriptor.token),
    body: JSON.stringify({ model: descriptor.model, messages: [] }),
  })
  assert.equal(unavailable.status, 409)
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
