import type { ConnectionAppStatus, ConnectionAppSummary } from "../../../electron/connections/common.ts"
import type { TeamAppAccess } from "../../../electron/teams/common.ts"
import type { ConnectionAccessIssue } from "@/lib/team-connection-access"

import { parseTeamConnectionAccess, setTeamConnectionMemberAccess } from "@/lib/team-connection-access"

export type MemberConnectionProvenance = "team" | "explicit" | "none" | "invalid"
export type MemberConnectionActionScope = "all" | "selected" | "none" | "invalid"
export type MemberConnectionAccessFilter = "all" | "effective" | MemberConnectionProvenance

export interface MemberConnectionAccessItem {
  actionCount: number | null
  actionScope: MemberConnectionActionScope
  appId: string
  effective: boolean
  issues: ConnectionAccessIssue[]
  label: string
  provenance: MemberConnectionProvenance
  service: string | null
  status: ConnectionAppStatus | null
}

export interface MemberConnectionAccessSummary {
  effectiveCount: number
  explicitCount: number
  invalidCount: number
  noneCount: number
  teamCount: number
  totalCount: number
}

export type MemberConnectionAccessProjection =
  | {
      items: MemberConnectionAccessItem[]
      ok: true
      summary: MemberConnectionAccessSummary
    }
  | {
      issues: ConnectionAccessIssue[]
      ok: false
    }

export type TeamMemberConnectionAccessProjection =
  | { byUserId: Map<string, Extract<MemberConnectionAccessProjection, { ok: true }>>; ok: true }
  | { issues: ConnectionAccessIssue[]; ok: false }

export interface MemberConnectionAccessDelta {
  addAppIds: string[]
  removeAppIds: string[]
  userId: string
}

export function applyMemberConnectionAccessDelta(
  access: TeamAppAccess,
  apps: ConnectionAppSummary[],
  delta: MemberConnectionAccessDelta,
): TeamAppAccess {
  const parsed = parseTeamConnectionAccess(
    access,
    apps.map((app) => ({ id: app.id, service: app.service })),
  )
  if (!parsed.ok) throw new Error("Invalid Team Connection policy")

  const appsById = new Map(apps.map((app) => [app.id, app]))
  const accessByAppId = new Map(parsed.apps.map((app) => [app.appId, app]))
  const additions = new Set(delta.addAppIds)
  const removals = new Set(delta.removeAppIds)
  if ([...additions].some((appId) => removals.has(appId))) {
    throw new Error("A Connection cannot be added and removed in the same update")
  }

  let next = access
  for (const [appId, shouldAdd] of [
    ...Array.from(additions, (id) => [id, true] as const),
    ...Array.from(removals, (id) => [id, false] as const),
  ]) {
    const app = appsById.get(appId)
    const appAccess = accessByAppId.get(appId)
    if (!app || !appAccess || appAccess.mode === "invalid") {
      throw new Error(`Connection access is unavailable: ${appId}`)
    }
    if (appAccess.memberAccess.mode !== "selected") {
      throw new Error(`Team-inherited Connection access cannot be changed per member: ${appId}`)
    }
    const userIds = new Set(appAccess.memberAccess.userIds)
    if (shouldAdd) userIds.add(delta.userId)
    else userIds.delete(delta.userId)
    next = setTeamConnectionMemberAccess(next, app, { mode: "selected", userIds: Array.from(userIds) })
  }
  return next
}

export function projectMemberConnectionAccess(
  access: TeamAppAccess,
  apps: ConnectionAppSummary[],
  userId: string,
): MemberConnectionAccessProjection {
  const projected = projectTeamMemberConnectionAccess(access, apps, [userId])
  if (!projected.ok) return projected
  return projected.byUserId.get(userId) ?? { items: [], ok: true, summary: summarizeMemberConnections([]) }
}

export function projectTeamMemberConnectionAccess(
  access: TeamAppAccess,
  apps: ConnectionAppSummary[],
  userIds: string[],
): TeamMemberConnectionAccessProjection {
  const parsed = parseTeamConnectionAccess(
    access,
    apps.map((app) => ({ id: app.id, service: app.service })),
  )
  if (!parsed.ok) return { issues: parsed.issues, ok: false }

  const appsById = new Map(apps.map((app) => [app.id, app]))
  const byUserId = new Map(
    Array.from(new Set(userIds), (userId) => {
      const items = parsed.apps
        .map((appAccess): MemberConnectionAccessItem => {
          const app = appsById.get(appAccess.appId)
          const label = app ? connectionLabel(app) : appAccess.appId
          if (appAccess.mode === "invalid") {
            return {
              actionCount: null,
              actionScope: "invalid",
              appId: appAccess.appId,
              effective: false,
              issues: appAccess.issues,
              label,
              provenance: "invalid",
              service: appAccess.service,
              status: app?.status ?? null,
            }
          }

          const provenance: MemberConnectionProvenance =
            appAccess.memberAccess.mode === "team"
              ? "team"
              : appAccess.memberAccess.userIds.includes(userId)
                ? "explicit"
                : "none"
          const actionNames = appAccess.actionAccess.mode === "restricted" ? appAccess.actionAccess.actionNames : null
          return {
            actionCount: actionNames?.length ?? null,
            actionScope: actionNames === null ? "all" : actionNames.length === 0 ? "none" : "selected",
            appId: appAccess.appId,
            effective: provenance !== "none",
            issues: [],
            label,
            provenance,
            service: appAccess.service,
            status: app?.status ?? null,
          }
        })
        .sort(compareMemberConnectionItems)
      return [userId, { items, ok: true as const, summary: summarizeMemberConnections(items) }] as const
    }),
  )
  return { byUserId, ok: true }
}

export function filterMemberConnectionAccessItems(
  items: MemberConnectionAccessItem[],
  filter: MemberConnectionAccessFilter,
  query: string,
): MemberConnectionAccessItem[] {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  return items.filter((item) => {
    if (filter === "effective" ? !item.effective : filter !== "all" && item.provenance !== filter) return false
    if (!normalizedQuery) return true
    return (
      item.label.toLocaleLowerCase().includes(normalizedQuery) ||
      item.service?.toLocaleLowerCase().includes(normalizedQuery) ||
      item.appId.toLocaleLowerCase().includes(normalizedQuery)
    )
  })
}

export function summarizeMemberConnections(items: MemberConnectionAccessItem[]): MemberConnectionAccessSummary {
  return {
    effectiveCount: items.filter((item) => item.effective).length,
    explicitCount: items.filter((item) => item.provenance === "explicit").length,
    invalidCount: items.filter((item) => item.provenance === "invalid").length,
    noneCount: items.filter((item) => item.provenance === "none").length,
    teamCount: items.filter((item) => item.provenance === "team").length,
    totalCount: items.length,
  }
}

function compareMemberConnectionItems(left: MemberConnectionAccessItem, right: MemberConnectionAccessItem): number {
  const provenanceOrder: Record<MemberConnectionProvenance, number> = { invalid: 0, explicit: 1, team: 2, none: 3 }
  return provenanceOrder[left.provenance] - provenanceOrder[right.provenance] || left.label.localeCompare(right.label)
}

function connectionLabel(app: ConnectionAppSummary): string {
  return (
    app.alias?.trim() ||
    app.connectionName?.trim() ||
    app.displayName?.trim() ||
    app.accountLabel?.trim() ||
    app.providerAccountId?.trim() ||
    app.service
  )
}
