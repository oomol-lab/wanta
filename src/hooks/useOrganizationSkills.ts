import type { WorkspaceSelection } from "@/hooks/useOrganizationWorkspace"
import type { AddOrganizationSkillInput, OrganizationSkillConfigItem } from "@/lib/organization-skills-client"
import type { UserFacingError } from "@/lib/user-facing-error"

import * as React from "react"
import { OomolHttpError } from "@/lib/oomol-http"
import {
  addOrganizationSkill,
  listOrganizationSkills,
  organizationSkillMentionId,
  organizationSkillsApiEnabled,
  removeOrganizationSkill,
} from "@/lib/organization-skills-client"
import { reportRendererHandledError } from "@/lib/renderer-diagnostics"
import { resolveUserFacingError } from "@/lib/user-facing-error"

export interface OrganizationSkillChatContext {
  description?: string
  icon?: string
  id: string
  name: string
  packageName?: string
  skillName?: string
  version?: string
}

export interface UseOrganizationSkills {
  addSkill(input: AddOrganizationSkillInput, options?: { refresh?: boolean }): Promise<void>
  apiEnabled: boolean
  canManage: boolean
  chatContextSkills: OrganizationSkillChatContext[]
  error: UserFacingError | null
  hasLoaded: boolean
  loading: boolean
  organizationId: string | null
  organizationName: string | null
  refresh(options?: { forceRefresh?: boolean }): Promise<void>
  removePackage(packageName: string): Promise<void>
  skills: OrganizationSkillConfigItem[]
}

interface OrganizationSkillCacheEntry {
  cacheKey: string
  fetchedAt: number
  organizationId: string
  skills: OrganizationSkillConfigItem[]
}

const organizationSkillCacheMs = 30_000
const organizationSkillPersistentCacheMaxAgeMs = 24 * 60 * 60 * 1000
const organizationSkillPersistentCacheStorageKey = "wanta.organization-skill-cache.v2"
const organizationSkillCache = new Map<string, OrganizationSkillCacheEntry>()
let organizationSkillPersistentCacheRead = false

function isOrganizationSkillCacheEntry(value: unknown): value is OrganizationSkillCacheEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false
  }

  const entry = value as Partial<OrganizationSkillCacheEntry>
  return (
    typeof entry.cacheKey === "string" &&
    typeof entry.fetchedAt === "number" &&
    Number.isFinite(entry.fetchedAt) &&
    typeof entry.organizationId === "string" &&
    Array.isArray(entry.skills)
  )
}

function readPersistentOrganizationSkillCache(): void {
  if (typeof window === "undefined" || organizationSkillPersistentCacheRead) {
    return
  }

  organizationSkillPersistentCacheRead = true
  try {
    const serialized = window.localStorage.getItem(organizationSkillPersistentCacheStorageKey)
    const entries = serialized ? JSON.parse(serialized) : []
    if (!Array.isArray(entries)) {
      return
    }
    const minimumFetchedAt = Date.now() - organizationSkillPersistentCacheMaxAgeMs
    for (const entry of entries) {
      if (isOrganizationSkillCacheEntry(entry) && entry.fetchedAt >= minimumFetchedAt) {
        organizationSkillCache.set(entry.cacheKey, entry)
      }
    }
  } catch {
    // localStorage 不可用或内容已损坏时退回网络请求，不影响组织切换。
  }
}

function persistOrganizationSkillCache(): void {
  if (typeof window === "undefined") {
    return
  }

  try {
    const minimumFetchedAt = Date.now() - organizationSkillPersistentCacheMaxAgeMs
    const entries = [...organizationSkillCache.values()].filter((entry) => entry.fetchedAt >= minimumFetchedAt)
    window.localStorage.setItem(organizationSkillPersistentCacheStorageKey, JSON.stringify(entries))
  } catch {
    // 配置缓存只是体验优化，存储失败不能阻断组织 Skill 的正常加载。
  }
}

function getOrganizationSkillCacheEntry(
  cacheKey: string,
  organizationId: string,
): OrganizationSkillCacheEntry | undefined {
  readPersistentOrganizationSkillCache()
  const entry = organizationSkillCache.get(cacheKey)
  return entry?.organizationId === organizationId ? entry : undefined
}

