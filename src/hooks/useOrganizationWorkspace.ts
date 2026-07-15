import type { ConnectionWorkspace } from "../../electron/connections/common.ts"
import type { Organization, OrganizationOverview, OrganizationRole } from "../../electron/organizations/common.ts"
import type { UserFacingError } from "../lib/user-facing-error.ts"

import * as React from "react"
import { branding } from "../../electron/branding.ts"
import { dropCachedAvatarImage } from "../lib/avatar-image-cache.ts"
import {
  applyOrganizationPatchesToOverview,
  resolveOrganizationSelection,
  upsertOverviewOrganization,
} from "../lib/organization-overview.ts"
import { organizationCanManage, organizationRole } from "../lib/organization-permissions.ts"
import { getOrganizationOverview } from "../lib/organizations-client.ts"
import { reportRendererHandledError } from "../lib/renderer-diagnostics.ts"
import { resolveUserFacingError } from "../lib/user-facing-error.ts"

export { organizationAvatarStyle, organizationInitials, organizationAvatarPalette } from "../lib/organization-avatar.ts"

export interface WorkspaceSelection {
  canManage: boolean
  organization: Organization | null
  avatarPreviewUrl?: string
  organizationId: string
  role: OrganizationRole | null
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
  organizationAvatarPreviewUrls: Record<string, string>
  clearOrganizationAvatarPreview: (organizationId: string) => void
  refresh: (options?: OrganizationWorkspaceRefreshOptions) => Promise<void>
  selectOrganization: (organizationId: string) => void
  syncOverview: (overview: OrganizationOverview) => void
  upsertOrganization: (organization: Organization, options?: OrganizationWorkspaceUpsertOptions) => void
}

export interface OrganizationWorkspaceRefreshOptions {
  forceRefresh?: boolean
}

