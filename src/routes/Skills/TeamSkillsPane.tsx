import type { ProviderSkillRecommendation } from "./provider-skill-recommendations.ts"
import type { ManagedSkillGroupById } from "./skill-route-model.ts"
import type { TeamSkillFilter } from "./SkillPageHeader.tsx"
import type { BusyAction } from "./team-management-model.ts"
import type { TeamSkillRecommendationItem } from "./team-skill-manage-helpers.ts"
import type { UseTeamSkills } from "@/hooks/useTeamSkills"
import type { UseTeamWorkspace } from "@/hooks/useTeamWorkspace"

import * as React from "react"
import {
  getTeamSkillRuntimeStatus,
  getPublicSkillInstallStateLabel,
  getSkillRowStatusBadgeClassName,
} from "./skill-route-model.ts"
import { SkillListRow } from "./SkillListRow.tsx"
import { SkillIconFrame, SkillManagementSheet, SkillPageScrollArea } from "./SkillUiParts.tsx"
import { planProviderSkillRecommendationBulkLinks } from "./team-management-model.ts"
import {
  buildTeamSkillRecommendationItems,
  canInstallProviderRecommendationRuntime,
  canOpenManagedTeamSkill,
  canOpenManagedProviderRecommendation,
  teamRuntimeStatusLabel,
  teamRuntimeStatusTone,
  providerRecommendationSkillDescription,
  shouldOpenTeamSkillManagement,
  shouldShowTeamRuntimeStatusOnCard,
} from "./team-skill-manage-helpers.ts"
import { TeamPackageRemoveConfirmDialog } from "./TeamSkillManageRows.tsx"
import { useTeamSkillRemoval } from "./use-team-skill-removal.ts"
import { AppIcons } from "@/components/AppIcons"
import { ErrorNotice } from "@/components/ErrorNotice"
import { InspectorCard, InspectorInsetCard } from "@/components/InspectorPanel"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useAppI18n } from "@/i18n"
import { resolveUserFacingError } from "@/lib/user-facing-error"
import { cn } from "@/lib/utils"

interface TeamSkillsPaneProps {
  busyAction: BusyAction | null
  groupById: ManagedSkillGroupById
  onAddRecommendation: (
    recommendation: ProviderSkillRecommendation,
    options: { installRuntime: boolean },
  ) => Promise<void>
  onInstallRuntimeSkill: (skill: { packageName: string; skillName: string }) => void
  onOpenManagedSkill: (skillName: string) => void
  teamFilter: TeamSkillFilter
  teamQuery: string
  teamSkills: UseTeamSkills
  providerRecommendationsLoading: boolean
  providerRecommendationsPendingCount: number
  providerRecommendations: ProviderSkillRecommendation[]
  providerRecommendationsTotalCount: number
  workspace: UseTeamWorkspace
}

