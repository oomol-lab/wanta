import type {
  Organization,
  OrganizationAppAccess,
  OrganizationMember,
  OrganizationProviderOption,
  OrganizationUserSummary,
} from "../../../electron/organizations/common.ts"
import type { LoadState } from "./organization-management-model.ts"

import * as React from "react"
import { errorState, loadState, loadingState, readyState, uniqueStrings } from "./organization-management-model.ts"
import {
  getCachedOrganizationAppAccess,
  getCachedOrganizationMembers,
  getCachedOrganizationProviderOptions,
  getCachedOrganizationUserSummaries,
  getOrganizationAppAccessResource,
  getOrganizationMembersResource,
  getOrganizationProviderOptionsResource,
  getOrganizationUserSummariesResource,
} from "@/lib/organization-details-resource"

type AsyncResult<T> = { ok: true; value: T } | { error: unknown; ok: false }

function settle<T>(promise: Promise<T>): Promise<AsyncResult<T>> {
  return promise.then(
    (value) => ({ ok: true, value }),
    (error: unknown) => ({ error, ok: false }),
  )
}

export function useOrganizationDetails({
  activeAccountId,
  canManage,
  selectedOrganization,
}: {
  activeAccountId: string | undefined
  canManage: boolean
  selectedOrganization: Organization | null
}) {
  const [membersState, setMembersState] = React.useState<LoadState<OrganizationMember[]>>(() => loadState([]))
  const [summariesState, setSummariesState] = React.useState<LoadState<Record<string, OrganizationUserSummary>>>(() =>
    loadState({}),
  )
  const [providerOptionsState, setProviderOptionsState] = React.useState<LoadState<OrganizationProviderOption[]>>(() =>
    loadState([]),
  )
  const [appAccessState, setAppAccessState] = React.useState<LoadState<OrganizationAppAccess | null>>(() =>
    loadState(null),
  )
  const detailsRequestId = React.useRef(0)
  const detailsOrganizationIdRef = React.useRef<string | null>(null)
  const activeAccountIdRef = React.useRef(activeAccountId)

  const reset = React.useCallback(() => {
    detailsRequestId.current += 1
    detailsOrganizationIdRef.current = null
    setMembersState(loadState([]))
    setSummariesState(loadState({}))
    setProviderOptionsState(loadState([]))
    setAppAccessState(loadState(null))
  }, [])

  const load = React.useCallback(
    async (organization: Organization, canManageDetails: boolean, options: { forceRefresh?: boolean } = {}) => {
      const requestId = detailsRequestId.current + 1
      const resourceAccountId = activeAccountId ?? "anonymous"
      const cachedMembers = options.forceRefresh
        ? null
        : getCachedOrganizationMembers(resourceAccountId, organization.id)
      const fallbackUserIds = uniqueStrings([organization.creator_user_id, activeAccountId ?? ""])
      const cachedSummaryUserIds = cachedMembers
        ? uniqueStrings([...cachedMembers.map((member) => member.user_id), ...fallbackUserIds])
        : fallbackUserIds
      const cachedSummaries = options.forceRefresh
        ? null
        : getCachedOrganizationUserSummaries(resourceAccountId, organization.id, cachedSummaryUserIds)
      const cachedProviderOptions =
        canManageDetails && !options.forceRefresh
          ? getCachedOrganizationProviderOptions(resourceAccountId, organization.id)
          : null
      const cachedAppAccess =
        canManageDetails && !options.forceRefresh
          ? getCachedOrganizationAppAccess(resourceAccountId, organization.id)
          : null
      const preserveCurrentData = detailsOrganizationIdRef.current === organization.id
      detailsRequestId.current = requestId
      detailsOrganizationIdRef.current = null
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
        getOrganizationMembersResource(resourceAccountId, organization.id, { forceRefresh: options.forceRefresh }),
      )
      const providerOptionsRequest = canManageDetails
        ? settle(
            getOrganizationProviderOptionsResource(resourceAccountId, organization.id, organization.name, {
              forceRefresh: options.forceRefresh,
            }),
          )
        : Promise.resolve<AsyncResult<OrganizationProviderOption[]>>({ ok: true, value: [] })
      const appAccessRequest = canManageDetails
        ? settle(
            getOrganizationAppAccessResource(resourceAccountId, organization.id, {
              forceRefresh: options.forceRefresh,
            }),
          )
        : Promise.resolve<AsyncResult<OrganizationAppAccess | null>>({ ok: true, value: null })
      const providerOptionsTask = providerOptionsRequest.then((result) => {
        if (!canManageDetails || detailsRequestId.current !== requestId) return
        setProviderOptionsState((current) => (result.ok ? readyState(result.value) : errorState(current, result.error)))
      })
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
            getOrganizationUserSummariesResource(resourceAccountId, organization.id, summaryUserIds, {
              forceRefresh: options.forceRefresh,
            }),
          )
        : Promise.resolve<AsyncResult<Record<string, OrganizationUserSummary>>>({ ok: true, value: {} })

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
      detailsOrganizationIdRef.current = organization.id
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
    if (!selectedOrganization) {
      detailsRequestId.current += 1
      detailsOrganizationIdRef.current = null
      setMembersState(loadState([]))
      setSummariesState(loadState({}))
      setProviderOptionsState(loadState([]))
      setAppAccessState(loadState(null))
      return
    }
    void load(selectedOrganization, canManage)
  }, [canManage, load, selectedOrganization?.id, selectedOrganization?.name])

  const reload = React.useCallback(async () => {
    if (selectedOrganization) await load(selectedOrganization, canManage, { forceRefresh: true })
  }, [canManage, load, selectedOrganization])

  const refresh = React.useCallback(async () => {
    if (selectedOrganization) await load(selectedOrganization, canManage)
  }, [canManage, load, selectedOrganization])

  return { appAccessState, membersState, providerOptionsState, refresh, reload, setAppAccessState, summariesState }
}
