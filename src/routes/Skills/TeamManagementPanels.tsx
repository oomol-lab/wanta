import type { ManagedSkillGroup, PublicSkillPackage } from "../../../electron/skills/common.ts"
import type { Team, TeamRole } from "../../../electron/teams/common.ts"
import type { BusyAction, MemberView } from "./team-management-model.ts"
import type { UseTeamSkills } from "@/hooks/useTeamSkills"
import type { ProviderSkillRecommendation } from "@/routes/Skills/provider-skill-recommendations.ts"

import {
  Building2Icon,
  CheckIcon,
  ChevronsUpDownIcon,
  CopyIcon,
  LockKeyholeIcon,
  PlusIcon,
  SettingsIcon,
  UserPlusIcon,
  UsersIcon,
} from "lucide-react"
import * as React from "react"
import { planProviderSkillRecommendationBulkLinks } from "./team-management-model.ts"
import { TeamAvatar, TeamMemberAccessButton } from "./TeamMembersPanel.tsx"
import { TeamSkillManageDialog, TeamSkillManageLoadingSkeleton } from "./TeamSkillManageDialog.tsx"
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
import { useClipboardCopy } from "@/hooks/useClipboardCopy"
import { useAppI18n } from "@/i18n"
import { teamRoleLabelKey } from "@/lib/team-permissions"
import { cn } from "@/lib/utils"

export function TeamSwitcherPanel({
  avatarPreviewUrls,
  canManage,
  members,
  membersComplete,
  membersLoading,
  getTeamRole,
  onCreate,
  onAddMember,
  onOpenSettings,
  onRemoteAvatarLoad,
  onSelect,
  teams,
  selectedTeam,
  selectedTeamId,
}: {
  avatarPreviewUrls: Record<string, string>
  canManage: boolean
  members: MemberView[]
  membersComplete: boolean
  membersLoading: boolean
  getTeamRole: (team: Team) => TeamRole
  onCreate: () => void
  onAddMember: () => void
  onOpenSettings: () => void
  onRemoteAvatarLoad: (teamId: string, file: File | null) => void
  onSelect: (teamId: string) => void
  teams: Team[]
  selectedTeam: Team | null
  selectedTeamId: string | null
}) {
  const { t } = useAppI18n()

  return (
    <section className="min-w-0 overflow-hidden rounded-md border border-[var(--oo-divider)] bg-background">
      <div className="grid min-w-0 gap-3 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <div className="flex min-w-0 items-center gap-3">
          <div className="shrink-0">
            {selectedTeam ? (
              <TeamAvatar
                team={selectedTeam}
                previewUrl={avatarPreviewUrls[selectedTeam.id]}
                className="size-16 rounded-md text-lg"
                onRemoteAvatarLoad={onRemoteAvatarLoad}
              />
            ) : (
              <div className="grid size-16 place-items-center rounded-md bg-muted text-muted-foreground">
                <Building2Icon className="size-5" />
              </div>
            )}
          </div>

          <div className="grid min-h-16 min-w-0 flex-1 content-center gap-1">
            {selectedTeam ? (
              <>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      className="-ml-2 h-auto w-fit max-w-full justify-start px-2 py-1"
                    >
                      <span className="oo-text-dialog-title min-w-0 truncate text-foreground">{selectedTeam.name}</span>
                      <ChevronsUpDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
                    </Button>
                  </DropdownMenuTrigger>
                  <TeamSwitcherMenu
                    avatarPreviewUrls={avatarPreviewUrls}
                    getTeamRole={getTeamRole}
                    onCreate={onCreate}
                    onRemoteAvatarLoad={onRemoteAvatarLoad}
                    onSelect={onSelect}
                    selectedTeamId={selectedTeamId}
                    teams={teams}
                  />
                </DropdownMenu>
                <TeamMemberAccessButton
                  canManage={canManage}
                  members={members}
                  membersComplete={membersComplete}
                  membersLoading={membersLoading}
                  onOpen={onOpenSettings}
                />
              </>
            ) : (
              <div className="oo-text-caption min-w-0 truncate text-muted-foreground">{t("teams.selectTeam")}</div>
            )}
          </div>
        </div>

        <div className="flex min-w-0 flex-wrap gap-2 sm:justify-end">
          {selectedTeam && canManage ? (
            <Button type="button" variant="outline" size="sm" className="w-full sm:w-auto" onClick={onAddMember}>
              <UserPlusIcon className="size-3.5" />
              {t("teams.addMember")}
            </Button>
          ) : null}
          {selectedTeam ? (
            <Button type="button" variant="outline" size="sm" className="w-full sm:w-auto" onClick={onOpenSettings}>
              {canManage ? <SettingsIcon className="size-3.5" /> : <UsersIcon className="size-3.5" />}
              {t(canManage ? "teams.teamSettings" : "teams.viewMembers")}
            </Button>
          ) : null}
        </div>
      </div>
    </section>
  )
}

