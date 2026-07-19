import type { ManagedSkillGroup, PublicSkillPackage } from "../../../electron/skills/common.ts"
import type { BusyAction } from "./team-management-model.ts"
import type { UseTeamSkills } from "@/hooks/useTeamSkills"
import type { ProviderSkillRecommendation } from "@/routes/Skills/provider-skill-recommendations"

import { ChevronDownIcon, PackageIcon, RefreshCwIcon } from "lucide-react"
import * as React from "react"
import {
  createTeamSkillPackageSet,
  errorMessage,
  teamSkillPackageLinked,
  planProviderSkillRecommendationBulkLinks,
} from "./team-management-model.ts"
import {
  buildInstallableTeamRecommendationSkills,
  buildTeamSkillRecommendationItems,
  looksLikeSkillPackageName,
  mergeMarketPackages,
} from "./team-skill-manage-helpers.ts"
import {
  TeamInstallMissingButton,
  TeamPackageRemoveConfirmDialog,
  TeamSkillDialogEmpty,
  TeamSkillManageLoadingSkeleton,
  TeamSkillManageRow,
  TeamSkillMarketRow,
  TeamSkillPackageListSkeleton,
  TeamSkillRecommendationRow,
} from "./TeamSkillManageRows.tsx"
import { useTeamSkillRemoval } from "./use-team-skill-removal.ts"
import { ErrorNotice } from "@/components/ErrorNotice"
import { SearchField } from "@/components/SearchField"
import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useAppI18n } from "@/i18n"
import { reportRendererHandledError } from "@/lib/renderer-diagnostics"
import {
  listPublicSkillPackages,
  readPublicSkillPackageByName,
  searchPublicSkillPackages,
} from "@/lib/skills-catalog-client"
import { resolveUserFacingError } from "@/lib/user-facing-error"
import { cn } from "@/lib/utils"
import {
  initialPublicPackageCatalogState,
  isNearScrollBottom,
  publicPackageCatalogReducer,
} from "@/routes/Skills/skill-route-model"

type TeamSkillManageTab = "market" | "recommendations"

export { TeamSkillManageLoadingSkeleton, RuntimeSkillRemoveConfirmDialog } from "./TeamSkillManageRows.tsx"

