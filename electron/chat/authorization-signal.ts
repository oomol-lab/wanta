import type { AuthorizationInfo } from "./common.ts"

function validId(value: string): boolean {
  return value.trim().length > 0
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined
}

export function parseAuthorizationSignal(output: string | undefined): AuthorizationInfo | null {
  if (!output) {
    return null
  }
  try {
    const parsed = JSON.parse(output) as Record<string, unknown>
    const authorizationBlocked =
      parsed.status === "authorization_required" ||
      (parsed.status === "skipped" && parsed.reason === "connection_blocked")
    if (!authorizationBlocked || typeof parsed.service !== "string" || !validId(parsed.service)) {
      return null
    }
    return {
      service: parsed.service,
      displayName: optionalString(parsed.displayName) ?? parsed.service,
      action: optionalString(parsed.action),
      authUrl: optionalString(parsed.authUrl),
      errorCode: optionalString(parsed.errorCode),
      message: optionalString(parsed.message),
    }
  } catch {
    return null
  }
}
