import type { ConnectionWorkspace } from "../../electron/connections/common.ts"
import type { Organization, OrganizationOverview, OrganizationRole } from "../../electron/organizations/common.ts"
import type { UserFacingError } from "../lib/user-facing-error.ts"

import * as React from "react"
import { branding } from "../../electron/branding.ts"
import { onOrganizationChanged } from "../lib/organization-change-bus.ts"
import { organizationCanManage, organizationRole } from "../lib/organization-permissions.ts"
import { getOrganizationOverview } from "../lib/organizations-client.ts"
import { resolveUserFacingError } from "../lib/user-facing-error.ts"

export { organizationAvatarStyle, organizationInitials, organizationAvatarPalette } from "../lib/organization-avatar.ts"

export type WorkspaceSelection =
  | { type: "personal" }
  | {
      canManage: boolean
      organization: Organization | null
      organizationId: string
      role: OrganizationRole | null
      type: "organization"
    }

export interface UseOrganizationWorkspace {
  activeWorkspace: WorkspaceSelection
  connectionWorkspace: ConnectionWorkspace | null
  error: UserFacingError | null
  getOrganizationCanManage: (organization: Organization) => boolean
  getOrganizationRole: (organization: Organization) => OrganizationRole
  hasLoaded: boolean
  loading: boolean
  organizations: Organization[]
  refresh: (options?: OrganizationWorkspaceRefreshOptions) => Promise<void>
  selectOrganization: (organizationId: string) => void
  selectPersonal: () => void
}

export interface OrganizationWorkspaceRefreshOptions {
  forceRefresh?: boolean
}

interface WorkspaceOverviewCacheEntry {
  accountId: string
  fetchedAt: number
  overview: OrganizationOverview
}

interface WorkspaceOverviewInFlightEntry {
  accountId: string
  promise: Promise<OrganizationOverview>
}

const selectedWorkspaceStorageKeyPrefix = `${branding.storageKeyPrefix}:active-workspace:`
const legacySelectedWorkspaceStorageKeyPrefix = "lumo:active-workspace:"
const workspaceOverviewCacheMs = 30_000
let workspaceOverviewCache: WorkspaceOverviewCacheEntry | null = null
let workspaceOverviewInFlight: WorkspaceOverviewInFlightEntry | null = null

function selectedWorkspaceStorageKey(accountId: string): string {
  return `${selectedWorkspaceStorageKeyPrefix}${accountId}`
}

function legacySelectedWorkspaceStorageKey(accountId: string): string {
  return `${legacySelectedWorkspaceStorageKeyPrefix}${accountId}`
}

function readStoredOrganizationId(accountId: string | undefined): string | null {
  if (!accountId) {
    return null
  }
  try {
    const key = selectedWorkspaceStorageKey(accountId)
    const legacyKey = legacySelectedWorkspaceStorageKey(accountId)
    const currentRaw = window.localStorage.getItem(key)
    const legacyRaw = currentRaw === null ? window.localStorage.getItem(legacyKey) : null
    const raw = currentRaw ?? legacyRaw
    if (!raw) {
      return null
    }
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object" || !("type" in parsed)) {
      return null
    }
    if (legacyRaw !== null && (parsed.type === "organization" || parsed.type === "personal")) {
      window.localStorage.setItem(key, raw)
      window.localStorage.removeItem(legacyKey)
    }
    if (parsed.type !== "organization" || !("organizationId" in parsed)) {
      return null
    }
    return typeof parsed.organizationId === "string" && parsed.organizationId.trim() ? parsed.organizationId : null
  } catch {
    return null
  }
}

function writeStoredWorkspace(accountId: string | undefined, organizationId: string | null): void {
  if (!accountId) {
    return
  }
  try {
    const key = selectedWorkspaceStorageKey(accountId)
    if (organizationId) {
      window.localStorage.setItem(key, JSON.stringify({ type: "organization", organizationId }))
    } else {
      window.localStorage.setItem(key, JSON.stringify({ type: "personal" }))
    }
  } catch {
    // 本地记忆只是体验优化，失败不影响本次切换。
  }
}

function uniqueOrganizations(overview: OrganizationOverview | null): Organization[] {
  if (!overview) {
    return []
  }
  const seen = new Set<string>()
  return [...overview.created, ...overview.joined].filter((organization) => {
    if (seen.has(organization.id)) {
      return false
    }
    seen.add(organization.id)
    return true
  })
}

function workspaceError(cause: unknown, hasLoaded: boolean): UserFacingError {
  const error = resolveUserFacingError(cause, { area: "generic" })
  return {
    ...error,
    descriptionKey: hasLoaded ? "organizations.refreshFailedDescription" : "organizations.loadFailedDescription",
    titleKey: hasLoaded ? "organizations.refreshFailedTitle" : "organizations.loadFailed",
  }
}

