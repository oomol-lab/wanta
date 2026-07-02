import type { Organization, OrganizationOverview } from "../../../electron/organizations/common.ts"
import type { ManagedSkillGroup, PublicSkillPackage } from "../../../electron/skills/common.ts"
import type { BusyAction, MemberView } from "./organization-management-model.ts"
import type { UseOrganizationSkills } from "@/hooks/useOrganizationSkills"
import type { WorkspaceSelection } from "@/hooks/useOrganizationWorkspace"
import type { ProviderSkillRecommendation } from "@/routes/Skills/provider-skill-recommendations.ts"
import type { RuntimeSkillRemoveTarget } from "@/routes/Skills/skill-route-model.ts"

import {
  Building2Icon,
  CheckIcon,
  ChevronsUpDownIcon,
  PackageIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
} from "lucide-react"
import * as React from "react"
import { organizationRole, planOrganizationSkillBulkLinks } from "./organization-management-model.ts"
import {
  AccountWorkspaceAvatar,
  OrganizationAvatar,
  OrganizationMemberAccessButton,
} from "./OrganizationMembersPanel.tsx"
import {
  OrganizationSkillManageDialog,
  OrganizationSkillManageLoadingSkeleton,
} from "./OrganizationSkillManageDialog.tsx"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import { useAppI18n } from "@/i18n"
import { cn } from "@/lib/utils"
import { canInstallPublicSkill, getOrganizationSkillRuntimeStatus } from "@/routes/Skills/skill-route-model"

