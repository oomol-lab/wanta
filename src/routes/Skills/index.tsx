import type { ConnectionProvider } from "../../../electron/connections/common.ts"
import type { ManagedSkillGroup, PublicSkillPackage, SkillVersionReport } from "../../../electron/skills/common.ts"
import type { BusyAction, OrganizationSkillLinkInput } from "./organization-management-model.ts"
import type { ProviderSkillRecommendation } from "./provider-skill-recommendations.ts"
import type {
  DiscoverSkillFilter,
  InstalledSkillFilter,
  ManagedSkillGroupById,
  SkillDocumentViewMode,
  SkillPageTab,
  SkillSelectionKey,
  SkillVersionCheckByKey,
} from "./skill-route-model.ts"
import type { OrganizationSkillFilter } from "./SkillPageHeader.tsx"
import type { ObjectStatusTone } from "@/components/ObjectRow"
import type { UseOrganizationSkills } from "@/hooks/useOrganizationSkills"
import type { UseOrganizationWorkspace } from "@/hooks/useOrganizationWorkspace"
import type { TranslateFn as TFunction } from "@/i18n"

import * as React from "react"
import { toast } from "sonner"
import { DiscoverSkillsPane } from "./DiscoverSkillsPane.tsx"
import { InstalledSkillsPane } from "./InstalledSkillsPane.tsx"
import { planOrganizationSkillBulkLinks } from "./organization-management-model.ts"
import { useProviderSkillPackageLookup } from "./provider-skill-package-lookup.ts"
import {
  buildProviderSkillRecommendations,
  getInstallableProviderSkillRecommendations,
} from "./provider-skill-recommendations.ts"
import {
  getGroupRowPackageLine,
  getGroupStatus,
  getLocalSkillPublishPath,
  getOrganizationSkillRuntimeStatus,
  getPublicPackagePrimarySkill,
  getPublicSkillInstallStateLabel,
  getRuntimeHosts,
  getSkillDocumentRootPath,
  getSkillKindLabel,
  getSkillRowStatusBadgeClassName,
  getSkillVersionCheck,
  getSkillVersionCheckKey,
  getStatusBadgeClassName,
  hasSkillUpdateAvailable,
  initialPublicPackageCatalogState,
  isInstalledSkillGroup,
  isPublishableLocalSkill,
  matchesInstalledSkillFilter,
  matchesPublicPackageQuery,
  publicPackageCatalogReducer,
  shouldShowStatusBadge,
  shouldUpdatePublishedSkill,
  skillDocumentPreviewSource,
} from "./skill-route-model.ts"
import { SkillErrorNotice } from "./SkillErrorNotice.tsx"
import { SkillPageHeader } from "./SkillPageHeader.tsx"
import { SkillIconFrame, SkillManagementSheet } from "./SkillUiParts.tsx"
import { MessageResponse } from "@/components/ai-elements/message"
import { useSkillService } from "@/components/AppContext"
import {
  useAuthStateResource,
  useHomeSummaryResource,
  useSkillInventoryResource,
  useSkillVersionReportResource,
} from "@/components/AppDataHooks"
import { AppIcons } from "@/components/AppIcons"
import { DeleteSkillConfirmDialog } from "@/components/DeleteSkillConfirmDialog"
import { ErrorNotice } from "@/components/ErrorNotice"
import { InspectorCard, InspectorInsetCard } from "@/components/InspectorPanel"
import { ObjectRowSkeletonGroup, SkeletonText } from "@/components/LoadingSkeletons"
import { ObjectStatusIcon } from "@/components/ObjectRow"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useSkillObjectActions } from "@/components/useSkillObjectActions"
import { useAppI18n } from "@/i18n"
import { listMyPublishedSkillPackages, listPublicSkillPackages } from "@/lib/skills-catalog-client"
import { resolveUserFacingError, userFacingErrorDescription } from "@/lib/user-facing-error"
import { cn } from "@/lib/utils"

function skillErrorMessage(cause: unknown, t: TFunction): string {
  return userFacingErrorDescription(resolveUserFacingError(cause, { area: "skills" }), t)
}

type SkillOperationError = {
  message: string
  operation: "publish" | "update"
  skillId: SkillSelectionKey
}

function visibleSkillOperationError(
  error: SkillOperationError | null,
  skillId: SkillSelectionKey | undefined,
): string | null {
  if (!error) {
    return null
  }
  if (error.skillId === skillId) {
    return error.message
  }
  return null
}

const publishableSkillBadgeClassName = "oo-badge-info oo-text-micro h-5 shrink-0 px-1.5 font-medium"

const skillUpdateBadgeBaseClassName =
  "oo-text-micro h-5 shrink-0 border-[var(--oo-warning-border)] bg-[var(--oo-warning-surface)] px-1.5 font-medium text-[var(--oo-warning-foreground)]"
const skillUpdateBadgeClassName = skillUpdateBadgeBaseClassName
const skillUpdateActionBadgeClassName = cn(
  "oo-text-caption-compact h-7 shrink-0 border-[var(--oo-warning-border)] bg-[var(--oo-warning-surface)] px-2 font-medium text-[var(--oo-warning-foreground)]",
  "border shadow-none hover:bg-[var(--oo-warning-surface)] hover:text-[var(--oo-warning-foreground)]",
)

function SkillUpdateBadge({ label }: { label: string }) {
  return (
    <Badge className={skillUpdateBadgeClassName} variant="outline">
      {label}
    </Badge>
  )
}

function SkillUpdateActionBadge({
  ariaLabel,
  disabled = false,
  isUpdating,
  label,
  onClick,
  updatingLabel,
}: {
  ariaLabel: string
  disabled?: boolean
  isUpdating: boolean
  label: string
  onClick: () => void
  updatingLabel: string
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={cn("gap-1", skillUpdateActionBadgeClassName)}
      disabled={disabled || isUpdating}
      aria-label={ariaLabel}
      onClick={onClick}
    >
      {isUpdating ? <AppIcons.status.loading className="size-3 animate-spin" /> : null}
      {isUpdating ? updatingLabel : label}
    </Button>
  )
}

