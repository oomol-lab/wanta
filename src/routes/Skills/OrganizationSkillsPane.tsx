import type { BusyAction } from "./organization-management-model.ts"
import type { OrganizationSkillRecommendationItem } from "./organization-skill-manage-helpers.ts"
import type { ProviderSkillRecommendation } from "./provider-skill-recommendations.ts"
import type { ManagedSkillGroupById } from "./skill-route-model.ts"
import type { OrganizationSkillFilter } from "./SkillPageHeader.tsx"
import type { UseOrganizationSkills } from "@/hooks/useOrganizationSkills"
import type { UseOrganizationWorkspace } from "@/hooks/useOrganizationWorkspace"
import type { TranslateFn as TFunction } from "@/i18n"

import * as React from "react"
import { toast } from "sonner"
import { planProviderSkillRecommendationBulkLinks } from "./organization-management-model.ts"
import {
  buildOrganizationSkillRecommendationItems,
  canInstallProviderRecommendationRuntime,
  canOpenManagedOrganizationSkill,
  canOpenManagedProviderRecommendation,
  organizationRuntimeStatusLabel,
  organizationRuntimeStatusTone,
  providerRecommendationSkillDescription,
  shouldOpenOrganizationSkillManagement,
  shouldShowOrganizationRuntimeStatusOnCard,
} from "./organization-skill-manage-helpers.ts"
import { OrganizationRecommendationRemoveConfirmDialog } from "./OrganizationSkillManageRows.tsx"
import {
  getOrganizationSkillRuntimeStatus,
  getPublicSkillInstallStateLabel,
  getSkillRowStatusBadgeClassName,
} from "./skill-route-model.ts"
import { SkillListRow } from "./SkillListRow.tsx"
import { SkillIconFrame, SkillManagementSheet, SkillPageScrollArea } from "./SkillUiParts.tsx"
import { AppIcons } from "@/components/AppIcons"
import { ErrorNotice } from "@/components/ErrorNotice"
import { InspectorCard, InspectorInsetCard } from "@/components/InspectorPanel"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useAppI18n } from "@/i18n"
import { resolveUserFacingError, userFacingErrorDescription } from "@/lib/user-facing-error"
import { cn } from "@/lib/utils"

function skillErrorMessage(cause: unknown, t: TFunction): string {
  return userFacingErrorDescription(resolveUserFacingError(cause, { area: "skills" }), t)
}

interface OrganizationSkillsPaneProps {
  busyAction: BusyAction | null
  groupById: ManagedSkillGroupById
  onAddRecommendation: (
    recommendation: ProviderSkillRecommendation,
    options: { installRuntime: boolean },
  ) => Promise<void>
  onInstallRuntimeSkill: (skill: { packageName: string; skillName: string }) => void
  onOpenManagedSkill: (skillName: string) => void
  organizationFilter: OrganizationSkillFilter
  organizationQuery: string
  organizationSkills: UseOrganizationSkills
  providerRecommendationsLoading: boolean
  providerRecommendationsPendingCount: number
  providerRecommendations: ProviderSkillRecommendation[]
  providerRecommendationsTotalCount: number
  workspace: UseOrganizationWorkspace
}

