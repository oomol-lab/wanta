import type { ConnectionProvider } from "../../../electron/connections/common.ts"
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
import type { UseOrganizationSkills } from "@/hooks/useOrganizationSkills"
import type { UseOrganizationWorkspace } from "@/hooks/useOrganizationWorkspace"

import * as React from "react"
import { toast } from "sonner"
import { DiscoverSkillsPane } from "./DiscoverSkillsPane.tsx"
import { InstalledSkillsPane } from "./InstalledSkillsPane.tsx"
import { OrganizationInstallMissingButton } from "./OrganizationSkillManageRows.tsx"
import { OrganizationSkillsPane } from "./OrganizationSkillsPane.tsx"
import { PersonalSkillRecommendationsPane } from "./PersonalSkillRecommendationsPane.tsx"
import { skillErrorMessage } from "./skill-errors.ts"
import {
  getGroupStatus,
  getInstallableOrganizationSkills,
  getLocalSkillPublishPath,
  getPublicPackagePrimarySkill,
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
import { useOrganizationSkillActions } from "./use-organization-skill-actions.ts"
import { useSkillService } from "@/components/AppContext"
import {
  useAuthStateResource,
  useHomeSummaryResource,
  useSkillInventoryResource,
  useSkillVersionReportResource,
} from "@/components/AppDataHooks"
import { AppIcons } from "@/components/AppIcons"
import { DeleteSkillConfirmDialog } from "@/components/DeleteSkillConfirmDialog"
import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useSkillObjectActions } from "@/components/useSkillObjectActions"
import { useProviderSkillRecommendations } from "@/hooks/useProviderSkillRecommendations"
import { useAppI18n } from "@/i18n"
import { addOrganizationSkill } from "@/lib/organization-skills-client"
import { reportRendererHandledError } from "@/lib/renderer-diagnostics"
import {
  invalidateMyPublishedSkillCatalog,
  invalidatePublicSkillCatalog,
  listMyPublishedSkillPackages,
  listPublicSkillPackages,
} from "@/lib/skills-catalog-client"
import { resolveUserFacingError } from "@/lib/user-facing-error"

type SkillOperationError = {
  cause: unknown
  operation: "publish" | "update"
  skillId: SkillSelectionKey
}

type SkillPublishVisibility = "private" | "public"

type SkillPublishStep = "form" | "published" | "link-failed"

type SkillOrganizationLinkTarget = {
  packageName: string
  skillName: string
  title: string
  version: string
}

