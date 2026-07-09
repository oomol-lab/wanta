import type { WorkspaceSelection } from "@/hooks/useOrganizationWorkspace"
import type {
  AddOrganizationSkillInput,
  OrganizationSkillConfigItem,
  ReorderOrganizationSkillInput,
  UpdateOrganizationSkillInput,
} from "@/lib/organization-skills-client"
import type { UserFacingError } from "@/lib/user-facing-error"

import * as React from "react"
import { OomolHttpError } from "@/lib/oomol-http"
import {
  addOrganizationSkill,
  listOrganizationSkills,
  organizationSkillMentionId,
  organizationSkillsApiEnabled,
  removeOrganizationSkill,
  reorderOrganizationSkills,
  updateOrganizationSkill,
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
  addSkill(input: AddOrganizationSkillInput): Promise<void>
  apiEnabled: boolean
  canManage: boolean
  chatContextSkills: OrganizationSkillChatContext[]
  error: UserFacingError | null
  hasLoaded: boolean
  loading: boolean
  organizationId: string | null
  organizationName: string | null
  refresh(options?: { forceRefresh?: boolean }): Promise<void>
  removeSkill(configId: string): Promise<void>
  reorder(items: ReorderOrganizationSkillInput[]): Promise<void>
  skills: OrganizationSkillConfigItem[]
  updateSkill(configId: string, input: UpdateOrganizationSkillInput): Promise<void>
}

interface OrganizationSkillCacheEntry {
  cacheKey: string
  fetchedAt: number
  organizationId: string
  skills: OrganizationSkillConfigItem[]
}

const organizationSkillCacheMs = 30_000
let organizationSkillCache: OrganizationSkillCacheEntry | null = null

function organizationWorkspaceKey(workspace: WorkspaceSelection): string {
  return workspace.type === "organization" ? workspace.organizationId : "personal"
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
  const organizationId = workspace.type === "organization" ? workspace.organizationId : null
  const organizationName = workspace.type === "organization" ? (workspace.organization?.name ?? null) : null
  const remoteApiEnabled = organizationSkillsApiEnabled()
  const canManage = workspace.type === "organization" && workspace.canManage
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
    setSkills([])
    setSkillsOrganizationId(null)
    setError(null)
    setHasLoaded(false)
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
      if (
        !options.forceRefresh &&
        organizationSkillCache?.cacheKey === cacheKey &&
        organizationSkillCache?.organizationId === organizationId &&
        now - organizationSkillCache.fetchedAt < organizationSkillCacheMs
      ) {
        setSkills(organizationSkillCache.skills)
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
        organizationSkillCache = { cacheKey, fetchedAt: Date.now(), organizationId, skills: config.skills }
        setSkills(config.skills)
        setSkillsOrganizationId(organizationId)
        setError(null)
        setHasLoaded(true)
      } catch (cause) {
        if (requestIdRef.current === requestId) {
          if (isOrganizationSkillsUnavailable(cause)) {
            organizationSkillCache = { cacheKey, fetchedAt: Date.now(), organizationId, skills: [] }
            setSkills([])
            setSkillsOrganizationId(organizationId)
            setError(null)
            setHasLoaded(true)
          } else {
            setSkillsOrganizationId(organizationId)
            setError(organizationSkillError(cause))
            setHasLoaded(false)
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
      if (latestOrganizationIdRef.current !== targetOrganizationId || latestCacheKeyRef.current !== targetCacheKey) {
        return
      }
      if (organizationSkillCache?.cacheKey === targetCacheKey) {
        organizationSkillCache = null
      }
      await refresh({ forceRefresh: true })
    },
    [refresh],
  )

  const addSkill = React.useCallback(
    async (input: AddOrganizationSkillInput): Promise<void> => {
      if (!organizationId) {
        throw new Error("Organization is required.")
      }
      if (!remoteApiEnabled) {
        throw new Error("Organization Skill API is not enabled.")
      }
      const targetOrganizationId = organizationId
      const targetCacheKey = cacheKey
      await addOrganizationSkill(targetOrganizationId, input)
      await reloadAfterMutation(targetOrganizationId, targetCacheKey)
    },
    [cacheKey, organizationId, reloadAfterMutation, remoteApiEnabled],
  )

  const updateSkill = React.useCallback(
    async (configId: string, input: UpdateOrganizationSkillInput): Promise<void> => {
      if (!organizationId) {
        throw new Error("Organization is required.")
      }
      if (!remoteApiEnabled) {
        throw new Error("Organization Skill API is not enabled.")
      }
      const targetOrganizationId = organizationId
      const targetCacheKey = cacheKey
      await updateOrganizationSkill(targetOrganizationId, configId, input)
      await reloadAfterMutation(targetOrganizationId, targetCacheKey)
    },
    [cacheKey, organizationId, reloadAfterMutation, remoteApiEnabled],
  )

  const removeSkill = React.useCallback(
    async (configId: string): Promise<void> => {
      if (!organizationId) {
        throw new Error("Organization is required.")
      }
      if (!remoteApiEnabled) {
        throw new Error("Organization Skill API is not enabled.")
      }
      const targetOrganizationId = organizationId
      const targetCacheKey = cacheKey
      const targetSkill = skills.find((skill) => skill.id === configId)
      await removeOrganizationSkill(targetOrganizationId, targetSkill?.packageName ?? configId)
      await reloadAfterMutation(targetOrganizationId, targetCacheKey)
    },
    [cacheKey, organizationId, reloadAfterMutation, remoteApiEnabled, skills],
  )

  const reorder = React.useCallback(
    async (items: ReorderOrganizationSkillInput[]): Promise<void> => {
      if (!organizationId) {
        throw new Error("Organization is required.")
      }
      if (!remoteApiEnabled) {
        throw new Error("Organization Skill API is not enabled.")
      }
      const targetOrganizationId = organizationId
      const requestId = requestIdRef.current + 1
      requestIdRef.current = requestId
      const config = await reorderOrganizationSkills(targetOrganizationId, items)
      if (
        requestIdRef.current !== requestId ||
        latestOrganizationIdRef.current !== targetOrganizationId ||
        latestCacheKeyRef.current !== cacheKey
      ) {
        return
      }
      organizationSkillCache = {
        cacheKey,
        fetchedAt: Date.now(),
        organizationId: targetOrganizationId,
        skills: config.skills,
      }
      setSkills(config.skills)
      setSkillsOrganizationId(targetOrganizationId)
      setError(null)
      setHasLoaded(true)
    },
    [cacheKey, organizationId, remoteApiEnabled],
  )

  const skillsBelongToCurrentOrganization = skillsOrganizationId === organizationId
  const currentSkills = skillsBelongToCurrentOrganization ? skills : []
  const currentError = skillsBelongToCurrentOrganization ? error : null
  const currentHasLoaded = skillsBelongToCurrentOrganization ? hasLoaded : false
  const currentLoading = loading || Boolean(organizationId && remoteApiEnabled && !skillsBelongToCurrentOrganization)
  const chatContextSkills = React.useMemo(
    () => currentSkills.filter((skill) => skill.enabled).map(toChatContextSkill),
    [currentSkills],
  )

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
    removeSkill,
    reorder,
    skills: currentSkills,
    updateSkill,
  }
}
