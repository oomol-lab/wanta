import type { TeamMember } from "../../../electron/teams/common.ts"
import type { LoadState } from "./team-management-model.ts"

import * as React from "react"
import { getTeamSubscriptionStatus } from "@/lib/billing-client"
import { reportRendererHandledError } from "@/lib/renderer-diagnostics"
import { countOccupiedTeamSeats } from "@/lib/team-permissions"

export function useTeamSeatLimit({
  accountId,
  teamId,
  enabled,
  members,
  membersStatus,
}: {
  accountId: string | undefined
  teamId: string | undefined
  enabled: boolean
  members: TeamMember[]
  membersStatus: LoadState<TeamMember[]>["status"]
}) {
  const key = `${accountId ?? ""}:${teamId ?? ""}`
  const [state, setState] = React.useState<{ key: string; maxMembers?: number; loading: boolean } | null>(null)
  React.useEffect(() => {
    if (!enabled || !teamId || !accountId) return
    const controller = new AbortController()
    setState({ key, loading: true })
    void getTeamSubscriptionStatus(teamId, controller.signal)
      .then((subscription) => {
        if (!controller.signal.aborted) setState({ key, maxMembers: subscription.team.maxMembers, loading: false })
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return
        reportRendererHandledError("teams.seatLimit", "Team seat limit read failed", cause)
        // The member mutation remains authoritative when the optional preflight is unavailable.
        setState({ key, loading: false })
      })
    return () => controller.abort()
  }, [accountId, teamId, key, enabled])
  const maxMembers = state?.key === key ? state.maxMembers : undefined
  return {
    // Wait for an in-flight member read, but let the server enforce capacity if that read fails.
    loading:
      enabled && (membersStatus === "idle" || membersStatus === "loading" || state?.key !== key || state.loading),
    reached:
      membersStatus === "ready" &&
      typeof maxMembers === "number" &&
      Number.isFinite(maxMembers) &&
      maxMembers >= 0 &&
      countOccupiedTeamSeats(members) >= maxMembers,
  }
}
