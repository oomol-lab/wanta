import type { ManagedSkillGroup, PublicSkillPackage, PublishSkillResult } from "../../../electron/skills/common.ts"
import type { BusyAction } from "./organization-management-model.ts"
import type {
  DiscoverSkillFilter,
  InstalledSkillFilter,
  ManagedSkillGroupById,
  SkillPageTab,
  SkillSelectionKey,
  SkillVersionCheckByKey,
} from "./skill-route-model.ts"
import type { SkillDetailContentProps } from "./SkillDetailContent.tsx"
import type { OrganizationSkillFilter } from "./SkillPageHeader.tsx"
import type {
  ManagedOrganizationOption,
  SkillOrganizationLinkTarget,
  SkillPublishVisibility,
} from "./SkillPublishDialogs.tsx"
import type { UseOrganizationSkills } from "@/hooks/useOrganizationSkills"
import type { UseOrganizationWorkspace } from "@/hooks/useOrganizationWorkspace"
import type { ProviderSkillRecommendationsState } from "@/hooks/useProviderSkillRecommendations"

import * as React from "react"
import { toast } from "sonner"
import { DiscoverSkillsPane } from "./DiscoverSkillsPane.tsx"
import { InstalledSkillsPane } from "./InstalledSkillsPane.tsx"
import { OrganizationInstallMissingButton } from "./OrganizationSkillManageRows.tsx"
import { OrganizationSkillsPane } from "./OrganizationSkillsPane.tsx"
import { skillErrorMessage } from "./skill-errors.ts"
import {
  getGroupStatus,
  getInstallableOrganizationSkills,
  getLocalSkillPublishPath,
  getPublicPackageInstallSkills,
  getRuntimeHosts,
  getSkillVersionCheck,
  getSkillVersionCheckKey,
  getSelectedManagedSkillGroup,
  initialPublicPackageCatalogState,
  isInstalledSkillGroup,
  matchesInstalledSkillFilter,
  matchesPublicPackageQuery,
  publicPackageCatalogReducer,
} from "./skill-route-model.ts"
import { SkillDetailContent } from "./SkillDetailContent.tsx"
import { SkillPageHeader } from "./SkillPageHeader.tsx"
import { OrganizationLinkDialog, PublishSkillDialog } from "./SkillPublishDialogs.tsx"
import { SkillManagementSheet } from "./SkillUiParts.tsx"
import { useOrganizationSkillActions } from "./use-organization-skill-actions.ts"
import { useRegistrySkillUpdate } from "./use-registry-skill-update.ts"
import { useSkillService } from "@/components/AppContext"
import {
  useAuthStateResource,
  useSkillInventoryResource,
  useSkillVersionReportResource,
} from "@/components/AppDataHooks"
import { DeleteSkillConfirmDialog } from "@/components/DeleteSkillConfirmDialog"
import { useSkillObjectActions } from "@/components/useSkillObjectActions"
import { useAppI18n } from "@/i18n"
import { addOrganizationSkill } from "@/lib/organization-skills-client"
import { reportRendererHandledError } from "@/lib/renderer-diagnostics"
import {
  invalidateMyPublishedSkillCatalog,
  invalidatePublicSkillCatalog,
  listMyPublishedSkillPackages,
  listPublicSkillPackages,
  searchPublicSkillPackages,
} from "@/lib/skills-catalog-client"
import { resolveUserFacingError } from "@/lib/user-facing-error"

type SkillOperationError = {
  cause: unknown
  operation: "publish" | "update"
  skillId: SkillSelectionKey
}

function visibleSkillOperationError(
  error: SkillOperationError | null,
  skillId: SkillSelectionKey | undefined,
): unknown {
  if (!error) {
    return null
  }
  if (error.skillId === skillId) {
    return error.cause
  }
  return null
}

