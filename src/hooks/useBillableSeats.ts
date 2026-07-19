import type { WorkspaceSelection } from "./useTeamWorkspace.ts"
import type { UserFacingError } from "@/lib/user-facing-error"

import * as React from "react"
import { useAuth } from "@/hooks/useAuth"
import { reportRendererHandledError } from "@/lib/renderer-diagnostics"
import { getCachedTeamMembers, getTeamMembersResource, subscribeTeamMembersResource } from "@/lib/team-details-resource"
import { resolveUserFacingError } from "@/lib/user-facing-error"

export interface UseBillableSeats {
  count: number | null
  error: UserFacingError | null
  loading: boolean
}

export function useBillableSeats(workspace: WorkspaceSelection, enabled = true): UseBillableSeats {
  const { state: authState } = useAuth()
  const accountId = authState?.status === "authenticated" ? (authState.account?.id ?? null) : null
  const teamId = workspace.teamId || null
  const cachedMembers = accountId && teamId ? getCachedTeamMembers(accountId, teamId) : null
  const [count, setCount] = React.useState<number | null>(() =>
    cachedMembers ? Math.max(1, cachedMembers.length) : null,
  )
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<UserFacingError | null>(null)
  const [resourceVersion, setResourceVersion] = React.useState(0)

  React.useEffect(() => {
    if (!accountId || !teamId) {
      return
    }
    return subscribeTeamMembersResource(accountId, teamId, () => {
      setResourceVersion((version) => version + 1)
    })
  }, [accountId, teamId])

  React.useEffect(() => {
    if (!enabled || !accountId || !teamId) {
      setCount(null)
      setError(null)
      setLoading(false)
      return
    }

    let cancelled = false
    const cached = getCachedTeamMembers(accountId, teamId)
    if (cached) {
      setCount(Math.max(1, cached.length))
      setError(null)
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)
    void getTeamMembersResource(accountId, teamId)
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
  }, [accountId, enabled, teamId, resourceVersion])

  return { count, error, loading }
}