function setOrganizationSkillCacheEntry(entry: OrganizationSkillCacheEntry): void {
  organizationSkillCache.set(entry.cacheKey, entry)
  persistOrganizationSkillCache()
}

function deleteOrganizationSkillCacheEntry(cacheKey: string): void {
  if (organizationSkillCache.delete(cacheKey)) {
    persistOrganizationSkillCache()
  }
}

function organizationWorkspaceKey(workspace: WorkspaceSelection): string {
  return workspace.organizationId || "workspace-loading"
}

function organizationSkillCacheKey(workspace: WorkspaceSelection, accountId: string | undefined): string {
  const accountKey = accountId?.trim() || "anonymous"
  return `${accountKey}\u0000${organizationWorkspaceKey(workspace)}`
}

function organizationSkillError(cause: unknown): UserFacingError {
  return resolveUserFacingError(cause, { area: "skills" })
}

function isOrganizationSkillsUnavailable(cause: unknown): boolean {
  return cause instanceof OomolHttpError && cause.status === 404
}

function toChatContextSkill(skill: OrganizationSkillConfigItem): OrganizationSkillChatContext {
  return {
    ...(skill.description ? { description: skill.description } : {}),
    ...(skill.icon ? { icon: skill.icon } : {}),
    id: organizationSkillMentionId(skill),
    name: skill.displayName || skill.skillName,
    packageName: skill.packageName,
    skillName: skill.skillName,
    version: skill.version,
  }
}

