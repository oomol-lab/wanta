import type { Team, TeamMember, TeamUserSummary } from "../../../electron/teams/common.ts"
import type { LoadState } from "./team-management-model.ts"

import * as React from "react"
import { errorState, loadState, loadingState, readyState, uniqueStrings } from "./team-management-model.ts"
import {
  getCachedTeamMembers,
  getCachedTeamUserSummaries,
  getTeamMembersResource,
  getTeamUserSummariesResource,
} from "@/lib/team-details-resource"

type AsyncResult<T> = { ok: true; value: T } | { error: unknown; ok: false }

function settle<T>(promise: Promise<T>): Promise<AsyncResult<T>> {
  return promise.then(
    (value) => ({ ok: true, value }),
    (error: unknown) => ({ error, ok: false }),
  )
}

/** Team settings owns membership only. Connection permission rules are edited from each Connection. */
export function useTeamDetails({
  activeAccountId,
  selectedTeam,
}: {
  activeAccountId: string | undefined
  selectedTeam: Team | null
}) {
  const [membersState, setMembersState] = React.useState<LoadState<TeamMember[]>>(() => loadState([]))
  const [summariesState, setSummariesState] = React.useState<LoadState<Record<string, TeamUserSummary>>>(() =>
    loadState({}),
  )
  const requestIdRef = React.useRef(0)
  const loadedTeamIdRef = React.useRef<string | null>(null)
  const activeAccountIdRef = React.useRef(activeAccountId)
  const latestActiveAccountIdRef = React.useRef(activeAccountId)
  const selectedTeamIdRef = React.useRef(selectedTeam?.id ?? null)
  latestActiveAccountIdRef.current = activeAccountId
  selectedTeamIdRef.current = selectedTeam?.id ?? null

  const reset = React.useCallback(() => {
    requestIdRef.current += 1
    loadedTeamIdRef.current = null
    setMembersState(loadState([]))
    setSummariesState(loadState({}))
  }, [])

  const load = React.useCallback(
    async (team: Team, options: { forceRefresh?: boolean } = {}) => {
      if (latestActiveAccountIdRef.current !== activeAccountId || selectedTeamIdRef.current !== team.id) return
      const requestId = requestIdRef.current + 1
      requestIdRef.current = requestId
      const resourceAccountId = activeAccountId ?? "anonymous"
      const cachedMembers = options.forceRefresh ? null : getCachedTeamMembers(resourceAccountId, team.id)
      const fallbackUserIds = uniqueStrings([team.creator_user_id, activeAccountId ?? ""])
      const cachedSummaryUserIds = cachedMembers
        ? uniqueStrings([...cachedMembers.map((member) => member.user_id), ...fallbackUserIds])
        : fallbackUserIds
      const cachedSummaries = options.forceRefresh
        ? null
        : getCachedTeamUserSummaries(resourceAccountId, team.id, cachedSummaryUserIds)
      const preserveCurrentData = loadedTeamIdRef.current === team.id
      loadedTeamIdRef.current = null
      setMembersState((current) =>
        cachedMembers ? readyState(cachedMembers) : loadingState(preserveCurrentData ? current : loadState([])),
      )
      setSummariesState((current) =>
        cachedSummaries ? readyState(cachedSummaries) : loadingState(preserveCurrentData ? current : loadState({})),
      )

      const membersResult = await settle(
        getTeamMembersResource(resourceAccountId, team.id, { forceRefresh: options.forceRefresh }),
      )
      if (requestIdRef.current !== requestId) return
      const summaryUserIds = membersResult.ok
        ? uniqueStrings([...membersResult.value.map((member) => member.user_id), ...fallbackUserIds])
        : fallbackUserIds
      const summariesPromise = summaryUserIds.length
        ? settle(
            getTeamUserSummariesResource(resourceAccountId, team.id, summaryUserIds, {
              forceRefresh: options.forceRefresh,
            }),
          )
        : Promise.resolve<AsyncResult<Record<string, TeamUserSummary>>>({ ok: true, value: {} })

      if (membersResult.ok) setMembersState(readyState(membersResult.value))
      else setMembersState((current) => errorState(current, membersResult.error))

      const summariesResult = await summariesPromise
      if (requestIdRef.current !== requestId) return
      setSummariesState((current) =>
        summariesResult.ok ? readyState(summariesResult.value) : errorState(current, summariesResult.error),
      )
      loadedTeamIdRef.current = team.id
    },
    [activeAccountId],
  )

  React.useEffect(() => {
    if (activeAccountIdRef.current !== activeAccountId) {
      activeAccountIdRef.current = activeAccountId
      reset()
    }
  }, [activeAccountId, reset])

  React.useEffect(() => {
    if (!selectedTeam) {
      reset()
      return
    }
    void load(selectedTeam)
  }, [load, reset, selectedTeam?.id])

  const reload = React.useCallback(async () => {
    if (selectedTeam && selectedTeamIdRef.current === selectedTeam.id) {
      await load(selectedTeam, { forceRefresh: true })
    }
  }, [load, selectedTeam])

  const refresh = React.useCallback(async () => {
    if (selectedTeam && selectedTeamIdRef.current === selectedTeam.id) await load(selectedTeam)
  }, [load, selectedTeam])

  return { membersState, refresh, reload, summariesState }
}
