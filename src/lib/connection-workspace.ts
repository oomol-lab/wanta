import type { ConnectionWorkspace } from "../../electron/connections/common.ts"

export function connectionWorkspaceKey(workspace: ConnectionWorkspace): string {
  return `organization:${workspace.organizationName}`
}
