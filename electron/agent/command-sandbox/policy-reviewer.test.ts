import { describe, expect, it, vi } from "vitest"
import { reviewPrivateNetworkAccess, validateReviewerResponse } from "./policy-reviewer.ts"

const input = {
  existingScopes: [],
  origin: "main" as const,
  requestedScope: {
    address: "192.168.1.20",
    host: "192.168.1.20",
    port: 443,
    protocol: "tcp" as const,
  },
  userMessage: "访问 192.168.1.20:443 帮我测试一下",
}

describe("private network policy reviewer", () => {
  it("accepts only exact scope and verbatim user evidence", () => {
    expect(
      validateReviewerResponse(
        JSON.stringify({
          decision: "approve",
          evidence: "192.168.1.20:443",
          scope: input.requestedScope,
        }),
        input,
      ),
    ).toEqual({ decision: "approve", evidence: "192.168.1.20:443" })
  })

  it.each([
    "```json\n{}\n```",
    JSON.stringify({ decision: "approve", evidence: "invented", scope: input.requestedScope }),
    JSON.stringify({
      decision: "approve",
      evidence: "192.168.1.20",
      scope: { ...input.requestedScope, port: 80 },
    }),
    JSON.stringify({ decision: "approve", evidence: "192.168.1.20", scope: input.requestedScope, extra: true }),
  ])("fails closed for malformed or widened output", (content) => {
    expect(validateReviewerResponse(content, input)).toEqual({ decision: "ask", evidence: null })
  })

  it("sends only the isolated reviewer input and fails closed on provider errors", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response("", { status: 500 }))
    await expect(
      reviewPrivateNetworkAccess(
        input,
        { apiKey: "key", baseUrl: "https://models.example/v1", modelId: "quick-model" },
        fetchImpl,
      ),
    ).resolves.toEqual({ decision: "ask", evidence: null })
    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)) as {
      messages: Array<{ content: string; role: string }>
    }
    expect(JSON.parse(body.messages[1].content)).toEqual(input)
    expect(body.messages[1].content).not.toContain("command")
  })
})
