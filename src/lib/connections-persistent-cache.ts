import type { ConnectionWorkspace } from "../../electron/connections/common.ts"

import { connectionWorkspaceKey } from "./connection-workspace.ts"

export interface PersistentConnectorCacheEntry {
  data: unknown
  etag?: string
  lastModified?: string
  meta: unknown
}

const persistentCacheVersion = 1
const providerCachePrefix = `wanta:connections:providers:v${persistentCacheVersion}:`
const appsCachePrefix = `wanta:connections:apps:v${persistentCacheVersion}:`

interface StoredConnectorCacheEntry extends PersistentConnectorCacheEntry {
  version: number
}

export function readPersistentConnectorCache(
  path: string,
  workspace: ConnectionWorkspace | null,
): PersistentConnectorCacheEntry | null {
  const target = persistentCacheTarget(path, workspace)
  if (!target) return null
  try {
    const raw = target.storage().getItem(target.key)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!isStoredConnectorCacheEntry(parsed, target.kind)) return null
    const data = sanitizePersistentData(parsed.data, target.kind)
    if (!data) return null
    return {
      data,
      etag: parsed.etag,
      lastModified: parsed.lastModified,
      meta: sanitizePersistentMeta(parsed.meta, target.kind),
    }
  } catch {
    return null
  }
}

export function writePersistentConnectorCache(
  path: string,
  workspace: ConnectionWorkspace | null,
  entry: PersistentConnectorCacheEntry,
): void {
  const target = persistentCacheTarget(path, workspace)
  if (!target) return
  const data = sanitizePersistentData(entry.data, target.kind)
  if (!data) return
  try {
    target.storage().setItem(
      target.key,
      JSON.stringify({
        ...entry,
        data,
        meta: sanitizePersistentMeta(entry.meta, target.kind),
        version: persistentCacheVersion,
      }),
    )
  } catch {
    // Storage can be unavailable or full; the in-memory cache remains authoritative.
  }
}

export function invalidatePersistentWorkspaceApps(workspace: ConnectionWorkspace): void {
  const workspacePrefix = `${appsCachePrefix}${encodeURIComponent(connectionWorkspaceKey(workspace))}:`
  removeStorageKeys(
    () => globalThis.sessionStorage,
    (key) => key.startsWith(workspacePrefix),
  )
}

export function clearPersistentConnectionAppsCache(): void {
  removeStorageKeys(
    () => globalThis.sessionStorage,
    (key) => key.startsWith(appsCachePrefix),
  )
}

function persistentCacheTarget(
  path: string,
  workspace: ConnectionWorkspace | null,
): { key: string; kind: "apps" | "providers"; storage: () => Storage } | null {
  if (workspace && (path === "/v1/connections" || path === "/v1/apps")) {
    return {
      key: `${appsCachePrefix}${encodeURIComponent(connectionWorkspaceKey(workspace))}:${encodeURIComponent(path)}`,
      kind: "apps",
      storage: () => globalThis.sessionStorage,
    }
  }
  if (!workspace && (path === "/v1/providers" || path.startsWith("/v1/providers?"))) {
    return {
      key: `${providerCachePrefix}${encodeURIComponent(path)}`,
      kind: "providers",
      storage: () => globalThis.localStorage,
    }
  }
  return null
}

function isStoredConnectorCacheEntry(value: unknown, kind: "apps" | "providers"): value is StoredConnectorCacheEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const entry = value as Partial<StoredConnectorCacheEntry>
  return (
    entry.version === persistentCacheVersion &&
    (entry.etag === undefined || typeof entry.etag === "string") &&
    (entry.lastModified === undefined || typeof entry.lastModified === "string") &&
    isPersistentData(entry.data, kind) &&
    "meta" in entry
  )
}

function isPersistentData(value: unknown, kind: "apps" | "providers"): boolean {
  if (!Array.isArray(value)) return false
  return value.every((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false
    const record = item as Record<string, unknown>
    if (typeof record["service"] !== "string") return false
    return kind === "providers" || typeof record["id"] === "string"
  })
}

function sanitizePersistentData(value: unknown, kind: "apps" | "providers"): unknown[] | null {
  if (!isPersistentData(value, kind)) return null
  if (kind === "providers") return value as unknown[]
  return (value as Record<string, unknown>[]).map((app) => ({
    accountLabel: app["accountLabel"],
    alias: app["alias"],
    authType: app["authType"],
    connectionName: app["connectionName"],
    createdAt: app["createdAt"],
    displayName: app["displayName"],
    id: app["id"],
    isDefault: app["isDefault"],
    providerAccountId: app["providerAccountId"],
    scopes: app["scopes"],
    service: app["service"],
    status: app["status"],
    updatedAt: app["updatedAt"],
  }))
}

function sanitizePersistentMeta(value: unknown, kind: "apps" | "providers"): unknown {
  if (kind === "providers" || !value || typeof value !== "object" || Array.isArray(value)) return null
  const summary = (value as Record<string, unknown>)["summary"]
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) return null
  const record = summary as Record<string, unknown>
  return {
    summary: {
      connectedProviderCount: record["connectedProviderCount"],
      providerCount: record["providerCount"],
    },
  }
}

function removeStorageKeys(getStorage: () => Storage, matches: (key: string) => boolean): void {
  try {
    const storage = getStorage()
    for (let index = storage.length - 1; index >= 0; index -= 1) {
      const key = storage.key(index)
      if (key && matches(key)) storage.removeItem(key)
    }
  } catch {
    // Cache cleanup must not block logout, account switching, or connection mutations.
  }
}
