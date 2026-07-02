import type { Organization, OrganizationOverview } from "../../electron/organizations/common.ts"

export function mergeOrganizationUpdate(current: Organization, updated: Organization): Organization {
  return {
    ...current,
    ...updated,
    role: updated.role ?? current.role,
    writable: updated.writable ?? current.writable,
  }
}

export function upsertOverviewOrganization(
  overview: OrganizationOverview | null,
  organization: Organization,
): OrganizationOverview | null {
  if (!overview) {
    return null
  }

  let found = false
  const patchList = (items: Organization[]) =>
    items.map((item) => {
      if (item.id !== organization.id) {
        return item
      }
      found = true
      return mergeOrganizationUpdate(item, organization)
    })

  let created = patchList(overview.created)
  let joined = patchList(overview.joined)

  if (!found) {
    if (organization.creator_user_id === overview.accountId || organization.role === "creator") {
      created = [...created, organization]
    } else if (organization.role === "member") {
      joined = [...joined, organization]
    } else {
      return overview
    }
  }

  return { ...overview, created, joined, updatedAt: new Date().toISOString() }
}

export function applyOrganizationPatchesToOverview(
  overview: OrganizationOverview,
  organizations: readonly Organization[],
): OrganizationOverview {
  return organizations.reduce(
    (current, organization) => upsertOverviewOrganization(current, organization) ?? current,
    overview,
  )
}
