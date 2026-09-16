import type { TeamMember } from "../../../electron/teams/common.ts"

import * as React from "react"
import { getTeamSubscriptionStatus } from "@/lib/billing-client"
import { reportRendererHandledError } from "@/lib/renderer-diagnostics"
import { countOccupiedTeamSeats } from "@/lib/team-permissions"

export function useTeamSeatLimit({
  accountId,
  teamId,
  enabled,
  members,
  membersComplete,
}: {
  accountId: string | undefined
  teamId: string | undefined
  enabled: boolean
  members: TeamMember[]
  membersComplete: boolean
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
    loading: enabled && (state?.key !== key || state.loading),
    reached:
      membersComplete &&
      typeof maxMembers === "number" &&
      Number.isFinite(maxMembers) &&
      maxMembers >= 0 &&
      countOccupiedTeamSeats(members) >= maxMembers,
  }
}