export function OrganizationSwitcherPanel({
  activeWorkspace,
  accountAvatarUrl,
  accountName,
  avatarPreviewUrls,
  canManage,
  members,
  membersLoading,
  onCreate,
  onEdit,
  onOpenMembers,
  onRemoteAvatarLoad,
  onSelect,
  onSelectPersonal,
  organizations,
  overview,
  selectedOrganization,
  selectedOrganizationId,
}: {
  activeWorkspace?: WorkspaceSelection
  accountAvatarUrl?: string
  accountName?: string
  avatarPreviewUrls: Record<string, string>
  canManage: boolean
  members: MemberView[]
  membersLoading: boolean
  onCreate: () => void
  onEdit: (organization: Organization) => void
  onOpenMembers: () => void
  onRemoteAvatarLoad: (organizationId: string, file: File | null) => void
  onSelect: (organizationId: string) => void
  onSelectPersonal: () => void
  organizations: Organization[]
  overview: OrganizationOverview | null
  selectedOrganization: Organization | null
  selectedOrganizationId: string | null
}) {
  const { t } = useAppI18n()
  const countLabel = t("organizations.organizationCount", { count: organizations.length })
  const personalSelected = activeWorkspace?.type === "personal"
  const personalLabel = accountName?.trim() || t("organizations.personal")
  const personalDescription =
    personalLabel === t("organizations.personal") ? t("organizations.workspace") : t("organizations.personal")

  return (
    <section className="min-w-0 overflow-hidden rounded-md border border-[var(--oo-divider)] bg-background">
      <div className="flex min-w-0 flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div className="shrink-0">
            {personalSelected ? (
              <AccountWorkspaceAvatar
                avatarUrl={accountAvatarUrl}
                className="size-16 rounded-md text-lg"
                name={accountName}
              />
            ) : selectedOrganization ? (
              <OrganizationAvatar
                organization={selectedOrganization}
                previewUrl={avatarPreviewUrls[selectedOrganization.id]}
                className="size-16 rounded-md text-lg"
                onRemoteAvatarLoad={onRemoteAvatarLoad}
              />
            ) : (
              <div className="grid size-16 place-items-center rounded-md bg-muted text-muted-foreground">
                <Building2Icon className="size-5" />
              </div>
            )}
          </div>

          <div className="grid min-h-16 min-w-0 content-center gap-1.5">
            <div className="flex min-w-0 items-baseline gap-3">
              {personalSelected ? (
                <span className="oo-text-dialog-title min-w-0 truncate text-foreground">{personalLabel}</span>
              ) : selectedOrganization ? (
                <>
                  <span className="oo-text-dialog-title min-w-0 truncate text-foreground">
                    {selectedOrganization.name}
                  </span>
                  <span className="oo-text-caption-compact min-w-0 truncate font-mono text-muted-foreground">
                    {selectedOrganization.id}
                  </span>
                </>
              ) : (
                <span className="oo-text-body min-w-0 truncate text-muted-foreground">
                  {t("organizations.selectOrganization")}
                </span>
              )}
            </div>

            {selectedOrganization ? (
              <OrganizationMemberAccessButton
                canManage={canManage}
                members={members}
                membersLoading={membersLoading}
                onOpen={onOpenMembers}
              />
            ) : (
              <div className="oo-text-caption min-w-0 truncate text-muted-foreground">
                {personalSelected ? personalDescription : t("organizations.selectOrganization")}
              </div>
            )}
          </div>
        </div>

        <div className="grid min-w-0 gap-2 sm:min-w-fit sm:shrink-0 sm:justify-items-end">
          <div className="flex min-w-0 flex-wrap justify-end gap-2">
            {selectedOrganization && canManage ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full sm:w-auto"
                onClick={() => onEdit(selectedOrganization)}
              >
                <PencilIcon className="size-3.5" />
                {t("organizations.editOrganization")}
              </Button>
            ) : null}
            <Button type="button" variant="outline" size="sm" className="w-full sm:w-auto" onClick={onCreate}>
              <PlusIcon className="size-3.5" />
              {t("organizations.createOrganization")}
            </Button>
          </div>
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 sm:justify-end">
            <span className="oo-text-body shrink-0 text-muted-foreground">{countLabel}</span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="ghost" size="sm" className="px-2">
                  {t("organizations.switchOrganization")}
                  <ChevronsUpDownIcon className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" sideOffset={6} className="w-[min(36rem,calc(100vw-2rem))]">
                <DropdownMenuLabel>{t("organizations.selectWorkspace")}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className={cn(
                    "grid min-h-14 min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-2 py-2",
                    personalSelected && "bg-accent",
                  )}
                  onSelect={onSelectPersonal}
                >
                  <AccountWorkspaceAvatar
                    avatarUrl={accountAvatarUrl}
                    className="size-10 rounded-md text-sm"
                    name={accountName}
                  />
                  <span className="grid min-h-10 min-w-0 content-center">
                    <span className="flex min-h-5 min-w-0 items-center gap-2">
                      <span className="oo-text-label truncate">{personalLabel}</span>
                      {personalSelected ? (
                        <span className="size-2 shrink-0 rounded-full bg-[var(--success)]" aria-hidden="true" />
                      ) : null}
                    </span>
                    <span className="oo-text-caption-compact block truncate text-muted-foreground">
                      {personalDescription}
                    </span>
                  </span>
                  {personalSelected ? <CheckIcon className="size-4 justify-self-end" /> : null}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {organizations.map((organization) => {
                  const role = organizationRole(overview, organization)
                  const selected = !personalSelected && organization.id === selectedOrganizationId
                  return (
                    <DropdownMenuItem
                      key={organization.id}
                      className={cn(
                        "grid min-h-14 min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-2 py-2",
                        selected && "bg-accent",
                      )}
                      onSelect={() => onSelect(organization.id)}
                    >
                      <OrganizationAvatar
                        organization={organization}
                        previewUrl={avatarPreviewUrls[organization.id]}
                        className="size-10 rounded-md text-sm"
                        onRemoteAvatarLoad={onRemoteAvatarLoad}
                      />
                      <span className="grid min-h-10 min-w-0 content-center">
                        <span className="flex min-h-5 min-w-0 items-center gap-2">
                          <span className="oo-text-label truncate">{organization.name}</span>
                          {selected ? (
                            <span className="size-2 shrink-0 rounded-full bg-[var(--success)]" aria-hidden="true" />
                          ) : null}
                        </span>
                        <span className="oo-text-caption-compact block truncate font-mono text-muted-foreground">
                          {organization.id}
                        </span>
                      </span>
                      <Badge variant="secondary" className="justify-self-end">
                        {role === "creator" ? t("organizations.roleCreator") : t("organizations.roleMember")}
                      </Badge>
                    </DropdownMenuItem>
                  )
                })}
                <DropdownMenuSeparator />
                <DropdownMenuItem className="gap-2 py-2" onSelect={onCreate}>
                  <PlusIcon className="size-4" />
                  <span>{t("organizations.createOrganization")}</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </section>
  )
}

