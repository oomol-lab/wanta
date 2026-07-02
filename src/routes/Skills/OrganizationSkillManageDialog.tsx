import type { ManagedSkillGroup, PublicSkillPackage } from "../../../electron/skills/common.ts"
import type { BusyAction } from "./organization-management-model.ts"
import type { UseOrganizationSkills } from "@/hooks/useOrganizationSkills"
import type { ProviderSkillRecommendation } from "@/routes/Skills/provider-skill-recommendations"
import type { RuntimeSkillRemoveTarget } from "@/routes/Skills/skill-route-model"

import {
  CheckCircle2Icon,
  ChevronDownIcon,
  Link2OffIcon,
  MoreHorizontalIcon,
  PackageMinusIcon,
  PackageIcon,
  PauseCircleIcon,
  PlayCircleIcon,
  RefreshCwIcon,
} from "lucide-react"
import * as React from "react"
import { toast } from "sonner"
import {
  createOrganizationSkillPackageSet,
  errorMessage,
  organizationSkillPackageLinked,
  planOrganizationSkillBulkLinks,
  runtimeSkillRemoveBusyKey,
} from "./organization-management-model.ts"
import { ErrorNotice } from "@/components/ErrorNotice"
import { SearchField } from "@/components/SearchField"
import { normalizeSkillIconSource } from "@/components/skill-icon-source"
import { SkillIcon } from "@/components/SkillIcon"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  ConfirmDialog,
  ConfirmDialogAction,
  ConfirmDialogCancel,
  ConfirmDialogContent,
  ConfirmDialogDescription,
  ConfirmDialogFooter,
  ConfirmDialogHeader,
  ConfirmDialogTitle,
} from "@/components/ui/confirm-dialog"
import { Dialog } from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useAppI18n } from "@/i18n"
import {
  listPublicSkillPackages,
  readPublicSkillPackageByName,
  searchPublicSkillPackages,
} from "@/lib/skills-catalog-client"
import { resolveUserFacingError } from "@/lib/user-facing-error"
import { cn } from "@/lib/utils"
import {
  canInstallPublicSkill,
  getOrganizationSkillRuntimeStatus,
  getPublicPackageInstallState,
  getPublicPackagePrimaryInstallSkill,
  getPublicPackagePrimarySkill,
  getPublicSkillInstallStateLabel,
  getRuntimeSkillRemoveTarget,
  getSkillRowStatusBadgeClassName,
  initialPublicPackageCatalogState,
  isEmojiIcon,
  isImageIcon,
  isNearScrollBottom,
  publicPackageCatalogReducer,
} from "@/routes/Skills/skill-route-model"

type OrganizationSkillManageTab = "configured" | "market" | "recommended"

function looksLikeSkillPackageName(query: string): boolean {
  const normalized = query.trim()
  return /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i.test(normalized) && normalized.length >= 3
}