function useDesktopDetailHeadingFocus<T extends HTMLElement>(dependency: string): React.RefObject<T | null> {
  const headingRef = React.useRef<T | null>(null)

  React.useEffect(() => {
    const mediaQuery = window.matchMedia("(min-width: 960px)")
    if (!mediaQuery.matches) {
      return
    }

    const frame = window.requestAnimationFrame(() => {
      const activeElement = document.activeElement
      if (
        activeElement instanceof HTMLElement &&
        (activeElement.matches("input, textarea, select") || activeElement.isContentEditable)
      ) {
        return
      }

      headingRef.current?.focus({ preventScroll: true })
    })

    return () => window.cancelAnimationFrame(frame)
  }, [dependency])

  return headingRef
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
  const { isRemovingSkill, openSkillFolder, removeSkill, removeTarget, setRemoveTarget } = useSkillObjectActions({
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
          message: cause instanceof Error ? cause.message : String(cause),
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
        const message = skillErrorMessage(cause, t)
        setPlanError({ message, operation: "publish", skillId: skill.id })
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

interface OrganizationSkillsPaneProps {
  busyAction: BusyAction | null
  groupById: ManagedSkillGroupById
  onAddRecommendation: (
    recommendation: ProviderSkillRecommendation,
    options: { installRuntime: boolean },
  ) => Promise<void>
  onInstallRuntimeSkill: (skill: { packageName: string; skillName: string }) => void
  onInstallRuntimeSkills: (skills: readonly { packageName: string; skillName: string }[]) => void
  onOpenManagedSkill: (skillName: string) => void
  organizationFilter: OrganizationSkillFilter
  organizationQuery: string
  organizationSkills: UseOrganizationSkills
  providerRecommendations: ProviderSkillRecommendation[]
  workspace: UseOrganizationWorkspace
}

function OrganizationSkillsPane({
  busyAction,
  groupById,
  onAddRecommendation,
  onInstallRuntimeSkill,
  onInstallRuntimeSkills,
  onOpenManagedSkill,
  organizationFilter,
  organizationQuery,
  organizationSkills,
  providerRecommendations,
  workspace,
}: OrganizationSkillsPaneProps) {
  const { t } = useAppI18n()
  const canManage = workspace.activeWorkspace.type === "organization" && workspace.activeWorkspace.canManage
  const [busyConfigId, setBusyConfigId] = React.useState<string | null>(null)
  const [selectedItemId, setSelectedItemId] = React.useState<string | null>(null)

  if (workspace.activeWorkspace.type !== "organization") {
    return (
      <div className="min-h-0 overflow-auto px-3 py-3">
        <div className="oo-text-body oo-text-muted px-1 py-3">{t("skills.organizationPersonalEmpty")}</div>
      </div>
    )
  }

  const activeOrganizationId = workspace.activeWorkspace.organizationId
  const selectedOrganizationSkills =
    organizationSkills.organizationId === activeOrganizationId ? organizationSkills : null

  const normalizedQuery = organizationQuery.trim().toLowerCase()
  const recommendedPlan = selectedOrganizationSkills
    ? planOrganizationSkillBulkLinks(providerRecommendations, selectedOrganizationSkills.skills)
    : null
  const recommendedOrganizationSkills = recommendedPlan?.linkable ?? []
  const filteredOrganizationItems = selectedOrganizationSkills
    ? buildOrganizationRecommendationItems({
        filter: organizationFilter,
        normalizedQuery,
        recommendedSkills: recommendedOrganizationSkills,
        skills: selectedOrganizationSkills.skills,
      })
    : []
  const installableConfiguredSkills = selectedOrganizationSkills
    ? selectedOrganizationSkills.skills.filter((skill) => {
        const state = getOrganizationSkillRuntimeStatus(groupById, skill).state
        return skill.enabled && (state === "missing" || state === "external-only")
      })
    : []
  const selectedOrganizationItem = selectedItemId
    ? filteredOrganizationItems.find((item) => item.id === selectedItemId)
    : undefined

  const updateOrganizationSkill = async (
    skill: UseOrganizationSkills["skills"][number],
    input: { enabled: boolean },
  ): Promise<void> => {
    if (!selectedOrganizationSkills?.canManage || busyConfigId) {
      return
    }
    setBusyConfigId(skill.id)
    try {
      await selectedOrganizationSkills.updateSkill(skill.id, input)
      toast.success(input.enabled ? t("skills.organizationSkillEnabled") : t("skills.organizationSkillDisabled"))
    } catch (cause) {
      toast.error(skillErrorMessage(cause, t))
    } finally {
      setBusyConfigId(null)
    }
  }

  const removeOrganizationSkill = async (skill: UseOrganizationSkills["skills"][number]): Promise<void> => {
    if (!selectedOrganizationSkills?.canManage || busyConfigId) {
      return
    }
    const confirmed = window.confirm(t("skills.organizationRemoveConfirm", { name: skill.displayName }))
    if (!confirmed) {
      return
    }
    setBusyConfigId(skill.id)
    try {
      await selectedOrganizationSkills.removeSkill(skill.id)
      toast.success(t("skills.organizationSkillRemoved"))
      setSelectedItemId(null)
    } catch (cause) {
      toast.error(skillErrorMessage(cause, t))
    } finally {
      setBusyConfigId(null)
    }
  }

  return (
    <div className="min-h-0 overflow-auto px-3 py-3">
      {selectedOrganizationSkills ? (
        <div className="grid gap-3 pr-1">
          {selectedOrganizationSkills.error ? (
            <div className="flex min-w-0 items-start gap-2">
              <ErrorNotice
                error={resolveUserFacingError(selectedOrganizationSkills.error, { area: "skills" })}
                compact
                className="min-w-0 flex-1"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={selectedOrganizationSkills.loading}
                onClick={() => void selectedOrganizationSkills.refresh({ forceRefresh: true })}
              >
                {selectedOrganizationSkills.loading ? (
                  <AppIcons.status.loading className="animate-spin" />
                ) : (
                  <AppIcons.action.refresh />
                )}
                {t("organizations.retry")}
              </Button>
            </div>
          ) : null}
          {installableConfiguredSkills.length > 1 ? (
            <div className="flex justify-end">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={Boolean(busyAction)}
                onClick={() => onInstallRuntimeSkills(installableConfiguredSkills)}
              >
                {busyAction === "installSkillBatch" ? (
                  <AppIcons.status.loading className="animate-spin" />
                ) : (
                  <AppIcons.action.installPackage />
                )}
                {t("organizations.skillManageInstallMissingAll", { count: installableConfiguredSkills.length })}
              </Button>
            </div>
          ) : null}
          {selectedOrganizationSkills.loading && !selectedOrganizationSkills.hasLoaded ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(15.5rem,1fr))] gap-2.5">
              {Array.from({ length: 6 }).map((_, index) => (
                <Skeleton key={index} className="h-44 rounded-md" />
              ))}
            </div>
          ) : filteredOrganizationItems.length === 0 ? (
            <OrganizationRecommendationEmptyState
              description={
                normalizedQuery
                  ? t("skills.organizationSearchEmptyDescription")
                  : organizationFilter === "recommended"
                    ? t("organizations.skillManageRecommendedEmpty")
                    : t("skills.organizationEmptyDescription")
              }
              title={
                normalizedQuery
                  ? t("skills.organizationSearchEmpty")
                  : organizationFilter === "recommended"
                    ? t("organizations.skillManageRecommended")
                    : t("skills.organizationEmpty")
              }
            />
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(15.5rem,1fr))] gap-2.5">
              {filteredOrganizationItems.map((item) =>
                item.type === "configured" ? (
                  <OrganizationConfiguredSkillCard
                    key={item.id}
                    busy={busyConfigId === item.skill.id || busyAction === "installSkillBatch"}
                    groupById={groupById}
                    installBusy={
                      busyAction === `installSkill:${item.skill.packageName}:${item.skill.skillName}` ||
                      busyAction === "installSkillBatch"
                    }
                    selected={selectedItemId === item.id}
                    skill={item.skill}
                    onInstallRuntime={() =>
                      onInstallRuntimeSkill({ packageName: item.skill.packageName, skillName: item.skill.skillName })
                    }
                    onOpenManagedSkill={() => onOpenManagedSkill(item.skill.skillName)}
                    onSelect={() => setSelectedItemId(item.id)}
                  />
                ) : (
                  <OrganizationRecommendedSkillCard
                    key={item.id}
                    busyAction={busyAction}
                    recommendation={item.recommendation}
                    selected={selectedItemId === item.id}
                    onInstallRuntime={() =>
                      onInstallRuntimeSkill({
                        packageName: item.recommendation.packageName,
                        skillName: item.recommendation.skillId,
                      })
                    }
                    onOpenManagedSkill={() => onOpenManagedSkill(item.recommendation.skillId)}
                    onSelect={() => setSelectedItemId(item.id)}
                  />
                ),
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(15.5rem,1fr))] gap-2.5">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-44 rounded-md" />
          ))}
        </div>
      )}
      {selectedOrganizationItem ? (
        <SkillManagementSheet
          title={
            selectedOrganizationItem.type === "configured"
              ? selectedOrganizationItem.skill.displayName
              : selectedOrganizationItem.recommendation.package.displayName
          }
          onClose={() => setSelectedItemId(null)}
        >
          <OrganizationSkillDetail
            busyAction={busyAction}
            busyConfigId={busyConfigId}
            canManage={canManage}
            groupById={groupById}
            item={selectedOrganizationItem}
            onAddRecommendation={(recommendation) => onAddRecommendation(recommendation, { installRuntime: false })}
            onDisableConfiguredSkill={(skill) => void updateOrganizationSkill(skill, { enabled: false })}
            onEnableConfiguredSkill={(skill) => void updateOrganizationSkill(skill, { enabled: true })}
            onInstallRuntimeSkill={onInstallRuntimeSkill}
            onOpenManagedSkill={onOpenManagedSkill}
            onRemoveConfiguredSkill={(skill) => void removeOrganizationSkill(skill)}
          />
        </SkillManagementSheet>
      ) : null}
    </div>
  )
}

