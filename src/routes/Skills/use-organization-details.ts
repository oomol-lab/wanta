import type {
  Organization,
  OrganizationAppAccess,
  OrganizationMember,
  OrganizationProviderOption,
  OrganizationUserSummary,
} from "../../../electron/organizations/common.ts"
import type { LoadState } from "./organization-management-model.ts"

import * as React from "react"
import {
  errorState,
  loadState,
  loadingState,
  organizationManagementSnapshotsByAccountId,
  readyState,
  readOrganizationManagementSnapshot,
  uniqueStrings,
} from "./organization-management-model.ts"
import {
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
  activeOrganizationId,
  canManage,
  selectedOrganization,
}: {
  activeAccountId: string | undefined
  activeOrganizationId: string | null
  canManage: boolean
  selectedOrganization: Organization | null
}) {
  const initialSnapshot = readOrganizationManagementSnapshot(activeAccountId)
  const [membersState, setMembersState] = React.useState<LoadState<OrganizationMember[]>>(
    () => initialSnapshot?.membersState ?? loadState([]),
  )
  const [summariesState, setSummariesState] = React.useState<LoadState<Record<string, OrganizationUserSummary>>>(
    () => initialSnapshot?.summariesState ?? loadState({}),
  )
  const [providerOptionsState, setProviderOptionsState] = React.useState<LoadState<OrganizationProviderOption[]>>(
    () => initialSnapshot?.providerOptionsState ?? loadState([]),
  )
  const [appAccessState, setAppAccessState] = React.useState<LoadState<OrganizationAppAccess | null>>(
    () => initialSnapshot?.appAccessState ?? loadState(null),
  )
  const detailsRequestId = React.useRef(0)
  const detailsOrganizationIdRef = React.useRef<string | null>(initialSnapshot?.detailsOrganizationId ?? null)
  const skipInitialLoadRef = React.useRef(
    Boolean(initialSnapshot?.detailsOrganizationId && initialSnapshot.detailsOrganizationId === activeOrganizationId),
  )
  const resetAccountIdRef = React.useRef<string | null>(null)

  const reset = React.useCallback((accountId: string | null) => {
    resetAccountIdRef.current = accountId
    detailsRequestId.current += 1
    detailsOrganizationIdRef.current = null
    skipInitialLoadRef.current = false
    setMembersState(loadState([]))
    setSummariesState(loadState({}))
    setProviderOptionsState(loadState([]))
    setAppAccessState(loadState(null))
  }, [])

  const load = React.useCallback(
    async (organization: Organization, canManageDetails: boolean, options: { forceRefresh?: boolean } = {}) => {
      const requestId = detailsRequestId.current + 1
      const preserveCurrentData = detailsOrganizationIdRef.current === organization.id
      detailsRequestId.current = requestId
      detailsOrganizationIdRef.current = null
      setMembersState((current) => loadingState(preserveCurrentData ? current : loadState([])))
      setSummariesState((current) => loadingState(preserveCurrentData ? current : loadState({})))
      setProviderOptionsState(
        canManageDetails ? (current) => loadingState(preserveCurrentData ? current : loadState([])) : loadState([]),
      )
      setAppAccessState(
        canManageDetails ? (current) => loadingState(preserveCurrentData ? current : loadState(null)) : loadState(null),
      )

      try {
        const resourceAccountId = activeAccountId ?? "anonymous"
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
        const fallbackUserIds = uniqueStrings([organization.creator_user_id, activeAccountId ?? ""])
        const loadSummaries = (userIds: string[]): Promise<AsyncResult<Record<string, OrganizationUserSummary>>> =>
          userIds.length > 0
            ? settle(
                getOrganizationUserSummariesResource(resourceAccountId, organization.id, userIds, {
                  forceRefresh: options.forceRefresh,
                }),
              )
            : Promise.resolve({ ok: true, value: {} })

        const membersResult = await membersRequest
        if (detailsRequestId.current !== requestId) return
        if (!membersResult.ok) {
          setMembersState((current) => errorState(current, membersResult.error))
          setSummariesState((current) => errorState(current, membersResult.error))
          const summariesResult = await loadSummaries(fallbackUserIds)
          if (detailsRequestId.current !== requestId) return
          setSummariesState((current) =>
            summariesResult.ok ? readyState(summariesResult.value) : errorState(current, summariesResult.error),
          )
          return
        }

        const members = membersResult.value
        setMembersState(readyState(members))
        const summariesRequest = loadSummaries(
          uniqueStrings([...members.map((member) => member.user_id), ...fallbackUserIds]),
        )
        const detailTasks: Promise<void>[] = [
          summariesRequest.then((result) => {
            if (detailsRequestId.current !== requestId) return
            setSummariesState((current) => (result.ok ? readyState(result.value) : errorState(current, result.error)))
          }),
        ]

        if (!canManageDetails) {
          setProviderOptionsState(loadState([]))
          setAppAccessState(loadState(null))
        } else {
          detailTasks.push(
            providerOptionsRequest.then((result) => {
              if (detailsRequestId.current !== requestId) return
              setProviderOptionsState((current) =>
                result.ok ? readyState(result.value) : errorState(current, result.error),
              )
            }),
            appAccessRequest.then((result) => {
              if (detailsRequestId.current !== requestId) return
              setAppAccessState((current) => (result.ok ? readyState(result.value) : errorState(current, result.error)))
            }),
          )
        }

        await Promise.all(detailTasks)
        if (detailsRequestId.current === requestId) detailsOrganizationIdRef.current = organization.id
      } catch (error) {
        if (detailsRequestId.current !== requestId) return
        setMembersState((current) => (current.status === "loading" ? errorState(current, error) : current))
        setSummariesState((current) => (current.status === "loading" ? errorState(current, error) : current))
        if (canManageDetails) {
          setProviderOptionsState((current) => (current.status === "loading" ? errorState(current, error) : current))
          setAppAccessState((current) => (current.status === "loading" ? errorState(current, error) : current))
        }
      }
    },
    [activeAccountId],
  )

  React.useEffect(() => {
    const snapshot = readOrganizationManagementSnapshot(activeAccountId)
    if (!activeAccountId) {
      if (resetAccountIdRef.current !== null || detailsOrganizationIdRef.current !== null) reset(null)
      return
    }
    if (!snapshot) {
      if (resetAccountIdRef.current !== activeAccountId) reset(activeAccountId)
      return
    }
    resetAccountIdRef.current = null
    setMembersState(snapshot.membersState)
    setSummariesState(snapshot.summariesState)
    setProviderOptionsState(snapshot.providerOptionsState)
    setAppAccessState(snapshot.appAccessState)
    detailsOrganizationIdRef.current = snapshot.detailsOrganizationId
    skipInitialLoadRef.current = Boolean(
      snapshot.detailsOrganizationId && snapshot.detailsOrganizationId === activeOrganizationId,
    )
  }, [activeAccountId, activeOrganizationId, reset])

  React.useEffect(() => {
    if (!activeAccountId) return
    organizationManagementSnapshotsByAccountId.set(activeAccountId, {
      appAccessState,
      detailsOrganizationId: detailsOrganizationIdRef.current,
      membersState,
      providerOptionsState,
      savedAt: Date.now(),
      summariesState,
    })
  }, [activeAccountId, appAccessState, membersState, providerOptionsState, summariesState])

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
    if (skipInitialLoadRef.current && detailsOrganizationIdRef.current === selectedOrganization.id) {
      skipInitialLoadRef.current = false
      return
    }
    skipInitialLoadRef.current = false
    void load(selectedOrganization, canManage)
  }, [canManage, load, selectedOrganization?.id, selectedOrganization?.name])

  const reload = React.useCallback(async () => {
    if (selectedOrganization) await load(selectedOrganization, canManage, { forceRefresh: true })
  }, [canManage, load, selectedOrganization])

  return { appAccessState, membersState, providerOptionsState, reload, setAppAccessState, summariesState }
}
