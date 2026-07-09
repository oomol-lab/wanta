import type { WorkspaceSelection } from "./useOrganizationWorkspace.ts"

import * as React from "react"
import { listOrganizationMembers } from "@/lib/organizations-client"

export interface UseBillableSeats {
  count: number | null
  error: string | null
  loading: boolean
}

export function useBillableSeats(workspace: WorkspaceSelection, enabled = true): UseBillableSeats {
  const [count, setCount] = React.useState<number | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const organizationId = workspace.type === "organization" ? workspace.organizationId : null

  React.useEffect(() => {
    if (!enabled || !organizationId) {
      setCount(null)
      setError(null)
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)
    void listOrganizationMembers(organizationId)
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
  }, [enabled, organizationId])

  return { count, error, loading }
}