type OrganizationRecommendationItem =
  | {
      id: string
      skill: UseOrganizationSkills["skills"][number]
      type: "configured"
    }
  | {
      id: string
      recommendation: ProviderSkillRecommendation
      type: "recommended"
    }

function buildOrganizationRecommendationItems({
  filter,
  normalizedQuery,
  recommendedSkills,
  skills,
}: {
  filter: OrganizationSkillFilter
  normalizedQuery: string
  recommendedSkills: ProviderSkillRecommendation[]
  skills: UseOrganizationSkills["skills"]
}): OrganizationRecommendationItem[] {
  const configuredItems: OrganizationRecommendationItem[] =
    filter === "recommended"
      ? []
      : skills
          .filter((skill) => organizationSkillMatchesSearchQuery(skill, normalizedQuery))
          .map((skill) => ({ id: `configured:${skill.id}`, skill, type: "configured" }))

  const recommendedItems: OrganizationRecommendationItem[] =
    filter === "configured"
      ? []
      : recommendedSkills
          .filter((recommendation) => providerRecommendationMatchesSearchQuery(recommendation, normalizedQuery))
          .map((recommendation) => ({
            id: `recommended:${recommendation.service}:${recommendation.packageName}:${recommendation.skillId}`,
            recommendation,
            type: "recommended",
          }))

  return [...recommendedItems, ...configuredItems]
}

function organizationSkillMatchesSearchQuery(
  skill: UseOrganizationSkills["skills"][number],
  normalizedQuery: string,
): boolean {
  if (!normalizedQuery) {
    return true
  }
  return [skill.displayName, skill.skillName, skill.packageName, skill.description ?? "", skill.version]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(normalizedQuery))
}

function providerRecommendationMatchesSearchQuery(
  recommendation: ProviderSkillRecommendation,
  normalizedQuery: string,
): boolean {
  if (!normalizedQuery) {
    return true
  }
  const skillDescription =
    recommendation.package.skills.find((skill) => skill.name === recommendation.skillId)?.description ?? ""
  return [
    recommendation.providerDisplayName,
    recommendation.package.displayName,
    recommendation.packageName,
    recommendation.skillId,
    recommendation.package.description ?? "",
    skillDescription,
  ].some((value) => value.toLowerCase().includes(normalizedQuery))
}

function OrganizationRecommendationEmptyState({ description, title }: { description: string; title: string }) {
  return (
    <div className="grid min-h-[22rem] place-items-center px-4 py-10 text-center">
      <div className="grid max-w-sm justify-items-center gap-2">
        <div className="grid size-12 place-items-center rounded-md border bg-muted/30 text-muted-foreground">
          <AppIcons.object.skill className="size-6" />
        </div>
        <div className="oo-text-label text-foreground">{title}</div>
        <p className="oo-text-caption text-muted-foreground">{description}</p>
      </div>
    </div>
  )
}

function organizationRuntimeStatusLabel(
  state: ReturnType<typeof getOrganizationSkillRuntimeStatus>["state"],
  t: ReturnType<typeof useAppI18n>["t"],
): string {
  switch (state) {
    case "installed-same":
      return t("skills.organizationRuntimeInstalled")
    case "installed-modified":
      return t("skills.organizationRuntimeModified")
    case "installed-version-mismatch":
      return t("skills.organizationRuntimeVersionMismatch")
    case "same-id-different-package":
      return t("skills.organizationRuntimePackageConflict")
    case "local-conflict":
    case "unknown-conflict":
      return t("skills.organizationRuntimeLocalConflict")
    case "external-only":
    case "missing":
      return t("skills.organizationRuntimeMissing")
  }
}

function organizationRuntimeStatusTone(
  state: ReturnType<typeof getOrganizationSkillRuntimeStatus>["state"],
): "attention" | "pending" | "ready" {
  return state === "installed-same"
    ? "ready"
    : state === "missing" || state === "external-only"
      ? "pending"
      : "attention"
}

function shouldShowOrganizationRuntimeStatusOnCard(
  state: ReturnType<typeof getOrganizationSkillRuntimeStatus>["state"],
): boolean {
  return state !== "installed-same" && state !== "missing" && state !== "external-only"
}

function canOpenManagedOrganizationSkill(
  state: ReturnType<typeof getOrganizationSkillRuntimeStatus>["state"],
): boolean {
  return (
    state === "installed-same" ||
    state === "installed-modified" ||
    state === "installed-version-mismatch" ||
    state === "local-conflict" ||
    state === "same-id-different-package" ||
    state === "unknown-conflict"
  )
}

