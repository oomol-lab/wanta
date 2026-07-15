import type { WorkspaceSelection } from "@/hooks/useOrganizationWorkspace"
import type { BillingRequestScope } from "@/lib/billing-client"

/** 账单读取同时按组织 ID（缓存边界）与组织名（Insight header）绑定当前工作区。 */
export function billingRequestScopeForWorkspace(workspace: WorkspaceSelection): BillingRequestScope | null {
  if (!workspace.organization?.name.trim()) {
    return null
  }
  return {
    organizationId: workspace.organizationId,
    organizationName: workspace.organization.name,
    type: "organization",
  }
}