function organizationSkillGuideStatus(
  organizationSkills: UseOrganizationSkills,
  t: ReturnType<typeof useAppI18n>["t"],
): string {
  const enabledCount = organizationSkills.skills.filter((skill) => skill.enabled).length
  if (!organizationSkills.apiEnabled) {
    return t("organizations.skillGuideUnavailableBadge")
  }
  if (organizationSkills.loading && !organizationSkills.hasLoaded) {
    return t("organizations.skillGuideLoading")
  }
  if (organizationSkills.error) {
    return t("organizations.skillGuideLoadFailed")
  }
  return enabledCount > 0
    ? t("organizations.skillGuideEnabledCount", { count: enabledCount })
    : t("organizations.skillGuideEmptyBadge")
}

export function OrganizationSkillGuidePanel({
  busyAction,
  groupById,
  organizationSkills,
  providerRecommendations,
  onAddRecommendation,
  onAddRecommendationBatch,
  onAddMarketPackage,
  onInstallRuntimeSkill,
  onInstallRuntimeSkills,
  onRequestRemoveRuntimeSkill,
}: {
  busyAction: BusyAction | null
  groupById: ReadonlyMap<string, ManagedSkillGroup>
  organizationSkills: UseOrganizationSkills
  providerRecommendations: ProviderSkillRecommendation[]
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
  onRequestRemoveRuntimeSkill: (target: RuntimeSkillRemoveTarget) => void
}) {
  const { t } = useAppI18n()
  const statusLabel = organizationSkillGuideStatus(organizationSkills, t)
  const recommendedPlan = React.useMemo(
    () => planOrganizationSkillBulkLinks(providerRecommendations, organizationSkills.skills),
    [organizationSkills.skills, providerRecommendations],
  )
  const installableHeaderSkills = React.useMemo(() => {
    const configuredSkills = organizationSkills.skills
      .filter((skill) => {
        const state = getOrganizationSkillRuntimeStatus(groupById, skill).state
        return skill.enabled && (state === "missing" || state === "external-only")
      })
      .map((skill) => ({ packageName: skill.packageName, skillName: skill.skillName }))
    const recommendedSkills = recommendedPlan.linkable
      .filter((recommendation) => canInstallPublicSkill(recommendation.installState))
      .map((recommendation) => ({
        packageName: recommendation.packageName,
        skillName: recommendation.skillId,
      }))
    const seen = new Set<string>()
    return [...configuredSkills, ...recommendedSkills].filter((skill) => {
      const key = `${skill.packageName}\u0000${skill.skillName}`
      if (seen.has(key)) {
        return false
      }
      seen.add(key)
      return true
    })
  }, [groupById, organizationSkills.skills, recommendedPlan.linkable])
  const installBusy = busyAction === "installSkillBatch"

  return (
    <section className="grid h-full min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-md border border-[var(--oo-divider)] bg-background">
      <div className="flex min-h-14 min-w-0 flex-wrap items-center justify-between gap-2 border-b border-[var(--oo-divider)] px-3 py-[7px]">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="oo-text-title min-w-0 truncate text-foreground">{t("organizations.skillGuideTitle")}</h2>
            <Badge variant="outline" className="max-w-full shrink-0">
              <span className="truncate">{statusLabel}</span>
            </Badge>
          </div>
          <p className="oo-text-caption mt-0.5 truncate text-muted-foreground">
            {t("organizations.skillGuideDescription")}
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          className="shrink-0"
          disabled={installableHeaderSkills.length === 0 || Boolean(busyAction)}
          onClick={() => onInstallRuntimeSkills(installableHeaderSkills)}
        >
          {installBusy ? <RefreshCwIcon className="size-3.5 animate-spin" /> : <PackageIcon className="size-3.5" />}
          {t("organizations.skillManageInstallAll")}
        </Button>
      </div>
      <div className="min-h-0">
        <OrganizationSkillManageDialog
          busyAction={busyAction}
          groupById={groupById}
          organizationSkills={organizationSkills}
          providerRecommendations={providerRecommendations}
          variant="inline"
          onAddRecommendation={onAddRecommendation}
          onAddRecommendationBatch={onAddRecommendationBatch}
          onAddMarketPackage={onAddMarketPackage}
          onInstallRuntimeSkill={onInstallRuntimeSkill}
          onInstallRuntimeSkills={onInstallRuntimeSkills}
          onRequestRemoveRuntimeSkill={onRequestRemoveRuntimeSkill}
        />
      </div>
    </section>
  )
}