export interface OrganizationWorkspaceUpsertOptions {
  avatarFile?: File | null
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

interface PendingWorkspaceOrganizationPatch {
  organization: Organization
  patchedAt: number
}

const selectedWorkspaceStorageKeyPrefix = `${branding.storageKeyPrefix}:active-workspace:`
const legacySelectedWorkspaceStorageKeyPrefix = "lumo:active-workspace:"
const workspaceOverviewCacheMs = 30_000
const workspaceOverviewPatchTtlMs = 120_000
let workspaceOverviewCache: WorkspaceOverviewCacheEntry | null = null
let workspaceOverviewInFlight: WorkspaceOverviewInFlightEntry | null = null
const pendingWorkspaceOrganizationPatches = new Map<string, PendingWorkspaceOrganizationPatch>()

function workspaceOrganizationPatchKey(accountId: string, organizationId: string): string {
  return `${accountId}\u0000${organizationId}`
}

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
    if (!parsed || typeof parsed !== "object") {
      return null
    }
    if (legacyRaw !== null && "organizationId" in parsed) {
      window.localStorage.setItem(key, raw)
      window.localStorage.removeItem(legacyKey)
    }
    if (!("organizationId" in parsed)) {
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
      window.localStorage.setItem(key, JSON.stringify({ organizationId }))
    } else {
      window.localStorage.removeItem(key)
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

function rememberWorkspaceOrganizationPatch(accountId: string, organization: Organization): void {
  pendingWorkspaceOrganizationPatches.set(workspaceOrganizationPatchKey(accountId, organization.id), {
    organization,
    patchedAt: Date.now(),
  })
}

function activeWorkspaceOrganizationPatches(accountId: string, now = Date.now()): Organization[] {
  const patches: Organization[] = []
  const keyPrefix = `${accountId}\u0000`
  for (const [key, patch] of pendingWorkspaceOrganizationPatches) {
    if (now - patch.patchedAt > workspaceOverviewPatchTtlMs) {
      pendingWorkspaceOrganizationPatches.delete(key)
      continue
    }
    if (!key.startsWith(keyPrefix)) {
      continue
    }
    patches.push(patch.organization)
  }
  return patches
}

function applyPendingWorkspaceOrganizationPatches(
  accountId: string,
  overview: OrganizationOverview,
): OrganizationOverview {
  const patches = activeWorkspaceOrganizationPatches(accountId)
  return patches.length > 0 ? applyOrganizationPatchesToOverview(overview, patches) : overview
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
    .catch((error: unknown) => {
      reportRendererHandledError("organization-workspace", "organization overview request failed", error)
    })
  return promise
}

export function useOrganizationWorkspace(accountId: string | undefined): UseOrganizationWorkspace {
  const [overview, setOverview] = React.useState<OrganizationOverview | null>(null)
  const [selectedOrganizationId, setSelectedOrganizationId] = React.useState<string | null>(() =>
    readStoredOrganizationId(accountId),
  )
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<UserFacingError | null>(null)
  const [organizationAvatarPreviewUrls, setOrganizationAvatarPreviewUrls] = React.useState<Record<string, string>>({})
  const requestIdRef = React.useRef(0)
  const loadedAccountIdRef = React.useRef<string | undefined>(undefined)
  const skipWorkspacePersistenceRef = React.useRef(false)
  const overviewRef = React.useRef<OrganizationOverview | null>(null)
  const organizationAvatarPreviewUrlsRef = React.useRef(new Map<string, string>())

  React.useEffect(() => {
    if (loadedAccountIdRef.current === accountId) {
      return
    }
    loadedAccountIdRef.current = accountId
    skipWorkspacePersistenceRef.current = true
    requestIdRef.current += 1
    overviewRef.current = null
    setOverview(null)
    setError(null)
    setSelectedOrganizationId(readStoredOrganizationId(accountId))
  }, [accountId])

  React.useEffect(() => {
    if (skipWorkspacePersistenceRef.current) {
      // 切换账号的首轮 effect 仍持有旧选择，等待新账号的本地选择进入 state 后再持久化。
      skipWorkspacePersistenceRef.current = false
      return
    }
    writeStoredWorkspace(accountId, selectedOrganizationId)
  }, [accountId, selectedOrganizationId])

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
        const next = applyPendingWorkspaceOrganizationPatches(
          accountId,
          await readCachedWorkspaceOverview(accountId, options),
        )
        if (requestIdRef.current !== requestId) {
          return
        }
        overviewRef.current = next
        setOverview(next)
        setError(null)
        const organizations = uniqueOrganizations(next)
        setSelectedOrganizationId((current) => resolveOrganizationSelection(current, organizations))
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

  const syncOverview = React.useCallback(
    (nextOverview: OrganizationOverview): void => {
      if (!accountId || nextOverview.accountId !== accountId) {
        return
      }
      const next = applyPendingWorkspaceOrganizationPatches(accountId, nextOverview)
      requestIdRef.current += 1
      overviewRef.current = next
      if (workspaceOverviewInFlight?.accountId === accountId) {
        workspaceOverviewInFlight = null
      }
      workspaceOverviewCache = { accountId, fetchedAt: Date.now(), overview: next }
      setOverview(next)
      setError(null)
      setLoading(false)
      const organizations = uniqueOrganizations(next)
      setSelectedOrganizationId((current) => resolveOrganizationSelection(current, organizations))
    },
    [accountId],
  )

  const clearOrganizationAvatarPreview = React.useCallback((organizationId: string): void => {
    const currentPreviewUrl = organizationAvatarPreviewUrlsRef.current.get(organizationId)
    if (!currentPreviewUrl) {
      return
    }
    URL.revokeObjectURL(currentPreviewUrl)
    organizationAvatarPreviewUrlsRef.current.delete(organizationId)
    setOrganizationAvatarPreviewUrls(Object.fromEntries(organizationAvatarPreviewUrlsRef.current))
  }, [])

  const setOrganizationAvatarPreview = React.useCallback((organizationId: string, file: File | null): void => {
    const currentPreviewUrl = organizationAvatarPreviewUrlsRef.current.get(organizationId)
    if (currentPreviewUrl) {
      URL.revokeObjectURL(currentPreviewUrl)
      organizationAvatarPreviewUrlsRef.current.delete(organizationId)
    }
    if (file) {
      organizationAvatarPreviewUrlsRef.current.set(organizationId, URL.createObjectURL(file))
    }
    setOrganizationAvatarPreviewUrls(Object.fromEntries(organizationAvatarPreviewUrlsRef.current))
  }, [])

  const upsertOrganization = React.useCallback(
    (organization: Organization, options: OrganizationWorkspaceUpsertOptions = {}): void => {
      if (!accountId) {
        return
      }
      rememberWorkspaceOrganizationPatch(accountId, organization)
      if ("avatarFile" in options) {
        dropCachedAvatarImage(organization.avatar)
        setOrganizationAvatarPreview(organization.id, options.avatarFile ?? null)
      }
      setOverview((current) => {
        const next = upsertOverviewOrganization(current, organization)
        if (!next) {
          return current
        }
        overviewRef.current = next
        if (workspaceOverviewCache?.accountId === accountId) {
          workspaceOverviewCache = { ...workspaceOverviewCache, fetchedAt: Date.now(), overview: next }
        }
        return next
      })
    },
    [accountId, setOrganizationAvatarPreview],
  )

  React.useEffect(() => {
    return () => {
      for (const previewUrl of organizationAvatarPreviewUrlsRef.current.values()) {
        URL.revokeObjectURL(previewUrl)
      }
      organizationAvatarPreviewUrlsRef.current.clear()
    }
  }, [])

  React.useEffect(() => {
    void refresh()
  }, [refresh])

  const organizations = React.useMemo(() => uniqueOrganizations(overview), [overview])
  const selectedOrganization = selectedOrganizationId
    ? (organizations.find((organization) => organization.id === selectedOrganizationId) ?? null)
    : null
  const activeWorkspace = React.useMemo<WorkspaceSelection>(() => {
    if (!selectedOrganizationId || !selectedOrganization) {
      return {
        canManage: false,
        organization: null,
        organizationId: "",
        role: null,
      }
    }
    return {
      avatarPreviewUrl: organizationAvatarPreviewUrls[selectedOrganizationId],
      organizationId: selectedOrganizationId,
      organization: selectedOrganization,
      role: organizationRole(overview, selectedOrganization),
      canManage: organizationCanManage(overview, selectedOrganization),
    }
  }, [organizationAvatarPreviewUrls, overview, selectedOrganization, selectedOrganizationId])
  const connectionWorkspace = React.useMemo<ConnectionWorkspace | null>(() => {
    return selectedOrganization?.name ? { organizationName: selectedOrganization.name } : null
  }, [selectedOrganization?.name, selectedOrganizationId])

  const selectOrganization = React.useCallback((organizationId: string) => {
    setSelectedOrganizationId(organizationId)
  }, [])

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
    organizationAvatarPreviewUrls,
    clearOrganizationAvatarPreview,
    refresh,
    selectOrganization,
    syncOverview,
    upsertOrganization,
  }
}