function mergeMarketPackages(
  packageInfo: PublicSkillPackage | null,
  packages: readonly PublicSkillPackage[],
): PublicSkillPackage[] {
  const items = packageInfo ? [packageInfo, ...packages] : [...packages]
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = item.name.trim().toLowerCase()
    if (!key || seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}

function organizationSkillMatchesQuery(
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

function providerRecommendationMatchesQuery(
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

const skillManageMenuLabelClassName = "oo-text-caption-compact px-2 py-1 text-muted-foreground"
const skillManageMenuIconClassName = "text-muted-foreground"

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

export function OrganizationSkillManageDialog({
  busyAction,
  groupById,
  onAddRecommendation,
  onAddRecommendationBatch,
  onAddMarketPackage,
  onClose = () => undefined,
  onInstallRuntimeSkill,
  onInstallRuntimeSkills,
  onOpenAdvanced,
  onRequestRemoveRuntimeSkill,
  open = true,
  organizationSkills,
  providerRecommendations,
  variant = "dialog",
}: {
  busyAction: BusyAction | null
  groupById: ReadonlyMap<string, ManagedSkillGroup>
  onAddRecommendation: (
    recommendation: ProviderSkillRecommendation,
    options: { installRuntime: boolean },
  ) => Promise<void>
  onAddRecommendationBatch: (
    recommendations: readonly ProviderSkillRecommendation[],
    options: { installRuntime: boolean },
  ) => Promise<void>
  onAddMarketPackage: (
    pkg: PublicSkillPackage,
    options: { installRuntime: boolean; skillName?: string },
  ) => Promise<void>
  onClose?: () => void
  onInstallRuntimeSkill: (skill: { packageName: string; skillName: string }) => void
  onInstallRuntimeSkills: (skills: readonly { packageName: string; skillName: string }[]) => void
  onOpenAdvanced?: () => void
  onRequestRemoveRuntimeSkill: (target: RuntimeSkillRemoveTarget) => void
  open?: boolean
  organizationSkills: UseOrganizationSkills
  providerRecommendations: ProviderSkillRecommendation[]
  variant?: "dialog" | "inline"
}) {
  const { t } = useAppI18n()
  const isActive = variant === "inline" || open
  const [busyConfigId, setBusyConfigId] = React.useState<string | null>(null)
  const [organizationRemoveTarget, setOrganizationRemoveTarget] = React.useState<
    UseOrganizationSkills["skills"][number] | null
  >(null)
  const [activeTab, setActiveTab] = React.useState<OrganizationSkillManageTab>("configured")
  const [searchQuery, setSearchQuery] = React.useState("")
  const [marketCatalog, dispatchMarketCatalog] = React.useReducer(
    publicPackageCatalogReducer,
    initialPublicPackageCatalogState,
  )
  const [marketExactPackage, setMarketExactPackage] = React.useState<PublicSkillPackage | null>(null)
  const [marketExactLoading, setMarketExactLoading] = React.useState(false)
  const marketRequestIdRef = React.useRef(0)
  const marketExactRequestIdRef = React.useRef(0)
  const marketAutoLoadRequestedRef = React.useRef(false)
  const marketScrollContainerRef = React.useRef<HTMLDivElement | null>(null)
  const marketLoadMoreAnchorRef = React.useRef<HTMLDivElement | null>(null)
  const linkedPackageKeys = React.useMemo(
    () => createOrganizationSkillPackageSet(organizationSkills.skills),
    [organizationSkills.skills],
  )
  const recommendedPlan = React.useMemo(
    () => planOrganizationSkillBulkLinks(providerRecommendations, organizationSkills.skills),
    [organizationSkills.skills, providerRecommendations],
  )
  const recommendedOrganizationSkills = recommendedPlan.linkable
  const normalizedQuery = searchQuery.trim().toLowerCase()
  const marketQuery = activeTab === "market" ? searchQuery.trim() : ""
  const filteredConfiguredSkills = React.useMemo(
    () => organizationSkills.skills.filter((skill) => organizationSkillMatchesQuery(skill, normalizedQuery)),
    [normalizedQuery, organizationSkills.skills],
  )
  const filteredRecommendedSkills = React.useMemo(
    () =>
      recommendedOrganizationSkills.filter((recommendation) =>
        providerRecommendationMatchesQuery(recommendation, normalizedQuery),
      ),
    [normalizedQuery, recommendedOrganizationSkills],
  )
  const installableRecommendedSkills = React.useMemo(
    () =>
      recommendedOrganizationSkills
        .filter((recommendation) => canInstallPublicSkill(recommendation.installState))
        .map((recommendation) => ({
          packageName: recommendation.packageName,
          skillName: recommendation.skillId,
        })),
    [recommendedOrganizationSkills],
  )
  const installableConfiguredSkills = React.useMemo(
    () =>
      organizationSkills.skills.filter((skill) => {
        const state = getOrganizationSkillRuntimeStatus(groupById, skill).state
        return skill.enabled && (state === "missing" || state === "external-only")
      }),
    [groupById, organizationSkills.skills],
  )
  const marketPackages = React.useMemo(
    () => mergeMarketPackages(marketExactPackage, marketCatalog.items),
    [marketCatalog.items, marketExactPackage],
  )
  const marketLoading = marketCatalog.status === "loading" || marketCatalog.status === "refreshing"
  const marketLoadingMore = marketCatalog.status === "loading-more"
  const canLoadMoreMarket = Boolean(marketCatalog.next) && !marketLoading && !marketLoadingMore
  const shouldInstallRecommendedBatch = installableRecommendedSkills.length > 1

  React.useEffect(() => {
    if (!marketLoadingMore) {
      marketAutoLoadRequestedRef.current = false
    }
  }, [marketLoadingMore, marketCatalog.next])

  React.useEffect(() => {
    if (!isActive) {
      return
    }
    setActiveTab(recommendedOrganizationSkills.length > 0 ? "recommended" : "configured")
    setSearchQuery("")
    setMarketExactPackage(null)
    setMarketExactLoading(false)
  }, [isActive, organizationSkills.organizationId, recommendedOrganizationSkills.length])

  const loadMarketPackages = React.useCallback(
    async (options: { clearItems?: boolean; forceRefresh?: boolean; next?: string | null; query?: string } = {}) => {
      const query = options.query?.trim() ?? ""
      const next = options.next?.trim() || undefined
      const append = Boolean(next && !options.forceRefresh)
      const requestId = marketRequestIdRef.current + 1
      marketRequestIdRef.current = requestId
      dispatchMarketCatalog({ append, clearItems: options.clearItems, requestId, type: "load-start" })

      try {
        const catalog = query
          ? await searchPublicSkillPackages({ next, query })
          : await listPublicSkillPackages({ next })
        dispatchMarketCatalog({ append, catalog, requestId, type: "load-success" })
      } catch (error) {
        dispatchMarketCatalog({ error: errorMessage(error), requestId, type: "load-error" })
      }
    },
    [],
  )

  React.useEffect(() => {
    if (!isActive || activeTab !== "market") {
      return
    }

    const load = () => {
      void loadMarketPackages({ clearItems: true, forceRefresh: true, query: marketQuery }).catch(() => undefined)
    }

    if (!marketQuery) {
      load()
      return
    }

    const timer = window.setTimeout(load, 300)
    return () => window.clearTimeout(timer)
  }, [activeTab, isActive, loadMarketPackages, marketQuery])

  React.useEffect(() => {
    const query = searchQuery.trim()
    const requestId = marketExactRequestIdRef.current + 1
    marketExactRequestIdRef.current = requestId
    setMarketExactPackage(null)
    setMarketExactLoading(false)

    if (!isActive || activeTab !== "market" || !looksLikeSkillPackageName(query)) {
      return
    }

    setMarketExactLoading(true)
    const timer = window.setTimeout(() => {
      void readPublicSkillPackageByName(query)
        .then((pkg) => {
          if (marketExactRequestIdRef.current === requestId) {
            setMarketExactPackage(pkg)
          }
        })
        .catch(() => undefined)
        .finally(() => {
          if (marketExactRequestIdRef.current === requestId) {
            setMarketExactLoading(false)
          }
        })
    }, 250)

    return () => window.clearTimeout(timer)
  }, [activeTab, isActive, searchQuery])

  const changeActiveTab = React.useCallback((tab: OrganizationSkillManageTab) => {
    setActiveTab(tab)
    setSearchQuery("")
  }, [])

  const requestNextMarketPage = React.useCallback(() => {
    if (!canLoadMoreMarket || marketAutoLoadRequestedRef.current) {
      return
    }

    marketAutoLoadRequestedRef.current = true
    void loadMarketPackages({ next: marketCatalog.next, query: marketQuery })
  }, [canLoadMoreMarket, loadMarketPackages, marketCatalog.next, marketQuery])

  const handleMarketScroll = React.useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      if (!isNearScrollBottom(event.currentTarget)) {
        return
      }

      requestNextMarketPage()
    },
    [requestNextMarketPage],
  )

  React.useEffect(() => {
    const root = marketScrollContainerRef.current
    const target = marketLoadMoreAnchorRef.current
    if (!root || !target || !canLoadMoreMarket) {
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          requestNextMarketPage()
        }
      },
      { root, rootMargin: "160px 0px" },
    )
    observer.observe(target)
    return () => observer.disconnect()
  }, [canLoadMoreMarket, marketPackages.length, requestNextMarketPage])

  React.useEffect(() => {
    if (marketCatalog.status !== "idle") {
      return
    }

    const element = marketScrollContainerRef.current
    if (element && isNearScrollBottom(element)) {
      requestNextMarketPage()
    }
  }, [marketCatalog.status, marketPackages.length, requestNextMarketPage])

  const updateOrganizationSkill = async (
    skill: UseOrganizationSkills["skills"][number],
    input: { enabled: boolean },
  ): Promise<void> => {
    if (!organizationSkills.canManage || busyConfigId) {
      return
    }
    setBusyConfigId(skill.id)
    try {
      await organizationSkills.updateSkill(skill.id, input)
      toast.success(input.enabled ? t("skills.organizationSkillEnabled") : t("skills.organizationSkillDisabled"))
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusyConfigId(null)
    }
  }

  const removeOrganizationSkill = async (): Promise<void> => {
    const skill = organizationRemoveTarget
    if (!skill || !organizationSkills.canManage || busyConfigId) {
      return
    }
    setBusyConfigId(skill.id)
    try {
      await organizationSkills.removeSkill(skill.id)
      toast.success(t("skills.organizationSkillRemoved"))
      setOrganizationRemoveTarget(null)
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusyConfigId(null)
    }
  }

  const inline = variant === "inline"
  const emptyStateClassName = inline ? "m-3 border-0 bg-transparent" : undefined
  const skillListClassName = inline
    ? "min-h-0 overflow-y-auto bg-background pb-3"
    : "min-h-0 overflow-y-auto rounded-md border bg-background"
  const marketListClassName = inline
    ? "min-h-0 flex-1 overflow-y-auto bg-background pb-3"
    : "min-h-0 flex-1 overflow-y-auto rounded-md border bg-background"

  const content = (
    <div className={cn("grid min-h-full grid-rows-[minmax(0,1fr)] gap-4", inline && "h-full min-h-0")}>
      {!organizationSkills.apiEnabled ? (
        <OrganizationSkillDialogEmpty
          className={emptyStateClassName}
          title={t("organizations.skillGuideUnavailableTitle")}
          description={t("organizations.skillGuideUnavailableDescription")}
        />
      ) : organizationSkills.error ? (
        <div className="grid gap-2">
          <ErrorNotice error={organizationSkills.error} compact />
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void organizationSkills.refresh({ forceRefresh: true })}
            >
              <RefreshCwIcon className="size-3.5" />
              {t("organizations.retry")}
            </Button>
          </div>
        </div>
      ) : organizationSkills.loading && !organizationSkills.hasLoaded ? (
        <OrganizationSkillManageLoadingSkeleton inline={inline} />
      ) : (
        <div className={cn("grid min-h-0 grid-rows-[auto_minmax(0,1fr)]", inline ? "gap-0" : "gap-3")}>
          <div
            className={cn(
              "flex min-w-0 flex-wrap items-center justify-between gap-2",
              inline && "border-b border-[var(--oo-divider)] px-3 py-3",
            )}
          >
            <div className="max-w-full min-w-0 overflow-x-auto">
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                value={activeTab}
                aria-label={t("organizations.skillManageTitle")}
                className="w-max"
                onValueChange={(value) => {
                  if (value === "configured" || value === "recommended" || value === "market") {
                    changeActiveTab(value)
                  }
                }}
              >
                <ToggleGroupItem value="configured">
                  <span>{t("organizations.skillManageConfigured")}</span>
                  <span className="oo-text-caption-compact text-muted-foreground">
                    {organizationSkills.skills.length}
                  </span>
                </ToggleGroupItem>
                <ToggleGroupItem value="recommended">
                  <span>{t("organizations.skillManageRecommended")}</span>
                  {installableRecommendedSkills.length > 0 ? (
                    <span className="size-2 shrink-0 rounded-full bg-[var(--success)]" aria-hidden="true" />
                  ) : null}
                  <span className="oo-text-caption-compact text-muted-foreground">
                    {recommendedOrganizationSkills.length}
                  </span>
                </ToggleGroupItem>
                <ToggleGroupItem value="market">
                  <span>{t("organizations.skillManageMarket")}</span>
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-2 sm:min-w-80 sm:flex-row sm:items-center sm:justify-end">
              <SearchField
                className="min-w-0 flex-1 sm:max-w-80"
                inputClassName="h-[var(--oo-control-height-compact)]"
                placeholder={
                  activeTab === "configured"
                    ? t("organizations.skillManageSearchConfigured")
                    : activeTab === "recommended"
                      ? t("organizations.skillManageSearchRecommended")
                      : t("organizations.skillManageSearchMarket")
                }
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.currentTarget.value)}
              />
              {activeTab === "configured" && installableConfiguredSkills.length > 0 ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={Boolean(busyAction)}
                  onClick={() => onInstallRuntimeSkills(installableConfiguredSkills)}
                >
                  {busyAction === "installSkillBatch" ? (
                    <RefreshCwIcon className="size-3.5 animate-spin" />
                  ) : (
                    <PackageIcon className="size-3.5" />
                  )}
                  {t("organizations.skillManageInstallMissingAll", {
                    count: installableConfiguredSkills.length,
                  })}
                </Button>
              ) : null}
              {activeTab === "recommended" &&
              organizationSkills.canManage &&
              (installableRecommendedSkills.length > 1 || recommendedOrganizationSkills.length > 1) ? (
                <div className="inline-flex max-w-full items-center justify-end">
                  <Button
                    type="button"
                    size="sm"
                    className="min-w-0 shrink rounded-r-none"
                    disabled={Boolean(busyAction)}
                    onClick={() =>
                      shouldInstallRecommendedBatch
                        ? onInstallRuntimeSkills(installableRecommendedSkills)
                        : onAddRecommendationBatch(recommendedOrganizationSkills, { installRuntime: false })
                    }
                  >
                    {busyAction === "installSkillBatch" || busyAction === "addSkillBatch" ? (
                      <RefreshCwIcon className="size-3.5 animate-spin" />
                    ) : (
                      <PackageIcon className="size-3.5" />
                    )}
                    <span className="truncate">
                      {shouldInstallRecommendedBatch
                        ? t("organizations.skillManageInstallRecommendedAll", {
                            count: installableRecommendedSkills.length,
                          })
                        : t("organizations.skillManageLinkAll", { count: recommendedOrganizationSkills.length })}
                    </span>
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        size="sm"
                        className="-ml-px w-[var(--oo-control-height-compact)] rounded-l-none border-l border-primary-foreground/25 px-0"
                        disabled={Boolean(busyAction)}
                        aria-label={t("organizations.skillManageMoreActions")}
                      >
                        <ChevronDownIcon className="size-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {installableRecommendedSkills.length > 0 ? (
                        <DropdownMenuItem
                          onSelect={() =>
                            void onAddRecommendationBatch(recommendedOrganizationSkills, { installRuntime: true })
                          }
                        >
                          {t("organizations.skillManageAddInstallAll", { count: recommendedOrganizationSkills.length })}
                        </DropdownMenuItem>
                      ) : null}
                      <DropdownMenuItem
                        onSelect={() =>
                          void onAddRecommendationBatch(recommendedOrganizationSkills, { installRuntime: false })
                        }
                      >
                        {t("organizations.skillManageLinkAll", { count: recommendedOrganizationSkills.length })}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ) : activeTab === "recommended" &&
                !organizationSkills.canManage &&
                installableRecommendedSkills.length > 1 ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={Boolean(busyAction)}
                  onClick={() => onInstallRuntimeSkills(installableRecommendedSkills)}
                >
                  {busyAction === "installSkillBatch" ? (
                    <RefreshCwIcon className="size-3.5 animate-spin" />
                  ) : (
                    <PackageIcon className="size-3.5" />
                  )}
                  {t("organizations.skillManageInstallRecommendedAll", {
                    count: installableRecommendedSkills.length,
                  })}
                </Button>
              ) : null}
            </div>
          </div>
          {activeTab === "configured" ? (
            organizationSkills.skills.length === 0 ? (
              <OrganizationSkillDialogEmpty
                className={emptyStateClassName}
                title={
                  organizationSkills.canManage
                    ? t("organizations.skillGuideEmptyCreatorTitle")
                    : t("organizations.skillGuideEmptyTitle")
                }
                description={
                  organizationSkills.canManage
                    ? t("organizations.skillGuideEmptyCreatorDescription")
                    : t("organizations.skillGuideEmptyDescription")
                }
              />
            ) : filteredConfiguredSkills.length === 0 ? (
              <OrganizationSkillDialogEmpty
                className={emptyStateClassName}
                title={t("organizations.skillManageSearchEmptyTitle")}
                description={t("organizations.skillManageSearchEmptyDescription")}
              />
            ) : (
              <div className={skillListClassName}>
                {filteredConfiguredSkills.map((skill) => (
                  <OrganizationSkillManageRow
                    key={skill.id}
                    busy={busyConfigId === skill.id || busyAction === "installSkillBatch"}
                    busyAction={busyAction}
                    canManage={organizationSkills.canManage}
                    groupById={groupById}
                    installBusy={
                      busyAction === `installSkill:${skill.packageName}:${skill.skillName}` ||
                      busyAction === "installSkillBatch"
                    }
                    skill={skill}
                    onInstallRuntime={() =>
                      onInstallRuntimeSkill({ packageName: skill.packageName, skillName: skill.skillName })
                    }
                    onRemove={() => setOrganizationRemoveTarget(skill)}
                    onRequestRemoveRuntimeSkill={onRequestRemoveRuntimeSkill}
                    onToggleEnabled={() => void updateOrganizationSkill(skill, { enabled: !skill.enabled })}
                  />
                ))}
              </div>
            )
          ) : activeTab === "recommended" ? (
            recommendedOrganizationSkills.length === 0 ? (
              <div
                className={cn(
                  "oo-text-caption px-3 py-4 text-muted-foreground",
                  inline ? "bg-transparent" : "rounded-md border border-dashed bg-muted/20",
                )}
              >
                {t("organizations.skillManageRecommendedEmpty")}
              </div>
            ) : filteredRecommendedSkills.length === 0 ? (
              <OrganizationSkillDialogEmpty
                className={emptyStateClassName}
                title={t("organizations.skillManageSearchEmptyTitle")}
                description={t("organizations.skillManageSearchEmptyDescription")}
              />
            ) : (
              <div className={skillListClassName}>
                {filteredRecommendedSkills.map((recommendation) => (
                  <OrganizationSkillRecommendationRow
                    key={`${recommendation.service}:${recommendation.packageName}:${recommendation.skillId}`}
                    busyAction={busyAction}
                    canManage={organizationSkills.canManage}
                    groupById={groupById}
                    recommendation={recommendation}
                    onAdd={() => onAddRecommendation(recommendation, { installRuntime: false })}
                    onAddAndInstall={() => onAddRecommendation(recommendation, { installRuntime: true })}
                    onInstallRuntime={() =>
                      onInstallRuntimeSkill({
                        packageName: recommendation.packageName,
                        skillName: recommendation.skillId,
                      })
                    }
                    onRequestRemoveRuntimeSkill={onRequestRemoveRuntimeSkill}
                  />
                ))}
              </div>
            )
          ) : (
            <div className="flex min-h-0 flex-col gap-2">
              {marketCatalog.error ? (
                <div className="flex min-w-0 items-start gap-2">
                  <ErrorNotice
                    error={resolveUserFacingError(marketCatalog.error, { area: "skills" })}
                    compact
                    className="min-w-0 flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={marketLoading}
                    onClick={() =>
                      void loadMarketPackages({ clearItems: true, forceRefresh: true, query: marketQuery })
                    }
                  >
                    <RefreshCwIcon className={cn("size-3.5", marketLoading && "animate-spin")} />
                    {t("organizations.retry")}
                  </Button>
                </div>
              ) : null}
              {(marketLoading || marketExactLoading) && marketPackages.length === 0 ? (
                <div className={marketListClassName}>
                  <OrganizationSkillPackageListSkeleton />
                </div>
              ) : marketPackages.length === 0 ? (
                <OrganizationSkillDialogEmpty
                  className={cn("min-h-0 flex-1", emptyStateClassName)}
                  title={t("organizations.skillManageMarketEmptyTitle")}
                  description={t("organizations.skillManageMarketEmptyDescription")}
                />
              ) : (
                <div ref={marketScrollContainerRef} className={marketListClassName} onScroll={handleMarketScroll}>
                  {marketPackages.map((pkg) => (
                    <OrganizationSkillMarketRow
                      key={pkg.id}
                      busyAction={busyAction}
                      canManage={organizationSkills.canManage}
                      groupById={groupById}
                      linked={organizationSkillPackageLinked(linkedPackageKeys, pkg.name)}
                      pkg={pkg}
                      onAdd={(skillName) => onAddMarketPackage(pkg, { installRuntime: false, skillName })}
                      onAddAndInstall={(skillName) => onAddMarketPackage(pkg, { installRuntime: true, skillName })}
                      onManageLinked={() => {
                        setActiveTab("configured")
                        setSearchQuery(pkg.name)
                      }}
                    />
                  ))}
                  <div ref={marketLoadMoreAnchorRef} className="h-px" aria-hidden="true" />
                  {marketLoadingMore ? (
                    <div className="oo-border-divider flex justify-center border-t px-3 py-2">
                      <div className="oo-text-caption-compact inline-flex items-center gap-1.5 text-muted-foreground">
                        <RefreshCwIcon className="size-3.5 animate-spin" />
                        {t("skills.discoverLoadingMore")}
                      </div>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )

  const removeRecommendationDialog = (
    <OrganizationRecommendationRemoveConfirmDialog
      busy={organizationRemoveTarget ? busyConfigId === organizationRemoveTarget.id : false}
      target={organizationRemoveTarget}
      onClose={() => {
        if (!busyConfigId) {
          setOrganizationRemoveTarget(null)
        }
      }}
      onConfirm={() => void removeOrganizationSkill()}
    />
  )

  if (variant === "inline") {
    return (
      <>
        {content}
        {removeRecommendationDialog}
      </>
    )
  }

  return (
    <>
      <Dialog
        open={open}
        ariaLabel={t("organizations.skillManageTitle")}
        title={t("organizations.skillManageTitle")}
        className="h-[min(44rem,85vh)] max-w-[min(60rem,calc(100vw-2rem))]"
        closeLabel={t("common.cancel")}
        footer={
          <>
            {onOpenAdvanced ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  onClose()
                  onOpenAdvanced()
                }}
              >
                {t("organizations.skillManageOpenAdvanced")}
              </Button>
            ) : null}
            <Button type="button" onClick={onClose}>
              {t("organizations.skillManageDone")}
            </Button>
          </>
        }
        onClose={onClose}
      >
        {content}
      </Dialog>
      {removeRecommendationDialog}
    </>
  )
}

export function OrganizationSkillManageLoadingSkeleton({ inline }: { inline: boolean }) {
  const listClassName = inline
    ? "min-h-0 overflow-hidden bg-background pb-3"
    : "min-h-0 overflow-hidden rounded-md border bg-background"

  return (
    <div
      className={cn("grid min-h-0 grid-rows-[auto_minmax(0,1fr)]", inline ? "h-full gap-0" : "gap-3")}
      aria-hidden="true"
    >
      <div
        className={cn(
          "flex min-w-0 flex-wrap items-center justify-between gap-2",
          inline && "border-b border-[var(--oo-divider)] px-3 py-3",
        )}
      >
        <div className="max-w-full min-w-0 overflow-x-auto">
          <div className="flex h-[var(--oo-control-height-compact)] w-max min-w-0 items-center overflow-hidden rounded-md bg-muted/45 shadow-xs">
            <Skeleton className="mx-2 h-3.5 w-20 shrink-0 rounded-sm" />
            <div className="h-full w-px bg-[var(--oo-divider)]" />
            <Skeleton className="mx-2 h-3.5 w-16 shrink-0 rounded-sm" />
            <div className="h-full w-px bg-[var(--oo-divider)]" />
            <Skeleton className="mx-2 h-3.5 w-14 shrink-0 rounded-sm" />
          </div>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2 sm:min-w-80 sm:flex-row sm:items-center sm:justify-end">
          <Skeleton className="h-[var(--oo-control-height-compact)] min-w-0 flex-1 rounded-md sm:max-w-80" />
          <Skeleton className="h-[var(--oo-control-height-compact)] w-28 shrink-0 rounded-md" />
        </div>
      </div>
      <div className={listClassName}>
        <OrganizationSkillManageRowSkeleton titleWidth="w-32" descriptionWidth="w-3/4 max-w-md" metaWidth="w-56" />
        <OrganizationSkillManageRowSkeleton titleWidth="w-40" descriptionWidth="w-5/6 max-w-lg" metaWidth="w-64" />
        <OrganizationSkillManageRowSkeleton titleWidth="w-28" descriptionWidth="w-2/3 max-w-sm" metaWidth="w-48" />
      </div>
    </div>
  )
}

function OrganizationSkillManageRowSkeleton({
  descriptionWidth,
  metaWidth,
  titleWidth,
}: {
  descriptionWidth: string
  metaWidth: string
  titleWidth: string
}) {
  return (
    <div className="grid min-w-0 gap-3 border-b border-[var(--oo-divider)] px-3 py-2.5 md:grid-cols-[auto_minmax(0,1fr)_auto] md:items-center">
      <Skeleton className="size-9 rounded-md" />
      <div className="grid min-w-0 gap-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <Skeleton className={cn("h-4 rounded-md", titleWidth)} />
          <Skeleton className="h-5 w-14 shrink-0 rounded-full" />
          <Skeleton className="hidden h-5 w-20 shrink-0 rounded-full sm:block" />
        </div>
        <Skeleton className={cn("h-3.5 rounded-md", descriptionWidth)} />
        <Skeleton className={cn("h-3 rounded-md", metaWidth)} />
      </div>
      <div className="flex min-w-0 justify-start gap-2 md:justify-end">
        <Skeleton className="h-[var(--oo-control-height-compact)] w-24 rounded-md" />
        <Skeleton className="h-[var(--oo-control-height-compact)] w-[var(--oo-control-height-compact)] rounded-md" />
      </div>
    </div>
  )
}

function OrganizationSkillDialogEmpty({
  className,
  description,
  title,
}: {
  className?: string
  description: string
  title: string
}) {
  return (
    <div
      className={cn(
        "grid min-h-36 place-items-center rounded-md border border-dashed bg-muted/20 px-4 py-8 text-center",
        className,
      )}
    >
      <div className="grid max-w-md justify-items-center gap-2">
        <div className="grid size-10 place-items-center rounded-md border bg-background text-muted-foreground">
          <PackageIcon className="size-5" />
        </div>
        <div className="oo-text-label text-foreground">{title}</div>
        <p className="oo-text-caption text-muted-foreground">{description}</p>
      </div>
    </div>
  )
}

function OrganizationSkillIconFrame({ icon }: { icon?: string }) {
  const normalizedIcon = normalizeSkillIconSource(icon)
  const frameClassName = "grid size-9 shrink-0 place-items-center rounded-md border bg-background"

  if (isImageIcon(normalizedIcon)) {
    return (
      <span className={cn(frameClassName, "overflow-hidden")}>
        <img alt="" src={normalizedIcon} className="size-full object-contain p-1.5" />
      </span>
    )
  }

  if (isEmojiIcon(normalizedIcon)) {
    return <span className={cn(frameClassName, "text-xl")}>{normalizedIcon}</span>
  }

  return (
    <span className={frameClassName}>
      <SkillIcon icon={normalizedIcon} className="size-5" />
    </span>
  )
}

function OrganizationSkillPackageListSkeleton() {
  return (
    <div className="divide-y">
      {Array.from({ length: 5 }).map((_, index) => (
        <div key={index} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5">
          <Skeleton className="size-9 rounded-md" />
          <div className="grid min-w-0 gap-2">
            <Skeleton className="h-4 w-40 rounded-md" />
            <Skeleton className="h-3 w-60 max-w-full rounded-md" />
          </div>
          <Skeleton className="h-[var(--oo-control-height-compact)] w-24 rounded-md" />
        </div>
      ))}
    </div>
  )
}

function OrganizationSkillMarketRow({
  busyAction,
  canManage,
  groupById,
  linked,
  onAdd,
  onAddAndInstall,
  onManageLinked,
  pkg,
}: {
  busyAction: BusyAction | null
  canManage: boolean
  groupById: ReadonlyMap<string, ManagedSkillGroup>
  linked: boolean
  onAdd: (skillName?: string) => Promise<void>
  onAddAndInstall: (skillName?: string) => Promise<void>
  onManageLinked: () => void
  pkg: PublicSkillPackage
}) {
  const { t } = useAppI18n()
  const primarySkill = getPublicPackagePrimarySkill(pkg)
  const primaryInstallSkill = getPublicPackagePrimaryInstallSkill(groupById, pkg) ?? primarySkill
  const installState = getPublicPackageInstallState(groupById, pkg)
  const canInstallRuntime = canInstallPublicSkill(installState)
  const targetSkillName = canInstallRuntime ? primaryInstallSkill?.name : primarySkill?.name
  const busy = targetSkillName ? busyAction === `addSkill:${pkg.name}:${targetSkillName}` : false
  const disabled = Boolean(busyAction && !busy)
  const canLink = canManage && Boolean(primarySkill) && !linked
  const skillDescription = primarySkill?.description ?? pkg.description
  const skillLine = primarySkill
    ? `${pkg.name} · ${primarySkill.name} · ${pkg.version}`
    : `${pkg.name} · ${pkg.version}`
  const primaryLabel = busy
    ? t("skills.organizationAdding")
    : canInstallRuntime
      ? t("organizations.skillManageAddAndInstall")
      : t("organizations.skillManageAddOnly")

  return (
    <div
      className={cn(
        "grid min-w-0 gap-3 border-b border-[var(--oo-divider)] px-3 py-2.5 md:items-center",
        "md:grid-cols-[auto_minmax(0,1fr)_auto_auto]",
      )}
    >
      <OrganizationSkillIconFrame icon={pkg.icon} />
      <div className="grid min-w-0 gap-0.5">
        <div className="oo-text-label min-w-0 truncate text-foreground">{pkg.displayName}</div>
        {skillDescription ? (
          <div className="oo-text-caption line-clamp-1 text-foreground/75">{skillDescription}</div>
        ) : null}
        <div className="oo-text-caption-compact min-w-0 truncate text-muted-foreground" title={skillLine}>
          {skillLine}
        </div>
      </div>
      <Badge className="shrink-0 justify-self-start md:justify-self-end" variant={linked ? "secondary" : "outline"}>
        {linked ? t("skills.organizationAdded") : getPublicSkillInstallStateLabel(installState, t)}
      </Badge>
      <div className="flex min-w-0 flex-wrap justify-start gap-2 md:justify-end">
        {linked ? (
          <Button type="button" variant="outline" size="sm" onClick={onManageLinked}>
            {t("skills.discoverOpenManage")}
          </Button>
        ) : !canManage ? (
          <Badge variant="outline">{t("organizations.readOnly")}</Badge>
        ) : canInstallRuntime && canLink ? (
          <div className="inline-flex items-center gap-0">
            <Button
              type="button"
              size="sm"
              className="rounded-r-none"
              disabled={disabled || busy || !targetSkillName}
              onClick={() => void onAddAndInstall(targetSkillName)}
            >
              {busy ? <RefreshCwIcon className="size-3.5 animate-spin" /> : <PackageIcon className="size-3.5" />}
              {primaryLabel}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  className="-ml-px w-[var(--oo-control-height-compact)] rounded-l-none border-l border-primary-foreground/25 px-0"
                  disabled={disabled || busy}
                  aria-label={t("organizations.skillManageMoreActions")}
                >
                  <MoreHorizontalIcon className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => void onAdd(primarySkill?.name)}>
                  {t("organizations.skillManageLinkOnly")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : (
          <Button
            type="button"
            size="sm"
            disabled={disabled || busy || !canLink}
            onClick={() => void onAdd(primarySkill?.name)}
          >
            {busy ? <RefreshCwIcon className="size-3.5 animate-spin" /> : null}
            {primaryLabel}
          </Button>
        )}
      </div>
    </div>
  )
}

function OrganizationConfiguredSkillActionsMenu({
  busy,
  canManage,
  enabled,
  onRemove,
  onRequestRemoveRuntimeSkill,
  onToggleEnabled,
  removeBusy,
  runtimeRemoveTarget,
}: {
  busy: boolean
  canManage: boolean
  enabled: boolean
  onRemove: () => void
  onRequestRemoveRuntimeSkill: (target: RuntimeSkillRemoveTarget) => void
  onToggleEnabled: () => void
  removeBusy: boolean
  runtimeRemoveTarget: RuntimeSkillRemoveTarget | null
}) {
  const { t } = useAppI18n()
  const hasRuntimeRemoveAction = Boolean(runtimeRemoveTarget)
  if (!canManage && !hasRuntimeRemoveAction) {
    return null
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-[var(--oo-control-height-compact)] px-0"
          disabled={busy || removeBusy}
          aria-label={t("organizations.skillManageMoreActions")}
        >
          {busy || removeBusy ? (
            <RefreshCwIcon className="size-3.5 animate-spin" />
          ) : (
            <MoreHorizontalIcon className="size-4" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {canManage ? (
          <>
            <DropdownMenuLabel className={skillManageMenuLabelClassName}>
              {t("organizations.skillManageOrganizationSection")}
            </DropdownMenuLabel>
            <DropdownMenuItem onSelect={onToggleEnabled}>
              {enabled ? (
                <PauseCircleIcon className={skillManageMenuIconClassName} />
              ) : (
                <PlayCircleIcon className={skillManageMenuIconClassName} />
              )}
              {enabled
                ? t("organizations.skillManagePauseRecommendation")
                : t("organizations.skillManageResumeRecommendation")}
            </DropdownMenuItem>
          </>
        ) : null}
        {runtimeRemoveTarget ? (
          <>
            {canManage ? <DropdownMenuSeparator /> : null}
            <DropdownMenuLabel className={skillManageMenuLabelClassName}>
              {t("organizations.skillManageRuntimeSection")}
            </DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => onRequestRemoveRuntimeSkill(runtimeRemoveTarget)}>
              <PackageMinusIcon className={skillManageMenuIconClassName} />
              {t("organizations.skillManageRemoveRuntime")}
            </DropdownMenuItem>
          </>
        ) : null}
        {canManage ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={onRemove}>
              <Link2OffIcon className="size-4" />
              {t("organizations.skillManageUnrecommend")}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function OrganizationRecommendedSkillActionsMenu({
  addBusy,
  busy,
  canManage,
  onAdd,
  onRequestRemoveRuntimeSkill,
  removeBusy,
  runtimeRemoveTarget,
}: {
  addBusy: boolean
  busy: boolean
  canManage: boolean
  onAdd: () => Promise<void>
  onRequestRemoveRuntimeSkill: (target: RuntimeSkillRemoveTarget) => void
  removeBusy: boolean
  runtimeRemoveTarget: RuntimeSkillRemoveTarget | null
}) {
  const { t } = useAppI18n()
  const hasRuntimeRemoveAction = Boolean(runtimeRemoveTarget)
  if (!canManage && !hasRuntimeRemoveAction) {
    return null
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-[var(--oo-control-height-compact)] px-0"
          disabled={busy || addBusy || removeBusy}
          aria-label={t("organizations.skillManageMoreActions")}
        >
          {busy || addBusy || removeBusy ? (
            <RefreshCwIcon className="size-3.5 animate-spin" />
          ) : (
            <MoreHorizontalIcon className="size-4" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {canManage ? (
          <>
            <DropdownMenuLabel className={skillManageMenuLabelClassName}>
              {t("organizations.skillManageOrganizationSection")}
            </DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => void onAdd()}>
              <CheckCircle2Icon className={skillManageMenuIconClassName} />
              {t("organizations.skillManageAddOnly")}
            </DropdownMenuItem>
          </>
        ) : null}
        {canManage && runtimeRemoveTarget ? <DropdownMenuSeparator /> : null}
        {runtimeRemoveTarget ? (
          <>
            <DropdownMenuLabel className={skillManageMenuLabelClassName}>
              {t("organizations.skillManageRuntimeSection")}
            </DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => onRequestRemoveRuntimeSkill(runtimeRemoveTarget)}>
              <PackageMinusIcon className={skillManageMenuIconClassName} />
              {t("organizations.skillManageRemoveRuntime")}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function RuntimeSkillRemoveConfirmDialog({
  busy,
  onClose,
  onConfirm,
  target,
}: {
  busy: boolean
  onClose: () => void
  onConfirm: () => void
  target: RuntimeSkillRemoveTarget | null
}) {
  const { t } = useAppI18n()

  return (
    <ConfirmDialog
      open={Boolean(target)}
      onOpenChange={(open) => {
        if (!open && !busy) {
          onClose()
        }
      }}
    >
      <ConfirmDialogContent>
        <ConfirmDialogHeader>
          <ConfirmDialogTitle>
            {target
              ? t("organizations.skillManageRemoveRuntimeConfirmTitle", { name: target.displayName })
              : t("organizations.skillManageRemoveRuntime")}
          </ConfirmDialogTitle>
          <ConfirmDialogDescription>
            {t("organizations.skillManageRemoveRuntimeConfirmDescription")}
          </ConfirmDialogDescription>
        </ConfirmDialogHeader>
        <ConfirmDialogFooter>
          <ConfirmDialogCancel disabled={busy}>{t("common.cancel")}</ConfirmDialogCancel>
          <ConfirmDialogAction
            disabled={busy || !target}
            onClick={(event) => {
              event.preventDefault()
              onConfirm()
            }}
          >
            {busy ? <RefreshCwIcon className="size-3.5 animate-spin" /> : null}
            {t("organizations.skillManageRemoveRuntime")}
          </ConfirmDialogAction>
        </ConfirmDialogFooter>
      </ConfirmDialogContent>
    </ConfirmDialog>
  )
}

function OrganizationRecommendationRemoveConfirmDialog({
  busy,
  onClose,
  onConfirm,
  target,
}: {
  busy: boolean
  onClose: () => void
  onConfirm: () => void
  target: UseOrganizationSkills["skills"][number] | null
}) {
  const { t } = useAppI18n()

  return (
    <ConfirmDialog
      open={Boolean(target)}
      onOpenChange={(open) => {
        if (!open && !busy) {
          onClose()
        }
      }}
    >
      <ConfirmDialogContent>
        <ConfirmDialogHeader>
          <ConfirmDialogTitle>
            {target
              ? t("organizations.skillManageUnrecommendConfirmTitle", { name: target.displayName })
              : t("organizations.skillManageUnrecommend")}
          </ConfirmDialogTitle>
          <ConfirmDialogDescription>
            {t("organizations.skillManageUnrecommendConfirmDescription")}
          </ConfirmDialogDescription>
        </ConfirmDialogHeader>
        <ConfirmDialogFooter>
          <ConfirmDialogCancel disabled={busy}>{t("common.cancel")}</ConfirmDialogCancel>
          <ConfirmDialogAction
            disabled={busy || !target}
            onClick={(event) => {
              event.preventDefault()
              onConfirm()
            }}
          >
            {busy ? <RefreshCwIcon className="size-3.5 animate-spin" /> : null}
            {t("organizations.skillManageUnrecommend")}
          </ConfirmDialogAction>
        </ConfirmDialogFooter>
      </ConfirmDialogContent>
    </ConfirmDialog>
  )
}

function OrganizationSkillManageRow({
  busy,
  busyAction,
  canManage,
  groupById,
  installBusy,
  onInstallRuntime,
  onRemove,
  onRequestRemoveRuntimeSkill,
  onToggleEnabled,
  skill,
}: {
  busy: boolean
  busyAction: BusyAction | null
  canManage: boolean
  groupById: ReadonlyMap<string, ManagedSkillGroup>
  installBusy: boolean
  onInstallRuntime: () => void
  onRemove: () => void
  onRequestRemoveRuntimeSkill: (target: RuntimeSkillRemoveTarget) => void
  onToggleEnabled: () => void
  skill: UseOrganizationSkills["skills"][number]
}) {
  const { t } = useAppI18n()
  const runtimeStatus = getOrganizationSkillRuntimeStatus(groupById, skill)
  const runtimeTone = organizationRuntimeStatusTone(runtimeStatus.state)
  const runtimeInstallable = runtimeStatus.state === "missing" || runtimeStatus.state === "external-only"
  const runtimeRemoveTarget = getRuntimeSkillRemoveTarget(groupById, {
    displayName: skill.displayName,
    packageName: skill.packageName,
    skillName: skill.skillName,
  })
  const removeBusy = runtimeRemoveTarget ? busyAction === runtimeSkillRemoveBusyKey(runtimeRemoveTarget) : false
  const menuBusy = Boolean(busyAction && !removeBusy) || busy || installBusy

  return (
    <div className="group/skill-row grid min-w-0 gap-3 border-b border-[var(--oo-divider)] px-3 py-2.5 md:grid-cols-[auto_minmax(0,1fr)_auto] md:items-center">
      <OrganizationSkillIconFrame icon={skill.icon} />
      <div className="grid min-w-0 gap-0.5">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <div className="oo-text-label min-w-0 truncate text-foreground">{skill.displayName}</div>
          <Badge variant={skill.enabled ? "secondary" : "outline"} className="shrink-0">
            {skill.enabled ? t("skills.organizationEnabled") : t("skills.organizationDisabled")}
          </Badge>
          <Badge className={cn("shrink-0", getSkillRowStatusBadgeClassName(runtimeTone))} variant="outline">
            {organizationRuntimeStatusLabel(runtimeStatus.state, t)}
          </Badge>
        </div>
        {skill.description ? (
          <div className="oo-text-caption line-clamp-1 text-foreground/75">{skill.description}</div>
        ) : null}
        <div
          className="oo-text-caption-compact min-w-0 truncate text-muted-foreground"
          title={`${skill.packageName} · ${skill.skillName} · ${skill.version}`}
        >
          {skill.packageName} · {skill.skillName} · {skill.version}
        </div>
      </div>
      <div className="flex min-w-0 flex-wrap justify-start gap-2 md:justify-end">
        {runtimeInstallable ? (
          <Button type="button" variant="outline" size="sm" disabled={installBusy} onClick={onInstallRuntime}>
            {installBusy ? <RefreshCwIcon className="size-3.5 animate-spin" /> : <PackageIcon className="size-3.5" />}
            {installBusy ? t("skills.registryInstalling") : t("organizations.skillManageInstallRuntime")}
          </Button>
        ) : null}
        <OrganizationConfiguredSkillActionsMenu
          busy={menuBusy}
          canManage={canManage}
          enabled={skill.enabled}
          removeBusy={removeBusy}
          runtimeRemoveTarget={runtimeRemoveTarget}
          onRemove={onRemove}
          onRequestRemoveRuntimeSkill={onRequestRemoveRuntimeSkill}
          onToggleEnabled={onToggleEnabled}
        />
      </div>
    </div>
  )
}

function OrganizationSkillRecommendationRow({
  busyAction,
  canManage,
  groupById,
  onAdd,
  onAddAndInstall,
  onInstallRuntime,
  onRequestRemoveRuntimeSkill,
  recommendation,
}: {
  busyAction: BusyAction | null
  canManage: boolean
  groupById: ReadonlyMap<string, ManagedSkillGroup>
  onAdd: () => Promise<void>
  onAddAndInstall: () => Promise<void>
  onInstallRuntime: () => void
  onRequestRemoveRuntimeSkill: (target: RuntimeSkillRemoveTarget) => void
  recommendation: ProviderSkillRecommendation
}) {
  const { t } = useAppI18n()
  const canInstallRuntime =
    recommendation.installState === "installable" || recommendation.installState === "partially-installed"
  const addBusyKey = `addSkill:${recommendation.packageName}:${recommendation.skillId}`
  const installBusyKey = `installSkill:${recommendation.packageName}:${recommendation.skillId}`
  const addBusy = busyAction === addBusyKey || busyAction === "addSkillBatch"
  const installBusy = busyAction === installBusyKey || busyAction === "installSkillBatch"
  const disabled = Boolean(busyAction && !addBusy && !installBusy)
  const skillDescription =
    recommendation.package.skills.find((skill) => skill.name === recommendation.skillId)?.description ??
    recommendation.package.description
  const runtimeRemoveTarget = getRuntimeSkillRemoveTarget(
    groupById,
    {
      displayName: recommendation.package.displayName,
      packageName: recommendation.packageName,
      skillName: recommendation.skillId,
    },
    { requirePackageMatch: true },
  )
  const runtimeRemoveBusy = runtimeRemoveTarget ? busyAction === runtimeSkillRemoveBusyKey(runtimeRemoveTarget) : false
  const menuBusy = Boolean(busyAction && !addBusy && !runtimeRemoveBusy)

  return (
    <div className="group/skill-row grid min-w-0 gap-3 border-b border-[var(--oo-divider)] px-3 py-2.5 md:grid-cols-[auto_minmax(0,1fr)_auto] md:items-center">
      <OrganizationSkillIconFrame icon={recommendation.package.icon} />
      <div className="grid min-w-0 gap-0.5">
        <div className="oo-text-label min-w-0 truncate text-foreground">{recommendation.package.displayName}</div>
        {skillDescription ? (
          <div className="oo-text-caption line-clamp-1 text-foreground/75">{skillDescription}</div>
        ) : null}
        <div
          className="oo-text-caption-compact min-w-0 truncate text-muted-foreground"
          title={recommendation.packageName}
        >
          {recommendation.providerDisplayName} · {recommendation.packageName} · {recommendation.skillId}
        </div>
      </div>
      <div className="flex min-w-0 flex-wrap justify-start gap-2 md:justify-end">
        {runtimeRemoveTarget ? (
          <OrganizationRecommendedSkillActionsMenu
            addBusy={addBusy}
            busy={menuBusy}
            canManage={canManage}
            removeBusy={runtimeRemoveBusy}
            runtimeRemoveTarget={runtimeRemoveTarget}
            onAdd={onAdd}
            onRequestRemoveRuntimeSkill={onRequestRemoveRuntimeSkill}
          />
        ) : canInstallRuntime ? (
          <div className="inline-flex items-center gap-0">
            <Button
              type="button"
              variant={canManage ? "default" : "outline"}
              size="sm"
              className={cn(canManage && "rounded-r-none")}
              disabled={disabled || installBusy}
              onClick={onInstallRuntime}
            >
              {installBusy ? <RefreshCwIcon className="size-3.5 animate-spin" /> : <PackageIcon className="size-3.5" />}
              {installBusy ? t("skills.registryInstalling") : t("organizations.skillManageInstallRuntime")}
            </Button>
            {canManage ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="default"
                    size="sm"
                    className="-ml-px w-[var(--oo-control-height-compact)] rounded-l-none border-l border-primary-foreground/25 px-0"
                    disabled={disabled || addBusy || installBusy}
                    aria-label={t("organizations.skillManageMoreActions")}
                  >
                    <MoreHorizontalIcon className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => void onAddAndInstall()}>
                    {t("organizations.skillManageAddAndInstall")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => void onAdd()}>
                    {t("organizations.skillManageLinkOnly")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        ) : !canManage ? (
          <Badge variant="outline">{getPublicSkillInstallStateLabel(recommendation.installState, t)}</Badge>
        ) : (
          <Button type="button" size="sm" disabled={disabled || addBusy} onClick={() => void onAdd()}>
            {addBusy ? <RefreshCwIcon className="size-3.5 animate-spin" /> : null}
            {t("organizations.skillManageAddOnly")}
          </Button>
        )}
      </div>
    </div>
  )
}
