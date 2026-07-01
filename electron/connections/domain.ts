const connectionOAuthCallbackHost = "connections"
const connectionOAuthCallbackPath = "/oauth-callback"

export interface ConnectionOAuthCallback {
  service: string
  status: "success"
}

export function createConnectorOAuthReturnUri(consoleBaseUrl: string, protocolScheme: string): string {
  const url = new URL("/app-connections/callback", consoleBaseUrl)
  url.searchParams.set("protocol", protocolScheme)
  return url.toString()
}

export function parseConnectorAuthorizationUrl(authorizationUrl: string): URL {
  let parsedAuthorizationUrl: URL

  try {
    parsedAuthorizationUrl = new URL(authorizationUrl)
  } catch {
    throw new Error("Connector connect request returned an invalid authorization URL")
  }

  if (parsedAuthorizationUrl.protocol !== "https:") {
    throw new Error("Connector connect request returned an invalid authorization URL")
  }

  return parsedAuthorizationUrl
}

export function parseConnectionOAuthCallback(url: string, protocolScheme: string): ConnectionOAuthCallback | undefined {
  let callbackUrl: URL
  try {
    callbackUrl = new URL(url)
  } catch {
    return undefined
  }

  if (
    callbackUrl.protocol !== `${protocolScheme}:` ||
    callbackUrl.host !== connectionOAuthCallbackHost ||
    callbackUrl.pathname !== connectionOAuthCallbackPath
  ) {
    return undefined
  }

  const status = callbackUrl.searchParams.get("status")
  const service = callbackUrl.searchParams.get("service")
  if (status !== "success" || !service) {
    return undefined
  }

  return { service, status }
}
