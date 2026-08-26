import type { ConnectionOAuthAuthorizationOption } from "../../../electron/connections/common.ts"

export function createInitialOAuthAuthorizationOptionIds(
  options: readonly ConnectionOAuthAuthorizationOption[] | undefined,
  currentScopes?: readonly string[],
): string[] {
  if (!options?.length) return []

  const selected = currentScopes
    ? new Set(currentScopes)
    : new Set(options.filter((option) => option.required || option.defaultSelected).map((option) => option.id))
  for (const option of options) {
    if (option.required) selected.add(option.id)
  }
  addDependencies(options, selected, [...selected])
  return orderedSelectedIds(options, selected)
}

export function updateOAuthAuthorizationOptionIds(
  options: readonly ConnectionOAuthAuthorizationOption[],
  selectedIds: readonly string[],
  optionId: string,
  checked: boolean,
): string[] {
  const option = options.find((candidate) => candidate.id === optionId)
  if (!option) return [...selectedIds]

  const selected = new Set(selectedIds)
  if (checked) {
    selected.add(optionId)
    addDependencies(options, selected, [optionId])
  } else {
    if (isOAuthAuthorizationOptionLocked(options, selectedIds, optionId)) return [...selectedIds]
    selected.delete(optionId)
  }
  return orderedSelectedIds(options, selected)
}

export function isOAuthAuthorizationOptionLocked(
  options: readonly ConnectionOAuthAuthorizationOption[],
  selectedIds: readonly string[],
  optionId: string,
): boolean {
  const option = options.find((candidate) => candidate.id === optionId)
  if (!option || option.required) return true
  const selected = new Set(selectedIds)
  return options.some(
    (candidate) => selected.has(candidate.id) && candidate.id !== optionId && candidate.requires.includes(optionId),
  )
}

export function getOAuthAuthorizationOptionChanges(
  options: readonly ConnectionOAuthAuthorizationOption[],
  currentScopes: readonly string[] | undefined,
  selectedIds: readonly string[],
): { added: string[]; removed: string[] } {
  if (!currentScopes) return { added: [], removed: [] }
  const current = new Set(currentScopes)
  const selected = new Set(selectedIds)
  const manageable = new Set(options.map((option) => option.id))
  return {
    added: selectedIds.filter((id) => manageable.has(id) && !current.has(id)),
    removed: currentScopes.filter((id) => manageable.has(id) && !selected.has(id)),
  }
}

function addDependencies(
  options: readonly ConnectionOAuthAuthorizationOption[],
  selected: Set<string>,
  optionIds: string[],
): void {
  const optionById = new Map(options.map((option) => [option.id, option]))
  const pending = [...optionIds]
  while (pending.length > 0) {
    const optionId = pending.pop()
    if (!optionId) continue
    for (const requiredId of optionById.get(optionId)?.requires ?? []) {
      if (selected.has(requiredId)) continue
      selected.add(requiredId)
      pending.push(requiredId)
    }
  }
}

function orderedSelectedIds(
  options: readonly ConnectionOAuthAuthorizationOption[],
  selected: ReadonlySet<string>,
): string[] {
  const manageable = new Set(options.map((option) => option.id))
  return [
    ...options.filter((option) => selected.has(option.id)).map((option) => option.id),
    ...[...selected].filter((id) => !manageable.has(id)),
  ]
}
