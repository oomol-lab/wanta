import type { TeamAppAccess, TeamMember, TeamProviderOption, TeamUserSummary } from "../../electron/teams/common.ts"

import { getTeamAppAccess, listTeamMembers, listTeamProviderOptions, listUserSummaries } from "./teams-client.ts"

const teamDetailsStaleMs = 60_000

interface ResourceEntry<T> {
  data: T | null
  listeners: Set<() => void>
  loadedAt: number
  promise: Promise<T> | null
}

const resourceCache = new Map<string, ResourceEntry<unknown>>()

function resourceKey(accountId: string, teamId: string, resource: string): string {
  return `${accountId}\u0000${teamId}\u0000${resource}`
}

function providerOptionsResourceKey(accountId: string, teamId: string, teamName: string): string {
  return resourceKey(accountId, teamId, `provider-options:${teamName.trim()}`)
}

function isFresh<T>(entry: ResourceEntry<T>): entry is ResourceEntry<T> & { data: T } {
  return entry.data !== null && Date.now() - entry.loadedAt < teamDetailsStaleMs
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

export interface TeamDetailsResourceOptions {
  forceRefresh?: boolean
}

export function getCachedTeamMembers(accountId: string, teamId: string): TeamMember[] | null {
  return readCached(resourceKey(accountId, teamId, "members"))
}

export function subscribeTeamMembersResource(accountId: string, teamId: string, listener: () => void): () => void {
  const entry = entryFor<TeamMember[]>(resourceKey(accountId, teamId, "members"))
  entry.listeners.add(listener)
  return () => {
    entry.listeners.delete(listener)
    if (entry.listeners.size === 0 && entry.data === null && entry.promise === null) {
      resourceCache.delete(resourceKey(accountId, teamId, "members"))
    }
  }
}

export function getCachedTeamProviderOptions(
  accountId: string,
  teamId: string,
  teamName: string,
): TeamProviderOption[] | null {
  return readCached(providerOptionsResourceKey(accountId, teamId, teamName))
}

export function getCachedTeamAppAccess(accountId: string, teamId: string): TeamAppAccess | null {
  return readCached(resourceKey(accountId, teamId, "app-access"))
}

export function getCachedTeamUserSummaries(
  accountId: string,
  teamId: string,
  userIds: string[],
): Record<string, TeamUserSummary> | null {
  const normalizedUserIds = Array.from(new Set(userIds.map((userId) => userId.trim()).filter(Boolean))).sort()
  return readCached(resourceKey(accountId, teamId, `user-summaries:${normalizedUserIds.join(",")}`))
}

export function getTeamMembersResource(
  accountId: string,
  teamId: string,
  options: TeamDetailsResourceOptions = {},
): Promise<TeamMember[]> {
  return loadResource(resourceKey(accountId, teamId, "members"), () => listTeamMembers(teamId), options.forceRefresh)
}

export function getTeamProviderOptionsResource(
  accountId: string,
  teamId: string,
  teamName: string,
  options: TeamDetailsResourceOptions = {},
): Promise<TeamProviderOption[]> {
  return loadResource(
    providerOptionsResourceKey(accountId, teamId, teamName),
    () => listTeamProviderOptions(teamName),
    options.forceRefresh,
  )
}

export function getTeamAppAccessResource(
  accountId: string,
  teamId: string,
  options: TeamDetailsResourceOptions = {},
): Promise<TeamAppAccess> {
  return loadResource(
    resourceKey(accountId, teamId, "app-access"),
    () => getTeamAppAccess(teamId),
    options.forceRefresh,
  )
}

export function getTeamUserSummariesResource(
  accountId: string,
  teamId: string,
  userIds: string[],
  options: TeamDetailsResourceOptions = {},
): Promise<Record<string, TeamUserSummary>> {
  const normalizedUserIds = Array.from(new Set(userIds.map((userId) => userId.trim()).filter(Boolean))).sort()
  return loadResource(
    resourceKey(accountId, teamId, `user-summaries:${normalizedUserIds.join(",")}`),
    () => listUserSummaries(normalizedUserIds),
    options.forceRefresh,
  )
}

/** 团队成员、授权等变更后，仅清掉对应团队的短时读取资源。 */
export function invalidateTeamDetailsResource(accountId: string | undefined, teamId: string): void {
  if (!accountId) {
    return
  }
  const prefix = `${accountId}\u0000${teamId}\u0000`
  for (const key of resourceCache.keys()) {
    if (key.startsWith(prefix)) {
      const entry = resourceCache.get(key)
      if (entry) {
        entry.data = null
        entry.loadedAt = 0
        entry.promise = null
        notifyResourceEntry(entry)
        if (entry.listeners.size === 0) resourceCache.delete(key)
      }
    }
  }
}

export function clearTeamDetailsResources(): void {
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
