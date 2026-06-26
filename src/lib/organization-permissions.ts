import type { Organization, OrganizationOverview, OrganizationRole } from "../../electron/organizations/common.ts"

export function organizationRole(
  overview: OrganizationOverview | null,
  organization: Organization | null,
): OrganizationRole | null {
  if (!overview || !organization) {
    return null
  }
  if (organization.role === "creator" || organization.role === "member") {
    return organization.role
  }
  return organization.creator_user_id === overview.accountId ||
    overview.created.some((created) => created.id === organization.id)
    ? "creator"
    : "member"
}

export function organizationCanManage(
  overview: OrganizationOverview | null,
  organization: Organization | null,
): boolean {
  if (!overview || !organization) {
    return false
  }
  if (typeof organization.writable === "boolean") {
    return organization.writable
  }
  return organizationRole(overview, organization) === "creator"
}
