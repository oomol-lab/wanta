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
import { resolveUserFacingError } from "@/lib/user-facing-error"

export interface OrganizationSkillChatContext {
  description?: string
  id: string
  name: string
  packageName?: string
  version?: string
}

export interface UseOrganizationSkills {
  addSkill(input: AddOrganizationSkillInput): Promise<void>
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
  fetchedAt: number
  organizationId: string
  skills: OrganizationSkillConfigItem[]
}

const organizationSkillCacheMs = 30_000
let organizationSkillCache: OrganizationSkillCacheEntry | null = null

function organizationWorkspaceKey(workspace: WorkspaceSelection): string {
  return workspace.type === "organization" ? workspace.organizationId : "personal"
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
    id: organizationSkillMentionId(skill),
    name: skill.displayName || skill.skillName,
    packageName: skill.packageName,
    version: skill.version,
  }
}

export function useOrganizationSkills(workspace: WorkspaceSelection): UseOrganizationSkills {
  const workspaceKey = organizationWorkspaceKey(workspace)
  const organizationId = workspace.type === "organization" ? workspace.organizationId : null
  const organizationName = workspace.type === "organization" ? (workspace.organization?.name ?? null) : null
  const remoteApiEnabled = organizationSkillsApiEnabled()
  const canManage = workspace.type === "organization" && workspace.role === "creator"
  const [skills, setSkills] = React.useState<OrganizationSkillConfigItem[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<UserFacingError | null>(null)
  const [hasLoaded, setHasLoaded] = React.useState(false)
  const requestIdRef = React.useRef(0)
  const latestOrganizationIdRef = React.useRef<string | null>(organizationId)

  React.useEffect(() => {
    latestOrganizationIdRef.current = organizationId
    requestIdRef.current += 1
    setSkills([])
    setError(null)
    setHasLoaded(false)
    if (!organizationId || !remoteApiEnabled) {
      setLoading(false)
      setHasLoaded(Boolean(organizationId && !remoteApiEnabled))
    }
  }, [organizationId, remoteApiEnabled, workspaceKey])

  const refresh = React.useCallback(
    async (options: { forceRefresh?: boolean } = {}): Promise<void> => {
      if (!organizationId || !remoteApiEnabled) {
        setSkills([])
        setError(null)
        setHasLoaded(Boolean(organizationId && !remoteApiEnabled))
        setLoading(false)
        return
      }

      const now = Date.now()
      if (
        !options.forceRefresh &&
        organizationSkillCache?.organizationId === organizationId &&
        now - organizationSkillCache.fetchedAt < organizationSkillCacheMs
      ) {
        setSkills(organizationSkillCache.skills)
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
        organizationSkillCache = { fetchedAt: Date.now(), organizationId, skills: config.skills }
        setSkills(config.skills)
        setError(null)
        setHasLoaded(true)
      } catch (cause) {
        if (requestIdRef.current === requestId) {
          if (isOrganizationSkillsUnavailable(cause)) {
            organizationSkillCache = { fetchedAt: Date.now(), organizationId, skills: [] }
            setSkills([])
            setError(null)
            setHasLoaded(true)
          } else {
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
    [organizationId, remoteApiEnabled],
  )

  React.useEffect(() => {
    void refresh().catch(() => undefined)
  }, [refresh])

  const reloadAfterMutation = React.useCallback(
    async (targetOrganizationId: string): Promise<void> => {
      if (latestOrganizationIdRef.current !== targetOrganizationId) {
        return
      }
      if (organizationSkillCache?.organizationId === targetOrganizationId) {
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
      await addOrganizationSkill(targetOrganizationId, input)
      await reloadAfterMutation(targetOrganizationId)
    },
    [organizationId, reloadAfterMutation, remoteApiEnabled],
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
      await updateOrganizationSkill(targetOrganizationId, configId, input)
      await reloadAfterMutation(targetOrganizationId)
    },
    [organizationId, reloadAfterMutation, remoteApiEnabled],
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
      await removeOrganizationSkill(targetOrganizationId, configId)
      await reloadAfterMutation(targetOrganizationId)
    },
    [organizationId, reloadAfterMutation, remoteApiEnabled],
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
      if (requestIdRef.current !== requestId || latestOrganizationIdRef.current !== targetOrganizationId) {
        return
      }
      organizationSkillCache = { fetchedAt: Date.now(), organizationId: targetOrganizationId, skills: config.skills }
      setSkills(config.skills)
      setError(null)
      setHasLoaded(true)
    },
    [organizationId, remoteApiEnabled],
  )

  const chatContextSkills = React.useMemo(
    () => skills.filter((skill) => skill.enabled).map(toChatContextSkill),
    [skills],
  )

  return {
    addSkill,
    canManage,
    chatContextSkills,
    error,
    hasLoaded,
    loading,
    organizationId,
    organizationName,
    refresh,
    removeSkill,
    reorder,
    skills,
    updateSkill,
  }
}