export function TeamSkillsPane({
  busyAction,
  groupById,
  onAddRecommendation,
  onInstallRuntimeSkill,
  onOpenManagedSkill,
  teamFilter,
  teamQuery,
  teamSkills,
  providerRecommendationsLoading,
  providerRecommendationsPendingCount,
  providerRecommendations,
  providerRecommendationsTotalCount,
  workspace,
}: TeamSkillsPaneProps) {
  const { t } = useAppI18n()
  const canManage = workspace.activeWorkspace.canManage
  const [selectedItemId, setSelectedItemId] = React.useState<string | null>(null)
  const openManagedSkill = React.useCallback(
    (skillName: string) => {
      setSelectedItemId(null)
      onOpenManagedSkill(skillName)
    },
    [onOpenManagedSkill],
  )

  const activeTeamId = workspace.activeWorkspace.teamId
  const selectedTeamSkills = teamSkills.teamId === activeTeamId ? teamSkills : null
  const skillRemoval = useTeamSkillRemoval({
    onRemoved: () => setSelectedItemId(null),
    teamSkills: selectedTeamSkills,
  })
  const busyConfigId = skillRemoval.busySkillId

  React.useEffect(() => {
    setSelectedItemId(null)
  }, [activeTeamId])

  const normalizedQuery = teamQuery.trim().toLowerCase()
  const recommendationLookupLoading = providerRecommendationsLoading && teamFilter !== "configured"
  const recommendedPlan = selectedTeamSkills
    ? planProviderSkillRecommendationBulkLinks(providerRecommendations, selectedTeamSkills.skills)
    : null
  const recommendedTeamSkills = recommendedPlan?.linkable ?? []
  const filteredTeamItems = selectedTeamSkills
    ? buildTeamSkillRecommendationItems({
        filter: teamFilter,
        normalizedQuery,
        providerRecommendations: recommendedTeamSkills,
        skills: selectedTeamSkills.skills,
      })
    : []
  const selectedTeamItem = selectedItemId ? filteredTeamItems.find((item) => item.id === selectedItemId) : undefined

  return (
    <SkillPageScrollArea>
      {selectedTeamSkills ? (
        <div className="grid gap-3">
          {selectedTeamSkills.error ? (
            <div className="flex min-w-0 items-start gap-2">
              <ErrorNotice
                error={resolveUserFacingError(selectedTeamSkills.error, { area: "skills" })}
                compact
                className="min-w-0 flex-1"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={selectedTeamSkills.loading}
                onClick={() => void selectedTeamSkills.refresh({ forceRefresh: true })}
              >
                {selectedTeamSkills.loading ? (
                  <AppIcons.status.loading className="animate-spin" />
                ) : (
                  <AppIcons.action.refresh />
                )}
                {t("teams.retry")}
              </Button>
            </div>
          ) : null}
          {selectedTeamSkills.loading && !selectedTeamSkills.hasLoaded ? (
            <TeamSkillListSkeleton />
          ) : recommendationLookupLoading && filteredTeamItems.length === 0 ? (
            <TeamSkillListSkeleton />
          ) : filteredTeamItems.length === 0 ? (
            <TeamRecommendationEmptyState
              description={
                normalizedQuery
                  ? t("skills.teamSearchEmptyDescription")
                  : teamFilter === "recommended"
                    ? t("teams.skillManageRecommendedEmpty")
                    : teamFilter === "configured"
                      ? t("skills.teamEmptyDescription")
                      : t("teams.skillManageRecommendationsEmptyDescription")
              }
              title={
                normalizedQuery
                  ? t("skills.teamSearchEmpty")
                  : teamFilter === "recommended"
                    ? t("teams.skillManageRecommendedEmptyTitle")
                    : teamFilter === "configured"
                      ? t("skills.teamEmpty")
                      : t("teams.skillManageRecommendationsEmptyTitle")
              }
            />
          ) : (
            <div className="overflow-hidden rounded-md border bg-background">
              {filteredTeamItems.map((item) =>
                item.type === "configured" ? (
                  <TeamConfiguredSkillCard
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
                    onOpenManagedSkill={() => openManagedSkill(item.skill.skillName)}
                    onSelect={() => setSelectedItemId(item.id)}
                  />
                ) : (
                  <TeamRecommendedSkillCard
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
                    onOpenManagedSkill={() => openManagedSkill(item.recommendation.skillId)}
                    onSelect={() => setSelectedItemId(item.id)}
                  />
                ),
              )}
              {recommendationLookupLoading ? (
                <TeamSkillLookupLoadingRows
                  resolvedCount={Math.max(0, providerRecommendationsTotalCount - providerRecommendationsPendingCount)}
                  totalCount={providerRecommendationsTotalCount}
                />
              ) : null}
            </div>
          )}
        </div>
      ) : (
        <TeamSkillListSkeleton />
      )}
      {selectedTeamItem ? (
        <SkillManagementSheet
          subjectName={
            selectedTeamItem.type === "configured"
              ? selectedTeamItem.skill.displayName
              : selectedTeamItem.recommendation.package.displayName
          }
          onClose={() => setSelectedItemId(null)}
        >
          <TeamSkillDetail
            busyAction={busyAction}
            busyConfigId={busyConfigId}
            canManage={canManage}
            groupById={groupById}
            item={selectedTeamItem}
            onAddRecommendation={(recommendation) => onAddRecommendation(recommendation, { installRuntime: false })}
            onInstallRuntimeSkill={onInstallRuntimeSkill}
            onOpenManagedSkill={openManagedSkill}
            onRemoveConfiguredSkill={skillRemoval.open}
          />
        </SkillManagementSheet>
      ) : null}
      <TeamPackageRemoveConfirmDialog
        busy={skillRemoval.target ? busyConfigId === skillRemoval.target.id : false}
        packageSkillCount={
          skillRemoval.target
            ? (selectedTeamSkills?.skills.filter((skill) => skill.packageName === skillRemoval.target?.packageName)
                .length ?? 0)
            : 0
        }
        target={skillRemoval.target}
        onClose={skillRemoval.close}
        onConfirm={() => void skillRemoval.confirm()}
      />
    </SkillPageScrollArea>
  )
}

