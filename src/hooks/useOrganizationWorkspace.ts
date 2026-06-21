import type { ConnectionWorkspace } from "../../electron/connections/common.ts"
import type { Organization, OrganizationOverview, OrganizationRole } from "../../electron/organizations/common.ts"
import type { UserFacingError } from "../lib/user-facing-error.ts"

import * as React from "react"
import { useOrganizationsService } from "../components/AppContext.ts"
import { resolveUserFacingError } from "../lib/user-facing-error.ts"

export type WorkspaceSelection =
  | { type: "personal" }
  | { organization: Organization | null; organizationId: string; role: OrganizationRole | null; type: "organization" }

export interface UseOrganizationWorkspace {
  activeWorkspace: WorkspaceSelection
  connectionWorkspace: ConnectionWorkspace | null
  error: UserFacingError | null
  getOrganizationRole: (organization: Organization) => OrganizationRole
  loading: boolean
  organizations: Organization[]
  refresh: () => Promise<void>
  selectOrganization: (organizationId: string) => void
  selectPersonal: () => void
}

const selectedWorkspaceStorageKeyPrefix = "lumo:active-workspace:"

function selectedWorkspaceStorageKey(accountId: string): string {
  return `${selectedWorkspaceStorageKeyPrefix}${accountId}`
}

function readStoredOrganizationId(accountId: string | undefined): string | null {
  if (!accountId) {
    return null
  }
  try {
    const raw = window.localStorage.getItem(selectedWorkspaceStorageKey(accountId))
    if (!raw) {
      return null
    }
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object" || !("type" in parsed)) {
      return null
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

function organizationRole(
  overview: OrganizationOverview | null,
  organization: Organization | null,
): OrganizationRole | null {
  if (!overview || !organization) {
    return null
  }
  return organization.creator_user_id === overview.accountId ||
    overview.created.some((created) => created.id === organization.id)
    ? "creator"
    : "member"
}

export function organizationInitials(name: string): string {
  return name.trim().slice(0, 2).toLocaleUpperCase() || "OR"
}

export function useOrganizationWorkspace(accountId: string | undefined): UseOrganizationWorkspace {
  const organizationService = useOrganizationsService()
  const [overview, setOverview] = React.useState<OrganizationOverview | null>(null)
  const [selectedOrganizationId, setSelectedOrganizationId] = React.useState<string | null>(() =>
    readStoredOrganizationId(accountId),
  )
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<UserFacingError | null>(null)
  const requestIdRef = React.useRef(0)
  const loadedAccountIdRef = React.useRef<string | undefined>(undefined)

  React.useEffect(() => {
    if (loadedAccountIdRef.current === accountId) {
      return
    }
    loadedAccountIdRef.current = accountId
    requestIdRef.current += 1
    setOverview(null)
    setError(null)
    setSelectedOrganizationId(readStoredOrganizationId(accountId))
  }, [accountId])

  const refresh = React.useCallback(async (): Promise<void> => {
    if (!accountId) {
      setOverview(null)
      setError(null)
      setLoading(false)
      return
    }

    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    setLoading(true)
    try {
      const next = await organizationService.invoke("getOrganizationOverview", { forceRefresh: true })
      if (requestIdRef.current !== requestId) {
        return
      }
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
        setError(resolveUserFacingError(err, { area: "connections" }))
      }
    } finally {
      if (requestIdRef.current === requestId) {
        setLoading(false)
      }
    }
  }, [accountId, organizationService])

  React.useEffect(() => {
    void refresh()
  }, [refresh])

  React.useEffect(() => {
    return organizationService.serverEvents.on("organizationChanged", () => {
      void refresh()
    })
  }, [organizationService.serverEvents, refresh])

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

  return {
    activeWorkspace,
    connectionWorkspace,
    error,
    getOrganizationRole,
    loading,
    organizations,
    refresh,
    selectOrganization,
    selectPersonal,
  }
}
