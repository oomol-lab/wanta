import type { WorkspaceSelection } from "./useOrganizationWorkspace.ts"
import type { UserFacingError } from "@/lib/user-facing-error"

import * as React from "react"
import { useAuth } from "@/hooks/useAuth"
import { getCachedOrganizationMembers, getOrganizationMembersResource } from "@/lib/organization-details-resource"
import { reportRendererHandledError } from "@/lib/renderer-diagnostics"
import { resolveUserFacingError } from "@/lib/user-facing-error"

export interface UseBillableSeats {
  count: number | null
  error: UserFacingError | null
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
  const [error, setError] = React.useState<UserFacingError | null>(null)

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
          reportRendererHandledError("billing.seats", "billable seat count load failed", cause)
          setCount(null)
          setError(resolveUserFacingError(cause, { area: "billing" }))
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
