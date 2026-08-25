import type { ConnectionActionCatalogItem } from "../../../electron/connections/common.ts"
import type { ConnectionAppAccess, ConnectionPermissionGrant } from "@/lib/team-connection-access"

export function createConnectionPermissionRuleGrant(): ConnectionPermissionGrant {
  return { actionAccess: { actionNames: [], mode: "restricted" } }
}

export function canRestoreConnectionAccess(canManage: boolean, access: ConnectionAppAccess | null): boolean {
  return canManage && access !== null && (access.mode === "configured" || access.mode === "invalid")
}

export function isConnectionAccessConflict(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "status" in error && error.status === 412)
}

export function defaultRestrictedActionNames(actions: readonly ConnectionActionCatalogItem[]): string[] {
  return uniqueSorted(actions.filter((action) => action.operationType === "read").map((action) => action.name))
}

export function unavailableActionNames(
  selected: readonly string[],
  actions: readonly ConnectionActionCatalogItem[],
): string[] {
  const catalogNames = new Set(actions.map((action) => action.name))
  return uniqueSorted(selected.filter((name) => !catalogNames.has(name)))
}

export function updateActionSelection(
  selected: readonly string[],
  actionNames: readonly string[],
  checked: boolean,
): string[] {
  const next = new Set(selected)
  for (const name of actionNames) {
    if (checked) next.add(name)
    else next.delete(name)
  }
  return uniqueSorted(Array.from(next))
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

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort()
}
