import type { ConnectionSummary, ConnectionWorkspace } from "./common.ts"

const defaultConnectionWorkspace: ConnectionWorkspace = { teamName: "unavailable" }

export function createEmptyConnectionSummary(
  workspace: ConnectionWorkspace = defaultConnectionWorkspace,
): ConnectionSummary {
  return {
    apps: [],
    connectedProviderCount: 0,
    providerCount: 0,
    providers: [],
    updatedAt: new Date().toISOString(),
    workspace,
  }
}