export function OrganizationManagementSkeleton({ mode }: { mode: "organization" | "personal" }) {
  const isPersonal = mode === "personal"

  return (
    <>
      <section className="min-w-0 overflow-hidden rounded-md border border-[var(--oo-divider)] bg-background">
        <div className="flex min-w-0 flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <Skeleton className="size-16 shrink-0 rounded-md" />
            <div className="grid min-h-16 min-w-0 content-center gap-1.5">
              <div className="flex min-w-0 items-baseline gap-3">
                <Skeleton className="h-5 w-28 rounded-md" />
                {isPersonal ? null : <Skeleton className="h-4 w-64 max-w-[48%] rounded-md" />}
              </div>
              {isPersonal ? (
                <Skeleton className="h-4 w-20 rounded-md" />
              ) : (
                <div className="flex min-w-0 items-center gap-2">
                  <Skeleton className="h-4 w-20 rounded-md" />
                  <Skeleton className="h-6 w-16 rounded-full" />
                </div>
              )}
            </div>
          </div>
          <div className="grid min-w-0 gap-2 sm:h-16 sm:min-w-fit sm:shrink-0 sm:content-between sm:justify-items-end sm:gap-0">
            <Skeleton className="h-[var(--oo-control-height-compact)] w-full rounded-md sm:w-32" />
            <div className="flex min-w-0 items-center justify-between gap-2 sm:justify-end">
              <Skeleton className="h-5 w-24 rounded-md" />
              <Skeleton className="h-[var(--oo-control-height-compact)] w-16 rounded-md" />
            </div>
          </div>
        </div>
      </section>

      {isPersonal ? (
        <section className="grid min-h-0 min-w-0 place-items-center overflow-hidden rounded-md border border-[var(--oo-divider)] bg-background px-4 py-10">
          <div className="grid w-full max-w-lg justify-items-center gap-4 text-center">
            <Skeleton className="size-14 rounded-md" />
            <div className="grid w-full min-w-0 justify-items-center gap-2">
              <Skeleton className="h-5 w-36 rounded-md" />
              <Skeleton className="h-4 w-96 max-w-full rounded-md" />
              <Skeleton className="h-4 w-72 max-w-[86%] rounded-md" />
            </div>
            <div className="flex min-w-0 flex-wrap items-center justify-center gap-2">
              <Skeleton className="h-[var(--oo-control-height)] w-28 rounded-md" />
              <Skeleton className="h-[var(--oo-control-height)] w-28 rounded-md" />
            </div>
            <Skeleton className="h-3.5 w-80 max-w-full rounded-md" />
          </div>
        </section>
      ) : (
        <section className="grid h-full min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-md border border-[var(--oo-divider)] bg-background">
          <div className="flex min-h-14 min-w-0 flex-wrap items-center justify-between gap-2 border-b border-[var(--oo-divider)] px-3 py-[7px]">
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2">
                <Skeleton className="h-5 w-24 rounded-md" />
                <Skeleton className="h-5 w-12 rounded-full" />
              </div>
              <Skeleton className="mt-1.5 h-4 w-72 max-w-full rounded-md" />
            </div>
            <Skeleton className="h-[var(--oo-control-height-compact)] w-28 shrink-0 rounded-md" />
          </div>
          <div className="min-h-0">
            <OrganizationSkillManageLoadingSkeleton inline />
          </div>
        </section>
      )}
    </>
  )
}