function TeamSwitcherMenu({
  avatarPreviewUrls,
  getTeamRole,
  onCreate,
  onRemoteAvatarLoad,
  onSelect,
  selectedTeamId,
  teams,
}: {
  avatarPreviewUrls: Record<string, string>
  getTeamRole: (team: Team) => TeamRole
  onCreate: () => void
  onRemoteAvatarLoad: (teamId: string, file: File | null) => void
  onSelect: (teamId: string) => void
  selectedTeamId: string | null
  teams: Team[]
}) {
  const { t } = useAppI18n()

  return (
    <DropdownMenuContent align="start" sideOffset={6} className="w-[min(36rem,calc(100vw-2rem))]">
      <DropdownMenuLabel>{t("teams.selectTeam")}</DropdownMenuLabel>
      <DropdownMenuSeparator />
      {teams.map((team) => {
        const role = getTeamRole(team)
        const selected = team.id === selectedTeamId
        return (
          <div key={team.id} role="group" className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-stretch">
            <DropdownMenuItem
              className={cn(
                "grid min-h-14 min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-2 py-2",
                selected && "rounded-r-none bg-accent",
              )}
              onSelect={() => onSelect(team.id)}
            >
              <TeamAvatar
                team={team}
                previewUrl={avatarPreviewUrls[team.id]}
                className="size-10 rounded-md text-sm"
                onRemoteAvatarLoad={onRemoteAvatarLoad}
              />
              <span className="grid min-h-10 min-w-0 content-center">
                <span className="flex min-h-5 min-w-0 items-center gap-2">
                  <span className="oo-text-label truncate">{team.name}</span>
                  {selected ? (
                    <span className="size-2 shrink-0 rounded-full bg-[var(--success)]" aria-hidden="true" />
                  ) : null}
                </span>
                <span className="oo-text-caption-compact min-w-0 truncate font-mono text-muted-foreground">
                  {team.id}
                </span>
              </span>
              <Badge variant="secondary" className="justify-self-end">
                {t(teamRoleLabelKey(role))}
              </Badge>
            </DropdownMenuItem>
            {selected ? <TeamIdCopyMenuItem teamId={team.id} /> : null}
          </div>
        )
      })}
      <DropdownMenuSeparator />
      <DropdownMenuItem className="gap-2 py-2" onSelect={onCreate}>
        <PlusIcon className="size-4" />
        <span>{t("teams.createNewTeam")}</span>
      </DropdownMenuItem>
    </DropdownMenuContent>
  )
}

function TeamIdCopyMenuItem({ teamId }: { teamId: string }) {
  const { t } = useAppI18n()
  const { copied, copyText } = useClipboardCopy({ failureMessage: t("teams.memberCopyFailed") })
  const Icon = copied ? CheckIcon : CopyIcon
  const label = copied ? t("teams.teamIdCopied") : t("teams.copyTeamId")

  return (
    <DropdownMenuItem
      aria-label={label}
      className="rounded-l-none bg-accent px-2"
      data-copied={copied ? "true" : "false"}
      onSelect={(event) => {
        event.preventDefault()
        void copyText(teamId)
      }}
    >
      <Icon className="size-3.5" aria-hidden="true" />
    </DropdownMenuItem>
  )
}

function teamSkillGuideStatus(teamSkills: UseTeamSkills, t: ReturnType<typeof useAppI18n>["t"]): string {
  const skillCount = teamSkills.skills.length
  if (!teamSkills.apiEnabled) {
    return t("teams.skillGuideUnavailableBadge")
  }
  if (teamSkills.loading && !teamSkills.hasLoaded) {
    return t("teams.skillGuideLoading")
  }
  if (teamSkills.error) {
    return t("teams.skillGuideLoadFailed")
  }
  return t("teams.skillGuideEnabledCount", { count: skillCount })
}