export function OrganizationSkillsPane({
  busyAction,
  groupById,
  onAddRecommendation,
  onInstallRuntimeSkill,
  onOpenManagedSkill,
  organizationFilter,
  organizationQuery,
  organizationSkills,
  providerRecommendationsLoading,
  providerRecommendationsPendingCount,
  providerRecommendations,
  providerRecommendationsTotalCount,
  workspace,
}: OrganizationSkillsPaneProps) {
  const { t } = useAppI18n()
  const canManage = workspace.activeWorkspace.canManage
  const [busyConfigId, setBusyConfigId] = React.useState<string | null>(null)
  const [organizationRemoveTarget, setOrganizationRemoveTarget] = React.useState<
    UseOrganizationSkills["skills"][number] | null
  >(null)
  const [selectedItemId, setSelectedItemId] = React.useState<string | null>(null)
  const openManagedSkill = React.useCallback(
    (skillName: string) => {
      setSelectedItemId(null)
      onOpenManagedSkill(skillName)
    },
    [onOpenManagedSkill],
  )

  const activeOrganizationId = workspace.activeWorkspace.organizationId
  const selectedOrganizationSkills =
    organizationSkills.organizationId === activeOrganizationId ? organizationSkills : null

  const normalizedQuery = organizationQuery.trim().toLowerCase()
  const recommendationLookupLoading = providerRecommendationsLoading && organizationFilter !== "configured"
  const recommendedPlan = selectedOrganizationSkills
    ? planProviderSkillRecommendationBulkLinks(providerRecommendations, selectedOrganizationSkills.skills)
    : null
  const recommendedOrganizationSkills = recommendedPlan?.linkable ?? []
  const filteredOrganizationItems = selectedOrganizationSkills
    ? buildOrganizationSkillRecommendationItems({
        filter: organizationFilter,
        normalizedQuery,
        providerRecommendations: recommendedOrganizationSkills,
        skills: selectedOrganizationSkills.skills,
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

  const removeOrganizationSkill = async (): Promise<void> => {
    const skill = organizationRemoveTarget
    if (!skill || !selectedOrganizationSkills?.canManage || busyConfigId) {
      return
    }
    setBusyConfigId(skill.id)
    try {
      await selectedOrganizationSkills.removeSkill(skill.id)
      toast.success(t("skills.organizationSkillRemoved"))
      setSelectedItemId(null)
      setOrganizationRemoveTarget(null)
    } catch (cause) {
      toast.error(skillErrorMessage(cause, t))
    } finally {
      setBusyConfigId(null)
    }
  }

  return (
    <SkillPageScrollArea>
      {selectedOrganizationSkills ? (
        <div className="grid gap-3">
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
          {selectedOrganizationSkills.loading && !selectedOrganizationSkills.hasLoaded ? (
            <OrganizationSkillListSkeleton />
          ) : recommendationLookupLoading && filteredOrganizationItems.length === 0 ? (
            <OrganizationSkillListSkeleton />
          ) : filteredOrganizationItems.length === 0 ? (
            <OrganizationRecommendationEmptyState
              description={
                normalizedQuery
                  ? t("skills.organizationSearchEmptyDescription")
                  : organizationFilter === "recommended"
                    ? t("organizations.skillManageRecommendedEmpty")
                    : organizationFilter === "configured"
                      ? t("skills.organizationEmptyDescription")
                      : t("organizations.skillManageRecommendationsEmptyDescription")
              }
              title={
                normalizedQuery
                  ? t("skills.organizationSearchEmpty")
                  : organizationFilter === "recommended"
                    ? t("organizations.skillManageRecommendedEmptyTitle")
                    : organizationFilter === "configured"
                      ? t("skills.organizationEmpty")
                      : t("organizations.skillManageRecommendationsEmptyTitle")
              }
            />
          ) : (
            <div className="overflow-hidden rounded-md border bg-background">
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
                    onOpenManagedSkill={() => openManagedSkill(item.skill.skillName)}
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
                    onOpenManagedSkill={() => openManagedSkill(item.recommendation.skillId)}
                    onSelect={() => setSelectedItemId(item.id)}
                  />
                ),
              )}
              {recommendationLookupLoading ? (
                <OrganizationSkillLookupLoadingRows
                  resolvedCount={Math.max(0, providerRecommendationsTotalCount - providerRecommendationsPendingCount)}
                  totalCount={providerRecommendationsTotalCount}
                />
              ) : null}
            </div>
          )}
        </div>
      ) : (
        <OrganizationSkillListSkeleton />
      )}
      {selectedOrganizationItem ? (
        <SkillManagementSheet
          subjectName={
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
            onOpenManagedSkill={openManagedSkill}
            onRemoveConfiguredSkill={setOrganizationRemoveTarget}
          />
        </SkillManagementSheet>
      ) : null}
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
    </SkillPageScrollArea>
  )
}

function OrganizationSkillLookupLoadingRows({
  resolvedCount,
  totalCount,
}: {
  resolvedCount: number
  totalCount: number
}) {
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
          {t("skills.organizationRecommendationsResolving", { resolved: resolvedCount, total: totalCount })}
        </div>
      ) : null}
    </>
  )
}

function OrganizationSkillListSkeleton() {
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
          <Badge variant="secondary">{t("organizations.skillManageConfigured")}</Badge>
          {!skill.enabled ? (
            <Badge variant="outline">{t("skills.organizationDisabled")}</Badge>
          ) : shouldShowOrganizationRuntimeStatusOnCard(runtimeStatus.state) ? (
            <Badge className={cn("shrink-0", getSkillRowStatusBadgeClassName(runtimeTone))} variant="outline">
              {organizationRuntimeStatusLabel(runtimeStatus.state, t)}
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
              {t("organizations.skillManageInstallRuntime")}
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
        if (shouldOpenOrganizationSkillManagement(runtimeStatus.state)) {
          onOpenManagedSkill()
          return
        }
        onSelect()
      }}
    />
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
          <Badge variant="secondary">{t("organizations.skillManageRecommended")}</Badge>
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
              {t("organizations.skillManageInstallRuntime")}
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
  item: OrganizationSkillRecommendationItem
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
            <Badge variant="secondary">{t("organizations.skillManageRecommended")}</Badge>
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
