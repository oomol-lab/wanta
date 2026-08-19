import type { ConnectionAppSummary } from "../../../electron/connections/common.ts"
import type { Team, TeamAppAccess, TeamMember, TeamUserSummary } from "../../../electron/teams/common.ts"
import type { LoadState } from "./team-management-model.ts"

import * as React from "react"
import { errorState, loadState, loadingState, readyState, uniqueStrings } from "./team-management-model.ts"
import {
  getCachedTeamMembers,
  getCachedTeamAppAccess,
  getCachedTeamConnectionApps,
  getCachedTeamUserSummaries,
  getTeamAppAccessResource,
  getTeamConnectionAppsResource,
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

export function useTeamDetails({
  activeAccountId,
  canManage,
  selectedTeam,
}: {
  activeAccountId: string | undefined
  canManage: boolean
  selectedTeam: Team | null
}) {
  const [membersState, setMembersState] = React.useState<LoadState<TeamMember[]>>(() => loadState([]))
  const [summariesState, setSummariesState] = React.useState<LoadState<Record<string, TeamUserSummary>>>(() =>
    loadState({}),
  )
  const [appAccessState, setAppAccessState] = React.useState<LoadState<TeamAppAccess | null>>(() => loadState(null))
  const [connectionAppsState, setConnectionAppsState] = React.useState<LoadState<ConnectionAppSummary[]>>(() =>
    loadState([]),
  )
  const detailsRequestId = React.useRef(0)
  const permissionsRequestId = React.useRef(0)
  const detailsTeamIdRef = React.useRef<string | null>(null)
  const permissionsTeamIdRef = React.useRef<string | null>(null)
  const activeAccountIdRef = React.useRef(activeAccountId)
  const latestActiveAccountIdRef = React.useRef(activeAccountId)
  const selectedTeamIdRef = React.useRef(selectedTeam?.id ?? null)
  latestActiveAccountIdRef.current = activeAccountId
  selectedTeamIdRef.current = selectedTeam?.id ?? null

  const reset = React.useCallback(() => {
    detailsRequestId.current += 1
    permissionsRequestId.current += 1
    detailsTeamIdRef.current = null
    permissionsTeamIdRef.current = null
    setMembersState(loadState([]))
    setSummariesState(loadState({}))
    setAppAccessState(loadState(null))
    setConnectionAppsState(loadState([]))
  }, [])

  const loadPermissions = React.useCallback(
    async (team: Team, options: { forceRefresh?: boolean } = {}) => {
      if (!canManage) {
        permissionsRequestId.current += 1
        permissionsTeamIdRef.current = null
        setAppAccessState(readyState(null))
        setConnectionAppsState(readyState([]))
        return
      }
      if (latestActiveAccountIdRef.current !== activeAccountId || selectedTeamIdRef.current !== team.id) return

      const requestId = permissionsRequestId.current + 1
      permissionsRequestId.current = requestId
      const resourceAccountId = activeAccountId ?? "anonymous"
      const cachedAccess = options.forceRefresh ? null : getCachedTeamAppAccess(resourceAccountId, team.id)
      const cachedApps = options.forceRefresh
        ? null
        : getCachedTeamConnectionApps(resourceAccountId, team.id, team.name)
      const preserveCurrentData = permissionsTeamIdRef.current === team.id
      permissionsTeamIdRef.current = null
      setAppAccessState((current) =>
        cachedAccess
          ? readyState(cachedAccess)
          : loadingState(preserveCurrentData && current.data ? current : loadState(null)),
      )
      setConnectionAppsState((current) =>
        cachedApps
          ? readyState(cachedApps)
          : loadingState(preserveCurrentData && current.data.length > 0 ? current : loadState([])),
      )

      const [accessResult, appsResult] = await Promise.all([
        settle(getTeamAppAccessResource(resourceAccountId, team.id, { forceRefresh: options.forceRefresh })),
        settle(
          getTeamConnectionAppsResource(resourceAccountId, team.id, team.name, {
            forceRefresh: options.forceRefresh,
          }),
        ),
      ])
      if (permissionsRequestId.current !== requestId) return
      setAppAccessState((current) =>
        accessResult.ok ? readyState(accessResult.value) : errorState(current, accessResult.error),
      )
      setConnectionAppsState((current) =>
        appsResult.ok ? readyState(appsResult.value) : errorState(current, appsResult.error),
      )
      permissionsTeamIdRef.current = team.id
    },
    [activeAccountId, canManage],
  )

  const load = React.useCallback(
    async (team: Team, options: { forceRefresh?: boolean } = {}) => {
      if (latestActiveAccountIdRef.current !== activeAccountId || selectedTeamIdRef.current !== team.id) {
        return
      }
      const requestId = detailsRequestId.current + 1
      const resourceAccountId = activeAccountId ?? "anonymous"
      const cachedMembers = options.forceRefresh ? null : getCachedTeamMembers(resourceAccountId, team.id)
      const fallbackUserIds = uniqueStrings([team.creator_user_id, activeAccountId ?? ""])
      const cachedSummaryUserIds = cachedMembers
        ? uniqueStrings([...cachedMembers.map((member) => member.user_id), ...fallbackUserIds])
        : fallbackUserIds
      const cachedSummaries = options.forceRefresh
        ? null
        : getCachedTeamUserSummaries(resourceAccountId, team.id, cachedSummaryUserIds)
      const preserveCurrentData = detailsTeamIdRef.current === team.id
      detailsRequestId.current = requestId
      detailsTeamIdRef.current = null
      setMembersState((current) =>
        cachedMembers ? readyState(cachedMembers) : loadingState(preserveCurrentData ? current : loadState([])),
      )
      setSummariesState((current) =>
        cachedSummaries ? readyState(cachedSummaries) : loadingState(preserveCurrentData ? current : loadState({})),
      )

      const membersRequest = settle(
        getTeamMembersResource(resourceAccountId, team.id, { forceRefresh: options.forceRefresh }),
      )
      const membersResult = await membersRequest
      if (detailsRequestId.current !== requestId) return

      const summaryUserIds = membersResult.ok
        ? uniqueStrings([...membersResult.value.map((member) => member.user_id), ...fallbackUserIds])
        : fallbackUserIds
      const summariesRequest = summaryUserIds.length
        ? settle(
            getTeamUserSummariesResource(resourceAccountId, team.id, summaryUserIds, {
              forceRefresh: options.forceRefresh,
            }),
          )
        : Promise.resolve<AsyncResult<Record<string, TeamUserSummary>>>({ ok: true, value: {} })

      if (membersResult.ok) {
        setMembersState(readyState(membersResult.value))
      } else {
        setMembersState((current) => errorState(current, membersResult.error))
      }

      const summariesResult = await summariesRequest
      if (detailsRequestId.current !== requestId) return
      setSummariesState((current) =>
        summariesResult.ok ? readyState(summariesResult.value) : errorState(current, summariesResult.error),
      )
      if (detailsRequestId.current !== requestId) return
      detailsTeamIdRef.current = team.id
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
      detailsRequestId.current += 1
      permissionsRequestId.current += 1
      detailsTeamIdRef.current = null
      permissionsTeamIdRef.current = null
      setMembersState(loadState([]))
      setSummariesState(loadState({}))
      setAppAccessState(loadState(null))
      setConnectionAppsState(loadState([]))
      return
    }
    void Promise.all([load(selectedTeam), loadPermissions(selectedTeam)])
  }, [load, loadPermissions, selectedTeam?.id, selectedTeam?.name])

  const reload = React.useCallback(async () => {
    if (
      selectedTeam &&
      latestActiveAccountIdRef.current === activeAccountId &&
      selectedTeamIdRef.current === selectedTeam.id
    ) {
      await Promise.all([
        load(selectedTeam, { forceRefresh: true }),
        loadPermissions(selectedTeam, { forceRefresh: true }),
      ])
    }
  }, [activeAccountId, load, loadPermissions, selectedTeam])

  const refresh = React.useCallback(async () => {
    if (
      selectedTeam &&
      latestActiveAccountIdRef.current === activeAccountId &&
      selectedTeamIdRef.current === selectedTeam.id
    ) {
      await Promise.all([load(selectedTeam), loadPermissions(selectedTeam)])
    }
  }, [activeAccountId, load, loadPermissions, selectedTeam])

  return {
    appAccessState,
    connectionAppsState,
    membersState,
    refresh,
    reload,
    summariesState,
  }
}
