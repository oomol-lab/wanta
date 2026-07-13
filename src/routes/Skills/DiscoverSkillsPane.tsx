import type { PublicSkillPackage } from "../../../electron/skills/common.ts"
import type { ProviderSkillRecommendation } from "./provider-skill-recommendations.ts"
import type { DiscoverSkillFilter, ManagedSkillGroupById } from "./skill-route-model.ts"

import * as React from "react"
import { PublicSkillPackageSheet } from "./PublicSkillPackageSheet.tsx"
import {
  canInstallPublicSkill,
  getPublicPackageInstallState,
  getPublicPackageMetaLine,
  getPublicPackagePrimaryInstallSkill,
  getPublicPackagePrimarySkill,
  getPublicSkillInstallActionLabel,
  getPublicSkillInstallKey,
  getPublicSkillInstallStateLabel,
  shouldPreloadNextSkillPage,
  shouldOpenPublicSkillManagement,
} from "./skill-route-model.ts"
import { SkillErrorNotice } from "./SkillErrorNotice.tsx"
import { SkillListRow } from "./SkillListRow.tsx"
import { SkillIconFrame, SkillPageScrollArea } from "./SkillUiParts.tsx"
import { AppIcons } from "@/components/AppIcons"
import { SkeletonText } from "@/components/LoadingSkeletons"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useAppI18n } from "@/i18n"

interface DiscoverSkillsPaneProps {
  error: string | null
  filter: DiscoverSkillFilter
  groupById: ManagedSkillGroupById
  installingKey: string | null
  isLoading: boolean
  isLoadingMore: boolean
  isSignedIn: boolean
  locale: string
  next: string | null
  onClosePackage: () => void
  onInstall: (pkg: PublicSkillPackage, skillName?: string) => void
  onLoadMore: () => void
  onOpenManagedSkill: (skillName: string) => void
  onOpenOrganizationRecommendations?: () => void
  onRetry: () => void
  onSelectPackage: (pkg: PublicSkillPackage) => void
  packages: PublicSkillPackage[]
  providerRecommendations: ProviderSkillRecommendation[]
  selectedPackage: PublicSkillPackage | undefined
}

function ProviderSkillRecommendationNotice({
  count,
  onOpenOrganizationRecommendations,
}: {
  count: number
  onOpenOrganizationRecommendations: () => void
}) {
  const { t } = useAppI18n()

  return (
    <div className="flex min-w-0 items-center justify-between gap-3 rounded-md border bg-muted/20 px-3 py-2">
      <div className="grid min-w-0 gap-0.5">
        <div className="oo-text-label min-w-0 truncate">
          {t("skills.providerRecommendationsTitle")}
          <span className="font-normal text-muted-foreground">
            {" · "}
            {t("skills.providerRecommendationsCount", { count })}
          </span>
        </div>
        <div className="oo-text-caption-compact min-w-0 truncate text-muted-foreground">
          {t("skills.providerRecommendationsMarketHint")}
        </div>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="shrink-0"
        onClick={onOpenOrganizationRecommendations}
      >
        {t("skills.providerRecommendationsOpenOrganization")}
      </Button>
    </div>
  )
}

export function DiscoverSkillsPane({
  error,
  filter,
  groupById,
  installingKey,
  isLoading,
  isLoadingMore,
  isSignedIn,
  locale,
  next,
  onClosePackage,
  onInstall,
  onLoadMore,
  onOpenManagedSkill,
  onOpenOrganizationRecommendations,
  onRetry,
  onSelectPackage,
  packages,
  providerRecommendations,
  selectedPackage,
}: DiscoverSkillsPaneProps) {
  const { t } = useAppI18n()
  const autoLoadRequestedRef = React.useRef(false)
  const canLoadMore = Boolean(next) && !isLoading && !isLoadingMore && packages.length > 0

  React.useEffect(() => {
    if (!isLoadingMore) {
      autoLoadRequestedRef.current = false
    }
  }, [isLoadingMore, next])

  const handleScroll = React.useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      if (!canLoadMore || autoLoadRequestedRef.current || !shouldPreloadNextSkillPage(event.currentTarget)) {
        return
      }

      autoLoadRequestedRef.current = true
      onLoadMore()
    },
    [canLoadMore, onLoadMore],
  )

  return (
    <SkillPageScrollArea onScroll={handleScroll}>
      <div className="grid gap-3">
        {onOpenOrganizationRecommendations && providerRecommendations.length > 0 ? (
          <ProviderSkillRecommendationNotice
            count={providerRecommendations.length}
            onOpenOrganizationRecommendations={onOpenOrganizationRecommendations}
          />
        ) : null}
        {error ? (
          <div className="flex min-w-0 items-start gap-2">
            <SkillErrorNotice className="min-w-0 flex-1" error={error} />
            <Button type="button" variant="outline" size="sm" disabled={isLoading} onClick={onRetry}>
              {isLoading ? (
                <AppIcons.status.loading className="size-3.5 animate-spin" />
              ) : (
                <AppIcons.action.refresh className="size-3.5" />
              )}
              {t("skills.retry")}
            </Button>
          </div>
        ) : null}
        {isLoading && packages.length === 0 ? (
          <PublicSkillListSkeleton />
        ) : packages.length === 0 ? (
          <div className="oo-text-body oo-text-muted px-1 py-3">
            {filter === "mine"
              ? isSignedIn
                ? t("skills.discoverMineEmpty")
                : t("skills.discoverMineSignedOut")
              : t("skills.discoverEmpty")}
          </div>
        ) : (
          <div className="overflow-hidden rounded-md border bg-background">
            {packages.map((pkg) => (
              <PublicSkillPackageRow
                key={pkg.id}
                groupById={groupById}
                installingKey={installingKey}
                pkg={pkg}
                selected={selectedPackage?.id === pkg.id}
                onInstall={(skillName) => onInstall(pkg, skillName)}
                onOpenManagedSkill={onOpenManagedSkill}
                onSelect={() => onSelectPackage(pkg)}
              />
            ))}
          </div>
        )}
        {next ? (
          <div className="flex min-h-12 items-center justify-center py-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isLoading || isLoadingMore}
              onClick={onLoadMore}
            >
              {isLoadingMore ? <AppIcons.status.loading className="animate-spin" /> : null}
              {isLoadingMore ? t("skills.discoverLoadingMore") : t("skills.discoverLoadMore")}
            </Button>
          </div>
        ) : null}
      </div>

      {selectedPackage ? (
        <PublicSkillPackageSheet
          installingKey={installingKey}
          groupById={groupById}
          locale={locale}
          pkg={selectedPackage}
          onClose={onClosePackage}
          onInstall={onInstall}
          onOpenManagedSkill={onOpenManagedSkill}
        />
      ) : null}
    </SkillPageScrollArea>
  )
}