export function TeamSkillGuidePanel({
  busyAction,
  groupById,
  teamSkills,
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
  teamSkills: UseTeamSkills
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
  const statusLabel = teamSkillGuideStatus(teamSkills, t)
  const systemRecommendationCount = React.useMemo(
    () => planProviderSkillRecommendationBulkLinks(providerRecommendations, teamSkills.skills).linkable.length,
    [teamSkills.skills, providerRecommendations],
  )
  const teamSkillsReady = teamSkills.apiEnabled && teamSkills.hasLoaded && !teamSkills.error

  return (
    <section className="grid h-full min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-md border border-[var(--oo-divider)] bg-background">
      <div className="flex min-h-14 min-w-0 flex-wrap items-center justify-between gap-2 border-b border-[var(--oo-divider)] px-3 py-[7px]">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <h2 className="oo-text-title min-w-0 truncate text-foreground">{t("teams.skillGuideTitle")}</h2>
            <Badge variant="muted" className="max-w-full shrink-0">
              <span className="truncate">{statusLabel}</span>
            </Badge>
            {teamSkillsReady && providerRecommendationsLoading ? (
              <Badge variant="muted" className="max-w-full shrink-0">
                <span className="truncate">{t("teams.skillGuideSystemLoading")}</span>
              </Badge>
            ) : teamSkillsReady && systemRecommendationCount > 0 ? (
              <Badge variant="muted" className="max-w-full shrink-0">
                <span className="truncate">
                  {t("teams.skillGuideSystemCount", { count: systemRecommendationCount })}
                </span>
              </Badge>
            ) : null}
            {!teamSkills.canManage ? (
              <Badge variant="muted" className="max-w-full shrink-0">
                <LockKeyholeIcon className="size-3" />
                <span className="truncate">{t("teams.skillGuideReadOnlyBadge")}</span>
              </Badge>
            ) : null}
          </div>
          <p className="oo-text-caption mt-0.5 text-muted-foreground">
            {t(teamSkills.canManage ? "teams.skillGuideDescription" : "teams.skillGuideReadOnlyDescription")}
          </p>
        </div>
      </div>
      <div className="min-h-0">
        <TeamSkillManageDialog
          busyAction={busyAction}
          groupById={groupById}
          teamSkills={teamSkills}
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

export function TeamManagementSkeleton() {
  return (
    <>
      <section className="min-w-0 overflow-hidden rounded-md border border-[var(--oo-divider)] bg-background">
        <div className="grid min-w-0 gap-3 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <div className="flex min-w-0 items-center gap-3">
            <Skeleton className="size-16 shrink-0 rounded-md" />
            <div className="grid min-h-16 min-w-0 flex-1 content-center gap-1.5">
              <Skeleton className="h-7 w-32 rounded-md" />
              <div className="flex min-w-0 items-center gap-2">
                <Skeleton className="h-6 w-16 rounded-full" />
                <Skeleton className="h-4 w-20 rounded-md" />
              </div>
            </div>
          </div>
          <div className="flex min-w-0 flex-wrap gap-2 sm:justify-end">
            <Skeleton className="h-[var(--oo-control-height-compact)] w-full rounded-md sm:w-24" />
            <Skeleton className="h-[var(--oo-control-height-compact)] w-full rounded-md sm:w-28" />
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
          <TeamSkillManageLoadingSkeleton inline />
        </div>
      </section>
    </>
  )
}

export function EmptyTeamsState({ onCreate }: { onCreate: () => void }) {
  const { t } = useAppI18n()
  return (
    <div className="flex min-h-full items-center justify-center px-4 py-10">
      <div className="grid max-w-md justify-items-center gap-4 text-center">
        <div className="grid size-14 place-items-center rounded-md border border-[var(--oo-divider)] bg-[var(--oo-inspector-surface)] text-muted-foreground">
          <Building2Icon className="size-7" />
        </div>
        <div className="min-w-0">
          <div className="oo-text-title text-foreground">{t("teams.emptyTeams")}</div>
          <div className="oo-text-body mt-1 max-w-sm text-muted-foreground">{t("teams.emptyTeamsDescription")}</div>
        </div>
        <Button type="button" onClick={onCreate}>
          <PlusIcon className="size-4" />
          {t("teams.createTeam")}
        </Button>
      </div>
    </div>
  )
}