export function EmptyOrganizationsState({ onCreate }: { onCreate: () => void }) {
  const { t } = useAppI18n()
  return (
    <div className="flex min-h-full items-center justify-center px-4 py-10">
      <div className="grid max-w-md justify-items-center gap-4 text-center">
        <div className="grid size-14 place-items-center rounded-md border border-[var(--oo-divider)] bg-[var(--oo-inspector-surface)] text-muted-foreground">
          <Building2Icon className="size-7" />
        </div>
        <div className="min-w-0">
          <div className="oo-text-title text-foreground">{t("organizations.emptyOrganizations")}</div>
          <div className="oo-text-body mt-1 max-w-sm text-muted-foreground">
            {t("organizations.emptyOrganizationsDescription")}
          </div>
        </div>
        <Button type="button" onClick={onCreate}>
          <PlusIcon className="size-4" />
          {t("organizations.createOrganization")}
        </Button>
      </div>
    </div>
  )
}

export function PersonalWorkspaceState({
  avatarPreviewUrls,
  onCreate,
  onRemoteAvatarLoad,
  onSelectOrganization,
  organizations,
  overview,
}: {
  avatarPreviewUrls: Record<string, string>
  onCreate: () => void
  onRemoteAvatarLoad: (organizationId: string, file: File | null) => void
  onSelectOrganization: (organizationId: string) => void
  organizations: Organization[]
  overview: OrganizationOverview | null
}) {
  const { t } = useAppI18n()

  return (
    <section className="grid min-h-0 min-w-0 place-items-center overflow-hidden rounded-md border border-[var(--oo-divider)] bg-background px-4 py-10">
      <div className="grid max-w-lg justify-items-center gap-4 text-center">
        <div className="grid size-14 place-items-center rounded-md border border-[var(--oo-divider)] bg-[var(--oo-inspector-surface)] text-muted-foreground">
          <Building2Icon className="size-7" />
        </div>
        <div className="grid min-w-0 gap-1.5">
          <h2 className="oo-text-title text-foreground">{t("organizations.personalWorkspaceTitle")}</h2>
          <p className="oo-text-body max-w-md text-muted-foreground">
            {t("organizations.personalWorkspaceDescription")}
          </p>
        </div>
        <div className="flex min-w-0 flex-wrap items-center justify-center gap-2">
          <Button type="button" onClick={onCreate}>
            <PlusIcon className="size-4" />
            {t("organizations.personalWorkspaceCreate")}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" disabled={organizations.length === 0}>
                {t("organizations.personalWorkspaceSwitch")}
                <ChevronsUpDownIcon className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="center" sideOffset={8} className="w-[min(28rem,calc(100vw-2rem))]">
              <DropdownMenuLabel>{t("organizations.selectOrganization")}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {organizations.map((organization) => {
                const role = organizationRole(overview, organization)
                return (
                  <DropdownMenuItem
                    key={organization.id}
                    className="grid min-h-14 min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-2 py-2"
                    onSelect={() => onSelectOrganization(organization.id)}
                  >
                    <OrganizationAvatar
                      organization={organization}
                      previewUrl={avatarPreviewUrls[organization.id]}
                      className="size-10 rounded-md text-sm"
                      onRemoteAvatarLoad={onRemoteAvatarLoad}
                    />
                    <span className="grid min-h-10 min-w-0 content-center">
                      <span className="oo-text-label truncate">{organization.name}</span>
                      <span className="oo-text-caption-compact block truncate font-mono text-muted-foreground">
                        {organization.id}
                      </span>
                    </span>
                    <Badge variant="secondary" className="justify-self-end">
                      {role === "creator" ? t("organizations.roleCreator") : t("organizations.roleMember")}
                    </Badge>
                  </DropdownMenuItem>
                )
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <p className="oo-text-caption max-w-md text-muted-foreground">
          {t("organizations.personalWorkspaceSwitchHint")}
        </p>
      </div>
    </section>
  )
}