function OrganizationConfiguredSkillCard({
  busy,
  groupById,
  installBusy,
  onInstallRuntime,
  onOpenManagedSkill,
  onSelect,
  selected,
  skill,
}: {
  busy: boolean
  groupById: ManagedSkillGroupById
  installBusy: boolean
  onInstallRuntime: () => void
  onOpenManagedSkill: () => void
  onSelect: () => void
  selected: boolean
  skill: UseOrganizationSkills["skills"][number]
}) {
  const { t } = useAppI18n()
  const runtimeStatus = getOrganizationSkillRuntimeStatus(groupById, skill)
  const runtimeTone = organizationRuntimeStatusTone(runtimeStatus.state)
  const runtimeInstallable =
    skill.enabled && (runtimeStatus.state === "missing" || runtimeStatus.state === "external-only")
  const managedSkillOpenable = canOpenManagedOrganizationSkill(runtimeStatus.state)

  return (
    <div
      className={cn(
        "grid min-h-44 grid-rows-[minmax(0,1fr)_auto] overflow-hidden rounded-md border bg-card text-card-foreground transition-colors hover:bg-[var(--oo-row-hover)]",
        selected && "border-[var(--accent-ring)] bg-[var(--oo-row-selected)] hover:bg-[var(--oo-row-selected)]",
      )}
    >
      <button
        type="button"
        className="grid min-w-0 gap-2 p-3 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
        onClick={onSelect}
      >
        <div className="flex min-w-0 items-start gap-3">
          <SkillIconFrame icon={skill.icon} />
          <div className="grid min-w-0 gap-1">
            <div className="oo-text-label min-w-0 truncate">{skill.displayName}</div>
            <div className="oo-text-caption oo-text-muted min-w-0 truncate" title={skill.packageName}>
              {skill.packageName}
            </div>
          </div>
        </div>
        {skill.description ? (
          <p className="oo-text-caption line-clamp-2 text-foreground/75">{skill.description}</p>
        ) : null}
        <div className="oo-text-caption oo-text-muted min-w-0 truncate" title={`${skill.skillName} · ${skill.version}`}>
          {skill.skillName} · {skill.version}
        </div>
      </button>
      <div className="oo-border-divider flex items-center justify-between gap-2 border-t px-3 py-2">
        <div className="min-w-0">
          <Badge variant="secondary">{t("organizations.skillManageConfigured")}</Badge>
        </div>
        <div className="flex min-w-0 shrink-0 items-center justify-end gap-1">
          {!skill.enabled ? (
            <Badge variant="outline">{t("skills.organizationDisabled")}</Badge>
          ) : shouldShowOrganizationRuntimeStatusOnCard(runtimeStatus.state) ? (
            <Badge className={cn("shrink-0", getSkillRowStatusBadgeClassName(runtimeTone))} variant="outline">
              {organizationRuntimeStatusLabel(runtimeStatus.state, t)}
            </Badge>
          ) : null}
          {runtimeInstallable ? (
            <Button type="button" variant="ghost" size="sm" disabled={installBusy} onClick={onInstallRuntime}>
              {installBusy ? <AppIcons.status.loading className="animate-spin" /> : <AppIcons.action.installPackage />}
              {t("organizations.skillManageInstallRuntime")}
            </Button>
          ) : null}
          {managedSkillOpenable ? (
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onOpenManagedSkill}>
              {t("skills.installedManage")}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function OrganizationRecommendedSkillCard({
  busyAction,
  onInstallRuntime,
  onOpenManagedSkill,
  onSelect,
  recommendation,
  selected,
}: {
  busyAction: BusyAction | null
  onInstallRuntime: () => void
  onOpenManagedSkill: () => void
  onSelect: () => void
  recommendation: ProviderSkillRecommendation
  selected: boolean
}) {
  const { t } = useAppI18n()
  const canInstallRuntime =
    recommendation.installState === "installable" || recommendation.installState === "partially-installed"
  const addBusyKey = `addSkill:${recommendation.packageName}:${recommendation.skillId}`
  const installBusyKey = `installSkill:${recommendation.packageName}:${recommendation.skillId}`
  const installBusy = busyAction === installBusyKey || busyAction === "installSkillBatch"
  const disabled = Boolean(busyAction && busyAction !== addBusyKey && !installBusy)
  const skillDescription =
    recommendation.package.skills.find((skill) => skill.name === recommendation.skillId)?.description ??
    recommendation.package.description
  const canOpenManage = recommendation.installState === "installed" || recommendation.installState === "name-conflict"

  return (
    <div
      className={cn(
        "grid min-h-44 grid-rows-[minmax(0,1fr)_auto] overflow-hidden rounded-md border bg-card text-card-foreground transition-colors hover:bg-[var(--oo-row-hover)]",
        selected && "border-[var(--accent-ring)] bg-[var(--oo-row-selected)] hover:bg-[var(--oo-row-selected)]",
      )}
    >
      <button
        type="button"
        className="grid min-w-0 gap-2 p-3 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
        onClick={onSelect}
      >
        <div className="flex min-w-0 items-start gap-3">
          <SkillIconFrame icon={recommendation.package.icon} />
          <div className="grid min-w-0 gap-1">
            <div className="oo-text-label min-w-0 truncate">{recommendation.package.displayName}</div>
            <div className="oo-text-caption oo-text-muted min-w-0 truncate" title={recommendation.packageName}>
              {recommendation.providerDisplayName}
            </div>
          </div>
        </div>
        {skillDescription ? (
          <p className="oo-text-caption line-clamp-2 text-foreground/75">{skillDescription}</p>
        ) : null}
        <div
          className="oo-text-caption oo-text-muted min-w-0 truncate"
          title={`${recommendation.packageName} · ${recommendation.skillId}`}
        >
          {recommendation.packageName} · {recommendation.skillId}
        </div>
      </button>
      <div className="oo-border-divider flex items-center justify-between gap-2 border-t px-3 py-2">
        <div className="min-w-0">
          <Badge variant="secondary">{t("organizations.skillManageRecommended")}</Badge>
        </div>
        <div className="flex min-w-0 shrink-0 items-center justify-end gap-1">
          {recommendation.installState === "name-conflict" || recommendation.installState === "unavailable" ? (
            <Badge variant="outline">{getPublicSkillInstallStateLabel(recommendation.installState, t)}</Badge>
          ) : null}
          {canInstallRuntime ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled || installBusy}
              onClick={onInstallRuntime}
            >
              {installBusy ? <AppIcons.status.loading className="animate-spin" /> : <AppIcons.action.installPackage />}
              {t("organizations.skillManageInstallRuntime")}
            </Button>
          ) : null}
          {canOpenManage ? (
            <Button type="button" variant="ghost" size="sm" onClick={onOpenManagedSkill}>
              {t("skills.installedManage")}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function OrganizationSkillDetail({
  busyAction,
  busyConfigId,
  canManage,
  groupById,
  item,
  onAddRecommendation,
  onDisableConfiguredSkill,
  onEnableConfiguredSkill,
  onInstallRuntimeSkill,
  onOpenManagedSkill,
  onRemoveConfiguredSkill,
}: {
  busyAction: BusyAction | null
  busyConfigId: string | null
  canManage: boolean
  groupById: ManagedSkillGroupById
  item: OrganizationRecommendationItem
  onAddRecommendation: (recommendation: ProviderSkillRecommendation) => Promise<void>
  onDisableConfiguredSkill: (skill: UseOrganizationSkills["skills"][number]) => void
  onEnableConfiguredSkill: (skill: UseOrganizationSkills["skills"][number]) => void
  onInstallRuntimeSkill: (skill: { packageName: string; skillName: string }) => void
  onOpenManagedSkill: (skillName: string) => void
  onRemoveConfiguredSkill: (skill: UseOrganizationSkills["skills"][number]) => void
}) {
  return item.type === "configured" ? (
    <OrganizationConfiguredSkillDetail
      busyAction={busyAction}
      busyConfigId={busyConfigId}
      canManage={canManage}
      groupById={groupById}
      skill={item.skill}
      onDisableConfiguredSkill={onDisableConfiguredSkill}
      onEnableConfiguredSkill={onEnableConfiguredSkill}
      onInstallRuntimeSkill={onInstallRuntimeSkill}
      onOpenManagedSkill={onOpenManagedSkill}
      onRemoveConfiguredSkill={onRemoveConfiguredSkill}
    />
  ) : (
    <OrganizationRecommendedSkillDetail
      busyAction={busyAction}
      canManage={canManage}
      recommendation={item.recommendation}
      onAddRecommendation={onAddRecommendation}
      onInstallRuntimeSkill={onInstallRuntimeSkill}
      onOpenManagedSkill={onOpenManagedSkill}
    />
  )
}

function OrganizationConfiguredSkillDetail({
  busyAction,
  busyConfigId,
  canManage,
  groupById,
  onDisableConfiguredSkill,
  onEnableConfiguredSkill,
  onInstallRuntimeSkill,
  onOpenManagedSkill,
  onRemoveConfiguredSkill,
  skill,
}: {
  busyAction: BusyAction | null
  busyConfigId: string | null
  canManage: boolean
  groupById: ManagedSkillGroupById
  onDisableConfiguredSkill: (skill: UseOrganizationSkills["skills"][number]) => void
  onEnableConfiguredSkill: (skill: UseOrganizationSkills["skills"][number]) => void
  onInstallRuntimeSkill: (skill: { packageName: string; skillName: string }) => void
  onOpenManagedSkill: (skillName: string) => void
  onRemoveConfiguredSkill: (skill: UseOrganizationSkills["skills"][number]) => void
  skill: UseOrganizationSkills["skills"][number]
}) {
  const { t } = useAppI18n()
  const runtimeStatus = getOrganizationSkillRuntimeStatus(groupById, skill)
  const runtimeTone = organizationRuntimeStatusTone(runtimeStatus.state)
  const installBusy =
    busyAction === `installSkill:${skill.packageName}:${skill.skillName}` || busyAction === "installSkillBatch"
  const configBusy = busyConfigId === skill.id
  const runtimeInstallable =
    skill.enabled && (runtimeStatus.state === "missing" || runtimeStatus.state === "external-only")
  const managedSkillOpenable = canOpenManagedOrganizationSkill(runtimeStatus.state)

  return (
    <div className="grid min-w-0 content-start gap-3">
      <InspectorCard>
        <CardHeader className="flex-row items-start gap-3 px-3 py-0">
          <SkillIconFrame icon={skill.icon} />
          <div className="grid min-w-0 flex-1 gap-1">
            <CardTitle className="oo-text-label min-w-0 truncate">{skill.displayName}</CardTitle>
            <CardDescription className="min-w-0 truncate">{skill.packageName}</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="grid gap-2 px-3">
          <div className="flex min-w-0 flex-wrap items-center gap-1">
            <Badge variant="secondary">{t("organizations.skillManageConfigured")}</Badge>
            {skill.enabled ? null : <Badge variant="outline">{t("skills.organizationDisabled")}</Badge>}
            {skill.enabled && shouldShowOrganizationRuntimeStatusOnCard(runtimeStatus.state) ? (
              <Badge className={cn("shrink-0", getSkillRowStatusBadgeClassName(runtimeTone))} variant="outline">
                {organizationRuntimeStatusLabel(runtimeStatus.state, t)}
              </Badge>
            ) : null}
            {skill.version ? <Badge variant="outline">{skill.version}</Badge> : null}
          </div>
          {skill.description ? (
            <CardDescription className="min-w-0 break-words text-foreground/80">{skill.description}</CardDescription>
          ) : null}
          <div className="flex min-w-0 flex-wrap gap-1">
            {runtimeInstallable ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={installBusy}
                onClick={() => onInstallRuntimeSkill({ packageName: skill.packageName, skillName: skill.skillName })}
              >
                {installBusy ? (
                  <AppIcons.status.loading className="animate-spin" />
                ) : (
                  <AppIcons.action.installPackage />
                )}
                {t("organizations.skillManageInstallRuntime")}
              </Button>
            ) : null}
            {managedSkillOpenable ? (
              <Button type="button" variant="outline" size="sm" onClick={() => onOpenManagedSkill(skill.skillName)}>
                {t("skills.installedManage")}
              </Button>
            ) : null}
            {canManage ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={configBusy}
                onClick={() => (skill.enabled ? onDisableConfiguredSkill(skill) : onEnableConfiguredSkill(skill))}
              >
                {configBusy ? <AppIcons.status.loading className="animate-spin" /> : null}
                {skill.enabled ? t("skills.organizationDisable") : t("skills.organizationEnable")}
              </Button>
            ) : null}
            {canManage ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="border-[var(--oo-danger-border)] text-destructive hover:bg-[var(--oo-danger-surface)] hover:text-destructive"
                disabled={configBusy}
                onClick={() => onRemoveConfiguredSkill(skill)}
              >
                {configBusy ? <AppIcons.status.loading className="animate-spin" /> : <AppIcons.action.delete />}
                {t("skills.organizationRemove")}
              </Button>
            ) : null}
          </div>
        </CardContent>
      </InspectorCard>

      <OrganizationSkillMetaCard packageName={skill.packageName} skillName={skill.skillName} version={skill.version} />
    </div>
  )
}

function OrganizationRecommendedSkillDetail({
  busyAction,
  canManage,
  onAddRecommendation,
  onInstallRuntimeSkill,
  onOpenManagedSkill,
  recommendation,
}: {
  busyAction: BusyAction | null
  canManage: boolean
  onAddRecommendation: (recommendation: ProviderSkillRecommendation) => Promise<void>
  onInstallRuntimeSkill: (skill: { packageName: string; skillName: string }) => void
  onOpenManagedSkill: (skillName: string) => void
  recommendation: ProviderSkillRecommendation
}) {
  const { t } = useAppI18n()
  const canInstallRuntime =
    recommendation.installState === "installable" || recommendation.installState === "partially-installed"
  const installBusy =
    busyAction === `installSkill:${recommendation.packageName}:${recommendation.skillId}` ||
    busyAction === "installSkillBatch"
  const addBusy =
    busyAction === `addSkill:${recommendation.packageName}:${recommendation.skillId}` || busyAction === "addSkillBatch"
  const managedSkillOpenable =
    recommendation.installState === "installed" || recommendation.installState === "name-conflict"
  const disabled = Boolean(busyAction && !installBusy && !addBusy)
  const skillDescription =
    recommendation.package.skills.find((skill) => skill.name === recommendation.skillId)?.description ??
    recommendation.package.description

  return (
    <div className="grid min-w-0 content-start gap-3">
      <InspectorCard>
        <CardHeader className="flex-row items-start gap-3 px-3 py-0">
          <SkillIconFrame icon={recommendation.package.icon} />
          <div className="grid min-w-0 flex-1 gap-1">
            <CardTitle className="oo-text-label min-w-0 truncate">{recommendation.package.displayName}</CardTitle>
            <CardDescription className="min-w-0 truncate">{recommendation.packageName}</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="grid gap-2 px-3">
          <div className="flex min-w-0 flex-wrap items-center gap-1">
            <Badge variant="secondary">{t("organizations.skillManageRecommended")}</Badge>
            {recommendation.installState === "name-conflict" || recommendation.installState === "unavailable" ? (
              <Badge variant="outline">{getPublicSkillInstallStateLabel(recommendation.installState, t)}</Badge>
            ) : null}
            <Badge variant="outline">{recommendation.package.version}</Badge>
          </div>
          {skillDescription ? (
            <CardDescription className="min-w-0 break-words text-foreground/80">{skillDescription}</CardDescription>
          ) : null}
          <div className="flex min-w-0 flex-wrap gap-1">
            {canInstallRuntime ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled || installBusy}
                onClick={() =>
                  onInstallRuntimeSkill({
                    packageName: recommendation.packageName,
                    skillName: recommendation.skillId,
                  })
                }
              >
                {installBusy ? (
                  <AppIcons.status.loading className="animate-spin" />
                ) : (
                  <AppIcons.action.installPackage />
                )}
                {t("organizations.skillManageInstallRuntime")}
              </Button>
            ) : null}
            {managedSkillOpenable ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onOpenManagedSkill(recommendation.skillId)}
              >
                {t("skills.installedManage")}
              </Button>
            ) : null}
            {canManage ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled || addBusy}
                onClick={() => void onAddRecommendation(recommendation)}
              >
                {addBusy ? <AppIcons.status.loading className="animate-spin" /> : null}
                {t("organizations.skillManageAddOnly")}
              </Button>
            ) : null}
          </div>
        </CardContent>
      </InspectorCard>

      <OrganizationSkillMetaCard
        packageName={recommendation.packageName}
        providerDisplayName={recommendation.providerDisplayName}
        skillName={recommendation.skillId}
        version={recommendation.package.version}
      />
    </div>
  )
}

