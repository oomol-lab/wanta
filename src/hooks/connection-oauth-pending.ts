import type { ConnectionConnectInput, ConnectionWorkspace } from "../../electron/connections/common.ts"

import { storageKey } from "../../electron/branding.ts"

export const connectionOAuthPendingTtlMs = 5 * 60_000

export interface OAuthPendingOperation {
  actionId: number
  appId?: string
  createdAt: number
  expiresAt: number
  key: string
  pollingKey: string
  service: string
  workspaceKey: string
}

const oauthPendingStorageKey = storageKey("connection-oauth-pending")
const memoryOAuthPendingOperations = new Map<string, OAuthPendingOperation>()

export function connectionWorkspaceKey(workspace: ConnectionWorkspace): string {
  return workspace.type === "organization" ? `organization:${workspace.organizationName}` : "personal"
}

export function createConnectionPollingKey(service: string, appId?: string): string {
  return appId ? `${service}\0${appId}` : service
}

export function isConnectionPollingTarget(polling: string | null, service: string, appId?: string): boolean {
  return polling === createConnectionPollingKey(service, appId)
}

export function createOAuthPendingKey(
  workspace: ConnectionWorkspace,
  input: Extract<ConnectionConnectInput, { authType: "oauth2" }>,
): string {
  // connector 会按同一 owner + service 让旧 state 失效；这里也按 service 粒度防重复。
  return `${connectionWorkspaceKey(workspace)}\0${input.service}`
}

export function createOAuthPendingOperation(
  workspace: ConnectionWorkspace,
  input: Extract<ConnectionConnectInput, { authType: "oauth2" }>,
  actionId: number,
  now = Date.now(),
): OAuthPendingOperation {
  return {
    actionId,
    ...(input.appId ? { appId: input.appId } : {}),
    createdAt: now,
    expiresAt: now + connectionOAuthPendingTtlMs,
    key: createOAuthPendingKey(workspace, input),
    pollingKey: createConnectionPollingKey(input.service, input.appId),
    service: input.service,
    workspaceKey: connectionWorkspaceKey(workspace),
  }
}

export function isConnectionServicePollingTarget(polling: string | null, service: string): boolean {
  return polling === service || Boolean(polling?.startsWith(`${service}\0`))
}

function oauthPendingStorage(): Storage | null {
  try {
    return globalThis.sessionStorage ?? null
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object"
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function normalizeOAuthPendingOperation(value: unknown): OAuthPendingOperation | null {
  if (!isRecord(value)) {
    return null
  }
  const actionId = value["actionId"]
  const createdAt = value["createdAt"]
  const expiresAt = value["expiresAt"]
  const key = optionalString(value["key"])
  const pollingKey = optionalString(value["pollingKey"])
  const service = optionalString(value["service"])
  const workspaceKey = optionalString(value["workspaceKey"])
  const appId = optionalString(value["appId"])
  if (
    typeof actionId !== "number" ||
    typeof createdAt !== "number" ||
    typeof expiresAt !== "number" ||
    !key ||
    !pollingKey ||
    !service ||
    !workspaceKey
  ) {
    return null
  }
  return {
    actionId,
    ...(appId ? { appId } : {}),
    createdAt,
    expiresAt,
    key,
    pollingKey,
    service,
    workspaceKey,
  }
}

function readStoredOAuthPendingOperations(storage: Storage | null): OAuthPendingOperation[] {
  if (!storage) {
    return []
  }
  try {
    const raw = storage.getItem(oauthPendingStorageKey)
    if (!raw) {
      return []
    }
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed.flatMap((item) => {
      const operation = normalizeOAuthPendingOperation(item)
      return operation ? [operation] : []
    })
  } catch {
    return []
  }
}

function writeStoredOAuthPendingOperations(operations: OAuthPendingOperation[], storage: Storage | null): void {
  if (!storage) {
    return
  }
  try {
    if (operations.length === 0) {
      storage.removeItem(oauthPendingStorageKey)
      return
    }
    storage.setItem(oauthPendingStorageKey, JSON.stringify(operations))
  } catch {
    // sessionStorage 只是防重体验兜底，写失败不影响内存态保护。
  }
}

function loadOAuthPendingOperations(storage: Storage | null): OAuthPendingOperation[] {
  for (const operation of readStoredOAuthPendingOperations(storage)) {
    memoryOAuthPendingOperations.set(operation.key, operation)
  }
  return Array.from(memoryOAuthPendingOperations.values())
}

function persistOAuthPendingOperations(storage: Storage | null): void {
  writeStoredOAuthPendingOperations(Array.from(memoryOAuthPendingOperations.values()), storage)
}

export function pruneExpiredOAuthPendingOperations(now = Date.now(), storage = oauthPendingStorage()): void {
  let changed = false
  for (const operation of loadOAuthPendingOperations(storage)) {
    if (operation.expiresAt <= now) {
      memoryOAuthPendingOperations.delete(operation.key)
      changed = true
    }
  }
  if (changed) {
    persistOAuthPendingOperations(storage)
  }
}

export function rememberOAuthPendingOperation(operation: OAuthPendingOperation, storage = oauthPendingStorage()): void {
  pruneExpiredOAuthPendingOperations(operation.createdAt, storage)
  memoryOAuthPendingOperations.set(operation.key, operation)
  persistOAuthPendingOperations(storage)
}

export function clearOAuthPendingOperation(key: string, storage = oauthPendingStorage()): void {
  loadOAuthPendingOperations(storage)
  if (!memoryOAuthPendingOperations.delete(key)) {
    return
  }
  persistOAuthPendingOperations(storage)
}

export function clearOAuthPendingOperations(storage = oauthPendingStorage()): void {
  memoryOAuthPendingOperations.clear()
  writeStoredOAuthPendingOperations([], storage)
}

export function readOAuthPendingOperation(
  key: string,
  now = Date.now(),
  storage = oauthPendingStorage(),
): OAuthPendingOperation | null {
  pruneExpiredOAuthPendingOperations(now, storage)
  return memoryOAuthPendingOperations.get(key) ?? null
}

export function readOAuthPendingOperationsForWorkspace(
  workspace: ConnectionWorkspace,
  now = Date.now(),
  storage = oauthPendingStorage(),
): OAuthPendingOperation[] {
  pruneExpiredOAuthPendingOperations(now, storage)
  const key = connectionWorkspaceKey(workspace)
  return Array.from(memoryOAuthPendingOperations.values())
    .filter((operation) => operation.workspaceKey === key)
    .sort((left, right) => right.createdAt - left.createdAt)
}
