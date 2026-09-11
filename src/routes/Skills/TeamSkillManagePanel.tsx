import type { ManagedSkillGroup, PublicSkillPackage } from "../../../electron/skills/common.ts"
import type { BusyAction } from "./team-management-model.ts"
import type { UseTeamSkills } from "@/hooks/useTeamSkills"
import type { ListPublicSkillPackagesInput } from "@/lib/skills-catalog-client"
import type { ProviderSkillRecommendation } from "@/routes/Skills/provider-skill-recommendations"

import { ArrowRightIcon, ArrowLeftIcon, CheckIcon, MonitorIcon, PlusIcon, RefreshCwIcon } from "lucide-react"
import * as React from "react"
import { createPortal } from "react-dom"
import {
  createTeamSkillPackageSet,
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
import { useSkillCatalog } from "./use-skill-catalog.ts"
import { useTeamSkillRemoval } from "./use-team-skill-removal.ts"
import { ErrorNotice } from "@/components/ErrorNotice"
import { SearchField } from "@/components/SearchField"
import { Button } from "@/components/ui/button"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useAppI18n } from "@/i18n"
import { reportRendererHandledError } from "@/lib/renderer-diagnostics"
import { getSkillCatalogInvalidationRevision, subscribeSkillCatalogInvalidation } from "@/lib/skill-catalog-cache"
import {
  listPublicSkillPackages,
  readPublicSkillPackageByName,
  searchPublicSkillPackages,
} from "@/lib/skills-catalog-client"
import { resolveUserFacingError } from "@/lib/user-facing-error"
import { cn } from "@/lib/utils"
import { getTeamSkillRuntimeStatus, isNearScrollBottom } from "@/routes/Skills/skill-route-model"

type TeamSkillManageTab = "market" | "recommendations"

export { TeamSkillManageLoadingSkeleton, RuntimeSkillRemoveConfirmDialog } from "./TeamSkillManageRows.tsx"