function OrganizationSkillMetaCard({
  packageName,
  providerDisplayName,
  skillName,
  version,
}: {
  packageName: string
  providerDisplayName?: string
  skillName: string
  version?: string
}) {
  const { t } = useAppI18n()

  return (
    <InspectorInsetCard className="gap-2 px-3 py-2">
      <div className="oo-text-caption-compact font-medium">{t("skills.discoverPackageInfo")}</div>
      <div className="oo-text-caption-compact grid gap-1">
        {providerDisplayName ? (
          <div className="flex min-w-0 justify-between gap-3">
            <span className="oo-text-muted">{t("organizations.provider")}</span>
            <span className="min-w-0 truncate text-right">{providerDisplayName}</span>
          </div>
        ) : null}
        <div className="flex min-w-0 justify-between gap-3">
          <span className="oo-text-muted">{t("skills.package")}</span>
          <span className="min-w-0 truncate text-right">{packageName}</span>
        </div>
        <div className="flex min-w-0 justify-between gap-3">
          <span className="oo-text-muted">{t("skills.organizationSkillName")}</span>
          <span className="min-w-0 truncate text-right">{skillName}</span>
        </div>
        {version ? (
          <div className="flex min-w-0 justify-between gap-3">
            <span className="oo-text-muted">{t("skills.version")}</span>
            <span className="min-w-0 truncate text-right">{version}</span>
          </div>
        ) : null}
      </div>
    </InspectorInsetCard>
  )
}

