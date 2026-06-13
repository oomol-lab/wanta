export function createConnectorOAuthReturnUri(consoleBaseUrl: string): string {
  return `${consoleBaseUrl}/app-connections/callback`
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