function TeamSkillLookupLoadingRows({ resolvedCount, totalCount }: { resolvedCount: number; totalCount: number }) {
  const { t } = useAppI18n()
  return (
    <>
      {Array.from({ length: 2 }).map((_, index) => (
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
              <Skeleton className="h-3 w-72 max-w-full rounded-md" />
            </div>
          </div>
          <Skeleton className="h-[var(--oo-control-height-compact)] w-24 rounded-md" />
        </div>
      ))}
      {totalCount > 0 ? (
        <div className="oo-text-caption border-b px-3 py-2 text-muted-foreground">
          {t("skills.teamRecommendationsResolving", { resolved: resolvedCount, total: totalCount })}
        </div>
      ) : null}
    </>
  )
}

function TeamSkillListSkeleton() {
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
                <Skeleton className="h-4 w-36 rounded-md" />
                <Skeleton className="h-5 w-20 rounded-md" />
              </div>
              <Skeleton className="h-3.5 w-64 max-w-full rounded-md" />
              <Skeleton className="h-3 w-80 max-w-full rounded-md" />
            </div>
          </div>
          <Skeleton className="h-[var(--oo-control-height-compact)] w-24 rounded-md" />
        </div>
      ))}
    </div>
  )
}

function TeamRecommendationEmptyState({ description, title }: { description: string; title: string }) {
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

function TeamConfiguredSkillCard({
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
  skill: UseTeamSkills["skills"][number]
}) {
  const { t } = useAppI18n()
  const runtimeStatus = getTeamSkillRuntimeStatus(groupById, skill)
  const runtimeTone = teamRuntimeStatusTone(runtimeStatus.state)
  const runtimeInstallable = runtimeStatus.state === "missing" || runtimeStatus.state === "external-only"
  const managedSkillOpenable = canOpenManagedTeamSkill(runtimeStatus.state)

  return (
    <SkillListRow
      icon={<SkillIconFrame icon={skill.icon} className="size-9" iconClassName="size-4.5" />}
      selected={selected}
      title={skill.displayName}
      subtitle={
        <span className="min-w-0 truncate" title={skill.packageName}>
          {skill.packageName}
        </span>
      }
      description={skill.description}
      badges={
        <>
          <Badge variant="secondary">{t("teams.skillManageConfigured")}</Badge>
          {shouldShowTeamRuntimeStatusOnCard(runtimeStatus.state) ? (
            <Badge className={cn("shrink-0", getSkillRowStatusBadgeClassName(runtimeTone))} variant="outline">
              {teamRuntimeStatusLabel(runtimeStatus.state, t)}
            </Badge>
          ) : null}
        </>
      }
      meta={
        <div className="min-w-0 truncate" title={`${skill.skillName} · ${skill.version}`}>
          {skill.skillName} · {skill.version}
        </div>
      }
      actions={
        <>
          {runtimeInstallable ? (
            <Button type="button" variant="ghost" size="sm" disabled={installBusy} onClick={onInstallRuntime}>
              {installBusy ? <AppIcons.status.loading className="animate-spin" /> : <AppIcons.action.installPackage />}
              {t("teams.skillManageInstallRuntime")}
            </Button>
          ) : null}
          {managedSkillOpenable ? (
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onOpenManagedSkill}>
              {t("skills.installedManage")}
            </Button>
          ) : null}
        </>
      }
      onSelect={() => {
        if (shouldOpenTeamSkillManagement(runtimeStatus.state)) {
          onOpenManagedSkill()
          return
        }
        onSelect()
      }}
    />
  )
}

