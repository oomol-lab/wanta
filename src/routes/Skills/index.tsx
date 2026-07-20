import type { ManagedSkillGroup, PublicSkillPackage, PublishSkillResult } from "../../../electron/skills/common.ts"
import type {
  DiscoverSkillFilter,
  InstalledSkillFilter,
  ManagedSkillGroupById,
  SkillPageTab,
  SkillSelectionKey,
  SkillVersionCheckByKey,
} from "./skill-route-model.ts"
import type { SkillDetailContentProps } from "./SkillDetailContent.tsx"
import type { TeamSkillFilter } from "./SkillPageHeader.tsx"
import type { ManagedTeamOption, SkillTeamLinkTarget, SkillPublishVisibility } from "./SkillPublishDialogs.tsx"
import type { BusyAction } from "./team-management-model.ts"
import type { ProviderSkillRecommendationsState } from "@/hooks/useProviderSkillRecommendations"
import type { UseTeamSkills } from "@/hooks/useTeamSkills"
import type { UseTeamWorkspace } from "@/hooks/useTeamWorkspace"

import * as React from "react"
import { toast } from "sonner"
import { DiscoverSkillsPane } from "./DiscoverSkillsPane.tsx"
import { InstalledSkillsPane } from "./InstalledSkillsPane.tsx"
import { skillErrorMessage } from "./skill-errors.ts"
import {
  getGroupStatus,
  getInstallableTeamSkills,
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
import { TeamLinkDialog, PublishSkillDialog } from "./SkillPublishDialogs.tsx"
import { SkillManagementSheet } from "./SkillUiParts.tsx"
import { TeamInstallMissingButton } from "./TeamSkillManageRows.tsx"
import { TeamSkillsPane } from "./TeamSkillsPane.tsx"
import { useRegistrySkillUpdate } from "./use-registry-skill-update.ts"
import { useTeamSkillActions } from "./use-team-skill-actions.ts"
import { useSkillService } from "@/components/AppContext"
import {
  useAuthStateResource,
  useSkillInventoryResource,
  useSkillVersionReportResource,
} from "@/components/AppDataHooks"
import { DeleteSkillConfirmDialog } from "@/components/DeleteSkillConfirmDialog"
import { useSkillObjectActions } from "@/components/useSkillObjectActions"
import { invalidateTeamSkillCache } from "@/hooks/useTeamSkills"
import { useAppI18n } from "@/i18n"
import { reportRendererHandledError } from "@/lib/renderer-diagnostics"
import {
  invalidateMyPublishedSkillCatalog,
  invalidatePublicSkillCatalog,
  listMyPublishedSkillPackages,
  listPublicSkillPackages,
  searchPublicSkillPackages,
} from "@/lib/skills-catalog-client"
import { addTeamSkill } from "@/lib/team-skills-client"
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
  cloudEnabled,
  connectedProvidersLoading = false,
  focusRequest,
  teamSkills,
  providerSkillRecommendationsState,
  workspace,
}: {
  cloudEnabled: boolean
  connectedProvidersLoading?: boolean
  focusRequest?: { nonce: number; tab: SkillPageTab } | null
  teamSkills: UseTeamSkills
  providerSkillRecommendationsState: ProviderSkillRecommendationsState
  workspace: UseTeamWorkspace
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
  const [teamFilter, setTeamFilter] = React.useState<TeamSkillFilter>("all")
  const [teamQuery, setTeamQuery] = React.useState("")
  const [discoveryQuery, setDiscoveryQuery] = React.useState("")
  const deferredInstalledQuery = React.useDeferredValue(query)
  const deferredTeamQuery = React.useDeferredValue(teamQuery)
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
  const [teamLinkTarget, setTeamLinkTarget] = React.useState<SkillTeamLinkTarget | null>(null)
  const [teamSkillBusyAction, setTeamSkillBusyAction] = React.useState<BusyAction | null>(null)
  const [isExecutingCliUpdate, setIsExecutingCliUpdate] = React.useState(false)
  const skillMutationInFlightRef = React.useRef(false)
  const requestedVersionCheckRef = React.useRef(false)
  const publicPackageRequestIdRef = React.useRef(0)
  const myPublishedPackageRequestIdRef = React.useRef(0)
  const myPublishedPackageControllerRef = React.useRef<AbortController | null>(null)
  const publicPackageSearchRequestIdRef = React.useRef(0)
  const publicPackageSearchControllerRef = React.useRef<AbortController | null>(null)
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
  const managedTeamOptions = React.useMemo<ManagedTeamOption[]>(() => {
    return workspace.teams
      .filter((team) => workspace.getTeamCanManage(team))
      .map((team) => ({ id: team.id, name: team.name }))
  }, [workspace.getTeamCanManage, workspace.teams])
  const selectedSkillLinkedToActiveTeam = React.useMemo(() => {
    const packageName = selectedSkill?.packageName?.trim()
    if (!packageName) {
      return false
    }
    return teamSkills.skills.some((skill) => skill.packageName === packageName)
  }, [teamSkills.skills, selectedSkill?.packageName])
  const showSelectedSkillTeamLinkAction = Boolean(selectedSkill?.packageName?.trim() && managedTeamOptions.length > 0)
  React.useEffect(() => {
    if (!cloudEnabled) {
      requestedVersionCheckRef.current = false
      return
    }
    if (requestedVersionCheckRef.current) {
      return
    }

    requestedVersionCheckRef.current = true
    void versionResource
      .refresh({ silent: true })
      .catch((error: unknown) => reportRendererHandledError("skills", "silent skill version refresh failed", error))
  }, [cloudEnabled, versionResource])

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
      focusRequest.tab === "team" && (!cloudEnabled || !workspace.activeWorkspace.teamId)
        ? "discover"
        : focusRequest.tab,
    )
  }, [cloudEnabled, focusRequest, workspace.activeWorkspace.teamId])

  React.useEffect(() => {
    if (activeTab === "team" && (!cloudEnabled || !workspace.activeWorkspace.teamId)) {
      setActiveTab("discover")
    }
    if (!cloudEnabled && discoveryFilter === "mine") {
      setDiscoveryFilter("all")
    }
    if (!cloudEnabled && installedFilter === "updates") {
      setInstalledFilter("all")
    }
  }, [activeTab, cloudEnabled, discoveryFilter, installedFilter, workspace.activeWorkspace.teamId])

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
      myPublishedPackageControllerRef.current?.abort()
      const controller = new AbortController()
      myPublishedPackageControllerRef.current = controller
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
          signal: controller.signal,
        })
        dispatchMyPublishedPackageCatalog({ append, catalog, requestId, type: "load-success" })
      } catch (cause) {
        if (controller.signal.aborted) {
          return
        }
        dispatchMyPublishedPackageCatalog({
          error: cause instanceof Error ? cause.message : String(cause),
          requestId,
          type: "load-error",
        })
      } finally {
        if (myPublishedPackageControllerRef.current === controller) {
          myPublishedPackageControllerRef.current = null
        }
      }
    },
    [authResource.data],
  )

  const loadPublicSkillSearch = React.useCallback(
    async (query: string, options: { forceRefresh?: boolean; next?: string | null; replace?: boolean } = {}) => {
      publicPackageSearchControllerRef.current?.abort()
      const controller = new AbortController()
      publicPackageSearchControllerRef.current = controller
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
        const catalog = await searchPublicSkillPackages({
          forceRefresh: options.forceRefresh,
          next,
          query,
          signal: controller.signal,
        })
        dispatchPublicPackageSearchCatalog({ append, catalog, requestId, type: "load-success" })
      } catch (cause) {
        if (controller.signal.aborted) {
          return
        }
        dispatchPublicPackageSearchCatalog({
          error: cause instanceof Error ? cause.message : String(cause),
          requestId,
          type: "load-error",
        })
      } finally {
        if (publicPackageSearchControllerRef.current === controller) {
          publicPackageSearchControllerRef.current = null
        }
      }
    },
    [],
  )

  React.useEffect(
    () => () => {
      publicPackageSearchControllerRef.current?.abort()
      myPublishedPackageControllerRef.current?.abort()
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
      if (!cloudEnabled) {
        toast.info(t("skills.signInToInstall"))
        return
      }
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
    [cloudEnabled, installedSkillGroupById, inventoryResource, skillService, t, versionResource],
  )

  const {
    addTeamSkillFromRecommendation,
    installRuntimeSkill: installTeamRuntimeSkill,
    installRuntimeSkills: installTeamRuntimeSkills,
  } = useTeamSkillActions({
    busyAction: teamSkillBusyAction,
    teamSkills,
    setBusyAction: setTeamSkillBusyAction,
  })
  const activeTeamId = workspace.activeWorkspace.teamId
  const teamHeaderInstallTargets = React.useMemo(() => {
    if (activeTab !== "team" || !activeTeamId || teamSkills.teamId !== activeTeamId) {
      return []
    }

    return getInstallableTeamSkills(installedSkillGroupById, teamSkills.skills).map((skill) => ({
      packageName: skill.packageName,
      skillName: skill.skillName,
    }))
  }, [activeTeamId, activeTab, installedSkillGroupById, teamSkills.teamId, teamSkills.skills])

  const linkPublishedSkillToTeam = React.useCallback(
    async (target: SkillTeamLinkTarget, teamId: string): Promise<void> => {
      await addTeamSkill(teamId, {
        packageName: target.packageName,
        skillName: target.skillName,
        version: target.version,
        versionPolicy: "pinned",
      })
      const accountId = authResource.data?.status === "authenticated" ? authResource.data.account?.id : undefined
      invalidateTeamSkillCache(accountId, teamId)

      if (workspace.activeWorkspace.teamId === teamId) {
        await teamSkills.refresh({ forceRefresh: true })
      }
      toast.success(t("skills.teamLinkDone", { name: target.title }))
    },
    [authResource.data, teamSkills, t, workspace.activeWorkspace],
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
    isSkillLinkedToTeam: selectedSkillLinkedToActiveTeam,
    openSkillFolder,
    publishSkill: setPublishDialogSkill,
    publishingSkillId,
    requestRemoveSkill: (skill) => setRemoveTarget({ skill }),
    requestTeamLink: (skill) => {
      const packageName = skill.packageName?.trim()
      if (!packageName) {
        return
      }
      setTeamLinkTarget({
        packageName,
        skillName: skill.id,
        title: skill.name,
        version: skill.version ?? "latest",
      })
    },
    selectedPlanError: visibleSkillOperationError(planError, selectedSkill?.id),
    selectedSkill,
    selectedStatus,
    showPublishAction: cloudEnabled,
    showRegistryActions: cloudEnabled,
    showTeamLinkAction: cloudEnabled && showSelectedSkillTeamLinkAction,
    selectedVersionCheck: cloudEnabled ? selectedVersionCheck : undefined,
    updateRegistrySkill,
    updatingRegistrySkillId,
  }
  const teamInstallMissingAction =
    activeTab === "team" && teamHeaderInstallTargets.length > 1 ? (
      <TeamInstallMissingButton
        busy={teamSkillBusyAction === "installSkillBatch"}
        count={teamHeaderInstallTargets.length}
        disabled={Boolean(teamSkillBusyAction)}
        onClick={() => installTeamRuntimeSkills(teamHeaderInstallTargets)}
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
          teamFilter={teamFilter}
          teamName={workspace.activeWorkspace.team?.name}
          teamQuery={teamQuery}
          teamTabAvailable={cloudEnabled && Boolean(workspace.activeWorkspace.teamId)}
          publishedFilterAvailable={cloudEnabled}
          registryUpdatesAvailable={cloudEnabled}
          teamAction={teamInstallMissingAction}
          onDiscoveryFilterChange={setDiscoveryFilter}
          onDiscoveryQueryChange={setDiscoveryQuery}
          onInstalledFilterChange={setInstalledFilter}
          onInstalledQueryChange={setQuery}
          onTeamFilterChange={setTeamFilter}
          onTeamQueryChange={setTeamQuery}
          onTabChange={setActiveTab}
        />
        {activeTab === "team" ? (
          <TeamSkillsPane
            busyAction={teamSkillBusyAction}
            groupById={installedSkillGroupById}
            teamFilter={teamFilter}
            teamQuery={deferredTeamQuery}
            teamSkills={teamSkills}
            providerRecommendationsLoading={connectedProvidersLoading || providerSkillRecommendationsState.isLoading}
            providerRecommendationsPendingCount={providerSkillRecommendationsState.pendingCount}
            providerRecommendations={providerSkillRecommendations}
            providerRecommendationsTotalCount={providerSkillRecommendationsState.totalCount}
            workspace={workspace}
            onAddRecommendation={addTeamSkillFromRecommendation}
            onInstallRuntimeSkill={installTeamRuntimeSkill}
            onOpenManagedSkill={openManagedPublicSkill}
          />
        ) : activeTab === "discover" ? (
          <DiscoverSkillsPane
            canInstall={cloudEnabled}
            error={activePackageCatalog.error}
            filter={discoveryFilter}
            groupById={installedSkillGroupById}
            installingKey={installingRegistryResultId}
            isLoading={isPublicPackageReplacing}
            isLoadingMore={isPublicPackageLoadingMore}
            isSignedIn={cloudEnabled}
            locale={locale}
            next={activePackageCatalog.next}
            packages={filteredPublicPackages}
            providerRecommendations={cloudEnabled ? installableProviderSkillRecommendations : []}
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
            onOpenTeamRecommendations={cloudEnabled ? () => setActiveTab("team") : undefined}
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
            cliUpdateError={cloudEnabled ? cliUpdateError : null}
            cliVersionCheck={cloudEnabled ? versionResource.data?.cli : undefined}
            groups={filteredInstalledGroups}
            isExecutingCliUpdate={isExecutingCliUpdate}
            updateRegistrySkill={updateRegistrySkill}
            updatingRegistrySkillId={updatingRegistrySkillId}
            versionCheckByKey={cloudEnabled ? versionCheckByKey : new Map()}
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
        managedTeams={managedTeamOptions}
        open={Boolean(publishDialogSkill)}
        skill={publishDialogSkill}
        onClose={() => {
          if (!publishingSkillId) {
            setPublishDialogSkill(null)
            setPlanError(null)
          }
        }}
        onLinkTeam={linkPublishedSkillToTeam}
        onPublish={publishSkill}
      />
      <TeamLinkDialog
        managedTeams={managedTeamOptions}
        open={Boolean(teamLinkTarget)}
        target={teamLinkTarget}
        onClose={() => setTeamLinkTarget(null)}
        onLinkTeam={linkPublishedSkillToTeam}
      />
    </>
  )
}
