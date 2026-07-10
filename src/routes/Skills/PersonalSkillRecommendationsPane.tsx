import type { BusyAction } from "./organization-management-model.ts"
import type { ProviderSkillRecommendation } from "./provider-skill-recommendations.ts"

import * as React from "react"
import { providerRecommendationMatchesQuery } from "./organization-skill-manage-helpers.ts"
import { SkillListRow } from "./SkillListRow.tsx"
import { SkillIconFrame } from "./SkillUiParts.tsx"
import { AppIcons } from "@/components/AppIcons"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useAppI18n } from "@/i18n"

interface PersonalSkillRecommendationsPaneProps {
  busyAction: BusyAction | null
  isLoading: boolean
  onInstallRuntimeSkill: (skill: { packageName: string; skillName: string }) => void
  query: string
  recommendations: ProviderSkillRecommendation[]
}

/** 个人空间：根据已连接的服务推荐但尚未装入 Wanta runtime 的 Skill。 */
export function PersonalSkillRecommendationsPane({
  busyAction,
  isLoading,
  onInstallRuntimeSkill,
  query,
  recommendations,
}: PersonalSkillRecommendationsPaneProps) {
  const { t } = useAppI18n()
  const normalizedQuery = query.trim().toLowerCase()
  const filteredRecommendations = React.useMemo(
    () =>
      recommendations.filter((recommendation) => providerRecommendationMatchesQuery(recommendation, normalizedQuery)),
    [normalizedQuery, recommendations],
  )
  return (
    <div className="min-h-0 overflow-auto px-3 py-3">
      <div className="grid gap-3 pr-1">
        {isLoading ? (
          <PersonalSkillRecommendationListSkeleton />
        ) : filteredRecommendations.length === 0 ? (
          <PersonalSkillRecommendationsEmpty query={normalizedQuery} />
        ) : (
          <div className="overflow-hidden rounded-md border bg-background">
            {filteredRecommendations.map((recommendation) => {
              const installBusy =
                busyAction === `installSkill:${recommendation.packageName}:${recommendation.skillId}` ||
                busyAction === "installSkillBatch"

              return (
                <SkillListRow
                  key={`${recommendation.service}:${recommendation.packageName}:${recommendation.skillId}`}
                  icon={
                    <SkillIconFrame icon={recommendation.package.icon} className="size-9" iconClassName="size-4.5" />
                  }
                  title={recommendation.package.displayName}
                  subtitle={
                    <span className="min-w-0 truncate" title={recommendation.providerDisplayName}>
                      {recommendation.providerDisplayName}
                    </span>
                  }
                  description={recommendationSkillDescription(recommendation)}
                  badges={<Badge variant="secondary">{t("skills.personalRecommendationsBadge")}</Badge>}
                  meta={
                    <div
                      className="min-w-0 truncate"
                      title={`${recommendation.packageName} · ${recommendation.skillId}`}
                    >
                      {recommendation.packageName} · {recommendation.skillId}
                    </div>
                  }
                  actions={
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={Boolean(busyAction && !installBusy) || installBusy}
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
                      {installBusy ? t("skills.registryInstalling") : t("organizations.skillManageInstallRuntime")}
                    </Button>
                  }
                  onSelect={() =>
                    onInstallRuntimeSkill({
                      packageName: recommendation.packageName,
                      skillName: recommendation.skillId,
                    })
                  }
                />
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function recommendationSkillDescription(recommendation: ProviderSkillRecommendation): string | undefined {
  return (
    recommendation.package.skills.find((skill) => skill.name === recommendation.skillId)?.description ??
    recommendation.package.description
  )
}

function PersonalSkillRecommendationsEmpty({ query }: { query: string }) {
  const { t } = useAppI18n()
  const hasQuery = Boolean(query)

  return (
    <div className="grid min-h-36 place-items-center rounded-md border border-dashed bg-muted/20 px-4 py-8 text-center">
      <div className="grid max-w-md justify-items-center gap-2">
        <div className="grid size-10 place-items-center rounded-md border bg-background text-muted-foreground">
          <AppIcons.action.installPackage className="size-5" />
        </div>
        <div className="oo-text-label text-foreground">
          {hasQuery ? t("skills.personalRecommendationsSearchEmpty") : t("skills.personalRecommendationsEmpty")}
        </div>
        <p className="oo-text-caption text-muted-foreground">
          {hasQuery
            ? t("skills.personalRecommendationsSearchEmptyDescription")
            : t("skills.personalRecommendationsEmptyDescription")}
        </p>
      </div>
    </div>
  )
}

function PersonalSkillRecommendationListSkeleton() {
  return (
    <div className="overflow-hidden rounded-md border bg-background">
      {Array.from({ length: 4 }).map((_, index) => (
        <div
          key={index}
          className="grid min-w-0 gap-2 border-b border-[var(--oo-divider)] px-3 py-2.5 last:border-b-0 md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
        >
          <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-3">
            <Skeleton className="size-9 rounded-md" />
            <div className="grid min-w-0 gap-1.5">
              <div className="flex min-w-0 items-center gap-2">
                <Skeleton className="h-4 w-32 rounded-md" />
                <Skeleton className="h-5 w-16 rounded-md" />
              </div>
              <Skeleton className="h-3.5 w-56 max-w-full rounded-md" />
              <Skeleton className="h-3 w-48 max-w-full rounded-md" />
            </div>
          </div>
          <Skeleton className="h-[var(--oo-control-height-compact)] w-24 rounded-md" />
        </div>
      ))}
    </div>
  )
}