function TeamRecommendedSkillCard({
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
  const canInstallRuntime = canInstallProviderRecommendationRuntime(recommendation)
  const addBusyKey = `addSkill:${recommendation.packageName}:${recommendation.skillId}`
  const installBusyKey = `installSkill:${recommendation.packageName}:${recommendation.skillId}`
  const installBusy = busyAction === installBusyKey || busyAction === "installSkillBatch"
  const disabled = Boolean(busyAction && busyAction !== addBusyKey && !installBusy)
  const skillDescription = providerRecommendationSkillDescription(recommendation)
  const canOpenManage = canOpenManagedProviderRecommendation(recommendation)

  return (
    <SkillListRow
      icon={<SkillIconFrame icon={recommendation.package.icon} className="size-9" iconClassName="size-4.5" />}
      selected={selected}
      title={recommendation.package.displayName}
      subtitle={
        <span className="min-w-0 truncate" title={recommendation.packageName}>
          {recommendation.providerDisplayName}
        </span>
      }
      description={skillDescription}
      badges={
        <>
          <Badge variant="secondary">{t("teams.skillManageRecommended")}</Badge>
          {recommendation.installState === "name-conflict" || recommendation.installState === "unavailable" ? (
            <Badge variant="outline">{getPublicSkillInstallStateLabel(recommendation.installState, t)}</Badge>
          ) : null}
        </>
      }
      meta={
        <div className="min-w-0 truncate" title={`${recommendation.packageName} · ${recommendation.skillId}`}>
          {recommendation.packageName} · {recommendation.skillId}
        </div>
      }
      actions={
        <>
          {canInstallRuntime ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled || installBusy}
              onClick={onInstallRuntime}
            >
              {installBusy ? <AppIcons.status.loading className="animate-spin" /> : <AppIcons.action.installPackage />}
              {t("teams.skillManageInstallRuntime")}
            </Button>
          ) : null}
          {canOpenManage ? (
            <Button type="button" variant="ghost" size="sm" onClick={onOpenManagedSkill}>
              {t("skills.installedManage")}
            </Button>
          ) : null}
        </>
      }
      onSelect={() => {
        if (canOpenManage) {
          onOpenManagedSkill()
          return
        }
        onSelect()
      }}
    />
  )
}

function TeamSkillDetail({
  busyAction,
  busyConfigId,
  canManage,
  groupById,
  item,
  onAddRecommendation,
  onInstallRuntimeSkill,
  onOpenManagedSkill,
  onRemoveConfiguredSkill,
}: {
  busyAction: BusyAction | null
  busyConfigId: string | null
  canManage: boolean
  groupById: ManagedSkillGroupById
  item: TeamSkillRecommendationItem
  onAddRecommendation: (recommendation: ProviderSkillRecommendation) => Promise<void>
  onInstallRuntimeSkill: (skill: { packageName: string; skillName: string }) => void
  onOpenManagedSkill: (skillName: string) => void
  onRemoveConfiguredSkill: (skill: UseTeamSkills["skills"][number]) => void
}) {
  return item.type === "configured" ? (
    <TeamConfiguredSkillDetail
      busyAction={busyAction}
      busyConfigId={busyConfigId}
      canManage={canManage}
      groupById={groupById}
      skill={item.skill}
      onInstallRuntimeSkill={onInstallRuntimeSkill}
      onOpenManagedSkill={onOpenManagedSkill}
      onRemoveConfiguredSkill={onRemoveConfiguredSkill}
    />
  ) : (
    <TeamRecommendedSkillDetail
      busyAction={busyAction}
      canManage={canManage}
      recommendation={item.recommendation}
      onAddRecommendation={onAddRecommendation}
      onInstallRuntimeSkill={onInstallRuntimeSkill}
      onOpenManagedSkill={onOpenManagedSkill}
    />
  )
}