function SkillDetailSkeleton() {
  return (
    <div className="grid min-w-0 gap-3 overflow-hidden">
      <section className="grid gap-2 rounded-md border px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <SkeletonText className="h-4 w-36" />
          <SkeletonText className="h-5 w-14 rounded-md" />
        </div>
        <div className="grid gap-1.5">
          <SkeletonText className="w-56 max-w-full" />
          <SkeletonText className="w-44 max-w-full" />
          <Skeleton className="mt-1 h-16 rounded-md" />
        </div>
      </section>

      <section className="grid gap-2 rounded-md border px-3 py-2.5">
        <SkeletonText className="h-4 w-24" />
        <ObjectRowSkeletonGroup count={2} rows={1} />
      </section>
    </div>
  )
}

interface SkillDetailContentProps {
  inventoryInitialLoading: boolean
  isRemovingSkill: boolean
  openSkillFolder: (pathname: string) => void
  publishSkill: (skill: ManagedSkillGroup) => Promise<void>
  publishingSkillId: string | null
  requestRemoveSkill: (skill: ManagedSkillGroup) => void
  selectedPlanError: string | null
  selectedSkill: ManagedSkillGroup | undefined
  selectedStatus: ReturnType<typeof getGroupStatus> | null
  selectedVersionCheck?: SkillVersionReport["skills"][number]
  updateRegistrySkill: (skill: Pick<ManagedSkillGroup, "id" | "kind" | "packageName">) => void
  updatingRegistrySkillId: string | null
}

