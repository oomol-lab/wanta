export function normalizeApiKeyInput(service: string, value: string): string {
  if (service === "investoday_mcp") return normalizeInvestodayApiKey(value)
  if (service !== "xydc_mcp") return value

  const text = value.trim()
  const directToken = readToken(text)
  if (directToken) return directToken

  try {
    const url = new URL(text)
    if (url.origin === "https://mcp.xydc.com" && url.pathname === "/mcp") {
      return readToken(url.searchParams.get("mcp_token")) ?? value
    }
  } catch {
    // The other official copy format is an MCP server JSON configuration.
  }

  try {
    const config = JSON.parse(text)
    return readToken(config?.mcpServers?.["xydc-mcp"]?.headers?.Authorization) ?? value
  } catch {
    return value
  }
}

function normalizeInvestodayApiKey(value: string): string {
  try {
    const url = new URL(value.trim())
    if (url.origin === "https://data-api.investoday.net" && url.pathname === "/data/mcp") {
      return readNonEmptyString(url.searchParams.get("apiKey")) ?? value
    }
  } catch {
    // A raw API key should be preserved as entered.
  }

  return value
}

function readNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  return value.trim() || undefined
}

function readToken(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  return /^(?:Bearer\s+)?(mcp_[a-zA-Z0-9_-]+)$/u.exec(value.trim())?.[1]
}
