import type { BusyAction } from "./organization-management-model.ts"
import type { ProviderSkillRecommendation } from "./provider-skill-recommendations.ts"
import type { ManagedSkillGroupById } from "./skill-route-model.ts"
import type { OrganizationSkillFilter } from "./SkillPageHeader.tsx"
import type { UseOrganizationSkills } from "@/hooks/useOrganizationSkills"
import type { UseOrganizationWorkspace } from "@/hooks/useOrganizationWorkspace"
import type { TranslateFn as TFunction } from "@/i18n"

import * as React from "react"
import { toast } from "sonner"
import { planOrganizationSkillBulkLinks } from "./organization-management-model.ts"
import {
  getOrganizationSkillRuntimeStatus,
  getPublicSkillInstallStateLabel,
  getSkillRowStatusBadgeClassName,
} from "./skill-route-model.ts"
import { SkillListRow } from "./SkillListRow.tsx"
import { SkillIconFrame, SkillManagementSheet } from "./SkillUiParts.tsx"
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
  onInstallRuntimeSkills: (skills: readonly { packageName: string; skillName: string }[]) => void
  onOpenManagedSkill: (skillName: string) => void
  organizationFilter: OrganizationSkillFilter
  organizationQuery: string
  organizationSkills: UseOrganizationSkills
  providerRecommendations: ProviderSkillRecommendation[]
  workspace: UseOrganizationWorkspace
}

export function OrganizationSkillsPane({
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
            <OrganizationSkillListSkeleton />
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
        <OrganizationSkillListSkeleton />
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
      onSelect={onSelect}
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
  const canInstallRuntime =
    recommendation.installState === "installable" ||
    recommendation.installState === "partially-installed" ||
    recommendation.installState === "external-installed"
  const addBusyKey = `addSkill:${recommendation.packageName}:${recommendation.skillId}`
  const installBusyKey = `installSkill:${recommendation.packageName}:${recommendation.skillId}`
  const installBusy = busyAction === installBusyKey || busyAction === "installSkillBatch"
  const disabled = Boolean(busyAction && busyAction !== addBusyKey && !installBusy)
  const skillDescription =
    recommendation.package.skills.find((skill) => skill.name === recommendation.skillId)?.description ??
    recommendation.package.description
  const canOpenManage = recommendation.installState === "installed" || recommendation.installState === "name-conflict"

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
      onSelect={onSelect}
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
  const canInstallRuntime =
    recommendation.installState === "installable" ||
    recommendation.installState === "partially-installed" ||
    recommendation.installState === "external-installed"
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
