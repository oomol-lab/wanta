import type { WorkspaceSelection } from "@/hooks/useTeamWorkspace"
import type { AddTeamSkillInput, TeamSkillConfigItem } from "@/lib/team-skills-client"
import type { UserFacingError } from "@/lib/user-facing-error"

import * as React from "react"
import { OomolHttpError } from "@/lib/oomol-http"
import { reportRendererHandledError } from "@/lib/renderer-diagnostics"
import {
  addTeamSkill,
  listTeamSkills,
  teamSkillMentionId,
  teamSkillsApiEnabled,
  removeTeamSkill,
} from "@/lib/team-skills-client"
import { resolveUserFacingError } from "@/lib/user-facing-error"

export interface TeamSkillChatContext {
  description?: string
  icon?: string
  id: string
  name: string
  packageName?: string
  skillName?: string
  version?: string
}

export interface UseTeamSkills {
  addSkill(input: AddTeamSkillInput, options?: { refresh?: boolean }): Promise<void>
  apiEnabled: boolean
  canManage: boolean
  chatContextSkills: TeamSkillChatContext[]
  error: UserFacingError | null
  hasLoaded: boolean
  loading: boolean
  teamId: string | null
  teamName: string | null
  refresh(options?: { forceRefresh?: boolean }): Promise<void>
  removePackage(packageName: string): Promise<void>
  skills: TeamSkillConfigItem[]
}

export interface TeamSkillCacheEntry {
  cacheKey: string
  fetchedAt: number
  teamId: string
  skills: TeamSkillConfigItem[]
}

const teamSkillCacheMs = 30_000
const teamSkillPersistentCacheMaxAgeMs = 24 * 60 * 60 * 1000
const teamSkillCacheMaxEntries = 50
const teamSkillPersistentCacheStorageKey = "wanta.team-skill-cache.v3"
const legacyTeamSkillPersistentCacheStorageKey = "wanta.organization-skill-cache.v2"
const teamSkillCache = new Map<string, TeamSkillCacheEntry>()
let teamSkillPersistentCacheRead = false

export function selectTeamSkillCacheEntries(
  entries: readonly TeamSkillCacheEntry[],
  now = Date.now(),
  maxEntries = teamSkillCacheMaxEntries,
): TeamSkillCacheEntry[] {
  const minimumFetchedAt = now - teamSkillPersistentCacheMaxAgeMs
  return entries
    .filter((entry) => entry.fetchedAt >= minimumFetchedAt)
    .sort((left, right) => right.fetchedAt - left.fetchedAt)
    .slice(0, Math.max(0, maxEntries))
}

function pruneTeamSkillCache(now = Date.now()): void {
  const retainedKeys = new Set(
    selectTeamSkillCacheEntries([...teamSkillCache.values()], now).map((entry) => entry.cacheKey),
  )
  for (const key of teamSkillCache.keys()) {
    if (!retainedKeys.has(key)) teamSkillCache.delete(key)
  }
}

export function normalizeTeamSkillCacheEntry(value: unknown): TeamSkillCacheEntry | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined
  }
  const entry = value as Partial<TeamSkillCacheEntry> & { organizationId?: unknown }
  const teamId = typeof entry.teamId === "string" ? entry.teamId : entry.organizationId
  if (
    typeof entry.cacheKey !== "string" ||
    typeof entry.fetchedAt !== "number" ||
    !Number.isFinite(entry.fetchedAt) ||
    typeof teamId !== "string" ||
    !Array.isArray(entry.skills)
  ) {
    return undefined
  }
  return {
    cacheKey: entry.cacheKey,
    fetchedAt: entry.fetchedAt,
    teamId,
    skills: entry.skills,
  }
}

function readPersistentTeamSkillCache(): void {
  if (typeof window === "undefined" || teamSkillPersistentCacheRead) {
    return
  }

  teamSkillPersistentCacheRead = true
  try {
    const currentSerialized = window.localStorage.getItem(teamSkillPersistentCacheStorageKey)
    const legacySerialized =
      currentSerialized === null ? window.localStorage.getItem(legacyTeamSkillPersistentCacheStorageKey) : null
    const serialized = currentSerialized ?? legacySerialized
    const entries = serialized ? JSON.parse(serialized) : []
    if (!Array.isArray(entries)) {
      return
    }
    const minimumFetchedAt = Date.now() - teamSkillPersistentCacheMaxAgeMs
    for (const value of entries) {
      const entry = normalizeTeamSkillCacheEntry(value)
      if (entry && entry.fetchedAt >= minimumFetchedAt) {
        teamSkillCache.set(entry.cacheKey, entry)
      }
    }
    pruneTeamSkillCache()
    persistTeamSkillCache()
    if (legacySerialized !== null) {
      window.localStorage.removeItem(legacyTeamSkillPersistentCacheStorageKey)
    }
  } catch {
    // localStorage 不可用或内容已损坏时退回网络请求，不影响团队切换。
  }
}

