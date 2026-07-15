import type { ConnectionSummary, ConnectionWorkspace } from "./common.ts"

export const connectionUsageSummaryDays = 7
const unavailableConnectionWorkspace: ConnectionWorkspace = { organizationName: "unavailable" }

export function createEmptyConnectionUsageSummary(): ConnectionSummary["usage"] {
  return {
    calls: 0,
    days: connectionUsageSummaryDays,
    errors: 0,
    points: [],
    recent: null,
    services: [],
    success: 0,
  }
}

export function createEmptyConnectionSummary(
  status: ConnectionSummary["status"],
  message?: string,
  workspace: ConnectionWorkspace = unavailableConnectionWorkspace,
): ConnectionSummary {
  return {
    status,
    activeConnections: 0,
    apps: [],
    connectedProviderCount: 0,
    connectableProviderCount: 0,
    needsAttention: 0,
    providerCount: 0,
    providers: [],
    usage: createEmptyConnectionUsageSummary(),
    message,
    updatedAt: new Date().toISOString(),
    workspace,
  }
}

export function createUnavailableConnectionSummaryFallback(
  previous: ConnectionSummary,
  message?: string,
): ConnectionSummary {
  return {
    ...previous,
    status: "unavailable",
    message,
    updatedAt: new Date().toISOString(),
  }
}

export function createSupersededConnectionSummaryFallback({
  accountMatches,
  cached,
  message,
  previous,
}: {
  accountMatches: boolean
  cached?: ConnectionSummary
  message?: string
  previous?: ConnectionSummary
}): ConnectionSummary {
  if (!accountMatches) {
    return createEmptyConnectionSummary("signed-out")
  }

  if (cached) {
    return cached
  }

  if (previous) {
    return createUnavailableConnectionSummaryFallback(previous, message)
  }

  return createEmptyConnectionSummary("unavailable", message)
}
