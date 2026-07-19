import type {
  Team,
  TeamAppAccess,
  TeamMember,
  TeamProviderOption,
  TeamUserSummary,
} from "../../../electron/teams/common.ts"
import type { LoadState } from "./team-management-model.ts"

import * as React from "react"
import { errorState, loadState, loadingState, readyState, uniqueStrings } from "./team-management-model.ts"
import {
  getCachedTeamAppAccess,
  getCachedTeamMembers,
  getCachedTeamProviderOptions,
  getCachedTeamUserSummaries,
  getTeamAppAccessResource,
  getTeamMembersResource,
  getTeamProviderOptionsResource,
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
  providerOptions,
  selectedTeam,
}: {
  activeAccountId: string | undefined
  canManage: boolean
  providerOptions?: TeamProviderOption[] | null
  selectedTeam: Team | null
}) {
  const [membersState, setMembersState] = React.useState<LoadState<TeamMember[]>>(() => loadState([]))
  const [summariesState, setSummariesState] = React.useState<LoadState<Record<string, TeamUserSummary>>>(() =>
    loadState({}),
  )
  const [providerOptionsState, setProviderOptionsState] = React.useState<LoadState<TeamProviderOption[]>>(() =>
    loadState([]),
  )
  const [appAccessState, setAppAccessState] = React.useState<LoadState<TeamAppAccess | null>>(() => loadState(null))
  const detailsRequestId = React.useRef(0)
  const detailsTeamIdRef = React.useRef<string | null>(null)
  const activeAccountIdRef = React.useRef(activeAccountId)
  const latestActiveAccountIdRef = React.useRef(activeAccountId)
  const selectedTeamIdRef = React.useRef(selectedTeam?.id ?? null)
  latestActiveAccountIdRef.current = activeAccountId
  selectedTeamIdRef.current = selectedTeam?.id ?? null

  const reset = React.useCallback(() => {
    detailsRequestId.current += 1
    detailsTeamIdRef.current = null
    setMembersState(loadState([]))
    setSummariesState(loadState({}))
    setProviderOptionsState(loadState([]))
    setAppAccessState(loadState(null))
  }, [])

  const load = React.useCallback(
    async (team: Team, canManageDetails: boolean, options: { forceRefresh?: boolean } = {}) => {
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
      const cachedProviderOptions = Array.isArray(providerOptions)
        ? providerOptions
        : canManageDetails && !options.forceRefresh
          ? getCachedTeamProviderOptions(resourceAccountId, team.id)
          : null
      const cachedAppAccess =
        canManageDetails && !options.forceRefresh ? getCachedTeamAppAccess(resourceAccountId, team.id) : null
      const preserveCurrentData = detailsTeamIdRef.current === team.id
      detailsRequestId.current = requestId
      detailsTeamIdRef.current = null
      setMembersState((current) =>
        cachedMembers ? readyState(cachedMembers) : loadingState(preserveCurrentData ? current : loadState([])),
      )
      setSummariesState((current) =>
        cachedSummaries ? readyState(cachedSummaries) : loadingState(preserveCurrentData ? current : loadState({})),
      )
      setProviderOptionsState(
        canManageDetails
          ? cachedProviderOptions
            ? readyState(cachedProviderOptions)
            : (current) => loadingState(preserveCurrentData ? current : loadState([]))
          : loadState([]),
      )
      setAppAccessState(
        canManageDetails
          ? cachedAppAccess
            ? readyState(cachedAppAccess)
            : (current) => loadingState(preserveCurrentData ? current : loadState(null))
          : loadState(null),
      )

      const membersRequest = settle(
        getTeamMembersResource(resourceAccountId, team.id, { forceRefresh: options.forceRefresh }),
      )
      const providerOptionsRequest =
        canManageDetails && providerOptions === null
          ? settle(
              getTeamProviderOptionsResource(resourceAccountId, team.id, team.name, {
                forceRefresh: options.forceRefresh,
              }),
            )
          : canManageDetails && providerOptions === undefined
            ? null
            : Promise.resolve<AsyncResult<TeamProviderOption[]>>({ ok: true, value: providerOptions ?? [] })
      const appAccessRequest = canManageDetails
        ? settle(
            getTeamAppAccessResource(resourceAccountId, team.id, {
              forceRefresh: options.forceRefresh,
            }),
          )
        : Promise.resolve<AsyncResult<TeamAppAccess | null>>({ ok: true, value: null })
      const providerOptionsTask =
        providerOptionsRequest?.then((result) => {
          if (!canManageDetails || detailsRequestId.current !== requestId) return
          setProviderOptionsState((current) =>
            result.ok ? readyState(result.value) : errorState(current, result.error),
          )
        }) ?? Promise.resolve()
      const appAccessTask = appAccessRequest.then((result) => {
        if (!canManageDetails || detailsRequestId.current !== requestId) return
        setAppAccessState((current) => (result.ok ? readyState(result.value) : errorState(current, result.error)))
      })
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
      await Promise.all([providerOptionsTask, appAccessTask])
      if (detailsRequestId.current !== requestId) return
      detailsTeamIdRef.current = team.id
    },
    [activeAccountId, providerOptions],
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
      detailsTeamIdRef.current = null
      setMembersState(loadState([]))
      setSummariesState(loadState({}))
      setProviderOptionsState(loadState([]))
      setAppAccessState(loadState(null))
      return
    }
    void load(selectedTeam, canManage)
  }, [canManage, load, selectedTeam?.id, selectedTeam?.name])

  const reload = React.useCallback(async () => {
    if (
      selectedTeam &&
      latestActiveAccountIdRef.current === activeAccountId &&
      selectedTeamIdRef.current === selectedTeam.id
    ) {
      await load(selectedTeam, canManage, { forceRefresh: true })
    }
  }, [activeAccountId, canManage, load, selectedTeam])

  const refresh = React.useCallback(async () => {
    if (
      selectedTeam &&
      latestActiveAccountIdRef.current === activeAccountId &&
      selectedTeamIdRef.current === selectedTeam.id
    ) {
      await load(selectedTeam, canManage)
    }
  }, [activeAccountId, canManage, load, selectedTeam])

  const setAppAccessForTeam = React.useCallback(
    (accountId: string | undefined, teamId: string, access: TeamAppAccess): void => {
      if (latestActiveAccountIdRef.current === accountId && selectedTeamIdRef.current === teamId) {
        setAppAccessState(readyState(access))
      }
    },
    [],
  )

  return {
    appAccessState,
    membersState,
    providerOptionsState,
    refresh,
    reload,
    setAppAccessForTeam,
    summariesState,
  }
}
