import type { ManagedSkillGroup, PublicSkillPackage } from "../../../electron/skills/common.ts"
import type { BusyAction } from "./organization-management-model.ts"
import type { UseOrganizationSkills } from "@/hooks/useOrganizationSkills"
import type { ProviderSkillRecommendation } from "@/routes/Skills/provider-skill-recommendations"
import type { RuntimeSkillRemoveTarget } from "@/routes/Skills/skill-route-model"

import { ChevronDownIcon, PackageIcon, RefreshCwIcon } from "lucide-react"
import * as React from "react"
import { toast } from "sonner"
import {
  createOrganizationSkillPackageSet,
  errorMessage,
  organizationSkillPackageLinked,
  planOrganizationSkillBulkLinks,
} from "./organization-management-model.ts"
import {
  looksLikeSkillPackageName,
  mergeMarketPackages,
  organizationSkillMatchesQuery,
  providerRecommendationMatchesQuery,
} from "./organization-skill-manage-helpers.ts"
import {
  OrganizationRecommendationRemoveConfirmDialog,
  OrganizationSkillDialogEmpty,
  OrganizationSkillManageLoadingSkeleton,
  OrganizationSkillManageRow,
  OrganizationSkillMarketRow,
  OrganizationSkillPackageListSkeleton,
  OrganizationSkillRecommendationRow,
} from "./OrganizationSkillManageRows.tsx"
import { ErrorNotice } from "@/components/ErrorNotice"
import { SearchField } from "@/components/SearchField"
import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
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
  initialPublicPackageCatalogState,
  isNearScrollBottom,
  publicPackageCatalogReducer,
} from "@/routes/Skills/skill-route-model"

type OrganizationSkillManageTab = "configured" | "market" | "recommended"

export {
  OrganizationSkillManageLoadingSkeleton,
  RuntimeSkillRemoveConfirmDialog,
} from "./OrganizationSkillManageRows.tsx"

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
