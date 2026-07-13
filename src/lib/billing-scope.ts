import type { WorkspaceSelection } from "@/hooks/useOrganizationWorkspace"
import type { BillingRequestScope } from "@/lib/billing-client"

type OrganizationWorkspaceSelection = Extract<WorkspaceSelection, { type: "organization" }>

export function canManageWantaBilling(workspace: WorkspaceSelection): workspace is OrganizationWorkspaceSelection {
  return workspace.type === "organization" && workspace.canManage && Boolean(workspace.organization?.name.trim())
}

/** 账单读取同时按组织 ID（订阅）与组织名（Insight header）绑定当前工作区。 */
export function billingRequestScopeForWorkspace(workspace: WorkspaceSelection): BillingRequestScope | null {
  if (workspace.type !== "organization") {
    return { type: "personal" }
  }
  if (!workspace.organization?.name.trim()) {
    return null
  }
  return {
    canManageBilling: workspace.canManage,
    organizationId: workspace.organizationId,
    organizationName: workspace.organization.name,
    type: "organization",
  }
}
