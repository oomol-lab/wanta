import type { ConnectionSummary, ConnectionWorkspace } from "./common.ts"

export const connectionUsageSummaryDays = 7
const defaultConnectionWorkspace: ConnectionWorkspace = { teamName: "unavailable" }

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
  workspace: ConnectionWorkspace = defaultConnectionWorkspace,
): ConnectionSummary {
  return {
    apps: [],
    connectedProviderCount: 0,
    providerCount: 0,
    providers: [],
    usage: createEmptyConnectionUsageSummary(),
    usageStatus: "ready",
    updatedAt: new Date().toISOString(),
    workspace,
  }
}