export function useOrganizationSkills(workspace: WorkspaceSelection, accountId?: string): UseOrganizationSkills {
  const workspaceKey = organizationWorkspaceKey(workspace)
  const cacheKey = organizationSkillCacheKey(workspace, accountId)
  const organizationId = workspace.organizationId || null
  const organizationName = workspace.organization?.name ?? null
  const remoteApiEnabled = organizationSkillsApiEnabled()
  const canManage = workspace.canManage
  const [skills, setSkills] = React.useState<OrganizationSkillConfigItem[]>([])
  const [skillsOrganizationId, setSkillsOrganizationId] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<UserFacingError | null>(null)
  const [hasLoaded, setHasLoaded] = React.useState(false)
  const requestIdRef = React.useRef(0)
  const latestOrganizationIdRef = React.useRef<string | null>(organizationId)
  const latestCacheKeyRef = React.useRef(cacheKey)

  React.useEffect(() => {
    latestOrganizationIdRef.current = organizationId
    latestCacheKeyRef.current = cacheKey
    requestIdRef.current += 1
    const cached = organizationId ? getOrganizationSkillCacheEntry(cacheKey, organizationId) : undefined
    setSkills(cached?.skills ?? [])
    setSkillsOrganizationId(cached ? organizationId : null)
    setError(null)
    setHasLoaded(Boolean(cached))
    if (!organizationId || !remoteApiEnabled) {
      setLoading(false)
      setSkillsOrganizationId(organizationId)
      setHasLoaded(Boolean(organizationId && !remoteApiEnabled))
    }
  }, [cacheKey, organizationId, remoteApiEnabled, workspaceKey])

  const refresh = React.useCallback(
    async (options: { forceRefresh?: boolean } = {}): Promise<void> => {
      if (!organizationId || !remoteApiEnabled) {
        setSkills([])
        setSkillsOrganizationId(organizationId)
        setError(null)
        setHasLoaded(Boolean(organizationId && !remoteApiEnabled))
        setLoading(false)
        return
      }

      const now = Date.now()
      const cached = getOrganizationSkillCacheEntry(cacheKey, organizationId)
      if (!options.forceRefresh && cached && now - cached.fetchedAt < organizationSkillCacheMs) {
        setSkills(cached.skills)
        setSkillsOrganizationId(organizationId)
        setError(null)
        setHasLoaded(true)
        setLoading(false)
        return
      }

      const requestId = requestIdRef.current + 1
      requestIdRef.current = requestId
      setLoading(true)
      try {
        const config = await listOrganizationSkills(organizationId)
        if (requestIdRef.current !== requestId) {
          return
        }
        setOrganizationSkillCacheEntry({ cacheKey, fetchedAt: Date.now(), organizationId, skills: config.skills })
        setSkills(config.skills)
        setSkillsOrganizationId(organizationId)
        setError(null)
        setHasLoaded(true)
      } catch (cause) {
        if (requestIdRef.current === requestId) {
          if (isOrganizationSkillsUnavailable(cause)) {
            setOrganizationSkillCacheEntry({ cacheKey, fetchedAt: Date.now(), organizationId, skills: [] })
            setSkills([])
            setSkillsOrganizationId(organizationId)
            setError(null)
            setHasLoaded(true)
          } else {
            const fallback = getOrganizationSkillCacheEntry(cacheKey, organizationId)
            setSkills(fallback?.skills ?? [])
            setSkillsOrganizationId(fallback ? organizationId : null)
            setError(organizationSkillError(cause))
            setHasLoaded(Boolean(fallback))
          }
        }
      } finally {
        if (requestIdRef.current === requestId) {
          setLoading(false)
        }
      }
    },
    [cacheKey, organizationId, remoteApiEnabled, workspaceKey],
  )

  React.useEffect(() => {
    void refresh().catch((error: unknown) => {
      reportRendererHandledError("organization-skills", "organization skills refresh failed", error)
    })
  }, [refresh])

  const reloadAfterMutation = React.useCallback(
    async (targetOrganizationId: string, targetCacheKey: string): Promise<void> => {
      deleteOrganizationSkillCacheEntry(targetCacheKey)
      if (latestOrganizationIdRef.current !== targetOrganizationId || latestCacheKeyRef.current !== targetCacheKey) {
        return
      }
      await refresh({ forceRefresh: true })
    },
    [refresh],
  )

  const addSkill = React.useCallback(
    async (input: AddOrganizationSkillInput, options: { refresh?: boolean } = {}): Promise<void> => {
      if (!organizationId) {
        throw new Error("Organization is required.")
      }
      if (!remoteApiEnabled) {
        throw new Error("Organization Skill API is not enabled.")
      }
      const targetOrganizationId = organizationId
      const targetCacheKey = cacheKey
      await addOrganizationSkill(targetOrganizationId, input)
      if (options.refresh === false) {
        deleteOrganizationSkillCacheEntry(targetCacheKey)
      } else {
        await reloadAfterMutation(targetOrganizationId, targetCacheKey)
      }
    },
    [cacheKey, organizationId, reloadAfterMutation, remoteApiEnabled],
  )

  const removePackage = React.useCallback(
    async (packageName: string): Promise<void> => {
      if (!organizationId) {
        throw new Error("Organization is required.")
      }
      if (!remoteApiEnabled) {
        throw new Error("Organization Skill API is not enabled.")
      }
      const targetOrganizationId = organizationId
      const targetCacheKey = cacheKey
      await removeOrganizationSkill(targetOrganizationId, packageName)
      await reloadAfterMutation(targetOrganizationId, targetCacheKey)
    },
    [cacheKey, organizationId, reloadAfterMutation, remoteApiEnabled],
  )

  const cached = organizationId ? getOrganizationSkillCacheEntry(cacheKey, organizationId) : undefined
  const skillsBelongToCurrentOrganization = skillsOrganizationId === organizationId
  const currentSkills = skillsBelongToCurrentOrganization ? skills : (cached?.skills ?? [])
  const currentError = skillsBelongToCurrentOrganization ? error : null
  const currentHasLoaded = skillsBelongToCurrentOrganization ? hasLoaded : Boolean(cached)
  const currentLoading =
    loading || Boolean(organizationId && remoteApiEnabled && !skillsBelongToCurrentOrganization && !cached)
  const chatContextSkills = React.useMemo(() => currentSkills.map(toChatContextSkill), [currentSkills])

  return {
    addSkill,
    apiEnabled: remoteApiEnabled,
    canManage,
    chatContextSkills,
    error: currentError,
    hasLoaded: currentHasLoaded,
    loading: currentLoading,
    organizationId,
    organizationName,
    refresh,
    removePackage,
    skills: currentSkills,
  }
}
