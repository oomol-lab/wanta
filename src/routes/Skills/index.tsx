import type { ConnectionProvider } from "../../../electron/connections/common.ts"
import type { ManagedSkillGroup, PublicSkillPackage } from "../../../electron/skills/common.ts"
import type { BusyAction, OrganizationSkillLinkInput } from "./organization-management-model.ts"
import type { ProviderSkillRecommendation } from "./provider-skill-recommendations.ts"
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
import type { UseOrganizationSkills } from "@/hooks/useOrganizationSkills"
import type { UseOrganizationWorkspace } from "@/hooks/useOrganizationWorkspace"

import * as React from "react"
import { toast } from "sonner"
import { DiscoverSkillsPane } from "./DiscoverSkillsPane.tsx"
import { InstalledSkillsPane } from "./InstalledSkillsPane.tsx"
import { OrganizationSkillsPane } from "./OrganizationSkillsPane.tsx"
import { useProviderSkillPackageLookup } from "./provider-skill-package-lookup.ts"
import {
  buildProviderSkillRecommendations,
  getInstallableProviderSkillRecommendations,
} from "./provider-skill-recommendations.ts"
import { skillErrorMessage } from "./skill-errors.ts"
import {
  getGroupStatus,
  getLocalSkillPublishPath,
  getPublicPackagePrimarySkill,
  getRuntimeHosts,
  getSkillVersionCheck,
  getSkillVersionCheckKey,
  initialPublicPackageCatalogState,
  isInstalledSkillGroup,
  matchesInstalledSkillFilter,
  matchesPublicPackageQuery,
  publicPackageCatalogReducer,
} from "./skill-route-model.ts"
import { SkillDetailContent } from "./SkillDetailContent.tsx"
import { SkillPageHeader } from "./SkillPageHeader.tsx"
import { useSkillService } from "@/components/AppContext"
import {
  useAuthStateResource,
  useHomeSummaryResource,
  useSkillInventoryResource,
  useSkillVersionReportResource,
} from "@/components/AppDataHooks"
import { DeleteSkillConfirmDialog } from "@/components/DeleteSkillConfirmDialog"
import { useSkillObjectActions } from "@/components/useSkillObjectActions"
import { useAppI18n } from "@/i18n"
import { listMyPublishedSkillPackages, listPublicSkillPackages } from "@/lib/skills-catalog-client"
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
  connectedProviders,
  focusRequest,
  organizationSkills,
  workspace,
}: {
  connectedProviders: ConnectionProvider[]
  focusRequest?: { nonce: number; tab: SkillPageTab } | null
  organizationSkills: UseOrganizationSkills
  workspace: UseOrganizationWorkspace
}) {
  const { locale, t } = useAppI18n()
  const skillService = useSkillService()
  const authResource = useAuthStateResource()
  const inventoryResource = useSkillInventoryResource()
  const versionResource = useSkillVersionReportResource()
  const homeSummaryResource = useHomeSummaryResource()
  const inventory = inventoryResource.data
  const installedSkillGroupById = React.useMemo<ManagedSkillGroupById>(() => {
    return new Map((inventory?.groups ?? []).map((group) => [group.id, group]))
  }, [inventory?.groups])
  const providerSkillPackageLookup = useProviderSkillPackageLookup(connectedProviders)
  const providerSkillRecommendations = React.useMemo(
    () =>
      buildProviderSkillRecommendations({
        groupById: installedSkillGroupById,
        packagesByService: providerSkillPackageLookup.packagesByService,
        providers: connectedProviders,
      }),
    [connectedProviders, installedSkillGroupById, providerSkillPackageLookup.packagesByService],
  )
  const installableProviderSkillRecommendations = React.useMemo(
    () => getInstallableProviderSkillRecommendations(providerSkillRecommendations),
    [providerSkillRecommendations],
  )
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
  const [publicPackageCatalog, dispatchPublicPackageCatalog] = React.useReducer(
    publicPackageCatalogReducer,
    initialPublicPackageCatalogState,
  )
  const [myPublishedPackageCatalog, dispatchMyPublishedPackageCatalog] = React.useReducer(
    publicPackageCatalogReducer,
    initialPublicPackageCatalogState,
  )
  const [installingRegistryResultId, setInstallingRegistryResultId] = React.useState<string | null>(null)
  const [planError, setPlanError] = React.useState<SkillOperationError | null>(null)
  const [cliUpdateError, setCliUpdateError] = React.useState<string | null>(null)
  const [publishingSkillId, setPublishingSkillId] = React.useState<string | null>(null)
  const [updatingRegistrySkillId, setUpdatingRegistrySkillId] = React.useState<string | null>(null)
  const [organizationSkillBusyAction, setOrganizationSkillBusyAction] = React.useState<BusyAction | null>(null)
  const [isExecutingCliUpdate, setIsExecutingCliUpdate] = React.useState(false)
  const [narrowPane, setNarrowPane] = React.useState<"detail" | "list">("list")
  const publishSkillInFlightRef = React.useRef(false)
  const updateRegistryInFlightRef = React.useRef(false)
  const cliUpdateInFlightRef = React.useRef(false)
  const installRegistryInFlightRef = React.useRef(false)
  const organizationSkillInFlightRef = React.useRef(false)
  const requestedVersionCheckRef = React.useRef(false)
  const publicPackageRequestIdRef = React.useRef(0)
  const myPublishedPackageRequestIdRef = React.useRef(0)
  const { copySkillPath, isRemovingSkill, openSkillFolder, removeSkill, removeTarget, setRemoveTarget } =
    useSkillObjectActions({
      onDeleted: (nextInventory) => {
        const nextSelectedSkill = nextInventory.groups.find(isInstalledSkillGroup)
        setSelectedSkillId(nextSelectedSkill?.id ?? null)
        setNarrowPane("list")
        homeSummaryResource.invalidate()
      },
    })

  React.useEffect(() => {
    if (!selectedSkillId && inventory?.groups[0]) {
      setSelectedSkillId(inventory.groups[0].id)
    }
  }, [inventory?.groups, selectedSkillId])

  const searchedGroups = React.useMemo(() => {
    const groups = inventory?.groups ?? []
    const normalizedQuery = query.trim().toLowerCase()

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
  }, [inventory?.groups, query])

  const installedGroups = React.useMemo(() => searchedGroups.filter(isInstalledSkillGroup), [searchedGroups])
  const filteredInstalledGroups = React.useMemo(() => {
    return installedGroups.filter((group) => {
      return matchesInstalledSkillFilter(group, installedFilter, getSkillVersionCheck(versionCheckByKey, group))
    })
  }, [installedFilter, installedGroups, versionCheckByKey])
  const selectedSkill = searchedGroups.find((group) => group.id === selectedSkillId) || searchedGroups[0]
  const selectedStatus = selectedSkill ? getGroupStatus(selectedSkill, t, getRuntimeHosts(selectedSkill)) : null
  const selectedVersionCheck = getSkillVersionCheck(versionCheckByKey, selectedSkill)
  React.useEffect(() => {
    if (requestedVersionCheckRef.current) {
      return
    }

    requestedVersionCheckRef.current = true
    void versionResource.refresh({ silent: true }).catch(() => {})
  }, [versionResource])

  React.useEffect(() => {
    if (versionResource.data?.cli?.status !== "update-available") {
      setCliUpdateError(null)
    }
  }, [versionResource.data?.cli?.status])

  React.useEffect(() => {
    if (activeTab === "organization" && workspace.activeWorkspace.type !== "organization") {
      setActiveTab("discover")
    }
  }, [activeTab, workspace.activeWorkspace.type])

  React.useEffect(() => {
    if (!focusRequest) {
      return
    }
    if (focusRequest.tab === "organization" && workspace.activeWorkspace.type !== "organization") {
      return
    }
    setActiveTab(focusRequest.tab)
  }, [focusRequest, workspace.activeWorkspace.type])

  const selectSkill = React.useCallback((skillId: SkillSelectionKey) => {
    setSelectedSkillId(skillId)
    setNarrowPane("detail")
  }, [])

  const loadPublicSkillPackages = React.useCallback(
    async (options: { forceRefresh?: boolean; next?: string | null } = {}) => {
      const next = options.next?.trim() || undefined
      const append = Boolean(next && !options.forceRefresh)
      const requestId = publicPackageRequestIdRef.current + 1
      publicPackageRequestIdRef.current = requestId
      dispatchPublicPackageCatalog({ append, requestId, type: "load-start" })

      try {
        const catalog = await listPublicSkillPackages({ next })
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

  React.useEffect(() => {
    if (
      activeTab !== "discover" ||
      discoveryFilter !== "all" ||
      publicPackageCatalog.items.length > 0 ||
      publicPackageCatalog.status !== "idle"
    ) {
      return
    }

    void loadPublicSkillPackages().catch(() => undefined)
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

    void loadMyPublishedSkillPackages().catch(() => undefined)
  }, [
    activeTab,
    authResource.data?.status,
    discoveryFilter,
    loadMyPublishedSkillPackages,
    myPublishedPackageCatalog.items.length,
    myPublishedPackageCatalog.status,
  ])

  const activePackageCatalog = discoveryFilter === "mine" ? myPublishedPackageCatalog : publicPackageCatalog
  const activePackageDispatcher =
    discoveryFilter === "mine" ? dispatchMyPublishedPackageCatalog : dispatchPublicPackageCatalog
  const filteredPublicPackages = React.useMemo(() => {
    const normalizedQuery = discoveryQuery.trim().toLowerCase()
    return activePackageCatalog.items.filter((pkg) => matchesPublicPackageQuery(pkg, normalizedQuery))
  }, [activePackageCatalog.items, discoveryQuery])

  const selectedPublicPackage = React.useMemo(() => {
    return activePackageCatalog.selectedId
      ? activePackageCatalog.items.find((pkg) => pkg.id === activePackageCatalog.selectedId)
      : undefined
  }, [activePackageCatalog.items, activePackageCatalog.selectedId])

  const openManagedPublicSkill = React.useCallback((skillName: string) => {
    setActiveTab("installed")
    setInstalledFilter("all")
    setQuery("")
    setSelectedSkillId(skillName)
    setNarrowPane("detail")
  }, [])

  const installPublicSkill = React.useCallback(
    async (pkg: PublicSkillPackage, skillName?: string) => {
      if (installRegistryInFlightRef.current) {
        return
      }

      const targetSkillName = skillName ?? getPublicPackagePrimarySkill(pkg)?.name
      if (!targetSkillName) {
        toast.error(t("skills.discoverInstallNoSkill"))
        return
      }

      installRegistryInFlightRef.current = true
      setInstallingRegistryResultId(`${pkg.id}:${targetSkillName}`)

      try {
        const nextInventory = await skillService.invoke("installRegistrySkill", {
          packageName: pkg.name,
          skillId: targetSkillName,
        })
        inventoryResource.setData(nextInventory)
        homeSummaryResource.invalidate()
        versionResource.invalidate()
        toast.success(t("skills.registryInstallDone", { name: targetSkillName }))
      } catch (cause) {
        toast.error(t("skills.registryInstallFailed", { error: skillErrorMessage(cause, t) }))
      } finally {
        installRegistryInFlightRef.current = false
        setInstallingRegistryResultId(null)
      }
    },
    [homeSummaryResource, inventoryResource, skillService, t, versionResource],
  )

  const beginOrganizationSkillAction = React.useCallback((action: BusyAction): boolean => {
    if (organizationSkillInFlightRef.current) {
      return false
    }
    organizationSkillInFlightRef.current = true
    setOrganizationSkillBusyAction(action)
    return true
  }, [])

  const endOrganizationSkillAction = React.useCallback((): void => {
    organizationSkillInFlightRef.current = false
    setOrganizationSkillBusyAction(null)
  }, [])

  const installOrganizationRuntimeSkill = React.useCallback(
    async (skill: { packageName: string; skillName: string }) => {
      if (!beginOrganizationSkillAction(`installSkill:${skill.packageName}:${skill.skillName}`)) {
        return
      }

      try {
        const nextInventory = await skillService.invoke("installRegistrySkill", {
          packageName: skill.packageName,
          skillId: skill.skillName,
        })
        inventoryResource.setData(nextInventory)
        homeSummaryResource.invalidate()
        versionResource.invalidate()
        toast.success(t("skills.registryInstallDone", { name: skill.skillName }))
      } catch (cause) {
        toast.error(t("skills.registryInstallFailed", { error: skillErrorMessage(cause, t) }))
      } finally {
        endOrganizationSkillAction()
      }
    },
    [
      beginOrganizationSkillAction,
      endOrganizationSkillAction,
      homeSummaryResource,
      inventoryResource,
      skillService,
      t,
      versionResource,
    ],
  )

  const installOrganizationRuntimeSkills = React.useCallback(
    async (skills: readonly { packageName: string; skillName: string }[]) => {
      const targets = skills.filter((skill) => skill.packageName.trim() && skill.skillName.trim())
      if (targets.length === 0 || !beginOrganizationSkillAction("installSkillBatch")) {
        return
      }

      let installedCount = 0
      let failedCount = 0
      let firstError: unknown
      try {
        for (const skill of targets) {
          try {
            const nextInventory = await skillService.invoke("installRegistrySkill", {
              packageName: skill.packageName,
              skillId: skill.skillName,
            })
            inventoryResource.setData(nextInventory)
            installedCount += 1
          } catch (cause) {
            failedCount += 1
            firstError ??= cause
          }
        }
        homeSummaryResource.invalidate()
        versionResource.invalidate()
        if (installedCount > 0) {
          toast.success(t("organizations.skillManageInstallMissingSuccess", { count: installedCount }))
        }
        if (failedCount > 0) {
          toast.error(
            t("organizations.skillManageInstallMissingFailed", {
              count: failedCount,
              error: skillErrorMessage(firstError, t),
            }),
          )
        }
      } finally {
        endOrganizationSkillAction()
      }
    },
    [
      beginOrganizationSkillAction,
      endOrganizationSkillAction,
      homeSummaryResource,
      inventoryResource,
      skillService,
      t,
      versionResource,
    ],
  )

  const linkOrganizationSkill = React.useCallback(
    async (input: OrganizationSkillLinkInput, options: { installRuntime: boolean }) => {
      if (!organizationSkills.canManage) {
        return
      }

      await organizationSkills.addSkill({
        packageName: input.packageName,
        skillName: input.skillName,
        version: input.version,
        versionPolicy: "pinned",
      })
      if (options.installRuntime) {
        const nextInventory = await skillService.invoke("installRegistrySkill", {
          packageName: input.packageName,
          skillId: input.skillName,
        })
        inventoryResource.setData(nextInventory)
        homeSummaryResource.invalidate()
        versionResource.invalidate()
      }
    },
    [homeSummaryResource, inventoryResource, organizationSkills, skillService, versionResource],
  )

  const addOrganizationSkillFromRecommendation = React.useCallback(
    async (recommendation: ProviderSkillRecommendation, options: { installRuntime: boolean }) => {
      if (
        !organizationSkills.canManage ||
        !beginOrganizationSkillAction(`addSkill:${recommendation.packageName}:${recommendation.skillId}`)
      ) {
        return
      }

      try {
        await linkOrganizationSkill(
          {
            packageName: recommendation.packageName,
            skillName: recommendation.skillId,
            version: recommendation.package.version,
          },
          options,
        )
        toast.success(t("organizations.skillManageAddSuccess"))
      } catch (cause) {
        toast.error(skillErrorMessage(cause, t))
      } finally {
        endOrganizationSkillAction()
      }
    },
    [beginOrganizationSkillAction, endOrganizationSkillAction, linkOrganizationSkill, organizationSkills.canManage, t],
  )

  const updateRegistrySkill = React.useCallback(
    async (skill: Pick<ManagedSkillGroup, "id" | "kind" | "packageName">) => {
      if (updateRegistryInFlightRef.current) {
        return
      }

      const packageName = skill.packageName?.trim()
      if (!packageName) {
        return
      }

      updateRegistryInFlightRef.current = true
      setUpdatingRegistrySkillId(skill.id)
      setPlanError(null)

      try {
        if (skill.kind !== "registry") {
          return
        }

        const nextInventory = await skillService.invoke("updateRegistrySkill", {
          packageName,
          skillId: skill.id,
        })
        inventoryResource.setData(nextInventory)
        await versionResource.refresh({ forceRefresh: true, silent: true })
        homeSummaryResource.invalidate()
      } catch (cause) {
        setPlanError({
          cause: resolveUserFacingError(cause, { area: "skills", preserveMessage: true }),
          operation: "update",
          skillId: skill.id,
        })
      } finally {
        updateRegistryInFlightRef.current = false
        setUpdatingRegistrySkillId(null)
      }
    },
    [homeSummaryResource, inventoryResource, skillService, versionResource],
  )

  const publishSkill = React.useCallback(
    async (skill: ManagedSkillGroup) => {
      if (publishSkillInFlightRef.current) {
        return
      }

      const skillPath = getLocalSkillPublishPath(skill)
      if (!skillPath) {
        toast.error(t("skills.publishNoLocalPath"))
        return
      }

      publishSkillInFlightRef.current = true
      setPublishingSkillId(skill.id)
      setPlanError(null)

      try {
        const result = await skillService.invoke("publishSkill", {
          path: skillPath,
          visibility: "public",
        })
        inventoryResource.setData(result.inventory)
        await versionResource.refresh({ forceRefresh: true, silent: true }).catch(() => {})
        homeSummaryResource.invalidate()
        toast.success(t("skills.publishDone", { name: skill.name }))
        void loadMyPublishedSkillPackages({ forceRefresh: true }).catch(() => undefined)
        if (publicPackageCatalog.items.length > 0) {
          void loadPublicSkillPackages({ forceRefresh: true }).catch(() => undefined)
        }
      } catch (cause) {
        setPlanError({
          cause: resolveUserFacingError(cause, { area: "skills", preserveMessage: true }),
          operation: "publish",
          skillId: skill.id,
        })
      } finally {
        publishSkillInFlightRef.current = false
        setPublishingSkillId(null)
      }
    },
    [
      homeSummaryResource,
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
    if (cliUpdateInFlightRef.current) {
      return
    }

    cliUpdateInFlightRef.current = true
    setIsExecutingCliUpdate(true)
    setCliUpdateError(null)

    try {
      const report = await skillService.invoke("executeCliUpdate")
      versionResource.setData(report)
      await inventoryResource.refresh({ forceRefresh: true, silent: true })
      homeSummaryResource.invalidate()
    } catch (cause) {
      setCliUpdateError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      cliUpdateInFlightRef.current = false
      setIsExecutingCliUpdate(false)
    }
  }, [homeSummaryResource, inventoryResource, skillService, versionResource])

  const isPublicPackageLoadingMore = activePackageCatalog.status === "loading-more"
  const isPublicPackageReplacing =
    activePackageCatalog.status === "loading" || activePackageCatalog.status === "refreshing"
  const detailContentProps: SkillDetailContentProps = {
    copySkillPath,
    inventoryInitialLoading: inventoryResource.isInitialLoading,
    isRemovingSkill,
    openSkillFolder,
    publishSkill,
    publishingSkillId,
    requestRemoveSkill: (skill) => setRemoveTarget({ skill }),
    selectedPlanError: visibleSkillOperationError(planError, selectedSkill?.id),
    selectedSkill,
    selectedStatus,
    selectedVersionCheck,
    updateRegistrySkill,
    updatingRegistrySkillId,
  }

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
          organizationTabAvailable={workspace.activeWorkspace.type === "organization"}
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
            organizationQuery={organizationQuery}
            organizationSkills={organizationSkills}
            providerRecommendations={providerSkillRecommendations}
            workspace={workspace}
            onAddRecommendation={addOrganizationSkillFromRecommendation}
            onInstallRuntimeSkill={installOrganizationRuntimeSkill}
            onInstallRuntimeSkills={installOrganizationRuntimeSkills}
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
                : loadPublicSkillPackages({ next: activePackageCatalog.next }))
            }
            onOpenManagedSkill={openManagedPublicSkill}
            onOpenOrganizationRecommendations={
              workspace.activeWorkspace.type === "organization" ? () => setActiveTab("organization") : undefined
            }
            onRetry={() => {
              if (discoveryFilter === "mine") {
                if (authResource.data?.status === "authenticated") {
                  void loadMyPublishedSkillPackages({ forceRefresh: true })
                }
                return
              }
              void loadPublicSkillPackages({ forceRefresh: true })
            }}
            onSelectPackage={(pkg) => activePackageDispatcher({ id: pkg.id, type: "select" })}
          />
        ) : (
          <InstalledSkillsPane
            cliUpdateError={cliUpdateError}
            cliVersionCheck={versionResource.data?.cli}
            detailContent={<SkillDetailContent {...detailContentProps} />}
            groups={filteredInstalledGroups}
            isExecutingCliUpdate={isExecutingCliUpdate}
            isDetailOpen={narrowPane === "detail"}
            updateRegistrySkill={updateRegistrySkill}
            updatingRegistrySkillId={updatingRegistrySkillId}
            versionCheckByKey={versionCheckByKey}
            selectedSkill={
              selectedSkill && filteredInstalledGroups.some((group) => group.id === selectedSkill.id)
                ? selectedSkill
                : undefined
            }
            onCloseDetail={() => setNarrowPane("list")}
            onSelectSkill={(skillId) => {
              selectSkill(skillId)
            }}
            onUpdateCli={executeCliUpdate}
          />
        )}
      </section>
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
    </>
  )
}