function TeamConfiguredSkillDetail({
  busyAction,
  busyConfigId,
  canManage,
  groupById,
  onInstallRuntimeSkill,
  onOpenManagedSkill,
  onRemoveConfiguredSkill,
  skill,
}: {
  busyAction: BusyAction | null
  busyConfigId: string | null
  canManage: boolean
  groupById: ManagedSkillGroupById
  onInstallRuntimeSkill: (skill: { packageName: string; skillName: string }) => void
  onOpenManagedSkill: (skillName: string) => void
  onRemoveConfiguredSkill: (skill: UseTeamSkills["skills"][number]) => void
  skill: UseTeamSkills["skills"][number]
}) {
  const { t } = useAppI18n()
  const runtimeStatus = getTeamSkillRuntimeStatus(groupById, skill)
  const runtimeTone = teamRuntimeStatusTone(runtimeStatus.state)
  const installBusy =
    busyAction === `installSkill:${skill.packageName}:${skill.skillName}` || busyAction === "installSkillBatch"
  const configBusy = busyConfigId === skill.id
  const runtimeInstallable = runtimeStatus.state === "missing" || runtimeStatus.state === "external-only"
  const managedSkillOpenable = canOpenManagedTeamSkill(runtimeStatus.state)

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
            <Badge variant="secondary">{t("teams.skillManageConfigured")}</Badge>
            {shouldShowTeamRuntimeStatusOnCard(runtimeStatus.state) ? (
              <Badge className={cn("shrink-0", getSkillRowStatusBadgeClassName(runtimeTone))} variant="outline">
                {teamRuntimeStatusLabel(runtimeStatus.state, t)}
              </Badge>
            ) : null}
            {skill.version ? <Badge variant="outline">{skill.version}</Badge> : null}
          </div>
          {skill.description ? (
            <CardDescription className="line-clamp-6 min-w-0 break-words text-foreground/80">
              {skill.description}
            </CardDescription>
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
                {t("teams.skillManageInstallRuntime")}
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
                className="border-[var(--oo-danger-border)] text-destructive hover:bg-[var(--oo-danger-surface)] hover:text-destructive"
                disabled={configBusy}
                onClick={() => onRemoveConfiguredSkill(skill)}
              >
                {configBusy ? <AppIcons.status.loading className="animate-spin" /> : <AppIcons.action.delete />}
                {t("teams.skillManageRemovePackage")}
              </Button>
            ) : null}
          </div>
        </CardContent>
      </InspectorCard>

      <TeamSkillMetaCard packageName={skill.packageName} skillName={skill.skillName} version={skill.version} />
    </div>
  )
}

function TeamRecommendedSkillDetail({
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
  const canInstallRuntime = canInstallProviderRecommendationRuntime(recommendation)
  const installBusy =
    busyAction === `installSkill:${recommendation.packageName}:${recommendation.skillId}` ||
    busyAction === "installSkillBatch"
  const addBusy =
    busyAction === `addSkill:${recommendation.packageName}:${recommendation.skillId}` || busyAction === "addSkillBatch"
  const managedSkillOpenable = canOpenManagedProviderRecommendation(recommendation)
  const disabled = Boolean(busyAction && !installBusy && !addBusy)
  const skillDescription = providerRecommendationSkillDescription(recommendation)

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
            <Badge variant="secondary">{t("teams.skillManageRecommended")}</Badge>
            {recommendation.installState === "name-conflict" || recommendation.installState === "unavailable" ? (
              <Badge variant="outline">{getPublicSkillInstallStateLabel(recommendation.installState, t)}</Badge>
            ) : null}
            <Badge variant="outline">{recommendation.package.version}</Badge>
          </div>
          {skillDescription ? (
            <CardDescription className="line-clamp-6 min-w-0 break-words text-foreground/80">
              {skillDescription}
            </CardDescription>
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
                {t("teams.skillManageInstallRuntime")}
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
                {t("teams.skillManageAddOnly")}
              </Button>
            ) : null}
          </div>
        </CardContent>
      </InspectorCard>

      <TeamSkillMetaCard
        packageName={recommendation.packageName}
        providerDisplayName={recommendation.providerDisplayName}
        skillName={recommendation.skillId}
        version={recommendation.package.version}
      />
    </div>
  )
}

function TeamSkillMetaCard({
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
            <span className="oo-text-muted">{t("teams.provider")}</span>
            <span className="min-w-0 truncate text-right">{providerDisplayName}</span>
          </div>
        ) : null}
        <div className="flex min-w-0 justify-between gap-3">
          <span className="oo-text-muted">{t("skills.package")}</span>
          <span className="min-w-0 truncate text-right">{packageName}</span>
        </div>
        <div className="flex min-w-0 justify-between gap-3">
          <span className="oo-text-muted">{t("skills.teamSkillName")}</span>
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
