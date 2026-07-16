import type { WorkspaceSelection } from "@/hooks/useOrganizationWorkspace"
import type { BillingRequestScope } from "@/lib/billing-client"

export function canManageWantaBilling(workspace: WorkspaceSelection): boolean {
  return workspace.canManage && Boolean(workspace.organization?.name.trim())
}

/** 组织计划/用量跟随工作区；个人余额仅由组织创建者读取和充值。 */
export function billingRequestScopeForWorkspace(workspace: WorkspaceSelection): BillingRequestScope | null {
  if (!workspace.organization?.name.trim()) {
    return null
  }
  return {
    canManageBilling: workspace.canManage,
    canManageFunding: workspace.role === "creator",
    organizationId: workspace.organizationId,
    organizationName: workspace.organization.name,
  }
}
