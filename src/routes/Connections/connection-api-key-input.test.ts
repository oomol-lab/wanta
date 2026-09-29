import { describe, expect, it } from "vitest"
import { normalizeApiKeyInput } from "./connection-api-key-input.ts"

describe("normalizeApiKeyInput", () => {
  const config = JSON.stringify(
    {
      mcpServers: {
        "xydc-mcp": {
          url: "https://mcp.xydc.com/mcp",
          headers: { Authorization: "Bearer mcp_92e5test" },
        },
      },
    },
    null,
    2,
  )

  it.each([
    [config, "mcp_92e5test"],
    ["https://mcp.xydc.com/mcp?mcp_token=mcp_92e51a343dctest", "mcp_92e51a343dctest"],
    ["https://mcp.xydc.com/mcp?mcp_token=mcp_test&other=value#fragment", "mcp_test"],
    ["https://mcp.xydc.com/mcp?mcp_token=mcp%5Ftest", "mcp_test"],
    ["  mcp_test-123_abc\n", "mcp_test-123_abc"],
    ["Bearer mcp_test", "mcp_test"],
    ["mcp_test", "mcp_test"],
  ])("extracts the complete token from %s", (input, expected) => {
    expect(normalizeApiKeyInput("xydc_mcp", input)).toBe(expected)
  })

  it.each([
    "",
    "mcp_",
    "unrecognized input",
    '{"mcpServers":',
    "null",
    '{"mcpServers":{"xydc-mcp":{"headers":{"Authorization":123}}}}',
    "https://mcp.xydc.com/mcp?other=mcp_test",
    "https://example.com/mcp?mcp_token=mcp_test",
    "https://mcp.xydc.com/mcp?mcp_token=mcp_test.invalid",
  ])("preserves unrecognized input: %s", (input) => {
    expect(normalizeApiKeyInput("xydc_mcp", input)).toBe(input)
  })

  it("leaves other providers unchanged", () => {
    expect(normalizeApiKeyInput("other", config)).toBe(config)
    expect(normalizeApiKeyInput("other", " Bearer mcp_test ")).toBe(" Bearer mcp_test ")
  })

  describe("Investoday MCP", () => {
    it.each([
      ["https://data-api.investoday.net/data/mcp?apiKey=test", "test"],
      ["https://data-api.investoday.net/data/mcp?apiKey=test%2Fkey", "test/key"],
      [" https://data-api.investoday.net/data/mcp?other=value&apiKey=test#fragment ", "test"],
    ])("extracts the API key from the official URL: %s", (input, expected) => {
      expect(normalizeApiKeyInput("investoday_mcp", input)).toBe(expected)
    })

    it.each([
      "test",
      "",
      "https://data-api.investoday.net/data/mcp?apiKey=",
      "https://data-api.investoday.net/data/mcp?other=test",
      "https://data-api.investoday.net/other?apiKey=test",
      "https://example.com/data/mcp?apiKey=test",
    ])("preserves raw keys and unrecognized URLs: %s", (input) => {
      expect(normalizeApiKeyInput("investoday_mcp", input)).toBe(input)
    })

    it("does not extract an Investoday key for another provider", () => {
      const input = "https://data-api.investoday.net/data/mcp?apiKey=test"
      expect(normalizeApiKeyInput("other", input)).toBe(input)
    })
  })
})
