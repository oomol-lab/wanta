import type {
  OrganizationAppAccess,
  OrganizationMember,
  OrganizationProviderOption,
  OrganizationUserSummary,
} from "../../electron/organizations/common.ts"

import {
  getOrganizationAppAccess,
  listOrganizationMembers,
  listOrganizationProviderOptions,
  listUserSummaries,
} from "./organizations-client.ts"

const organizationDetailsStaleMs = 60_000

interface ResourceEntry<T> {
  data: T | null
  listeners: Set<() => void>
  loadedAt: number
  promise: Promise<T> | null
}

const resourceCache = new Map<string, ResourceEntry<unknown>>()

function resourceKey(accountId: string, organizationId: string, resource: string): string {
  return `${accountId}\u0000${organizationId}\u0000${resource}`
}

function isFresh<T>(entry: ResourceEntry<T>): entry is ResourceEntry<T> & { data: T } {
  return entry.data !== null && Date.now() - entry.loadedAt < organizationDetailsStaleMs
}

function entryFor<T>(key: string): ResourceEntry<T> {
  const existing = resourceCache.get(key) as ResourceEntry<T> | undefined
  if (existing) {
    return existing
  }
  const entry: ResourceEntry<T> = { data: null, listeners: new Set(), loadedAt: 0, promise: null }
  resourceCache.set(key, entry as ResourceEntry<unknown>)
  return entry
}

function readCached<T>(key: string): T | null {
  const entry = resourceCache.get(key) as ResourceEntry<T> | undefined
  return entry && isFresh(entry) ? entry.data : null
}

function loadResource<T>(key: string, request: () => Promise<T>, forceRefresh = false): Promise<T> {
  const entry = entryFor<T>(key)
  if (!forceRefresh && isFresh(entry)) {
    return Promise.resolve(entry.data)
  }
  if (!forceRefresh && entry.promise) {
    return entry.promise
  }

  const promise = request()
  entry.promise = promise
  void promise.then(
    (data) => {
      if (entry.promise === promise) {
        entry.data = data
        entry.loadedAt = Date.now()
        entry.promise = null
        notifyResourceEntry(entry)
      }
    },
    () => {
      if (entry.promise === promise) {
        entry.promise = null
      }
    },
  )
  return promise
}

export interface OrganizationDetailsResourceOptions {
  forceRefresh?: boolean
}

export function getCachedOrganizationMembers(accountId: string, organizationId: string): OrganizationMember[] | null {
  return readCached(resourceKey(accountId, organizationId, "members"))
}

export function subscribeOrganizationMembersResource(
  accountId: string,
  organizationId: string,
  listener: () => void,
): () => void {
  const entry = entryFor<OrganizationMember[]>(resourceKey(accountId, organizationId, "members"))
  entry.listeners.add(listener)
  return () => {
    entry.listeners.delete(listener)
  }
}

export function getCachedOrganizationProviderOptions(
  accountId: string,
  organizationId: string,
): OrganizationProviderOption[] | null {
  return readCached(resourceKey(accountId, organizationId, "provider-options"))
}

export function getCachedOrganizationAppAccess(
  accountId: string,
  organizationId: string,
): OrganizationAppAccess | null {
  return readCached(resourceKey(accountId, organizationId, "app-access"))
}

export function getCachedOrganizationUserSummaries(
  accountId: string,
  organizationId: string,
  userIds: string[],
): Record<string, OrganizationUserSummary> | null {
  const normalizedUserIds = Array.from(new Set(userIds.map((userId) => userId.trim()).filter(Boolean))).sort()
  return readCached(resourceKey(accountId, organizationId, `user-summaries:${normalizedUserIds.join(",")}`))
}

export function getOrganizationMembersResource(
  accountId: string,
  organizationId: string,
  options: OrganizationDetailsResourceOptions = {},
): Promise<OrganizationMember[]> {
  return loadResource(
    resourceKey(accountId, organizationId, "members"),
    () => listOrganizationMembers(organizationId),
    options.forceRefresh,
  )
}

export function getOrganizationProviderOptionsResource(
  accountId: string,
  organizationId: string,
  organizationName: string,
  options: OrganizationDetailsResourceOptions = {},
): Promise<OrganizationProviderOption[]> {
  return loadResource(
    resourceKey(accountId, organizationId, "provider-options"),
    () => listOrganizationProviderOptions(organizationName),
    options.forceRefresh,
  )
}

export function getOrganizationAppAccessResource(
  accountId: string,
  organizationId: string,
  options: OrganizationDetailsResourceOptions = {},
): Promise<OrganizationAppAccess> {
  return loadResource(
    resourceKey(accountId, organizationId, "app-access"),
    () => getOrganizationAppAccess(organizationId),
    options.forceRefresh,
  )
}

export function getOrganizationUserSummariesResource(
  accountId: string,
  organizationId: string,
  userIds: string[],
  options: OrganizationDetailsResourceOptions = {},
): Promise<Record<string, OrganizationUserSummary>> {
  const normalizedUserIds = Array.from(new Set(userIds.map((userId) => userId.trim()).filter(Boolean))).sort()
  return loadResource(
    resourceKey(accountId, organizationId, `user-summaries:${normalizedUserIds.join(",")}`),
    () => listUserSummaries(normalizedUserIds),
    options.forceRefresh,
  )
}

/** 组织成员、授权等变更后，仅清掉对应组织的短时读取资源。 */
export function invalidateOrganizationDetailsResource(accountId: string | undefined, organizationId: string): void {
  if (!accountId) {
    return
  }
  const prefix = `${accountId}\u0000${organizationId}\u0000`
  for (const key of resourceCache.keys()) {
    if (key.startsWith(prefix)) {
      const entry = resourceCache.get(key)
      if (entry) {
        entry.data = null
        entry.loadedAt = 0
        entry.promise = null
        notifyResourceEntry(entry)
      }
    }
  }
}

export function clearOrganizationDetailsResources(): void {
  for (const entry of resourceCache.values()) {
    entry.data = null
    entry.loadedAt = 0
    entry.promise = null
    notifyResourceEntry(entry)
  }
  resourceCache.clear()
}

function notifyResourceEntry(entry: ResourceEntry<unknown>): void {
  for (const listener of entry.listeners) {
    listener()
  }
}
