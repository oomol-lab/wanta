import type { ConnectionAppSummary } from "../../electron/connections/common.ts"
import type { TeamAppAccess, TeamMember, TeamUserSummary } from "../../electron/teams/common.ts"

import { getTeamAppAccess, listTeamConnectionApps, listTeamMembers, listUserSummaries } from "./teams-client.ts"

const teamDetailsStaleMs = 60_000
const teamDetailsMaxEntries = 256

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

function connectionAppsResourceKey(accountId: string, teamId: string, teamName: string): string {
  return resourceKey(accountId, teamId, `connection-apps:${teamName.trim()}`)
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
  pruneResourceCache(key)
  return entry
}

function pruneResourceCache(protectedKey?: string): void {
  if (resourceCache.size <= teamDetailsMaxEntries) return
  for (const [key, entry] of resourceCache) {
    if (key === protectedKey) continue
    if (entry.listeners.size > 0 || entry.promise) continue
    resourceCache.delete(key)
    if (resourceCache.size <= teamDetailsMaxEntries) return
  }
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

export function getCachedTeamAppAccess(accountId: string, teamId: string): TeamAppAccess | null {
  return readCached(resourceKey(accountId, teamId, "app-access"))
}

export function getCachedTeamConnectionApps(
  accountId: string,
  teamId: string,
  teamName: string,
): ConnectionAppSummary[] | null {
  return readCached(connectionAppsResourceKey(accountId, teamId, teamName))
}

interface UserSummaryEntry {
  data?: TeamUserSummary
  loadedAt: number
  promise?: Promise<void>
}

type UserSummaryCache = Map<string, UserSummaryEntry>

function summaryCache(accountId: string, teamId: string): UserSummaryCache {
  const entry = entryFor<UserSummaryCache>(resourceKey(accountId, teamId, "user-summaries"))
  return (entry.data ??= new Map())
}

function normalizedUserIds(userIds: string[]): string[] {
  return [...new Set(userIds.map((id) => id.trim()).filter(Boolean))]
}

export function getCachedTeamUserSummaries(
  accountId: string,
  teamId: string,
  userIds: string[],
): Record<string, TeamUserSummary> | null {
  const cache = summaryCache(accountId, teamId)
  const summaries: Record<string, TeamUserSummary> = {}
  for (const id of normalizedUserIds(userIds)) {
    const entry = cache.get(id)
    if (!entry || entry.promise || Date.now() - entry.loadedAt >= teamDetailsStaleMs) return null
    if (entry.data) summaries[id] = entry.data
  }
  return summaries
}

export function getTeamMembersResource(
  accountId: string,
  teamId: string,
  options: TeamDetailsResourceOptions = {},
): Promise<TeamMember[]> {
  return loadResource(resourceKey(accountId, teamId, "members"), () => listTeamMembers(teamId), options.forceRefresh)
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

export function getTeamConnectionAppsResource(
  accountId: string,
  teamId: string,
  teamName: string,
  options: TeamDetailsResourceOptions = {},
): Promise<ConnectionAppSummary[]> {
  return loadResource(
    connectionAppsResourceKey(accountId, teamId, teamName),
    () => listTeamConnectionApps(teamName, { forceRefresh: options.forceRefresh }),
    options.forceRefresh,
  )
}

export async function getTeamUserSummariesResource(
  accountId: string,
  teamId: string,
  userIds: string[],
  options: TeamDetailsResourceOptions = {},
): Promise<Record<string, TeamUserSummary>> {
  const ids = normalizedUserIds(userIds)
  const cache = summaryCache(accountId, teamId)
  const missing = ids.filter((id) => {
    const entry = cache.get(id)
    return options.forceRefresh || !entry || (!entry.promise && Date.now() - entry.loadedAt >= teamDetailsStaleMs)
  })
  if (missing.length) {
    const entries = missing.map((id) => {
      const entry: UserSummaryEntry = { loadedAt: 0 }
      cache.set(id, entry)
      return entry
    })
    const promise = listUserSummaries(missing).then(
      (summaries) => {
        missing.forEach((id, index) => {
          const entry = entries[index]
          entry.data = summaries[id]
          entry.loadedAt = Date.now()
          entry.promise = undefined
        })
      },
      (error: unknown) => {
        missing.forEach((id, index) => {
          if (cache.get(id) === entries[index]) cache.delete(id)
        })
        throw error
      },
    )
    entries.forEach((entry) => {
      entry.promise = promise
    })
  }
  // Capture this consumer's entries so superseding refreshes cannot replace its result.
  const entries = ids.map((id) => [id, cache.get(id)!] as const)
  await Promise.all(new Set(entries.map(([, entry]) => entry.promise)))
  return Object.fromEntries(entries.flatMap(([id, entry]) => (entry.data ? [[id, entry.data]] : [])))
}

/** 团队成员、授权等变更后，仅清掉对应团队的短时读取资源。 */
export function invalidateTeamDetailsResource(
  accountId: string | undefined,
  teamId: string,
  options: { preserveUserSummaries?: boolean } = {},
): void {
  if (!accountId) {
    return
  }
  const prefix = `${accountId}\u0000${teamId}\u0000`
  for (const key of resourceCache.keys()) {
    if (key.startsWith(prefix) && !(options.preserveUserSummaries && key === `${prefix}user-summaries`)) {
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