export function SkillsRoute({
  connectedProvidersLoading = false,
  focusRequest,
  organizationSkills,
  providerSkillRecommendationsState,
  workspace,
}: {
  connectedProvidersLoading?: boolean
  focusRequest?: { nonce: number; tab: SkillPageTab } | null
  organizationSkills: UseOrganizationSkills
  providerSkillRecommendationsState: ProviderSkillRecommendationsState
  workspace: UseOrganizationWorkspace
}) {
  const { locale, t } = useAppI18n()
  const skillService = useSkillService()
  const authResource = useAuthStateResource()
  const inventoryResource = useSkillInventoryResource()
  const versionResource = useSkillVersionReportResource()
  const inventory = inventoryResource.data
  const installedSkillGroupById = React.useMemo<ManagedSkillGroupById>(() => {
    return new Map((inventory?.groups ?? []).map((group) => [group.id, group]))
  }, [inventory?.groups])
  const providerSkillRecommendations = providerSkillRecommendationsState.recommendations
  const installableProviderSkillRecommendations = providerSkillRecommendationsState.installable
  const versionCheckByKey = React.useMemo<SkillVersionCheckByKey>(() => {
    return new Map(
      (versionResource.data?.skills ?? []).map((check) => [
        getSkillVersionCheckKey(check.skillId, check.packageName),
        check,
      ]),
    )
  }, [versionResource.data?.skills])
  const [activeTab, setActiveTab] = React.useState<SkillPageTab>("discover")
  const [selectedSkillId, setSelectedSkillId] = React.useState<SkillSelectionKey | null>(null)
  const [query, setQuery] = React.useState("")
  const [discoveryFilter, setDiscoveryFilter] = React.useState<DiscoverSkillFilter>("all")
  const [installedFilter, setInstalledFilter] = React.useState<InstalledSkillFilter>("all")
  const [organizationFilter, setOrganizationFilter] = React.useState<OrganizationSkillFilter>("all")
  const [organizationQuery, setOrganizationQuery] = React.useState("")
  const [discoveryQuery, setDiscoveryQuery] = React.useState("")
  const deferredInstalledQuery = React.useDeferredValue(query)
  const deferredOrganizationQuery = React.useDeferredValue(organizationQuery)
  const deferredDiscoveryQuery = React.useDeferredValue(discoveryQuery)
  const [debouncedDiscoveryQuery, setDebouncedDiscoveryQuery] = React.useState("")
  const [publicPackageCatalog, dispatchPublicPackageCatalog] = React.useReducer(
    publicPackageCatalogReducer,
    initialPublicPackageCatalogState,
  )
  const [myPublishedPackageCatalog, dispatchMyPublishedPackageCatalog] = React.useReducer(
    publicPackageCatalogReducer,
    initialPublicPackageCatalogState,
  )
  const [publicPackageSearchCatalog, dispatchPublicPackageSearchCatalog] = React.useReducer(
    publicPackageCatalogReducer,
    initialPublicPackageCatalogState,
  )
  const [installingRegistryResultId, setInstallingRegistryResultId] = React.useState<string | null>(null)
  const [planError, setPlanError] = React.useState<SkillOperationError | null>(null)
  const [cliUpdateError, setCliUpdateError] = React.useState<string | null>(null)
  const [publishingSkillId, setPublishingSkillId] = React.useState<string | null>(null)
  const [publishDialogSkill, setPublishDialogSkill] = React.useState<ManagedSkillGroup | null>(null)
  const [organizationLinkTarget, setOrganizationLinkTarget] = React.useState<SkillOrganizationLinkTarget | null>(null)
  const [organizationSkillBusyAction, setOrganizationSkillBusyAction] = React.useState<BusyAction | null>(null)
  const [isExecutingCliUpdate, setIsExecutingCliUpdate] = React.useState(false)
  const skillMutationInFlightRef = React.useRef(false)
  const requestedVersionCheckRef = React.useRef(false)
  const publicPackageRequestIdRef = React.useRef(0)
  const myPublishedPackageRequestIdRef = React.useRef(0)
  const publicPackageSearchRequestIdRef = React.useRef(0)
  const { copySkillPath, isRemovingSkill, openSkillFolder, removeSkill, removeTarget, setRemoveTarget } =
    useSkillObjectActions({
      onDeleted: () => {
        setSelectedSkillId(null)
      },
    })
  const handleRegistrySkillUpdateBusy = React.useCallback(() => {
    toast.info(t("skills.operationInProgress"))
  }, [t])
  const handleRegistrySkillUpdateError = React.useCallback((cause: unknown, skillId: string) => {
    setPlanError({
      cause: resolveUserFacingError(cause, { area: "skills" }),
      operation: "update",
      skillId,
    })
  }, [])
  const clearRegistrySkillUpdateError = React.useCallback(() => setPlanError(null), [])
  const { updateRegistrySkill, updatingRegistrySkillId } = useRegistrySkillUpdate({
    inventoryResource,
    mutationInFlightRef: skillMutationInFlightRef,
    onBusy: handleRegistrySkillUpdateBusy,
    onError: handleRegistrySkillUpdateError,
    onStart: clearRegistrySkillUpdateError,
    skillService,
    versionResource,
  })

  const searchedGroups = React.useMemo(() => {
    const groups = inventory?.groups ?? []
    const normalizedQuery = deferredInstalledQuery.trim().toLowerCase()

    if (!normalizedQuery) {
      return groups
    }

    return groups.filter((group) => {
      return (
        group.name.toLowerCase().includes(normalizedQuery) ||
        Boolean(group.description?.toLowerCase().includes(normalizedQuery)) ||
        Boolean(group.packageName?.toLowerCase().includes(normalizedQuery))
      )
    })
  }, [deferredInstalledQuery, inventory?.groups])

  const installedGroups = React.useMemo(() => searchedGroups.filter(isInstalledSkillGroup), [searchedGroups])
  const filteredInstalledGroups = React.useMemo(() => {
    return installedGroups.filter((group) => {
      return matchesInstalledSkillFilter(group, installedFilter, getSkillVersionCheck(versionCheckByKey, group))
    })
  }, [installedFilter, installedGroups, versionCheckByKey])
  const selectedSkill = getSelectedManagedSkillGroup(inventory?.groups ?? [], selectedSkillId)
  const selectedStatus = selectedSkill ? getGroupStatus(selectedSkill, t, getRuntimeHosts(selectedSkill)) : null
  const selectedVersionCheck = getSkillVersionCheck(versionCheckByKey, selectedSkill)
  const managedOrganizationOptions = React.useMemo<ManagedOrganizationOption[]>(() => {
    return workspace.organizations
      .filter((organization) => workspace.getOrganizationCanManage(organization))
      .map((organization) => ({ id: organization.id, name: organization.name }))
  }, [workspace.getOrganizationCanManage, workspace.organizations])
  const selectedSkillLinkedToActiveOrganization = React.useMemo(() => {
    const packageName = selectedSkill?.packageName?.trim()
    if (!packageName) {
      return false
    }
    return organizationSkills.skills.some((skill) => skill.packageName === packageName)
  }, [organizationSkills.skills, selectedSkill?.packageName])
  const showSelectedSkillOrganizationLinkAction = Boolean(
    selectedSkill?.packageName?.trim() && managedOrganizationOptions.length > 0,
  )
  React.useEffect(() => {
    if (requestedVersionCheckRef.current) {
      return
    }

    requestedVersionCheckRef.current = true
    void versionResource
      .refresh({ silent: true })
      .catch((error: unknown) => reportRendererHandledError("skills", "silent skill version refresh failed", error))
  }, [versionResource])

  React.useEffect(() => {
    if (versionResource.data?.cli?.status !== "update-available") {
      setCliUpdateError(null)
    }
  }, [versionResource.data?.cli?.status])

  React.useEffect(() => {
    if (!focusRequest) {
      return
    }
    setActiveTab(
      focusRequest.tab === "organization" && !workspace.activeWorkspace.organizationId ? "discover" : focusRequest.tab,
    )
  }, [focusRequest, workspace.activeWorkspace.organizationId])

  React.useEffect(() => {
    if (activeTab === "organization" && !workspace.activeWorkspace.organizationId) {
      setActiveTab("discover")
    }
  }, [activeTab, workspace.activeWorkspace.organizationId])

  React.useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedDiscoveryQuery(discoveryQuery.trim())
    }, 250)
    return () => window.clearTimeout(timeout)
  }, [discoveryQuery])

  const selectSkill = React.useCallback((skillId: SkillSelectionKey) => {
    setSelectedSkillId(skillId)
  }, [])

  const loadPublicSkillPackages = React.useCallback(
    async (options: { forceRefresh?: boolean; next?: string | null } = {}) => {
      const next = options.next?.trim() || undefined
      const append = Boolean(next && !options.forceRefresh)
      const requestId = publicPackageRequestIdRef.current + 1
      publicPackageRequestIdRef.current = requestId
      dispatchPublicPackageCatalog({ append, requestId, type: "load-start" })

      try {
        const catalog = await listPublicSkillPackages({ forceRefresh: options.forceRefresh, next })
        dispatchPublicPackageCatalog({ append, catalog, requestId, type: "load-success" })
      } catch (cause) {
        dispatchPublicPackageCatalog({
          error: cause instanceof Error ? cause.message : String(cause),
          requestId,
          type: "load-error",
        })
      }
    },
    [],
  )

  const loadMyPublishedSkillPackages = React.useCallback(
    async (options: { forceRefresh?: boolean; next?: string | null } = {}) => {
      const account = authResource.data?.status === "authenticated" ? authResource.data.account : undefined
      if (!account) {
        return
      }
      const next = options.next?.trim() || undefined
      const append = Boolean(next && !options.forceRefresh)
      const requestId = myPublishedPackageRequestIdRef.current + 1
      myPublishedPackageRequestIdRef.current = requestId
      dispatchMyPublishedPackageCatalog({ append, requestId, type: "load-start" })

      try {
        const catalog = await listMyPublishedSkillPackages({
          account: { avatarUrl: account.avatarUrl, id: account.id, name: account.name },
          forceRefresh: options.forceRefresh,
          next,
        })
        dispatchMyPublishedPackageCatalog({ append, catalog, requestId, type: "load-success" })
      } catch (cause) {
        dispatchMyPublishedPackageCatalog({
          error: cause instanceof Error ? cause.message : String(cause),
          requestId,
          type: "load-error",
        })
      }
    },
    [authResource.data],
  )

  const loadPublicSkillSearch = React.useCallback(
    async (query: string, options: { forceRefresh?: boolean; next?: string | null; replace?: boolean } = {}) => {
      const next = options.next?.trim() || undefined
      const append = Boolean(next && !options.forceRefresh && !options.replace)
      const requestId = publicPackageSearchRequestIdRef.current + 1
      publicPackageSearchRequestIdRef.current = requestId
      dispatchPublicPackageSearchCatalog({
        append,
        clearItems: options.replace,
        requestId,
        type: "load-start",
      })

      try {
        const catalog = await searchPublicSkillPackages({ forceRefresh: options.forceRefresh, next, query })
        dispatchPublicPackageSearchCatalog({ append, catalog, requestId, type: "load-success" })
      } catch (cause) {
        dispatchPublicPackageSearchCatalog({
          error: cause instanceof Error ? cause.message : String(cause),
          requestId,
          type: "load-error",
        })
      }
    },
    [],
  )

  React.useEffect(() => {
    if (
      activeTab !== "discover" ||
      discoveryFilter !== "all" ||
      publicPackageCatalog.items.length > 0 ||
      publicPackageCatalog.status !== "idle"
    ) {
      return
    }

    void loadPublicSkillPackages().catch((error: unknown) => {
      reportRendererHandledError("skills", "public skill package load failed", error)
    })
  }, [
    activeTab,
    discoveryFilter,
    loadPublicSkillPackages,
    publicPackageCatalog.items.length,
    publicPackageCatalog.status,
  ])

  React.useEffect(() => {
    if (
      activeTab !== "discover" ||
      discoveryFilter !== "mine" ||
      authResource.data?.status !== "authenticated" ||
      myPublishedPackageCatalog.items.length > 0 ||
      myPublishedPackageCatalog.status !== "idle"
    ) {
      return
    }

    void loadMyPublishedSkillPackages().catch((error: unknown) => {
      reportRendererHandledError("skills", "published skill package load failed", error)
    })
  }, [
    activeTab,
    authResource.data?.status,
    discoveryFilter,
    loadMyPublishedSkillPackages,
    myPublishedPackageCatalog.items.length,
    myPublishedPackageCatalog.status,
  ])

  React.useEffect(() => {
    if (activeTab !== "discover" || discoveryFilter !== "all" || !debouncedDiscoveryQuery) {
      return
    }
    void loadPublicSkillSearch(debouncedDiscoveryQuery, { replace: true }).catch((error: unknown) => {
      reportRendererHandledError("skills", "public skill package search failed", error)
    })
  }, [activeTab, debouncedDiscoveryQuery, discoveryFilter, loadPublicSkillSearch])

  const isPublicSearchActive = discoveryFilter === "all" && Boolean(debouncedDiscoveryQuery)
  const activePackageCatalog =
    discoveryFilter === "mine"
      ? myPublishedPackageCatalog
      : isPublicSearchActive
        ? publicPackageSearchCatalog
        : publicPackageCatalog
  const activePackageDispatcher =
    discoveryFilter === "mine"
      ? dispatchMyPublishedPackageCatalog
      : isPublicSearchActive
        ? dispatchPublicPackageSearchCatalog
        : dispatchPublicPackageCatalog
  const filteredPublicPackages = React.useMemo(() => {
    if (discoveryFilter === "all") {
      return activePackageCatalog.items
    }
    const normalizedQuery = deferredDiscoveryQuery.trim().toLowerCase()
    return activePackageCatalog.items.filter((pkg) => matchesPublicPackageQuery(pkg, normalizedQuery))
  }, [activePackageCatalog.items, deferredDiscoveryQuery, discoveryFilter])

  const selectedPublicPackage = React.useMemo(() => {
    return activePackageCatalog.selectedId
      ? activePackageCatalog.items.find((pkg) => pkg.id === activePackageCatalog.selectedId)
      : undefined
  }, [activePackageCatalog.items, activePackageCatalog.selectedId])

  const openManagedPublicSkill = React.useCallback((skillName: string) => {
    dispatchPublicPackageCatalog({ id: null, type: "select" })
    dispatchPublicPackageSearchCatalog({ id: null, type: "select" })
    dispatchMyPublishedPackageCatalog({ id: null, type: "select" })
    setSelectedSkillId(skillName)
  }, [])

  const installPublicSkill = React.useCallback(
    async (pkg: PublicSkillPackage, skillName?: string) => {
      if (skillMutationInFlightRef.current) {
        toast.info(t("skills.operationInProgress"))
        return
      }

      const targetSkills = skillName
        ? pkg.skills.filter((skill) => skill.name === skillName)
        : getPublicPackageInstallSkills(installedSkillGroupById, pkg)
      const primaryTarget = targetSkills[0]
      if (!primaryTarget) {
        toast.error(t("skills.discoverInstallNoSkill"))
        return
      }

      skillMutationInFlightRef.current = true
      setInstallingRegistryResultId(`${pkg.id}:${primaryTarget.name}`)

      try {
        if (targetSkills.length === 1) {
          const nextInventory = await skillService.invoke("installRegistrySkill", {
            packageName: pkg.name,
            skillId: primaryTarget.name,
          })
          inventoryResource.setData(nextInventory)
          toast.success(t("skills.registryInstallDone", { name: primaryTarget.name }))
        } else {
          const result = await skillService.invoke(
            "installRegistrySkills",
            targetSkills.map((skill) => ({ packageName: pkg.name, skillId: skill.name })),
          )
          inventoryResource.setData(result.inventory)
          if (result.installed.length > 0) {
            toast.success(t("skills.registryInstallBatchDone", { count: result.installed.length }))
          }
          if (result.failures.length > 0) {
            toast.error(
              t("skills.registryInstallBatchFailed", {
                count: result.failures.length,
                error: result.failures[0]?.error ?? "",
              }),
            )
          }
        }
        versionResource.invalidate()
      } catch (cause) {
        toast.error(t("skills.registryInstallFailed", { error: skillErrorMessage(cause, t) }))
      } finally {
        skillMutationInFlightRef.current = false
        setInstallingRegistryResultId(null)
      }
    },
    [installedSkillGroupById, inventoryResource, skillService, t, versionResource],
  )

  const {
    addOrganizationSkillFromRecommendation,
    installRuntimeSkill: installOrganizationRuntimeSkill,
    installRuntimeSkills: installOrganizationRuntimeSkills,
  } = useOrganizationSkillActions({
    busyAction: organizationSkillBusyAction,
    organizationSkills,
    setBusyAction: setOrganizationSkillBusyAction,
  })
  const activeOrganizationId = workspace.activeWorkspace.organizationId
  const organizationHeaderInstallTargets = React.useMemo(() => {
    if (
      activeTab !== "organization" ||
      !activeOrganizationId ||
      organizationSkills.organizationId !== activeOrganizationId
    ) {
      return []
    }

    return getInstallableOrganizationSkills(installedSkillGroupById, organizationSkills.skills).map((skill) => ({
      packageName: skill.packageName,
      skillName: skill.skillName,
    }))
  }, [
    activeOrganizationId,
    activeTab,
    installedSkillGroupById,
    organizationSkills.organizationId,
    organizationSkills.skills,
  ])

  const linkPublishedSkillToOrganization = React.useCallback(
    async (target: SkillOrganizationLinkTarget, organizationId: string): Promise<void> => {
      await addOrganizationSkill(organizationId, {
        packageName: target.packageName,
        skillName: target.skillName,
        version: target.version,
        versionPolicy: "pinned",
      })

      if (workspace.activeWorkspace.organizationId === organizationId) {
        await organizationSkills.refresh({ forceRefresh: true })
      }
      toast.success(t("skills.organizationLinkDone", { name: target.title }))
    },
    [organizationSkills, t, workspace.activeWorkspace],
  )

  const publishSkill = React.useCallback(
    async (
      skill: ManagedSkillGroup,
      options: { visibility: SkillPublishVisibility },
    ): Promise<PublishSkillResult | null> => {
      if (skillMutationInFlightRef.current) {
        toast.info(t("skills.operationInProgress"))
        return null
      }

      const skillPath = getLocalSkillPublishPath(skill)
      if (!skillPath) {
        toast.error(t("skills.publishNoLocalPath"))
        return null
      }

      skillMutationInFlightRef.current = true
      setPublishingSkillId(skill.id)
      setPlanError(null)

      try {
        const result = await skillService.invoke("publishSkill", {
          path: skillPath,
          visibility: options.visibility,
        })
        if (authResource.data?.status === "authenticated" && authResource.data.account) {
          invalidateMyPublishedSkillCatalog(authResource.data.account.id)
        }
        invalidatePublicSkillCatalog()
        inventoryResource.setData(result.inventory)
        await versionResource
          .refresh({ forceRefresh: true, silent: true })
          .catch((error: unknown) =>
            reportRendererHandledError("skills", "silent skill version refresh failed after publish", error),
          )
        toast.success(t("skills.publishDone", { name: skill.name }))
        void loadMyPublishedSkillPackages({ forceRefresh: true }).catch((error: unknown) => {
          reportRendererHandledError("skills", "published skill package refresh failed after publish", error)
        })
        if (publicPackageCatalog.items.length > 0) {
          void loadPublicSkillPackages({ forceRefresh: true }).catch((error: unknown) => {
            reportRendererHandledError("skills", "public skill package refresh failed after publish", error)
          })
        }
        return result
      } catch (cause) {
        setPlanError({
          cause: resolveUserFacingError(cause, { area: "skills" }),
          operation: "publish",
          skillId: skill.id,
        })
        throw cause
      } finally {
        skillMutationInFlightRef.current = false
        setPublishingSkillId(null)
      }
    },
    [
      authResource.data,
      inventoryResource,
      loadMyPublishedSkillPackages,
      loadPublicSkillPackages,
      publicPackageCatalog.items.length,
      skillService,
      t,
      versionResource,
    ],
  )

  const executeCliUpdate = React.useCallback(async () => {
    if (skillMutationInFlightRef.current) {
      toast.info(t("skills.operationInProgress"))
      return
    }

    skillMutationInFlightRef.current = true
    setIsExecutingCliUpdate(true)
    setCliUpdateError(null)

    try {
      const report = await skillService.invoke("executeCliUpdate")
      versionResource.setData(report)
      await inventoryResource.refresh({ forceRefresh: true, silent: true })
    } catch (cause) {
      setCliUpdateError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      skillMutationInFlightRef.current = false
      setIsExecutingCliUpdate(false)
    }
  }, [inventoryResource, skillService, t, versionResource])

  const isPublicPackageLoadingMore = activePackageCatalog.status === "loading-more"
  const isPublicPackageReplacing =
    activePackageCatalog.status === "loading" || activePackageCatalog.status === "refreshing"
  const detailContentProps: SkillDetailContentProps = {
    copySkillPath,
    inventoryInitialLoading: inventoryResource.isInitialLoading,
    isRemovingSkill,
    isSkillLinkedToOrganization: selectedSkillLinkedToActiveOrganization,
    openSkillFolder,
    publishSkill: setPublishDialogSkill,
    publishingSkillId,
    requestRemoveSkill: (skill) => setRemoveTarget({ skill }),
    requestOrganizationLink: (skill) => {
      const packageName = skill.packageName?.trim()
      if (!packageName) {
        return
      }
      setOrganizationLinkTarget({
        packageName,
        skillName: skill.id,
        title: skill.name,
        version: skill.version ?? "latest",
      })
    },
    selectedPlanError: visibleSkillOperationError(planError, selectedSkill?.id),
    selectedSkill,
    selectedStatus,
    showOrganizationLinkAction: showSelectedSkillOrganizationLinkAction,
    selectedVersionCheck,
    updateRegistrySkill,
    updatingRegistrySkillId,
  }
  const organizationInstallMissingAction =
    activeTab === "organization" && organizationHeaderInstallTargets.length > 1 ? (
      <OrganizationInstallMissingButton
        busy={organizationSkillBusyAction === "installSkillBatch"}
        count={organizationHeaderInstallTargets.length}
        disabled={Boolean(organizationSkillBusyAction)}
        onClick={() => installOrganizationRuntimeSkills(organizationHeaderInstallTargets)}
      />
    ) : null
  return (
    <>
      <section className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
        <SkillPageHeader
          activeTab={activeTab}
          discoveryFilter={discoveryFilter}
          discoveryQuery={discoveryQuery}
          installedFilter={installedFilter}
          installedQuery={query}
          organizationFilter={organizationFilter}
          organizationQuery={organizationQuery}
          organizationTabAvailable={Boolean(workspace.activeWorkspace.organizationId)}
          organizationAction={organizationInstallMissingAction}
          onDiscoveryFilterChange={setDiscoveryFilter}
          onDiscoveryQueryChange={setDiscoveryQuery}
          onInstalledFilterChange={setInstalledFilter}
          onInstalledQueryChange={setQuery}
          onOrganizationFilterChange={setOrganizationFilter}
          onOrganizationQueryChange={setOrganizationQuery}
          onTabChange={setActiveTab}
        />
        {activeTab === "organization" ? (
          <OrganizationSkillsPane
            busyAction={organizationSkillBusyAction}
            groupById={installedSkillGroupById}
            organizationFilter={organizationFilter}
            organizationQuery={deferredOrganizationQuery}
            organizationSkills={organizationSkills}
            providerRecommendationsLoading={connectedProvidersLoading || providerSkillRecommendationsState.isLoading}
            providerRecommendationsPendingCount={providerSkillRecommendationsState.pendingCount}
            providerRecommendations={providerSkillRecommendations}
            providerRecommendationsTotalCount={providerSkillRecommendationsState.totalCount}
            workspace={workspace}
            onAddRecommendation={addOrganizationSkillFromRecommendation}
            onInstallRuntimeSkill={installOrganizationRuntimeSkill}
            onOpenManagedSkill={openManagedPublicSkill}
          />
        ) : activeTab === "discover" ? (
          <DiscoverSkillsPane
            error={activePackageCatalog.error}
            filter={discoveryFilter}
            groupById={installedSkillGroupById}
            installingKey={installingRegistryResultId}
            isLoading={isPublicPackageReplacing}
            isLoadingMore={isPublicPackageLoadingMore}
            isSignedIn={authResource.data?.status === "authenticated"}
            locale={locale}
            next={activePackageCatalog.next}
            packages={filteredPublicPackages}
            providerRecommendations={installableProviderSkillRecommendations}
            selectedPackage={selectedPublicPackage}
            onClosePackage={() => activePackageDispatcher({ id: null, type: "select" })}
            onInstall={installPublicSkill}
            onLoadMore={() =>
              void (discoveryFilter === "mine"
                ? loadMyPublishedSkillPackages({ next: activePackageCatalog.next })
                : isPublicSearchActive
                  ? loadPublicSkillSearch(debouncedDiscoveryQuery, { next: activePackageCatalog.next })
                  : loadPublicSkillPackages({ next: activePackageCatalog.next }))
            }
            onOpenManagedSkill={openManagedPublicSkill}
            onOpenOrganizationRecommendations={() => setActiveTab("organization")}
            onRetry={() => {
              if (discoveryFilter === "mine") {
                if (authResource.data?.status === "authenticated") {
                  void loadMyPublishedSkillPackages({ forceRefresh: true })
                }
                return
              }
              void (isPublicSearchActive
                ? loadPublicSkillSearch(debouncedDiscoveryQuery, { forceRefresh: true, replace: true })
                : loadPublicSkillPackages({ forceRefresh: true }))
            }}
            onSelectPackage={(pkg) => activePackageDispatcher({ id: pkg.id, type: "select" })}
          />
        ) : (
          <InstalledSkillsPane
            cliUpdateError={cliUpdateError}
            cliVersionCheck={versionResource.data?.cli}
            groups={filteredInstalledGroups}
            isExecutingCliUpdate={isExecutingCliUpdate}
            updateRegistrySkill={updateRegistrySkill}
            updatingRegistrySkillId={updatingRegistrySkillId}
            versionCheckByKey={versionCheckByKey}
            selectedSkill={
              selectedSkill && filteredInstalledGroups.some((group) => group.id === selectedSkill.id)
                ? selectedSkill
                : undefined
            }
            onSelectSkill={selectSkill}
            onUpdateCli={executeCliUpdate}
          />
        )}
      </section>
      {selectedSkill ? (
        <SkillManagementSheet subjectName={selectedSkill.name} onClose={() => setSelectedSkillId(null)}>
          <SkillDetailContent {...detailContentProps} />
        </SkillManagementSheet>
      ) : null}
      <DeleteSkillConfirmDialog
        isRemoving={isRemovingSkill}
        target={removeTarget}
        onConfirm={removeSkill}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            setRemoveTarget(null)
          }
        }}
      />
      <PublishSkillDialog
        busy={Boolean(publishingSkillId)}
        managedOrganizations={managedOrganizationOptions}
        open={Boolean(publishDialogSkill)}
        skill={publishDialogSkill}
        onClose={() => {
          if (!publishingSkillId) {
            setPublishDialogSkill(null)
            setPlanError(null)
          }
        }}
        onLinkOrganization={linkPublishedSkillToOrganization}
        onPublish={publishSkill}
      />
      <OrganizationLinkDialog
        managedOrganizations={managedOrganizationOptions}
        open={Boolean(organizationLinkTarget)}
        target={organizationLinkTarget}
        onClose={() => setOrganizationLinkTarget(null)}
        onLinkOrganization={linkPublishedSkillToOrganization}
      />
    </>
  )
}