function persistTeamSkillCache(): void {
  if (typeof window === "undefined") {
    return
  }

  try {
    pruneTeamSkillCache()
    const entries = [...teamSkillCache.values()]
    window.localStorage.setItem(teamSkillPersistentCacheStorageKey, JSON.stringify(entries))
  } catch {
    // 配置缓存只是体验优化，存储失败不能阻断团队 Skill 的正常加载。
  }
}

function getTeamSkillCacheEntry(cacheKey: string, teamId: string): TeamSkillCacheEntry | undefined {
  readPersistentTeamSkillCache()
  const entry = teamSkillCache.get(cacheKey)
  return entry?.teamId === teamId ? entry : undefined
}

function setTeamSkillCacheEntry(entry: TeamSkillCacheEntry): void {
  teamSkillCache.set(entry.cacheKey, entry)
  pruneTeamSkillCache()
  persistTeamSkillCache()
}

function deleteTeamSkillCacheEntry(cacheKey: string): void {
  if (teamSkillCache.delete(cacheKey)) {
    persistTeamSkillCache()
  }
}

export function invalidateTeamSkillCache(accountId: string | undefined, teamId: string): void {
  const accountKey = accountId?.trim() || "anonymous"
  deleteTeamSkillCacheEntry(`${accountKey}\u0000${teamId}`)
}

function teamWorkspaceKey(workspace: WorkspaceSelection): string {
  return workspace.teamId || "workspace-loading"
}

function teamSkillCacheKey(workspace: WorkspaceSelection, accountId: string | undefined): string {
  const accountKey = accountId?.trim() || "anonymous"
  return `${accountKey}\u0000${teamWorkspaceKey(workspace)}`
}

function teamSkillError(cause: unknown): UserFacingError {
  return resolveUserFacingError(cause, { area: "skills" })
}

function isTeamSkillsUnavailable(cause: unknown): boolean {
  return cause instanceof OomolHttpError && cause.status === 404
}

function toChatContextSkill(skill: TeamSkillConfigItem): TeamSkillChatContext {
  return {
    ...(skill.description ? { description: skill.description } : {}),
    ...(skill.icon ? { icon: skill.icon } : {}),
    id: teamSkillMentionId(skill),
    name: skill.displayName || skill.skillName,
    packageName: skill.packageName,
    skillName: skill.skillName,
    version: skill.version,
  }
}