function SkillDetailContent({
  inventoryInitialLoading,
  isRemovingSkill,
  openSkillFolder,
  publishSkill,
  publishingSkillId,
  requestRemoveSkill,
  selectedPlanError,
  selectedSkill,
  selectedStatus,
  selectedVersionCheck,
  updateRegistrySkill,
  updatingRegistrySkillId,
}: SkillDetailContentProps) {
  const { t } = useAppI18n()

  if (inventoryInitialLoading) {
    return <SkillDetailSkeleton />
  }

  if (selectedSkill && selectedStatus) {
    return (
      <SkillPeek
        openSkillFolder={openSkillFolder}
        planError={selectedPlanError}
        publishSkill={publishSkill}
        publishingSkillId={publishingSkillId}
        isRemovingSkill={isRemovingSkill}
        requestRemoveSkill={requestRemoveSkill}
        selectedSkill={selectedSkill}
        selectedStatus={selectedStatus}
        selectedVersionCheck={selectedVersionCheck}
        updateRegistrySkill={updateRegistrySkill}
        updatingRegistrySkillId={updatingRegistrySkillId}
      />
    )
  }

  return <div className="oo-text-body oo-text-muted p-4">{t("skills.detailPlaceholder")}</div>
}

interface SkillPeekProps {
  isRemovingSkill: boolean
  openSkillFolder: (pathname: string) => void
  planError: string | null
  publishSkill: (skill: ManagedSkillGroup) => Promise<void>
  publishingSkillId: string | null
  requestRemoveSkill: (skill: ManagedSkillGroup) => void
  selectedSkill: ManagedSkillGroup
  selectedStatus: ReturnType<typeof getGroupStatus>
  selectedVersionCheck?: SkillVersionReport["skills"][number]
  updateRegistrySkill: (skill: Pick<ManagedSkillGroup, "id" | "kind" | "packageName">) => void
  updatingRegistrySkillId: string | null
}