function readCachedWorkspaceOverview(
  accountId: string,
  options: OrganizationWorkspaceRefreshOptions,
): Promise<OrganizationOverview> {
  const now = Date.now()
  if (
    !options.forceRefresh &&
    workspaceOverviewCache?.accountId === accountId &&
    now - workspaceOverviewCache.fetchedAt < workspaceOverviewCacheMs
  ) {
    return Promise.resolve(workspaceOverviewCache.overview)
  }

  if (!options.forceRefresh && workspaceOverviewInFlight?.accountId === accountId) {
    return workspaceOverviewInFlight.promise
  }

  const promise = getOrganizationOverview(accountId).then((overview) => {
    if (workspaceOverviewInFlight?.promise === promise) {
      workspaceOverviewCache = { accountId, fetchedAt: Date.now(), overview }
    }
    return overview
  })
  workspaceOverviewInFlight = { accountId, promise }
  void promise
    .finally(() => {
      if (workspaceOverviewInFlight?.promise === promise) {
        workspaceOverviewInFlight = null
      }
    })
    .catch(() => undefined)
  return promise
}

export function useOrganizationWorkspace(accountId: string | undefined): UseOrganizationWorkspace {
  const [overview, setOverview] = React.useState<OrganizationOverview | null>(null)
  const [selectedOrganizationId, setSelectedOrganizationId] = React.useState<string | null>(() =>
    readStoredOrganizationId(accountId),
  )
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<UserFacingError | null>(null)
  const requestIdRef = React.useRef(0)
  const loadedAccountIdRef = React.useRef<string | undefined>(undefined)
  const overviewRef = React.useRef<OrganizationOverview | null>(null)

  React.useEffect(() => {
    if (loadedAccountIdRef.current === accountId) {
      return
    }
    loadedAccountIdRef.current = accountId
    requestIdRef.current += 1
    overviewRef.current = null
    setOverview(null)
    setError(null)
    setSelectedOrganizationId(readStoredOrganizationId(accountId))
  }, [accountId])

  const refresh = React.useCallback(
    async (options: OrganizationWorkspaceRefreshOptions = {}): Promise<void> => {
      if (!accountId) {
        overviewRef.current = null
        setOverview(null)
        setError(null)
        setLoading(false)
        return
      }

      const requestId = requestIdRef.current + 1
      requestIdRef.current = requestId
      const hadOverview = overviewRef.current !== null
      setLoading(true)
      try {
        const next = await readCachedWorkspaceOverview(accountId, options)
        if (requestIdRef.current !== requestId) {
          return
        }
        overviewRef.current = next
        setOverview(next)
        setError(null)
        const organizations = uniqueOrganizations(next)
        setSelectedOrganizationId((current) => {
          if (!current || organizations.some((organization) => organization.id === current)) {
            return current
          }
          writeStoredWorkspace(accountId, null)
          return null
        })
      } catch (err) {
        if (requestIdRef.current === requestId) {
          setError(workspaceError(err, hadOverview))
        }
      } finally {
        if (requestIdRef.current === requestId) {
          setLoading(false)
        }
      }
    },
    [accountId],
  )

  React.useEffect(() => {
    void refresh()
  }, [refresh])

  React.useEffect(() => {
    return onOrganizationChanged(() => {
      void refresh({ forceRefresh: true })
    })
  }, [refresh])

  const organizations = React.useMemo(() => uniqueOrganizations(overview), [overview])
  const selectedOrganization = selectedOrganizationId
    ? (organizations.find((organization) => organization.id === selectedOrganizationId) ?? null)
    : null
  const activeWorkspace = React.useMemo<WorkspaceSelection>(() => {
    if (!selectedOrganizationId) {
      return { type: "personal" }
    }
    return {
      type: "organization",
      organizationId: selectedOrganizationId,
      organization: selectedOrganization,
      role: organizationRole(overview, selectedOrganization),
      canManage: organizationCanManage(overview, selectedOrganization),
    }
  }, [overview, selectedOrganization, selectedOrganizationId])
  const connectionWorkspace = React.useMemo<ConnectionWorkspace | null>(() => {
    if (!selectedOrganizationId) {
      return { type: "personal" }
    }
    return selectedOrganization?.name ? { type: "organization", organizationName: selectedOrganization.name } : null
  }, [selectedOrganization?.name, selectedOrganizationId])

  const selectPersonal = React.useCallback(() => {
    writeStoredWorkspace(accountId, null)
    setSelectedOrganizationId(null)
  }, [accountId])

  const selectOrganization = React.useCallback(
    (organizationId: string) => {
      writeStoredWorkspace(accountId, organizationId)
      setSelectedOrganizationId(organizationId)
    },
    [accountId],
  )

  const getOrganizationRole = React.useCallback(
    (organization: Organization): OrganizationRole => organizationRole(overview, organization) ?? "member",
    [overview],
  )
  const getOrganizationCanManage = React.useCallback(
    (organization: Organization): boolean => organizationCanManage(overview, organization),
    [overview],
  )

  return {
    activeWorkspace,
    connectionWorkspace,
    error,
    getOrganizationCanManage,
    getOrganizationRole,
    hasLoaded: overview !== null,
    loading,
    organizations,
    refresh,
    selectOrganization,
    selectPersonal,
  }
}
