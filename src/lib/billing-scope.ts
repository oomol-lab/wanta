import type { WorkspaceSelection } from "@/hooks/useTeamWorkspace"
import type { BillingRequestScope } from "@/lib/billing-client"

import { isTeamManagerRole } from "@/lib/team-permissions"

export function canReadTeamSubscriptionForWorkspace(workspace: WorkspaceSelection): boolean {
  return isTeamManagerRole(workspace.role) && Boolean(workspace.team?.name.trim())
}

export function canManageTeamSubscriptionForWorkspace(workspace: WorkspaceSelection): boolean {
  return workspace.role === "creator" && Boolean(workspace.team?.name.trim())
}

/** Team plans and usage follow the workspace; only the creator can read or fund the personal wallet. */
export function billingRequestScopeForWorkspace(workspace: WorkspaceSelection): BillingRequestScope | null {
  if (!workspace.team?.name.trim()) {
    return null
  }
  return {
    canManageTeamSubscription: canManageTeamSubscriptionForWorkspace(workspace),
    canManageFunding: workspace.role === "creator",
    canReadTeamSubscription: canReadTeamSubscriptionForWorkspace(workspace),
    teamId: workspace.teamId,
    teamName: workspace.team.name,
  }
}