export function TeamSkillManageDialog({
  busyAction,
  groupById,
  onAddRecommendation,
  onAddRecommendationBatch,
  onAddMarketPackage,
  onClose = () => undefined,
  onInstallRuntimeSkill,
  onInstallRuntimeSkills,
  onOpenManagedSkill,
  onOpenPackageDetail,
  onOpenAdvanced,
  open = true,
  teamSkills,
  providerRecommendationsLoading = false,
  providerRecommendationsResolvedCount = 0,
  providerRecommendationsTotalCount = 0,
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
  onOpenManagedSkill: (skillName: string) => void
  onOpenPackageDetail: (pkg: PublicSkillPackage) => void
  onOpenAdvanced?: () => void
  open?: boolean
  teamSkills: UseTeamSkills
  providerRecommendationsLoading?: boolean
  providerRecommendationsResolvedCount?: number
  providerRecommendationsTotalCount?: number
  providerRecommendations: ProviderSkillRecommendation[]
  variant?: "dialog" | "inline"
}) {
  const { t } = useAppI18n()
  const isActive = variant === "inline" || open
  const skillRemoval = useTeamSkillRemoval({ teamSkills })
  const busyConfigId = skillRemoval.busySkillId
  const [activeTab, setActiveTab] = React.useState<TeamSkillManageTab>("recommendations")
  const [recommendationSourceFilter, setRecommendationSourceFilter] = React.useState<
    "all" | "configured" | "recommended"
  >("all")
  const [searchQuery, setSearchQuery] = React.useState("")
  const [marketCatalog, dispatchMarketCatalog] = React.useReducer(
    publicPackageCatalogReducer,
    initialPublicPackageCatalogState,
  )
  const [marketExactPackage, setMarketExactPackage] = React.useState<PublicSkillPackage | null>(null)
  const [marketExactLoading, setMarketExactLoading] = React.useState(false)
  const marketRequestIdRef = React.useRef(0)
  const marketRequestControllerRef = React.useRef<AbortController | null>(null)
  const marketExactRequestIdRef = React.useRef(0)
  const marketLoadedQueryRef = React.useRef<string | null>(null)
  const marketAutoLoadRequestedRef = React.useRef(false)
  const marketScrollContainerRef = React.useRef<HTMLDivElement | null>(null)
  const marketLoadMoreAnchorRef = React.useRef<HTMLDivElement | null>(null)
  const linkedPackageKeys = React.useMemo(() => createTeamSkillPackageSet(teamSkills.skills), [teamSkills.skills])
  const recommendedPlan = React.useMemo(
    () => planProviderSkillRecommendationBulkLinks(providerRecommendations, teamSkills.skills),
    [teamSkills.skills, providerRecommendations],
  )
  const recommendedTeamSkills = recommendedPlan.linkable
  const normalizedQuery = searchQuery.trim().toLowerCase()
  const marketQuery = activeTab === "market" ? searchQuery.trim() : ""
  const recommendationItems = React.useMemo(
    () =>
      buildTeamSkillRecommendationItems({
        filter: recommendationSourceFilter,
        normalizedQuery,
        providerRecommendations: recommendedTeamSkills,
        skills: teamSkills.skills,
      }),
    [normalizedQuery, teamSkills.skills, recommendationSourceFilter, recommendedTeamSkills],
  )
  const allRecommendationItems = React.useMemo(
    () =>
      buildTeamSkillRecommendationItems({
        filter: recommendationSourceFilter,
        normalizedQuery: "",
        providerRecommendations: recommendedTeamSkills,
        skills: teamSkills.skills,
      }),
    [teamSkills.skills, recommendationSourceFilter, recommendedTeamSkills],
  )
  const recommendationSourceIncludesSystem = recommendationSourceFilter !== "configured"
  const installableRecommendedSkills = React.useMemo(
    () => buildInstallableTeamRecommendationSkills({ groupById, items: allRecommendationItems }),
    [allRecommendationItems, groupById],
  )
  const marketPackages = React.useMemo(
    () => mergeMarketPackages(marketExactPackage, marketCatalog.items),
    [marketCatalog.items, marketExactPackage],
  )
  const marketLoading = marketCatalog.status === "loading" || marketCatalog.status === "refreshing"
  const marketLoadingMore = marketCatalog.status === "loading-more"
  const canLoadMoreMarket = Boolean(marketCatalog.next) && !marketLoading && !marketLoadingMore
  const shouldInstallRecommendedBatch = installableRecommendedSkills.length > 1
  const hasRecommendationItems = allRecommendationItems.length > 0
  const showInitialRecommendationSkeleton =
    providerRecommendationsLoading && recommendationSourceIncludesSystem && !hasRecommendationItems
  const showRecommendationProgress =
    providerRecommendationsLoading && recommendationSourceIncludesSystem && providerRecommendationsTotalCount > 0

  React.useEffect(() => {
    if (!marketLoadingMore) {
      marketAutoLoadRequestedRef.current = false
    }
  }, [marketLoadingMore, marketCatalog.next])

  React.useEffect(() => {
    if (!isActive) {
      return
    }
    setActiveTab("recommendations")
    setRecommendationSourceFilter("all")
    setSearchQuery("")
    marketLoadedQueryRef.current = null
    setMarketExactPackage(null)
    setMarketExactLoading(false)
  }, [isActive, teamSkills.teamId])

  const loadMarketPackages = React.useCallback(
    async (options: { clearItems?: boolean; forceRefresh?: boolean; next?: string | null; query?: string } = {}) => {
      marketRequestControllerRef.current?.abort()
      const controller = new AbortController()
      marketRequestControllerRef.current = controller
      const query = options.query?.trim() ?? ""
      const next = options.next?.trim() || undefined
      const append = Boolean(next && !options.forceRefresh)
      const requestId = marketRequestIdRef.current + 1
      marketRequestIdRef.current = requestId
      dispatchMarketCatalog({ append, clearItems: options.clearItems, requestId, type: "load-start" })

      try {
        const catalog = query
          ? await searchPublicSkillPackages({
              forceRefresh: options.forceRefresh,
              next,
              query,
              signal: controller.signal,
            })
          : await listPublicSkillPackages({
              forceRefresh: options.forceRefresh,
              next,
              signal: controller.signal,
            })
        dispatchMarketCatalog({ append, catalog, requestId, type: "load-success" })
      } catch (error) {
        if (controller.signal.aborted) {
          return
        }
        dispatchMarketCatalog({ error: errorMessage(error), requestId, type: "load-error" })
      } finally {
        if (marketRequestControllerRef.current === controller) {
          marketRequestControllerRef.current = null
        }
      }
    },
    [],
  )

  React.useEffect(
    () => () => {
      marketRequestControllerRef.current?.abort()
    },
    [],
  )

  React.useEffect(() => {
    if (!isActive || activeTab !== "market") {
      return
    }

    const load = () => {
      const clearItems = marketLoadedQueryRef.current !== marketQuery
      marketLoadedQueryRef.current = marketQuery
      void loadMarketPackages({ clearItems, query: marketQuery }).catch((error: unknown) => {
        reportRendererHandledError("team-skills", "market package load failed", error)
      })
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

    const controller = new AbortController()
    setMarketExactLoading(true)
    const timer = window.setTimeout(() => {
      void readPublicSkillPackageByName(query, controller.signal)
        .then((pkg) => {
          if (marketExactRequestIdRef.current === requestId) {
            setMarketExactPackage(pkg)
          }
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted) {
            reportRendererHandledError("team-skills", "exact market package lookup failed", error)
          }
        })
        .finally(() => {
          if (marketExactRequestIdRef.current === requestId) {
            setMarketExactLoading(false)
          }
        })
    }, 250)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [activeTab, isActive, searchQuery])

  const changeActiveTab = React.useCallback((tab: TeamSkillManageTab) => {
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
      {!teamSkills.apiEnabled ? (
        <TeamSkillDialogEmpty
          className={emptyStateClassName}
          title={t("teams.skillGuideUnavailableTitle")}
          description={t("teams.skillGuideUnavailableDescription")}
        />
      ) : teamSkills.error ? (
        <div className="grid gap-2">
          <ErrorNotice error={teamSkills.error} compact />
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void teamSkills.refresh({ forceRefresh: true })}
            >
              <RefreshCwIcon className="size-3.5" />
              {t("teams.retry")}
            </Button>
          </div>
        </div>
      ) : teamSkills.loading && !teamSkills.hasLoaded ? (
        <TeamSkillManageLoadingSkeleton inline={inline} />
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
                aria-label={t("teams.skillManageTitle")}
                className="w-max"
                onValueChange={(value) => {
                  if (value === "recommendations" || value === "market") {
                    changeActiveTab(value)
                  }
                }}
              >
                <ToggleGroupItem value="recommendations">
                  <span>{t("teams.skillManageRecommendations")}</span>
                  {installableRecommendedSkills.length > 0 ? (
                    <span className="size-2 shrink-0 rounded-full bg-[var(--success)]" aria-hidden="true" />
                  ) : null}
                  <span className="oo-text-caption-compact text-muted-foreground">{allRecommendationItems.length}</span>
                </ToggleGroupItem>
                <ToggleGroupItem value="market">
                  <span>{t("teams.skillManageMarket")}</span>
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-2 sm:min-w-80 sm:flex-row sm:items-center sm:justify-end">
              <SearchField
                className="min-w-0 flex-1"
                inputClassName="h-[var(--oo-control-height-compact)]"
                placeholder={
                  activeTab === "recommendations"
                    ? t("teams.skillManageSearchRecommendations")
                    : t("teams.skillManageSearchMarket")
                }
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.currentTarget.value)}
              />
              {activeTab === "recommendations" ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="max-w-36 min-w-28 justify-between px-2"
                    >
                      <span className="min-w-0 truncate">
                        {recommendationSourceFilter === "configured"
                          ? t("teams.skillManageConfigured")
                          : recommendationSourceFilter === "recommended"
                            ? t("teams.skillManageRecommended")
                            : t("teams.skillManageSourceAll")}
                      </span>
                      <ChevronDownIcon className="size-3.5 text-muted-foreground" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => setRecommendationSourceFilter("all")}>
                      {t("teams.skillManageSourceAll")}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setRecommendationSourceFilter("configured")}>
                      {t("teams.skillManageConfigured")}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setRecommendationSourceFilter("recommended")}>
                      {t("teams.skillManageRecommended")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
              {activeTab === "recommendations" &&
              teamSkills.canManage &&
              recommendationSourceIncludesSystem &&
              (installableRecommendedSkills.length > 1 || recommendedTeamSkills.length > 1) ? (
                <div className="inline-flex max-w-full items-center justify-end">
                  <Button
                    type="button"
                    size="sm"
                    className="min-w-0 shrink rounded-r-none"
                    disabled={Boolean(busyAction)}
                    onClick={() =>
                      shouldInstallRecommendedBatch
                        ? onInstallRuntimeSkills(installableRecommendedSkills)
                        : onAddRecommendationBatch(recommendedTeamSkills, { installRuntime: false })
                    }
                  >
                    {busyAction === "installSkillBatch" || busyAction === "addSkillBatch" ? (
                      <RefreshCwIcon className="size-3.5 animate-spin" />
                    ) : (
                      <PackageIcon className="size-3.5" />
                    )}
                    <span className="truncate">
                      {shouldInstallRecommendedBatch
                        ? t("teams.skillManageInstallMissingAll", {
                            count: installableRecommendedSkills.length,
                          })
                        : t("teams.skillManageLinkAll", { count: recommendedTeamSkills.length })}
                    </span>
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        size="sm"
                        className="-ml-px w-[var(--oo-control-height-compact)] rounded-l-none border-l border-primary-foreground/25 px-0"
                        disabled={Boolean(busyAction)}
                        aria-label={t("teams.skillManageMoreActions")}
                      >
                        <ChevronDownIcon className="size-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {installableRecommendedSkills.length > 0 ? (
                        <DropdownMenuItem
                          onSelect={() =>
                            void onAddRecommendationBatch(recommendedTeamSkills, { installRuntime: true })
                          }
                        >
                          {t("teams.skillManageAddInstallAll", { count: recommendedTeamSkills.length })}
                        </DropdownMenuItem>
                      ) : null}
                      <DropdownMenuItem
                        onSelect={() => void onAddRecommendationBatch(recommendedTeamSkills, { installRuntime: false })}
                      >
                        {t("teams.skillManageLinkAll", { count: recommendedTeamSkills.length })}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ) : activeTab === "recommendations" &&
                (!teamSkills.canManage || !recommendationSourceIncludesSystem || recommendedTeamSkills.length <= 1) &&
                installableRecommendedSkills.length > 1 ? (
                <TeamInstallMissingButton
                  busy={busyAction === "installSkillBatch"}
                  count={installableRecommendedSkills.length}
                  disabled={Boolean(busyAction)}
                  onClick={() => onInstallRuntimeSkills(installableRecommendedSkills)}
                />
              ) : null}
            </div>
          </div>
          {activeTab === "recommendations" ? (
            showInitialRecommendationSkeleton ? (
              <div className={skillListClassName}>
                <TeamSkillPackageListSkeleton />
              </div>
            ) : allRecommendationItems.length === 0 ? (
              <TeamSkillDialogEmpty
                className={emptyStateClassName}
                title={
                  recommendationSourceFilter === "recommended"
                    ? t("teams.skillManageRecommendedEmptyTitle")
                    : recommendationSourceFilter === "configured"
                      ? t("teams.skillGuideEmptyTitle")
                      : t("teams.skillManageRecommendationsEmptyTitle")
                }
                description={
                  recommendationSourceFilter === "recommended"
                    ? t("teams.skillManageRecommendedEmpty")
                    : recommendationSourceFilter === "configured"
                      ? teamSkills.canManage
                        ? t("teams.skillGuideEmptyCreatorDescription")
                        : t("teams.skillGuideEmptyDescription")
                      : t("teams.skillManageRecommendationsEmptyDescription")
                }
              />
            ) : recommendationItems.length === 0 ? (
              <TeamSkillDialogEmpty
                className={emptyStateClassName}
                title={t("teams.skillManageSearchEmptyTitle")}
                description={t("teams.skillManageSearchEmptyDescription")}
              />
            ) : (
              <div className={skillListClassName}>
                {recommendationItems.map((item) =>
                  item.type === "configured" ? (
                    <TeamSkillManageRow
                      key={item.id}
                      busy={busyConfigId === item.skill.id || busyAction === "installSkillBatch"}
                      busyAction={busyAction}
                      canManage={teamSkills.canManage}
                      groupById={groupById}
                      installBusy={
                        busyAction === `installSkill:${item.skill.packageName}:${item.skill.skillName}` ||
                        busyAction === "installSkillBatch"
                      }
                      skill={item.skill}
                      onInstallRuntime={() =>
                        onInstallRuntimeSkill({
                          packageName: item.skill.packageName,
                          skillName: item.skill.skillName,
                        })
                      }
                      onOpenManagedSkill={() => onOpenManagedSkill(item.skill.skillName)}
                      onRemove={() => skillRemoval.open(item.skill)}
                    />
                  ) : (
                    <TeamSkillRecommendationRow
                      key={item.id}
                      busyAction={busyAction}
                      canManage={teamSkills.canManage}
                      recommendation={item.recommendation}
                      onAdd={() => onAddRecommendation(item.recommendation, { installRuntime: false })}
                      onInstallRuntime={() =>
                        onInstallRuntimeSkill({
                          packageName: item.recommendation.packageName,
                          skillName: item.recommendation.skillId,
                        })
                      }
                      onOpenManagedSkill={() => onOpenManagedSkill(item.recommendation.skillId)}
                      onOpenPackageDetail={() => onOpenPackageDetail(item.recommendation.package)}
                    />
                  ),
                )}
                {showRecommendationProgress ? (
                  <div className="oo-text-caption border-t border-[var(--oo-divider)] px-3 py-2 text-muted-foreground">
                    {t("skills.teamRecommendationsResolving", {
                      resolved: providerRecommendationsResolvedCount,
                      total: providerRecommendationsTotalCount,
                    })}
                  </div>
                ) : null}
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
                    {t("teams.retry")}
                  </Button>
                </div>
              ) : null}
              {(marketLoading || marketExactLoading) && marketPackages.length === 0 ? (
                <div className={marketListClassName}>
                  <TeamSkillPackageListSkeleton />
                </div>
              ) : marketPackages.length === 0 ? (
                <TeamSkillDialogEmpty
                  className={cn("min-h-0 flex-1", emptyStateClassName)}
                  title={t("teams.skillManageMarketEmptyTitle")}
                  description={t("teams.skillManageMarketEmptyDescription")}
                />
              ) : (
                <div ref={marketScrollContainerRef} className={marketListClassName} onScroll={handleMarketScroll}>
                  {marketPackages.map((pkg) => (
                    <TeamSkillMarketRow
                      key={pkg.id}
                      busyAction={busyAction}
                      canManage={teamSkills.canManage}
                      groupById={groupById}
                      linked={teamSkillPackageLinked(linkedPackageKeys, pkg.name)}
                      pkg={pkg}
                      onAdd={(skillName) => onAddMarketPackage(pkg, { installRuntime: false, skillName })}
                      onInstallRuntime={(skillName) => onInstallRuntimeSkill({ packageName: pkg.name, skillName })}
                      onOpenManagedSkill={onOpenManagedSkill}
                      onOpenPackageDetail={() => onOpenPackageDetail(pkg)}
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
    <TeamPackageRemoveConfirmDialog
      busy={skillRemoval.target ? busyConfigId === skillRemoval.target.id : false}
      packageSkillCount={
        skillRemoval.target
          ? teamSkills.skills.filter((skill) => skill.packageName === skillRemoval.target?.packageName).length
          : 0
      }
      target={skillRemoval.target}
      onClose={skillRemoval.close}
      onConfirm={() => void skillRemoval.confirm()}
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
        ariaLabel={t("teams.skillManageTitle")}
        title={t("teams.skillManageTitle")}
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
                {t("teams.skillManageOpenAdvanced")}
              </Button>
            ) : null}
            <Button type="button" onClick={onClose}>
              {t("teams.skillManageDone")}
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