export function TeamSkillManagePanel({
  actionsContainer,
  busyAction,
  runtimeInventoryLoading = false,
  groupById,
  onAddRecommendation,
  onAddMarketPackage,
  onInstallRuntimeSkill,
  onInstallRuntimeSkills,
  onOpenManagedSkill,
  onOpenPackageDetail,
  teamSkills,
  providerRecommendationsLoading = false,
  providerRecommendationsResolvedCount = 0,
  providerRecommendationsTotalCount = 0,
  providerRecommendations,
}: {
  actionsContainer?: HTMLElement | null
  runtimeInventoryLoading?: boolean
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
  onInstallRuntimeSkill: (skill: { packageName: string; skillName: string }) => void
  onInstallRuntimeSkills: (skills: readonly { packageName: string; skillName: string }[]) => void
  onOpenManagedSkill: (skillName: string) => void
  onOpenPackageDetail: (pkg: PublicSkillPackage) => void
  teamSkills: UseTeamSkills
  providerRecommendationsLoading?: boolean
  providerRecommendationsResolvedCount?: number
  providerRecommendationsTotalCount?: number
  providerRecommendations: ProviderSkillRecommendation[]
}) {
  const { t } = useAppI18n()
  const catalogRevision = React.useSyncExternalStore(
    subscribeSkillCatalogInvalidation,
    getSkillCatalogInvalidationRevision,
  )
  const skillRemoval = useTeamSkillRemoval({ teamSkills })
  const busyConfigId = skillRemoval.busySkillId
  const [catalogTab, setActiveTab] = React.useState<TeamSkillManageTab>("recommendations")
  const [addingSkills, setAddingSkills] = React.useState(false)
  const adding = addingSkills
  const activeTab = adding ? catalogTab : "recommendations"
  const addBackRef = React.useRef<HTMLButtonElement>(null)
  const addButtonRef = React.useRef<HTMLButtonElement>(null)
  const wasAddingRef = React.useRef(false)
  React.useEffect(() => {
    if (adding) addBackRef.current?.focus()
    else if (wasAddingRef.current) addButtonRef.current?.focus()
    wasAddingRef.current = adding
  }, [adding])
  const recommendationSourceFilter = adding ? "recommended" : "all"
  const [searchQuery, setSearchQuery] = React.useState("")
  const [marketExactPackage, setMarketExactPackage] = React.useState<PublicSkillPackage | null>(null)
  const [marketExactLoading, setMarketExactLoading] = React.useState(false)
  const marketExactRequestIdRef = React.useRef(0)
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
  const marketQuery = adding && activeTab === "market" ? searchQuery.trim() : ""
  const loadMarket = React.useCallback(
    (input: ListPublicSkillPackagesInput) =>
      marketQuery ? searchPublicSkillPackages({ ...input, query: marketQuery }) : listPublicSkillPackages(input),
    [marketQuery],
  )
  const { catalog: marketCatalog, loadPage: loadMarketPackages } = useSkillCatalog({
    enabled: adding && activeTab === "market",
    load: loadMarket,
    debounceMs: marketQuery ? 300 : 0,
  })
  const recommendationItems = React.useMemo(
    () =>
      buildTeamSkillRecommendationItems({
        filter: recommendationSourceFilter,
        normalizedQuery,
        providerRecommendations,
        skills: teamSkills.skills,
      }),
    [normalizedQuery, teamSkills.skills, recommendationSourceFilter, providerRecommendations],
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
  const recommendationSourceIncludesSystem = true
  const installableRecommendedSkills = React.useMemo(
    () =>
      buildInstallableTeamRecommendationSkills({
        groupById,
        items: adding ? allRecommendationItems : allRecommendationItems.filter((item) => item.type === "configured"),
      }),
    [adding, allRecommendationItems, groupById],
  )
  const marketPackages = React.useMemo(
    () => mergeMarketPackages(marketExactPackage, marketCatalog.items),
    [marketCatalog.items, marketExactPackage],
  )
  const marketLoading = marketCatalog.status === "loading" || marketCatalog.status === "refreshing"
  const marketLoadingMore = marketCatalog.status === "loading-more"
  const canLoadMoreMarket =
    activeTab === "market" && Boolean(marketCatalog.next) && !marketLoading && !marketLoadingMore
  const installedCount = teamSkills.skills.filter((skill) => {
    const status = getTeamSkillRuntimeStatus(groupById, skill).state
    return status === "installed-same" || status === "installed-modified" || status === "installed-version-mismatch"
  }).length
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
    setActiveTab("recommendations")
    setAddingSkills(false)
    setSearchQuery("")
    setMarketExactPackage(null)
    setMarketExactLoading(false)
  }, [teamSkills.teamId])

  React.useEffect(() => {
    const query = searchQuery.trim()
    const requestId = marketExactRequestIdRef.current + 1
    marketExactRequestIdRef.current = requestId
    setMarketExactPackage(null)
    setMarketExactLoading(false)

    if (activeTab !== "market" || !looksLikeSkillPackageName(query)) {
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
  }, [activeTab, searchQuery, catalogRevision])

  const changeActiveTab = React.useCallback((tab: TeamSkillManageTab) => {
    setActiveTab(tab)
    setSearchQuery("")
  }, [])

  const requestNextMarketPage = React.useCallback(() => {
    if (!canLoadMoreMarket || marketAutoLoadRequestedRef.current) {
      return
    }

    marketAutoLoadRequestedRef.current = true
    void loadMarketPackages({ next: marketCatalog.next })
  }, [canLoadMoreMarket, loadMarketPackages, marketCatalog.next])

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

  const emptyStateClassName = "m-3 border-0 bg-transparent"
  const skillListClassName = "min-h-0 overflow-y-auto bg-background pb-3"
  const marketListClassName = "min-h-0 flex-1 overflow-y-auto bg-background pb-3"

  const actions = (
    <div className="flex flex-wrap items-center gap-2">
      {teamSkills.canManage ? (
        <Button
          ref={addButtonRef}
          size="sm"
          disabled={Boolean(busyAction) || !teamSkills.apiEnabled || !teamSkills.hasLoaded || Boolean(teamSkills.error)}
          onClick={() => {
            setAddingSkills(true)
            changeActiveTab("recommendations")
          }}
        >
          <PlusIcon data-icon="inline-start" />
          {t("teams.addSkillsTitle")}
        </Button>
      ) : null}
      <Button
        ref={teamSkills.canManage ? undefined : addButtonRef}
        disabled={Boolean(busyAction) || !teamSkills.apiEnabled || !teamSkills.hasLoaded || Boolean(teamSkills.error)}
        variant="outline"
        size="sm"
        onClick={() => {
          setAddingSkills(true)
          changeActiveTab("market")
        }}
      >
        {t("teams.skillManageMarket")}
        <ArrowRightIcon data-icon="inline-end" />
      </Button>
    </div>
  )
  const content = (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {adding ? (
        <div className="flex shrink-0 flex-col items-start gap-2">
          <Button
            ref={addBackRef}
            variant="ghost"
            size="sm"
            onClick={() => {
              setAddingSkills(false)
              changeActiveTab("recommendations")
            }}
          >
            <ArrowLeftIcon data-icon="inline-start" />
            {t("teams.backToSkills")}
          </Button>
          <p className="oo-text-caption text-muted-foreground">
            {t(teamSkills.canManage ? "teams.addSkillsDescription" : "teams.browseSkillsDescription")}
          </p>
        </div>
      ) : actionsContainer ? (
        createPortal(actions, actionsContainer)
      ) : (
        <div className="flex shrink-0 justify-end">{actions}</div>
      )}
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
      ) : (teamSkills.loading && !teamSkills.hasLoaded) || runtimeInventoryLoading ? (
        <TeamSkillManageLoadingSkeleton inline />
      ) : (
        <div
          className={cn(
            "grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)]",
            !adding && teamSkills.skills.length === 0 ? "gap-0" : "gap-3",
          )}
        >
          {adding ? (
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                value={activeTab}
                aria-label={t(teamSkills.canManage ? "teams.addSkillsTitle" : "teams.browseSkillsTitle")}
                onValueChange={(value) => {
                  if (value === "recommendations" || value === "market") changeActiveTab(value)
                }}
              >
                <ToggleGroupItem value="recommendations">{t("teams.skillManageRecommended")}</ToggleGroupItem>
                <ToggleGroupItem value="market">{t("teams.skillManageMarket")}</ToggleGroupItem>
              </ToggleGroup>
              <SearchField
                className="min-w-0 sm:max-w-sm sm:flex-1"
                inputClassName="h-[var(--oo-control-height-compact)]"
                placeholder={t(
                  activeTab === "recommendations"
                    ? "teams.skillManageSearchRecommendations"
                    : "teams.skillManageSearchMarket",
                )}
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.currentTarget.value)}
              />
            </div>
          ) : teamSkills.skills.length > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-muted/50 px-3 py-2.5">
              <span className="oo-text-caption flex items-center gap-2 text-muted-foreground">
                <MonitorIcon className="size-4" />
                {t("teams.localSkillsCount", { installed: installedCount, total: teamSkills.skills.length })}
              </span>
              {installableRecommendedSkills.length > 0 ? (
                <TeamInstallMissingButton
                  busy={busyAction === "installSkillBatch"}
                  count={installableRecommendedSkills.length}
                  disabled={Boolean(busyAction)}
                  onClick={() => onInstallRuntimeSkills(installableRecommendedSkills)}
                />
              ) : installedCount === teamSkills.skills.length ? (
                <span className="oo-text-caption flex items-center gap-1.5 text-muted-foreground">
                  <CheckIcon className="size-4" />
                  {t("teams.localSkillsComplete")}
                </span>
              ) : null}
            </div>
          ) : (
            <div />
          )}
          {activeTab === "recommendations" ? (
            showInitialRecommendationSkeleton ? (
              <div className={skillListClassName}>
                <TeamSkillPackageListSkeleton />
              </div>
            ) : allRecommendationItems.length === 0 ? (
              <TeamSkillDialogEmpty
                className={emptyStateClassName}
                title={t("teams.skillManageRecommendationsEmptyTitle")}
                action={
                  !adding ? (
                    <Button
                      variant="outline"
                      onClick={() => {
                        setAddingSkills(true)
                        setSearchQuery("")
                      }}
                    >
                      {t("teams.browseSkillsTitle")}
                    </Button>
                  ) : undefined
                }
                description={t("teams.skillManageRecommendationsEmptyDescription")}
              />
            ) : recommendationItems.length === 0 ? (
              <TeamSkillDialogEmpty
                className={emptyStateClassName}
                title={t("teams.skillManageSearchEmptyTitle")}
                description={t("teams.skillManageSearchEmptyDescription")}
              />
            ) : (
              <div className={skillListClassName}>
                {recommendationItems.map((item, index) => (
                  <React.Fragment key={item.id}>
                    {index === 0 || recommendationItems[index - 1]?.type !== item.type ? (
                      <h2 className="oo-text-label py-2 text-muted-foreground">
                        {t(item.type === "configured" ? "teams.sharedSkillsGroup" : "teams.skillManageRecommended")}
                      </h2>
                    ) : null}
                    {item.type === "configured" ? (
                      <TeamSkillManageRow
                        key={item.id}
                        busy={busyConfigId === item.skill.id || busyAction === "installSkillBatch"}
                        actionsDisabled={Boolean(busyAction)}
                        canManage={teamSkills.canManage}
                        groupById={groupById}
                        installBusy={
                          busyAction === `installSkill:${item.skill.packageName}:${item.skill.skillName}` ||
                          busyAction === "installSkillBatch"
                        }
                        skill={item.skill}
                        onInstallRuntime={onInstallRuntimeSkill}
                        onOpenManagedSkill={onOpenManagedSkill}
                        onRemove={skillRemoval.open}
                      />
                    ) : (
                      <TeamSkillRecommendationRow
                        key={item.id}
                        addBusy={
                          busyAction === "addSkillBatch" ||
                          busyAction === `addSkill:${item.recommendation.packageName}:${item.recommendation.skillId}`
                        }
                        installBusy={
                          busyAction === "installSkillBatch" ||
                          busyAction ===
                            `installSkill:${item.recommendation.packageName}:${item.recommendation.skillId}`
                        }
                        actionsDisabled={Boolean(busyAction)}
                        canManage={adding && teamSkills.canManage}
                        compact
                        selectionOnly={adding && teamSkills.canManage}
                        recommendation={item.recommendation}
                        onAdd={onAddRecommendation}
                        onInstallRuntime={onInstallRuntimeSkill}
                        onOpenManagedSkill={onOpenManagedSkill}
                        onOpenPackageDetail={onOpenPackageDetail}
                      />
                    )}
                  </React.Fragment>
                ))}
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
                    onClick={() => void loadMarketPackages({ replace: true, forceRefresh: true })}
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
                      selectionOnly={teamSkills.canManage}
                      pkg={pkg}
                      onAdd={onAddMarketPackage}
                      onInstallRuntime={onInstallRuntimeSkill}
                      onOpenManagedSkill={onOpenManagedSkill}
                      onOpenPackageDetail={onOpenPackageDetail}
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
      {!adding ? (
        <p className="oo-text-caption-compact shrink-0 text-muted-foreground">{t("teams.skillsCredentialNote")}</p>
      ) : null}
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

  return (
    <>
      {content}
      {removeRecommendationDialog}
    </>
  )
}
