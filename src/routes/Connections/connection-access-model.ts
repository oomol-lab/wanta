import type { ConnectionActionCatalogItem } from "../../../electron/connections/common.ts"
import type { TeamMember, TeamUserSummary } from "../../../electron/teams/common.ts"
import type {
  ConnectionActionPolicy,
  ConnectionActionPolicies,
  ConnectionAppAccess,
  ConnectionPermissionGrant,
} from "@/lib/team-connection-access"

import { isGuestTeamServiceAccount } from "@/lib/team-permissions"

export function createConnectionPermissionRuleGrant(
  actions: readonly ConnectionActionCatalogItem[] = [],
): ConnectionPermissionGrant {
  return { actionAccess: { actionPolicies: createDefaultActionPolicies(actions), mode: "restricted" } }
}

export function canRestoreConnectionAccess(canManage: boolean, access: ConnectionAppAccess | null): boolean {
  return canManage && access !== null && (access.mode === "configured" || access.mode === "invalid")
}

export function isConnectionAccessConflict(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "status" in error && error.status === 412)
}

export function mergeConnectionRuleAssignments(
  assignments: Record<string, string>,
  ruleId: string,
  selectedUserIds: readonly string[],
  loadedUserIds: readonly string[],
): Record<string, string> {
  const loaded = new Set(loadedUserIds)
  const selected = new Set(selectedUserIds)
  const next = Object.fromEntries(
    Object.entries(assignments).filter(
      ([userId, assignedRuleId]) => !loaded.has(userId) || (assignedRuleId !== ruleId && !selected.has(userId)),
    ),
  )
  for (const userId of selected) next[userId] = ruleId
  return next
}

// Connector only exposes call_tool when the Action allowlist is absent.
const unrestrictedOnlyActionNames = new Set(["call_tool"])

export function isActionIndividuallyConfigurable(action: Pick<ConnectionActionCatalogItem, "name">) {
  return !unrestrictedOnlyActionNames.has(action.name)
}

export type ActionPolicySelection = ConnectionActionPolicy | "deny"

export function getActionPolicy(policies: ConnectionActionPolicies, name: string): ActionPolicySelection {
  if (unrestrictedOnlyActionNames.has(name) || !Object.hasOwn(policies, name)) return "deny"
  return policies[name]
}

export function getActionGroupPolicy(
  policies: ConnectionActionPolicies,
  actions: readonly ConnectionActionCatalogItem[],
) {
  const states = new Set(
    actions.filter(isActionIndividuallyConfigurable).map((action) => getActionPolicy(policies, action.name)),
  )
  return states.size > 1 ? "mixed" : (states.values().next().value ?? "deny")
}

export function setActionPolicies(
  policies: ConnectionActionPolicies,
  names: string[],
  policy: ActionPolicySelection,
): ConnectionActionPolicies {
  const next = new Map(Object.entries(policies))
  for (const name of names) {
    if (unrestrictedOnlyActionNames.has(name)) continue
    if (policy === "deny") next.delete(name)
    else next.set(name, policy)
  }
  return Object.fromEntries([...next].sort(([a], [b]) => a.localeCompare(b)))
}

export function createDefaultActionPolicies(actions: readonly ConnectionActionCatalogItem[]): ConnectionActionPolicies {
  const entries: [string, ConnectionActionPolicy][] = []
  for (const action of actions) {
    if (!isActionIndividuallyConfigurable(action)) continue
    if (action.operationType === "read") entries.push([action.name, "allow"])
    else if (action.operationType === "write") entries.push([action.name, "ask_advisory"])
  }
  return Object.fromEntries(entries.sort(([a], [b]) => a.localeCompare(b)))
}

export function unavailableActionNames(
  policies: ConnectionActionPolicies,
  actions: readonly ConnectionActionCatalogItem[],
): string[] {
  const catalogNames = new Set(actions.map((action) => action.name))
  return Object.keys(policies)
    .filter((name) => !catalogNames.has(name))
    .sort()
}

export function connectionAccessSaveDisabled(input: {
  busy: boolean
  dirty: boolean
  error: boolean
  loading: boolean
  requiresCatalog: boolean
}): boolean {
  return !input.dirty || input.busy || (input.requiresCatalog && (input.loading || input.error))
}

/** Guest service accounts have a separate access scope, outside ordinary team rules. */
export function connectionRuleMembers(members: readonly TeamMember[]): TeamMember[] {
  return members.filter((member) => !isGuestTeamServiceAccount(member))
}

export function removeGuestConnectionAssignments(
  assignments: Record<string, string>,
  members: readonly TeamMember[],
): Record<string, string> {
  const guestIds = new Set(members.filter(isGuestTeamServiceAccount).map((member) => member.user_id))
  return Object.fromEntries(Object.entries(assignments).filter(([userId]) => !guestIds.has(userId)))
}

export function connectionMemberLabel(
  userId: string,
  summaries: Record<string, TeamUserSummary>,
  name?: string,
): string {
  const summary = summaries[userId]
  return summary?.nickname?.trim() || summary?.username?.trim() || name?.trim() || userId
}