type ManagedOrganizationOption = {
  id: string
  name: string
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
  connectedProvidersLoading = false,
  focusRequest,
  organizationSkills,
  workspace,
}: {
  connectedProviders: ConnectionProvider[]
  connectedProvidersLoading?: boolean
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
  const providerSkillRecommendationsState = useProviderSkillRecommendations({
    groupById: installedSkillGroupById,
    providers: connectedProviders,
  })
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
  const [recommendedQuery, setRecommendedQuery] = React.useState("")
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
  const [publishDialogSkill, setPublishDialogSkill] = React.useState<ManagedSkillGroup | null>(null)
  const [organizationLinkTarget, setOrganizationLinkTarget] = React.useState<SkillOrganizationLinkTarget | null>(null)
  const [updatingRegistrySkillId, setUpdatingRegistrySkillId] = React.useState<string | null>(null)
  const [organizationSkillBusyAction, setOrganizationSkillBusyAction] = React.useState<BusyAction | null>(null)
  const [isExecutingCliUpdate, setIsExecutingCliUpdate] = React.useState(false)
  const [narrowPane, setNarrowPane] = React.useState<"detail" | "list">("list")
  const publishSkillInFlightRef = React.useRef(false)
  const updateRegistryInFlightRef = React.useRef(false)
  const cliUpdateInFlightRef = React.useRef(false)
  const installRegistryInFlightRef = React.useRef(false)
  const requestedVersionCheckRef = React.useRef(false)
  const publicPackageRequestIdRef = React.useRef(0)
  const myPublishedPackageRequestIdRef = React.useRef(0)
  const { copySkillPath, isRemovingSkill, openSkillFolder, removeSkill, removeTarget, setRemoveTarget } =
    useSkillObjectActions({
      onDeleted: () => {
        setSelectedSkillId(null)
        setNarrowPane("list")
        homeSummaryResource.invalidate()
      },
    })

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
  const selectedSkill = getSelectedManagedSkillGroup(searchedGroups, selectedSkillId)
  const selectedStatus = selectedSkill ? getGroupStatus(selectedSkill, t, getRuntimeHosts(selectedSkill)) : null
  const selectedVersionCheck = getSkillVersionCheck(versionCheckByKey, selectedSkill)
  const managedOrganizationOptions = React.useMemo<ManagedOrganizationOption[]>(() => {
    return workspace.organizations
      .filter((organization) => workspace.getOrganizationCanManage(organization))
      .map((organization) => ({ id: organization.id, name: organization.name }))
  }, [workspace.getOrganizationCanManage, workspace.organizations])
  const selectedSkillLinkedToActiveOrganization = React.useMemo(() => {
    const packageName = selectedSkill?.packageName?.trim()
    if (!packageName || workspace.activeWorkspace.type !== "organization") {
      return false
    }
    return organizationSkills.skills.some((skill) => skill.packageName === packageName)
  }, [organizationSkills.skills, selectedSkill?.packageName, workspace.activeWorkspace.type])
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
    if (activeTab === "organization" && workspace.activeWorkspace.type !== "organization") {
      setActiveTab("discover")
    }
  }, [activeTab, workspace.activeWorkspace.type])

  React.useEffect(() => {
    if (activeTab === "recommended" && workspace.activeWorkspace.type !== "personal") {
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

  const {
    addOrganizationSkillFromRecommendation,
    installRuntimeSkill: installOrganizationRuntimeSkill,
    installRuntimeSkills: installOrganizationRuntimeSkills,
  } = useOrganizationSkillActions({
    busyAction: organizationSkillBusyAction,
    organizationSkills,
    setBusyAction: setOrganizationSkillBusyAction,
  })
  const activeOrganizationId =
    workspace.activeWorkspace.type === "organization" ? workspace.activeWorkspace.organizationId : null
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

  const linkPublishedSkillToOrganization = React.useCallback(
    async (target: SkillOrganizationLinkTarget, organizationId: string): Promise<void> => {
      await addOrganizationSkill(organizationId, {
        packageName: target.packageName,
        skillName: target.skillName,
        version: target.version,
        versionPolicy: "pinned",
      })

      if (
        workspace.activeWorkspace.type === "organization" &&
        workspace.activeWorkspace.organizationId === organizationId
      ) {
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
      if (publishSkillInFlightRef.current) {
        return null
      }

      const skillPath = getLocalSkillPublishPath(skill)
      if (!skillPath) {
        toast.error(t("skills.publishNoLocalPath"))
        return null
      }

      publishSkillInFlightRef.current = true
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
        homeSummaryResource.invalidate()
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
          cause: resolveUserFacingError(cause, { area: "skills", preserveMessage: true }),
          operation: "publish",
          skillId: skill.id,
        })
        throw cause
      } finally {
        publishSkillInFlightRef.current = false
        setPublishingSkillId(null)
      }
    },
    [
      authResource.data,
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
  const installPersonalRuntimeSkills = React.useCallback(
    (skills: readonly { packageName: string; skillName: string }[]) =>
      installOrganizationRuntimeSkills(skills, "personal"),
    [installOrganizationRuntimeSkills],
  )
  const personalRecommendationInstallTargets = React.useMemo(
    () =>
      installableProviderSkillRecommendations.map((recommendation) => ({
        packageName: recommendation.packageName,
        skillName: recommendation.skillId,
      })),
    [installableProviderSkillRecommendations],
  )
  const personalRecommendationInstallAction =
    activeTab === "recommended" && personalRecommendationInstallTargets.length > 1 ? (
      <Button
        type="button"
        size="sm"
        disabled={Boolean(organizationSkillBusyAction)}
        onClick={() => installPersonalRuntimeSkills(personalRecommendationInstallTargets)}
      >
        {organizationSkillBusyAction === "installSkillBatch" ? (
          <AppIcons.status.loading className="animate-spin" />
        ) : (
          <AppIcons.action.installPackage />
        )}
        {t("skills.personalRecommendationsInstallAll", { count: personalRecommendationInstallTargets.length })}
      </Button>
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
          organizationTabAvailable={workspace.activeWorkspace.type === "organization"}
          organizationAction={organizationInstallMissingAction}
          recommendedAction={personalRecommendationInstallAction}
          recommendedQuery={recommendedQuery}
          recommendedTabAvailable={workspace.activeWorkspace.type === "personal"}
          onDiscoveryFilterChange={setDiscoveryFilter}
          onDiscoveryQueryChange={setDiscoveryQuery}
          onInstalledFilterChange={setInstalledFilter}
          onInstalledQueryChange={setQuery}
          onOrganizationFilterChange={setOrganizationFilter}
          onOrganizationQueryChange={setOrganizationQuery}
          onRecommendedQueryChange={setRecommendedQuery}
          onTabChange={setActiveTab}
        />
        {activeTab === "recommended" ? (
          <PersonalSkillRecommendationsPane
            busyAction={organizationSkillBusyAction}
            isLoading={connectedProvidersLoading || providerSkillRecommendationsState.isLoading}
            query={recommendedQuery}
            recommendations={installableProviderSkillRecommendations}
            onInstallRuntimeSkill={installOrganizationRuntimeSkill}
          />
        ) : activeTab === "organization" ? (
          <OrganizationSkillsPane
            busyAction={organizationSkillBusyAction}
            groupById={installedSkillGroupById}
            organizationFilter={organizationFilter}
            organizationQuery={organizationQuery}
            organizationSkills={organizationSkills}
            providerRecommendationsLoading={connectedProvidersLoading || providerSkillRecommendationsState.isLoading}
            providerRecommendations={providerSkillRecommendations}
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

function PublishSkillDialog({
  busy,
  managedOrganizations,
  open,
  skill,
  onClose,
  onLinkOrganization,
  onPublish,
}: {
  busy: boolean
  managedOrganizations: ManagedOrganizationOption[]
  open: boolean
  skill: ManagedSkillGroup | null
  onClose: () => void
  onLinkOrganization: (target: SkillOrganizationLinkTarget, organizationId: string) => Promise<void>
  onPublish: (
    skill: ManagedSkillGroup,
    options: { visibility: SkillPublishVisibility },
  ) => Promise<PublishSkillResult | null>
}) {
  const { t } = useAppI18n()
  const [visibility, setVisibility] = React.useState<SkillPublishVisibility>("private")
  const [linkAfterPublish, setLinkAfterPublish] = React.useState(false)
  const [selectedOrganizationId, setSelectedOrganizationId] = React.useState("")
  const [step, setStep] = React.useState<SkillPublishStep>("form")
  const [publishedTarget, setPublishedTarget] = React.useState<SkillOrganizationLinkTarget | null>(null)
  const [publishError, setPublishError] = React.useState<string | null>(null)
  const [linkError, setLinkError] = React.useState<string | null>(null)
  const [linkedOrganizationId, setLinkedOrganizationId] = React.useState<string | null>(null)
  const [linking, setLinking] = React.useState(false)
  const [availableOrganizations, setAvailableOrganizations] = React.useState<ManagedOrganizationOption[]>([])
  const initializedSkillIdRef = React.useRef<string | null>(null)
  const hasManagedOrganizations = availableOrganizations.length > 0
  const visibilityLabel = visibility === "private" ? t("skills.visibility.private") : t("skills.visibility.public")
  const linkedOrganization = linkedOrganizationId
    ? availableOrganizations.find((organization) => organization.id === linkedOrganizationId)
    : undefined

  React.useEffect(() => {
    if (!open) {
      initializedSkillIdRef.current = null
      setAvailableOrganizations([])
      return
    }

    const skillId = skill?.id ?? null
    if (initializedSkillIdRef.current === skillId) {
      if (managedOrganizations.length > 0) {
        setAvailableOrganizations(managedOrganizations)
      }
      return
    }

    initializedSkillIdRef.current = skillId
    setVisibility("private")
    setLinkAfterPublish(false)
    setSelectedOrganizationId(managedOrganizations[0]?.id ?? "")
    setAvailableOrganizations(managedOrganizations)
    setStep("form")
    setPublishedTarget(null)
    setPublishError(null)
    setLinkError(null)
    setLinkedOrganizationId(null)
    setLinking(false)
  }, [managedOrganizations, open, skill?.id])

  React.useEffect(() => {
    if (!open || availableOrganizations.length === 0) {
      return
    }
    setSelectedOrganizationId((current) =>
      current && availableOrganizations.some((organization) => organization.id === current)
        ? current
        : (availableOrganizations[0]?.id ?? ""),
    )
  }, [availableOrganizations, open])

  const linkPublishedTarget = React.useCallback(
    async (target: SkillOrganizationLinkTarget, organizationId: string): Promise<boolean> => {
      if (!organizationId) {
        return false
      }
      setLinking(true)
      setLinkError(null)
      try {
        await onLinkOrganization(target, organizationId)
        setLinkedOrganizationId(organizationId)
        setStep("published")
        return true
      } catch (cause) {
        setStep("link-failed")
        setLinkError(skillErrorMessage(cause, t))
        return false
      } finally {
        setLinking(false)
      }
    },
    [onLinkOrganization, t],
  )

  const submitPublish = React.useCallback(async () => {
    if (!skill || busy || linking) {
      return
    }
    setPublishError(null)
    let result: PublishSkillResult | null = null
    try {
      result = await onPublish(skill, { visibility })
    } catch (cause) {
      setPublishError(skillErrorMessage(cause, t))
      return
    }
    if (!result) {
      return
    }
    const target: SkillOrganizationLinkTarget = {
      packageName: result.packageName,
      skillName: skill.id,
      title: skill.name,
      version: result.version,
    }
    setPublishedTarget(target)
    setStep("published")
    if (linkAfterPublish && selectedOrganizationId) {
      await linkPublishedTarget(target, selectedOrganizationId)
    }
  }, [busy, linkAfterPublish, linkPublishedTarget, linking, onPublish, selectedOrganizationId, skill, t, visibility])

  const footer =
    step === "form" ? (
      <>
        <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button type="button" disabled={busy || linking} onClick={() => void submitPublish()}>
          {busy ? <AppIcons.status.loading className="animate-spin" /> : <AppIcons.action.publish />}
          {busy ? t("skills.publishing") : t("skills.publishConfirm")}
        </Button>
      </>
    ) : (
      <>
        {publishedTarget && hasManagedOrganizations && !linkedOrganizationId ? (
          <Button
            type="button"
            variant="outline"
            disabled={linking || !selectedOrganizationId}
            onClick={() => void linkPublishedTarget(publishedTarget, selectedOrganizationId)}
          >
            {linking ? <AppIcons.status.loading className="animate-spin" /> : <AppIcons.action.share />}
            {linking ? t("skills.organizationLinking") : t("skills.organizationLink")}
          </Button>
        ) : null}
        <Button type="button" onClick={onClose} disabled={linking}>
          {t("skills.publishDoneAction")}
        </Button>
      </>
    )

  return (
    <Dialog
      open={open}
      title={t("skills.publishDialogTitle", { name: skill?.name ?? "" })}
      description={t("skills.publishDialogDescription")}
      closeLabel={t("common.cancel")}
      className="max-w-xl"
      footer={footer}
      onClose={busy || linking ? () => undefined : onClose}
    >
      <div className="grid gap-4">
        <div className="grid gap-1 rounded-md border bg-muted/30 px-3 py-2.5">
          <div className="oo-text-caption-compact font-medium">{skill?.name}</div>
          <div className="oo-text-caption min-w-0 truncate">{getLocalSkillPublishPath(skill ?? emptySkillGroup)}</div>
        </div>

        {step === "form" ? (
          <>
            <fieldset className="grid gap-2">
              <legend className="oo-text-label">{t("skills.publishVisibility")}</legend>
              <label className="grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] gap-2 rounded-md border px-3 py-2">
                <input
                  type="radio"
                  name="skill-publish-visibility"
                  className="mt-1"
                  checked={visibility === "private"}
                  onChange={() => setVisibility("private")}
                />
                <span className="grid gap-0.5">
                  <span className="oo-text-caption-compact font-medium">{t("skills.visibility.private")}</span>
                  <span className="oo-text-caption">{t("skills.publishVisibilityPrivateDescription")}</span>
                </span>
              </label>
              <label className="grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] gap-2 rounded-md border px-3 py-2">
                <input
                  type="radio"
                  name="skill-publish-visibility"
                  className="mt-1"
                  checked={visibility === "public"}
                  onChange={() => setVisibility("public")}
                />
                <span className="grid gap-0.5">
                  <span className="oo-text-caption-compact font-medium">{t("skills.visibility.public")}</span>
                  <span className="oo-text-caption">{t("skills.publishVisibilityPublicDescription")}</span>
                </span>
              </label>
            </fieldset>

            <div className="grid gap-2">
              <label className="grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] gap-2 rounded-md border px-3 py-2">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={linkAfterPublish}
                  disabled={!hasManagedOrganizations}
                  onChange={(event) => setLinkAfterPublish(event.currentTarget.checked)}
                />
                <span className="grid gap-0.5">
                  <span className="oo-text-caption-compact font-medium">{t("skills.publishLinkAfterPublish")}</span>
                  <span className="oo-text-caption">
                    {hasManagedOrganizations
                      ? t("skills.publishLinkAfterPublishDescription")
                      : t("skills.publishNoOrganizations")}
                  </span>
                </span>
              </label>
              {linkAfterPublish && hasManagedOrganizations ? (
                <OrganizationSelect
                  organizations={availableOrganizations}
                  selectedOrganizationId={selectedOrganizationId}
                  onChange={setSelectedOrganizationId}
                />
              ) : null}
              {publishError ? (
                <div className="rounded-md border border-[var(--oo-danger-border)] bg-[var(--oo-danger-surface)] px-3 py-2 text-sm text-destructive">
                  {t("skills.publishFailed", { error: publishError })}
                </div>
              ) : null}
            </div>
          </>
        ) : (
          <div className="grid gap-3">
            <div className="grid gap-1 rounded-md border border-[var(--oo-success-border)] bg-[var(--oo-success-surface)] px-3 py-2.5">
              <div className="oo-text-caption-compact font-medium">{t("skills.publishResultTitle")}</div>
              <div className="oo-text-caption">
                {t("skills.publishResultDescription", {
                  visibility: visibilityLabel,
                })}
              </div>
            </div>
            {publishedTarget && hasManagedOrganizations ? (
              <div className="grid gap-2">
                <div className="oo-text-label">{t("skills.organizationUse")}</div>
                {linkedOrganization ? (
                  <div className="oo-text-caption rounded-md border bg-muted/30 px-3 py-2.5">
                    {t("skills.organizationLinkedResult", { name: linkedOrganization.name })}
                  </div>
                ) : (
                  <OrganizationSelect
                    organizations={availableOrganizations}
                    selectedOrganizationId={selectedOrganizationId}
                    onChange={setSelectedOrganizationId}
                  />
                )}
              </div>
            ) : null}
            {step === "link-failed" && linkError ? (
              <div className="rounded-md border border-[var(--oo-danger-border)] bg-[var(--oo-danger-surface)] px-3 py-2 text-sm text-destructive">
                {t("skills.organizationLinkFailed", { error: linkError })}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </Dialog>
  )
}

function OrganizationLinkDialog({
  managedOrganizations,
  open,
  target,
  onClose,
  onLinkOrganization,
}: {
  managedOrganizations: ManagedOrganizationOption[]
  open: boolean
  target: SkillOrganizationLinkTarget | null
  onClose: () => void
  onLinkOrganization: (target: SkillOrganizationLinkTarget, organizationId: string) => Promise<void>
}) {
  const { t } = useAppI18n()
  const [selectedOrganizationId, setSelectedOrganizationId] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!open) {
      return
    }
    setSelectedOrganizationId(managedOrganizations[0]?.id ?? "")
    setBusy(false)
    setError(null)
  }, [managedOrganizations, open, target?.packageName])

  const submit = React.useCallback(async () => {
    if (!target || !selectedOrganizationId || busy) {
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onLinkOrganization(target, selectedOrganizationId)
      onClose()
    } catch (cause) {
      setError(skillErrorMessage(cause, t))
    } finally {
      setBusy(false)
    }
  }, [busy, onClose, onLinkOrganization, selectedOrganizationId, t, target])

  return (
    <Dialog
      open={open}
      title={t("skills.organizationLinkDialogTitle", { name: target?.title ?? "" })}
      description={t("skills.organizationLinkDialogDescription")}
      closeLabel={t("common.cancel")}
      footer={
        <>
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            disabled={busy || !selectedOrganizationId || managedOrganizations.length === 0}
            onClick={() => void submit()}
          >
            {busy ? <AppIcons.status.loading className="animate-spin" /> : <AppIcons.action.share />}
            {busy ? t("skills.organizationLinking") : t("skills.organizationLink")}
          </Button>
        </>
      }
      onClose={busy ? () => undefined : onClose}
    >
      <div className="grid gap-3">
        {managedOrganizations.length > 0 ? (
          <OrganizationSelect
            organizations={managedOrganizations}
            selectedOrganizationId={selectedOrganizationId}
            onChange={setSelectedOrganizationId}
          />
        ) : (
          <div className="oo-text-caption rounded-md border bg-muted/30 px-3 py-2.5">
            {t("skills.publishNoOrganizations")}
          </div>
        )}
        {error ? (
          <div className="rounded-md border border-[var(--oo-danger-border)] bg-[var(--oo-danger-surface)] px-3 py-2 text-sm text-destructive">
            {t("skills.organizationLinkFailed", { error })}
          </div>
        ) : null}
      </div>
    </Dialog>
  )
}

function OrganizationSelect({
  organizations,
  selectedOrganizationId,
  onChange,
}: {
  organizations: ManagedOrganizationOption[]
  selectedOrganizationId: string
  onChange: (organizationId: string) => void
}) {
  const { t } = useAppI18n()
  return (
    <div className="grid gap-1.5">
      <label className="oo-text-caption-compact font-medium" htmlFor="skill-organization-link-target">
        {t("skills.organizationSelect")}
      </label>
      <Select value={selectedOrganizationId} onValueChange={onChange}>
        <SelectTrigger id="skill-organization-link-target" className="w-full">
          <SelectValue placeholder={t("organizations.selectOrganization")} />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {organizations.map((organization) => (
              <SelectItem key={organization.id} value={organization.id}>
                {organization.name}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  )
}

const emptySkillGroup: ManagedSkillGroup = {
  externalHosts: [],
  hosts: [],
  id: "",
  kind: "unknown",
  name: "",
  runtimeHosts: [],
}
