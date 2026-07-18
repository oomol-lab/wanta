import type { Organization, OrganizationRole } from "../../../electron/organizations/common.ts"
import type { ManagedSkillGroup, PublicSkillPackage } from "../../../electron/skills/common.ts"
import type { BusyAction, MemberView } from "./organization-management-model.ts"
import type { UseOrganizationSkills } from "@/hooks/useOrganizationSkills"
import type { ProviderSkillRecommendation } from "@/routes/Skills/provider-skill-recommendations.ts"

import { Building2Icon, ChevronsUpDownIcon, LockKeyholeIcon, PencilIcon, PlusIcon } from "lucide-react"
import * as React from "react"
import { planProviderSkillRecommendationBulkLinks } from "./organization-management-model.ts"
import { OrganizationAvatar, OrganizationMemberAccessButton } from "./OrganizationMembersPanel.tsx"
import {
  OrganizationSkillManageDialog,
  OrganizationSkillManageLoadingSkeleton,
} from "./OrganizationSkillManageDialog.tsx"
import { CopyIconButton } from "@/components/CopyIconButton"
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

export function OrganizationSwitcherPanel({
  avatarPreviewUrls,
  canManage,
  members,
  membersComplete,
  membersLoading,
  getOrganizationRole,
  onCreate,
  onEdit,
  onAddMember,
  onOpenMembers,
  onRemoteAvatarLoad,
  onSelect,
  organizations,
  selectedOrganization,
  selectedOrganizationId,
}: {
  avatarPreviewUrls: Record<string, string>
  canManage: boolean
  members: MemberView[]
  membersComplete: boolean
  membersLoading: boolean
  getOrganizationRole: (organization: Organization) => OrganizationRole
  onCreate: () => void
  onEdit: (organization: Organization) => void
  onAddMember: () => void
  onOpenMembers: () => void
  onRemoteAvatarLoad: (organizationId: string, file: File | null) => void
  onSelect: (organizationId: string) => void
  organizations: Organization[]
  selectedOrganization: Organization | null
  selectedOrganizationId: string | null
}) {
  const { t } = useAppI18n()
  const countLabel = t("organizations.organizationCount", { count: organizations.length })

  return (
    <section className="min-w-0 overflow-hidden rounded-md border border-[var(--oo-divider)] bg-background">
      <div className="flex min-w-0 flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div className="shrink-0">
            {selectedOrganization ? (
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
              {selectedOrganization ? (
                <>
                  <span className="oo-text-dialog-title min-w-0 truncate text-foreground">
                    {selectedOrganization.name}
                  </span>
                  <OrganizationIdLabel organizationId={selectedOrganization.id} />
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
                membersComplete={membersComplete}
                membersLoading={membersLoading}
                onAddMember={onAddMember}
                onOpen={onOpenMembers}
              />
            ) : (
              <div className="oo-text-caption min-w-0 truncate text-muted-foreground">
                {t("organizations.selectOrganization")}
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
                {organizations.map((organization) => {
                  const role = getOrganizationRole(organization)
                  const selected = organization.id === selectedOrganizationId
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

function OrganizationIdLabel({ organizationId }: { organizationId: string }) {
  const { t } = useAppI18n()

  return (
    <span className="group/organization-id inline-flex min-w-0 items-center gap-1.5 align-baseline">
      <span
        data-selectable="true"
        className="oo-text-caption-compact min-w-0 cursor-text truncate font-mono text-muted-foreground select-text"
        title={organizationId}
      >
        {organizationId}
      </span>
      <CopyIconButton
        ariaLabel={t("organizations.copyOrganizationId")}
        className="opacity-70 group-hover/organization-id:opacity-100 focus-visible:opacity-100 data-[copied=true]:opacity-100"
        copiedLabel={t("organizations.organizationIdCopied")}
        failureMessage={t("organizations.memberCopyFailed")}
        tooltipClassName="max-w-80 font-mono break-all"
        value={organizationId}
      />
    </span>
  )
}

function organizationSkillGuideStatus(
  organizationSkills: UseOrganizationSkills,
  t: ReturnType<typeof useAppI18n>["t"],
): string {
  const skillCount = organizationSkills.skills.length
  if (!organizationSkills.apiEnabled) {
    return t("organizations.skillGuideUnavailableBadge")
  }
  if (organizationSkills.loading && !organizationSkills.hasLoaded) {
    return t("organizations.skillGuideLoading")
  }
  if (organizationSkills.error) {
    return t("organizations.skillGuideLoadFailed")
  }
  return t("organizations.skillGuideEnabledCount", { count: skillCount })
}

export function OrganizationSkillGuidePanel({
  busyAction,
  groupById,
  organizationSkills,
  providerRecommendationsLoading,
  providerRecommendationsResolvedCount,
  providerRecommendationsTotalCount,
  providerRecommendations,
  onAddRecommendation,
  onAddRecommendationBatch,
  onAddMarketPackage,
  onInstallRuntimeSkill,
  onInstallRuntimeSkills,
  onOpenManagedSkill,
  onOpenPackageDetail,
}: {
  busyAction: BusyAction | null
  groupById: ReadonlyMap<string, ManagedSkillGroup>
  organizationSkills: UseOrganizationSkills
  providerRecommendationsLoading: boolean
  providerRecommendationsResolvedCount: number
  providerRecommendationsTotalCount: number
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
  onOpenManagedSkill: (skillName: string) => void
  onOpenPackageDetail: (pkg: PublicSkillPackage) => void
}) {
  const { t } = useAppI18n()
  const statusLabel = organizationSkillGuideStatus(organizationSkills, t)
  const systemRecommendationCount = React.useMemo(
    () => planProviderSkillRecommendationBulkLinks(providerRecommendations, organizationSkills.skills).linkable.length,
    [organizationSkills.skills, providerRecommendations],
  )
  const organizationSkillsReady =
    organizationSkills.apiEnabled && organizationSkills.hasLoaded && !organizationSkills.error

  return (
    <section className="grid h-full min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-md border border-[var(--oo-divider)] bg-background">
      <div className="flex min-h-14 min-w-0 flex-wrap items-center justify-between gap-2 border-b border-[var(--oo-divider)] px-3 py-[7px]">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <h2 className="oo-text-title min-w-0 truncate text-foreground">{t("organizations.skillGuideTitle")}</h2>
            <Badge variant="muted" className="max-w-full shrink-0">
              <span className="truncate">{statusLabel}</span>
            </Badge>
            {organizationSkillsReady && providerRecommendationsLoading ? (
              <Badge variant="muted" className="max-w-full shrink-0">
                <span className="truncate">{t("organizations.skillGuideSystemLoading")}</span>
              </Badge>
            ) : organizationSkillsReady && systemRecommendationCount > 0 ? (
              <Badge variant="muted" className="max-w-full shrink-0">
                <span className="truncate">
                  {t("organizations.skillGuideSystemCount", { count: systemRecommendationCount })}
                </span>
              </Badge>
            ) : null}
            {!organizationSkills.canManage ? (
              <Badge variant="muted" className="max-w-full shrink-0">
                <LockKeyholeIcon className="size-3" />
                <span className="truncate">{t("organizations.skillGuideReadOnlyBadge")}</span>
              </Badge>
            ) : null}
          </div>
          <p className="oo-text-caption mt-0.5 text-muted-foreground">
            {t(
              organizationSkills.canManage
                ? "organizations.skillGuideDescription"
                : "organizations.skillGuideReadOnlyDescription",
            )}
          </p>
        </div>
      </div>
      <div className="min-h-0">
        <OrganizationSkillManageDialog
          busyAction={busyAction}
          groupById={groupById}
          organizationSkills={organizationSkills}
          providerRecommendationsLoading={providerRecommendationsLoading}
          providerRecommendationsResolvedCount={providerRecommendationsResolvedCount}
          providerRecommendationsTotalCount={providerRecommendationsTotalCount}
          providerRecommendations={providerRecommendations}
          variant="inline"
          onAddRecommendation={onAddRecommendation}
          onAddRecommendationBatch={onAddRecommendationBatch}
          onAddMarketPackage={onAddMarketPackage}
          onInstallRuntimeSkill={onInstallRuntimeSkill}
          onInstallRuntimeSkills={onInstallRuntimeSkills}
          onOpenManagedSkill={onOpenManagedSkill}
          onOpenPackageDetail={onOpenPackageDetail}
        />
      </div>
    </section>
  )
}

export function OrganizationManagementSkeleton() {
  return (
    <>
      <section className="min-w-0 overflow-hidden rounded-md border border-[var(--oo-divider)] bg-background">
        <div className="flex min-w-0 flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <Skeleton className="size-16 shrink-0 rounded-md" />
            <div className="grid min-h-16 min-w-0 content-center gap-1.5">
              <div className="flex min-w-0 items-baseline gap-3">
                <Skeleton className="h-5 w-28 rounded-md" />
                <Skeleton className="h-4 w-64 max-w-[48%] rounded-md" />
              </div>
              <div className="flex min-w-0 items-center gap-2">
                <Skeleton className="h-4 w-20 rounded-md" />
                <Skeleton className="h-6 w-16 rounded-full" />
              </div>
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
