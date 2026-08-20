import type { ConnectionActionCatalogItem } from "../../../electron/connections/common.ts"

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