export function useTeamSkills(workspace: WorkspaceSelection, accountId?: string): UseTeamSkills {
  const workspaceKey = teamWorkspaceKey(workspace)
  const cacheKey = teamSkillCacheKey(workspace, accountId)
  const teamId = workspace.teamId || null
  const teamName = workspace.team?.name ?? null
  const remoteApiEnabled = teamSkillsApiEnabled()
  const canManage = workspace.canManage
  const [skills, setSkills] = React.useState<TeamSkillConfigItem[]>([])
  const [skillsTeamId, setSkillsTeamId] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<UserFacingError | null>(null)
  const [hasLoaded, setHasLoaded] = React.useState(false)
  const requestIdRef = React.useRef(0)
  const latestTeamIdRef = React.useRef<string | null>(teamId)
  const latestCacheKeyRef = React.useRef(cacheKey)

  React.useEffect(() => {
    latestTeamIdRef.current = teamId
    latestCacheKeyRef.current = cacheKey
    requestIdRef.current += 1
    const cached = teamId ? getTeamSkillCacheEntry(cacheKey, teamId) : undefined
    setSkills(cached?.skills ?? [])
    setSkillsTeamId(cached ? teamId : null)
    setError(null)
    setHasLoaded(Boolean(cached))
    if (!teamId || !remoteApiEnabled) {
      setLoading(false)
      setSkillsTeamId(teamId)
      setHasLoaded(Boolean(teamId && !remoteApiEnabled))
    }
  }, [cacheKey, teamId, remoteApiEnabled, workspaceKey])

  const refresh = React.useCallback(
    async (options: { forceRefresh?: boolean } = {}): Promise<void> => {
      if (!teamId || !remoteApiEnabled) {
        setSkills([])
        setSkillsTeamId(teamId)
        setError(null)
        setHasLoaded(Boolean(teamId && !remoteApiEnabled))
        setLoading(false)
        return
      }

      const now = Date.now()
      const cached = getTeamSkillCacheEntry(cacheKey, teamId)
      if (!options.forceRefresh && cached && now - cached.fetchedAt < teamSkillCacheMs) {
        setSkills(cached.skills)
        setSkillsTeamId(teamId)
        setError(null)
        setHasLoaded(true)
        setLoading(false)
        return
      }

      const requestId = requestIdRef.current + 1
      requestIdRef.current = requestId
      setLoading(true)
      try {
        const config = await listTeamSkills(teamId)
        if (requestIdRef.current !== requestId) {
          return
        }
        setTeamSkillCacheEntry({ cacheKey, fetchedAt: Date.now(), teamId, skills: config.skills })
        setSkills(config.skills)
        setSkillsTeamId(teamId)
        setError(null)
        setHasLoaded(true)
      } catch (cause) {
        if (requestIdRef.current === requestId) {
          if (isTeamSkillsUnavailable(cause)) {
            setTeamSkillCacheEntry({ cacheKey, fetchedAt: Date.now(), teamId, skills: [] })
            setSkills([])
            setSkillsTeamId(teamId)
            setError(null)
            setHasLoaded(true)
          } else {
            const fallback = getTeamSkillCacheEntry(cacheKey, teamId)
            setSkills(fallback?.skills ?? [])
            setSkillsTeamId(fallback ? teamId : null)
            setError(teamSkillError(cause))
            setHasLoaded(Boolean(fallback))
          }
        }
      } finally {
        if (requestIdRef.current === requestId) {
          setLoading(false)
        }
      }
    },
    [cacheKey, teamId, remoteApiEnabled, workspaceKey],
  )

  React.useEffect(() => {
    void refresh().catch((error: unknown) => {
      reportRendererHandledError("team-skills", "team skills refresh failed", error)
    })
  }, [refresh])

  const reloadAfterMutation = React.useCallback(
    async (targetTeamId: string, targetCacheKey: string): Promise<void> => {
      deleteTeamSkillCacheEntry(targetCacheKey)
      if (latestTeamIdRef.current !== targetTeamId || latestCacheKeyRef.current !== targetCacheKey) {
        return
      }
      await refresh({ forceRefresh: true })
    },
    [refresh],
  )

  const addSkill = React.useCallback(
    async (input: AddTeamSkillInput, options: { refresh?: boolean } = {}): Promise<void> => {
      if (!teamId) {
        throw new Error("Team is required.")
      }
      if (!remoteApiEnabled) {
        throw new Error("Team Skill API is not enabled.")
      }
      const targetTeamId = teamId
      const targetCacheKey = cacheKey
      await addTeamSkill(targetTeamId, input)
      if (options.refresh === false) {
        deleteTeamSkillCacheEntry(targetCacheKey)
      } else {
        await reloadAfterMutation(targetTeamId, targetCacheKey)
      }
    },
    [cacheKey, teamId, reloadAfterMutation, remoteApiEnabled],
  )

  const removePackage = React.useCallback(
    async (packageName: string): Promise<void> => {
      if (!teamId) {
        throw new Error("Team is required.")
      }
      if (!remoteApiEnabled) {
        throw new Error("Team Skill API is not enabled.")
      }
      const targetTeamId = teamId
      const targetCacheKey = cacheKey
      await removeTeamSkill(targetTeamId, packageName)
      await reloadAfterMutation(targetTeamId, targetCacheKey)
    },
    [cacheKey, teamId, reloadAfterMutation, remoteApiEnabled],
  )

  const cached = teamId ? getTeamSkillCacheEntry(cacheKey, teamId) : undefined
  const skillsBelongToCurrentTeam = skillsTeamId === teamId
  const currentSkills = skillsBelongToCurrentTeam ? skills : (cached?.skills ?? [])
  const currentError = skillsBelongToCurrentTeam ? error : null
  const currentHasLoaded = skillsBelongToCurrentTeam ? hasLoaded : Boolean(cached)
  const currentLoading = loading || Boolean(teamId && remoteApiEnabled && !skillsBelongToCurrentTeam && !cached)
  const chatContextSkills = React.useMemo(() => currentSkills.map(toChatContextSkill), [currentSkills])

  return {
    addSkill,
    apiEnabled: remoteApiEnabled,
    canManage,
    chatContextSkills,
    error: currentError,
    hasLoaded: currentHasLoaded,
    loading: currentLoading,
    teamId,
    teamName,
    refresh,
    removePackage,
    skills: currentSkills,
  }
}
