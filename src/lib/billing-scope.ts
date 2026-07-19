import type { WorkspaceSelection } from "@/hooks/useTeamWorkspace"
import type { BillingRequestScope } from "@/lib/billing-client"

export function canManageTeamBilling(workspace: WorkspaceSelection): boolean {
  return workspace.canManage && Boolean(workspace.team?.name.trim())
}

/** 团队计划/用量跟随工作区；个人余额仅由团队创建者读取和充值。 */
export function billingRequestScopeForWorkspace(workspace: WorkspaceSelection): BillingRequestScope | null {
  if (!workspace.team?.name.trim()) {
    return null
  }
  return {
    canManageBilling: workspace.canManage,
    canManageFunding: workspace.role === "creator",
    teamId: workspace.teamId,
    teamName: workspace.team.name,
  }
}
