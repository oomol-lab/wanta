import type { WorkspaceSelection } from "./useOrganizationWorkspace.ts"

import * as React from "react"
import { useAuth } from "@/hooks/useAuth"
import { getCachedOrganizationMembers, getOrganizationMembersResource } from "@/lib/organization-details-resource"

export interface UseBillableSeats {
  count: number | null
  error: string | null
  loading: boolean
}

export function useBillableSeats(workspace: WorkspaceSelection, enabled = true): UseBillableSeats {
  const { state: authState } = useAuth()
  const accountId = authState?.status === "authenticated" ? (authState.account?.id ?? null) : null
  const organizationId = workspace.organizationId || null
  const cachedMembers = accountId && organizationId ? getCachedOrganizationMembers(accountId, organizationId) : null
  const [count, setCount] = React.useState<number | null>(() =>
    cachedMembers ? Math.max(1, cachedMembers.length) : null,
  )
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!enabled || !accountId || !organizationId) {
      setCount(null)
      setError(null)
      setLoading(false)
      return
    }

    let cancelled = false
    const cached = getCachedOrganizationMembers(accountId, organizationId)
    if (cached) {
      setCount(Math.max(1, cached.length))
      setError(null)
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)
    void getOrganizationMembersResource(accountId, organizationId)
      .then((members) => {
        if (!cancelled) {
          setCount(Math.max(1, members.length))
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setCount(null)
          setError(cause instanceof Error ? cause.message : String(cause))
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [accountId, enabled, organizationId])

  return { count, error, loading }
}