function PublicSkillListSkeleton() {
  return (
    <div className="overflow-hidden rounded-md border bg-background">
      {Array.from({ length: 6 }).map((_, index) => (
        <div
          key={index}
          className="grid min-w-0 gap-2 border-b border-[var(--oo-divider)] px-3 py-2.5 last:border-b-0 md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
        >
          <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-3">
            <Skeleton className="size-9 rounded-md" />
            <div className="grid min-w-0 gap-1.5">
              <div className="flex min-w-0 items-center gap-2">
                <SkeletonText className="h-4 w-36" />
                <SkeletonText className="h-5 w-16 rounded-md" />
              </div>
              <SkeletonText className="h-3 w-56 max-w-full" />
              <SkeletonText className="h-3 w-72 max-w-full" />
              <SkeletonText className="h-3 w-32 max-w-full" />
            </div>
          </div>
          <Skeleton className="h-[var(--oo-control-height-compact)] w-24 rounded-md" />
        </div>
      ))}
    </div>
  )
}

interface PublicSkillPackageRowProps {
  groupById: ManagedSkillGroupById
  installingKey: string | null
  onInstall: (skillName?: string) => void
  onOpenManagedSkill: (skillName: string) => void
  onSelect: () => void
  pkg: PublicSkillPackage
  selected: boolean
}

function PublicSkillPackageRow({
  groupById,
  installingKey,
  onInstall,
  onOpenManagedSkill,
  onSelect,
  pkg,
  selected,
}: PublicSkillPackageRowProps) {
  const { t } = useAppI18n()
  const primarySkill = getPublicPackagePrimarySkill(pkg)
  const primaryInstallSkill = getPublicPackagePrimaryInstallSkill(groupById, pkg)
  const state = getPublicPackageInstallState(groupById, pkg)
  const isInstalling = installingKey === getPublicSkillInstallKey(pkg, primaryInstallSkill?.name)
  const stateBadge =
    state === "name-conflict" || state === "unavailable" ? (
      <Badge variant="outline">{getPublicSkillInstallStateLabel(state, t)}</Badge>
    ) : null

  return (
    <SkillListRow
      icon={<SkillIconFrame icon={pkg.icon} className="size-9" iconClassName="size-4.5" />}
      selected={selected}
      title={pkg.displayName}
      subtitle={
        <span className="min-w-0 truncate" title={pkg.name}>
          {pkg.name}
        </span>
      }
      description={pkg.description}
      badges={stateBadge}
      meta={
        <div className="min-w-0 truncate" title={getPublicPackageMetaLine(pkg, t)}>
          {getPublicPackageMetaLine(pkg, t)}
        </div>
      }
      actions={
        state === "name-conflict" && primarySkill ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => onOpenManagedSkill(primarySkill.name)}>
            {t("skills.discoverOpenManage")}
          </Button>
        ) : state === "installed" && primarySkill ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => onOpenManagedSkill(primarySkill.name)}>
            {t("skills.installedManage")}
          </Button>
        ) : canInstallPublicSkill(state) ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isInstalling}
            onClick={() => onInstall(primaryInstallSkill?.name)}
          >
            {isInstalling ? <AppIcons.status.loading className="animate-spin" /> : <AppIcons.action.installPackage />}
            {isInstalling ? t("skills.registryInstalling") : getPublicSkillInstallActionLabel(state, t)}
          </Button>
        ) : null
      }
      onSelect={() => {
        if (primarySkill && shouldOpenPublicSkillManagement(state)) {
          onOpenManagedSkill(primarySkill.name)
          return
        }
        onSelect()
      }}
    />
  )
}
