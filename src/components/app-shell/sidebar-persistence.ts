import type { SessionScope } from "../../../electron/session/common.ts"

export type SidebarSegment = "projects" | "tasks"

type LocalStorageLike = Pick<Storage, "getItem" | "removeItem" | "setItem">

const sidebarSegmentStorageKey = "wanta.sidebarSegment"
const sidebarCollapsedStorageKey = "wanta.sidebarCollapsed"
const projectCollapsedStoragePrefix = "wanta.projectSidebarCollapsed"

function readItem(storage: LocalStorageLike | null | undefined, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null
  } catch {
    return null
  }
}

function writeItem(storage: LocalStorageLike | null | undefined, key: string, value: string): boolean {
  if (!storage) {
    return false
  }
  try {
    storage.setItem(key, value)
    return true
  } catch {
    // 本地存储不可用时仅保留本次会话状态。
    return false
  }
}

function removeItem(storage: LocalStorageLike | null | undefined, key: string): void {
  try {
    storage?.removeItem(key)
  } catch {
    // 本地存储不可用时无需清理。
  }
}

export function readStoredSidebarSegment(storage: LocalStorageLike | null | undefined): SidebarSegment {
  return readItem(storage, sidebarSegmentStorageKey) === "projects" ? "projects" : "tasks"
}

export function writeStoredSidebarSegment(storage: LocalStorageLike | null | undefined, segment: SidebarSegment): void {
  writeItem(storage, sidebarSegmentStorageKey, segment)
}

export function readStoredSidebarCollapsed(storage: LocalStorageLike | null | undefined): boolean {
  return readItem(storage, sidebarCollapsedStorageKey) === "1"
}

export function writeStoredSidebarCollapsed(storage: LocalStorageLike | null | undefined, collapsed: boolean): void {
  writeItem(storage, sidebarCollapsedStorageKey, collapsed ? "1" : "0")
}

export function projectSidebarCollapsedStorageKey(
  accountId: string | undefined,
  scope: SessionScope | null,
): string | null {
  if (!accountId || !scope) {
    return null
  }
  const scopeKey = `team:${scope.teamId}`
  return `${projectCollapsedStoragePrefix}:${accountId}:${scopeKey}`
}

export function readStoredCollapsedProjectIds(
  storage: LocalStorageLike | null | undefined,
  key: string | null,
): Set<string> {
  if (!key) {
    return new Set()
  }
  const legacyKey = key.replace(":team:", ":organization:")
  const currentRaw = readItem(storage, key)
  const parseIds = (raw: string | null): Set<string> | null => {
    if (!raw) {
      return null
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return null
    }
    if (!Array.isArray(parsed)) {
      return null
    }
    return new Set(parsed.filter((value): value is string => typeof value === "string" && value.trim().length > 0))
  }
  const currentIds = parseIds(currentRaw)
  if (currentIds) {
    return currentIds
  }
  const legacyRaw = legacyKey !== key ? readItem(storage, legacyKey) : null
  const legacyIds = parseIds(legacyRaw)
  if (!legacyIds) {
    return new Set()
  }
  if (writeItem(storage, key, JSON.stringify([...legacyIds].sort()))) {
    removeItem(storage, legacyKey)
  }
  return legacyIds
}

export function writeStoredCollapsedProjectIds(
  storage: LocalStorageLike | null | undefined,
  key: string | null,
  collapsedIds: Set<string>,
): void {
  if (!key) {
    return
  }
  if (collapsedIds.size === 0) {
    removeItem(storage, key)
    return
  }
  writeItem(storage, key, JSON.stringify([...collapsedIds].sort()))
}

export function pruneCollapsedProjectIds(collapsedIds: Set<string>, projectIds: Set<string>): Set<string> {
  const next = new Set([...collapsedIds].filter((id) => projectIds.has(id)))
  return setsEqual(collapsedIds, next) ? collapsedIds : next
}

export function setsEqual(left: Set<string>, right: Set<string>): boolean {
  if (left.size !== right.size) {
    return false
  }
  for (const value of left) {
    if (!right.has(value)) {
      return false
    }
  }
  return true
}