function SkillPeek({
  isRemovingSkill,
  openSkillFolder,
  planError,
  publishSkill,
  publishingSkillId,
  requestRemoveSkill,
  selectedSkill,
  selectedStatus,
  selectedVersionCheck,
  updateRegistrySkill,
  updatingRegistrySkillId,
}: SkillPeekProps) {
  const { t } = useAppI18n()
  const skillService = useSkillService()
  const runtimeHosts = getRuntimeHosts(selectedSkill)
  const skillDocumentRootPath = getSkillDocumentRootPath(selectedSkill)
  const hasPublishedUpdate = hasSkillUpdateAvailable(selectedVersionCheck)
  const canUpdatePublishedSkill = hasPublishedUpdate && shouldUpdatePublishedSkill(selectedSkill)
  const canRestoreRegistrySkill = selectedSkill.kind === "registry" && Boolean(selectedSkill.packageName?.trim())
  const isUpdatingRegistrySkill = updatingRegistrySkillId === selectedSkill.id
  const localPublishPath = getLocalSkillPublishPath(selectedSkill)
  const canPublishLocalSkill = Boolean(localPublishPath)
  const isPublishingSkill = publishingSkillId === selectedSkill.id
  const attentionHosts = runtimeHosts.filter(
    (host) => host.controlState === "modified" || host.controlState === "source-missing",
  )
  const hostAttentionCount = attentionHosts.length
  const canOpenLocalSkillFiles = Boolean(skillDocumentRootPath)
  const headingRef = useDesktopDetailHeadingFocus<HTMLHeadingElement>(selectedSkill.id)
  const [skillDocument, setSkillDocument] = React.useState<{ content: string; path: string } | null>(null)
  const [skillDocumentError, setSkillDocumentError] = React.useState<string | null>(null)
  const [isSkillDocumentLoading, setIsSkillDocumentLoading] = React.useState(false)
  const [skillDocumentViewMode, setSkillDocumentViewMode] = React.useState<SkillDocumentViewMode>("preview")
  const hasSourceMissingHost = attentionHosts.some((host) => host.controlState === "source-missing")
  const hostAttentionTone: ObjectStatusTone = hasSourceMissingHost ? "danger" : "attention"
  const packageLine = getGroupRowPackageLine(selectedSkill)
  const statusDescription = hasPublishedUpdate
    ? t("skills.versionUpdateAvailable", {
        current: selectedVersionCheck?.currentVersion ?? "",
        latest: selectedVersionCheck?.latestVersion ?? "",
      })
    : packageLine
  const previewDocumentContent = skillDocument ? skillDocumentPreviewSource(skillDocument.content) : ""

  React.useEffect(() => {
    setSkillDocumentViewMode("preview")
  }, [selectedSkill.id])

  React.useEffect(() => {
    let cancelled = false

    setSkillDocument(null)
    setSkillDocumentError(null)

    if (!skillDocumentRootPath) {
      setIsSkillDocumentLoading(false)
      return () => {
        cancelled = true
      }
    }

    setIsSkillDocumentLoading(true)
    void skillService
      .invoke("readSkillDocument", { path: skillDocumentRootPath })
      .then((document) => {
        if (!cancelled) {
          setSkillDocument(document)
        }
      })
      .catch((cause) => {
        if (!cancelled) {
          setSkillDocumentError(skillErrorMessage(cause, t))
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsSkillDocumentLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [skillDocumentRootPath, skillService, t])

  const openSkillDocument = React.useCallback(async () => {
    if (!skillDocumentRootPath) {
      return
    }

    try {
      await skillService.invoke("openSkillDocument", { path: skillDocumentRootPath })
    } catch (cause) {
      toast.error(t("skills.openDocumentFailed", { error: skillErrorMessage(cause, t) }))
    }
  }, [skillDocumentRootPath, skillService, t])

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col gap-3 overflow-hidden">
      <InspectorCard className="shrink-0">
        <CardHeader className="grid gap-1 px-3 py-0">
          <CardTitle ref={headingRef} className="oo-text-label min-w-0 truncate outline-none" tabIndex={-1}>
            {selectedSkill.name}
          </CardTitle>
          {statusDescription ? (
            <CardDescription className="min-w-0 truncate">{statusDescription}</CardDescription>
          ) : null}
        </CardHeader>
        <CardContent className="grid gap-2 px-3">
          <div className="flex min-w-0 flex-wrap items-center gap-1">
            <Badge variant="secondary">{getSkillKindLabel(selectedSkill.kind, t)}</Badge>
            {shouldShowStatusBadge(selectedStatus.tone) && selectedStatus.label ? (
              <Badge
                className={cn("shrink-0", getStatusBadgeClassName(selectedStatus.tone))}
                variant={selectedStatus.badge}
              >
                {selectedStatus.label}
              </Badge>
            ) : null}
            {isPublishableLocalSkill(selectedSkill) ? (
              <Badge className={publishableSkillBadgeClassName} variant="outline">
                {t("skills.publishable")}
              </Badge>
            ) : null}
            {hasPublishedUpdate && canUpdatePublishedSkill ? (
              <SkillUpdateActionBadge
                ariaLabel={t("skills.updateRegistryToVersion", {
                  current: selectedVersionCheck?.currentVersion ?? selectedSkill.version ?? "",
                  latest: selectedVersionCheck?.latestVersion ?? "",
                })}
                isUpdating={isUpdatingRegistrySkill}
                label={t("skills.updateAvailable")}
                updatingLabel={t("skills.updatingRegistry")}
                onClick={() => updateRegistrySkill(selectedSkill)}
              />
            ) : hasPublishedUpdate ? (
              <SkillUpdateBadge label={t("skills.updateAvailable")} />
            ) : null}
            {!packageLine && selectedSkill.version ? <Badge variant="outline">{selectedSkill.version}</Badge> : null}
          </div>
          {selectedSkill.description ? (
            <CardDescription className="min-w-0 break-words text-foreground/80">
              {selectedSkill.description}
            </CardDescription>
          ) : null}
          {hostAttentionCount > 0 ? (
            <div
              className={cn(
                "grid gap-2 rounded-md border px-2.5 py-2",
                hasSourceMissingHost
                  ? "border-[var(--oo-danger-border)] bg-[var(--oo-danger-surface)]"
                  : "border-[var(--oo-warning-border)] bg-[var(--oo-warning-surface)]",
              )}
            >
              <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-2">
                <ObjectStatusIcon tone={hostAttentionTone} />
                <div className="grid min-w-0 gap-1">
                  <div className="oo-text-caption-compact font-medium">{t("skills.localChangeActionTitle")}</div>
                  <CardDescription className="oo-text-caption-compact">
                    {hasSourceMissingHost && canRestoreRegistrySkill
                      ? t("skills.localChangeSourceMissingDescription")
                      : canRestoreRegistrySkill
                        ? t("skills.localChangeRegistryDescription")
                        : t("skills.localChangeLocalDescription")}
                  </CardDescription>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 pl-6">
                {canRestoreRegistrySkill ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isUpdatingRegistrySkill}
                    onClick={() => updateRegistrySkill(selectedSkill)}
                  >
                    {isUpdatingRegistrySkill ? <AppIcons.status.loading className="animate-spin" /> : null}
                    {isUpdatingRegistrySkill ? t("skills.updatingRegistry") : t("skills.restoreRegistryVersion")}
                  </Button>
                ) : null}
                {localPublishPath ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isPublishingSkill}
                    onClick={() => void publishSkill(selectedSkill)}
                  >
                    {isPublishingSkill ? <AppIcons.status.loading className="animate-spin" /> : null}
                    {isPublishingSkill ? t("skills.publishing") : t("skills.publishToMarket")}
                  </Button>
                ) : null}
                {canOpenLocalSkillFiles ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (skillDocumentRootPath) {
                        openSkillFolder(skillDocumentRootPath)
                      }
                    }}
                  >
                    {t("skills.openLocalFiles")}
                  </Button>
                ) : null}
              </div>
              <CardDescription className="oo-text-caption-compact pl-6">
                {t("skills.localChangeSkipDescription")}
              </CardDescription>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-1">
            {canPublishLocalSkill && hostAttentionCount === 0 ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isPublishingSkill}
                onClick={() => void publishSkill(selectedSkill)}
              >
                {isPublishingSkill ? <AppIcons.status.loading className="animate-spin" /> : <AppIcons.action.publish />}
                {isPublishingSkill
                  ? t("skills.publishing")
                  : selectedSkill.packageName?.trim()
                    ? t("skills.republishToMarket")
                    : t("skills.publishToMarket")}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="border-[var(--oo-danger-border)] text-destructive hover:bg-[var(--oo-danger-surface)] hover:text-destructive"
              disabled={isRemovingSkill}
              onClick={() => requestRemoveSkill(selectedSkill)}
            >
              {isRemovingSkill ? <AppIcons.status.loading className="animate-spin" /> : <AppIcons.action.delete />}
              {isRemovingSkill ? t("skills.removing") : t("skills.removeConfirmAction")}
            </Button>
          </div>
          <SkillErrorNotice error={planError} />
        </CardContent>
      </InspectorCard>

      <InspectorInsetCard className="flex min-h-0 flex-1 flex-col gap-2 px-3 py-3">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <div className="oo-text-label min-w-0 truncate">{t("skills.documentTitle")}</div>
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              className="shrink-0"
              value={skillDocumentViewMode}
              onValueChange={(value) => {
                if (value === "preview" || value === "raw") {
                  setSkillDocumentViewMode(value)
                }
              }}
            >
              <ToggleGroupItem value="preview">{t("skills.documentPreview")}</ToggleGroupItem>
              <ToggleGroupItem value="raw">{t("skills.documentRaw")}</ToggleGroupItem>
            </ToggleGroup>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!skillDocumentRootPath || Boolean(skillDocumentError)}
              onClick={() => void openSkillDocument()}
            >
              <AppIcons.action.openExternal />
              {t("skills.openDocument")}
            </Button>
          </div>
        </div>
        <div className="min-h-0 flex-1">
          {isSkillDocumentLoading ? (
            <div className="grid h-full min-h-32 content-start gap-2 rounded-md border bg-background p-2.5">
              <SkeletonText className="w-5/6" />
              <SkeletonText className="w-4/6" />
              <SkeletonText className="w-3/4" />
            </div>
          ) : skillDocumentError ? (
            <ErrorNotice error={resolveUserFacingError(skillDocumentError, { area: "skills" })} compact />
          ) : skillDocument ? (
            <div className="h-full min-h-32 overflow-auto rounded-md border bg-background p-3">
              {skillDocumentViewMode === "preview" ? (
                <MessageResponse className="max-w-none text-foreground/85">{previewDocumentContent}</MessageResponse>
              ) : (
                <pre className="font-mono text-xs leading-relaxed break-words whitespace-pre-wrap text-foreground/80">
                  {skillDocument.content}
                </pre>
              )}
            </div>
          ) : (
            <CardDescription className="oo-text-caption-compact">{t("skills.documentUnavailable")}</CardDescription>
          )}
        </div>
      </InspectorInsetCard>

      {hasPublishedUpdate && canUpdatePublishedSkill ? (
        <InspectorInsetCard className="shrink-0 gap-2 border-[var(--oo-warning-border)] bg-[var(--oo-warning-surface)] px-3 py-2">
          <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-2">
            <ObjectStatusIcon tone="attention" />
            <div className="grid min-w-0 gap-1">
              <div className="oo-text-caption-compact font-medium">{t("skills.installedSuggestedActionTitle")}</div>
              <CardDescription className="oo-text-caption-compact">
                {t("skills.installedSuggestedUpdateDescription", {
                  latest: selectedVersionCheck?.latestVersion ?? "",
                })}
              </CardDescription>
            </div>
          </div>
          <div className="flex justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isUpdatingRegistrySkill}
              onClick={() => updateRegistrySkill(selectedSkill)}
            >
              {isUpdatingRegistrySkill ? <AppIcons.status.loading className="animate-spin" /> : null}
              {isUpdatingRegistrySkill ? t("skills.updatingRegistry") : t("skills.updateRegistry")}
            </Button>
          </div>
        </InspectorInsetCard>
      ) : null}
    </div>
  )
}
