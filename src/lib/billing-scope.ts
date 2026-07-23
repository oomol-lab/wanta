import type { WorkspaceSelection } from "@/hooks/useTeamWorkspace"
import type { BillingRequestScope } from "@/lib/billing-client"

import { isTeamManagerRole } from "@/lib/team-permissions"

export function canReadTeamSubscriptionForWorkspace(workspace: WorkspaceSelection): boolean {
  return isTeamManagerRole(workspace.role) && Boolean(workspace.team?.name.trim())
}

export function canManageTeamSubscriptionForWorkspace(workspace: WorkspaceSelection): boolean {
  return workspace.role === "creator" && Boolean(workspace.team?.name.trim())
}

/** Team plans follow the workspace; the signed-in user always owns and can fund their personal usage account. */
export function billingRequestScopeForWorkspace(workspace: WorkspaceSelection): BillingRequestScope | null {
  if (!workspace.team?.name.trim()) {
    return null
  }
  return {
    canManageTeamSubscription: canManageTeamSubscriptionForWorkspace(workspace),
    canManageFunding: true,
    canReadTeamSubscription: canReadTeamSubscriptionForWorkspace(workspace),
    teamId: workspace.teamId,
    teamName: workspace.team.name,
  }
}
