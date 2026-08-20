import type { ConnectionProviderSummary } from "../../../electron/connections/common.ts"
import type { PublicSkillPackage } from "../../../electron/skills/common.ts"
import type { BusyAction, MemberView } from "./team-management-model.ts"
import type { MemberConnectionAccessDelta } from "./team-member-connection-access-model.ts"
import type { ProviderSkillRecommendationsState } from "@/hooks/useProviderSkillRecommendations"
import type { UseTeamSkills } from "@/hooks/useTeamSkills"
import type { UseTeamWorkspace } from "@/hooks/useTeamWorkspace"

import { RefreshCwIcon } from "lucide-react"
import * as React from "react"
import { PublicSkillPackageSheet } from "./PublicSkillPackageSheet.tsx"
import {
  getPublicPackagePrimaryInstallSkill,
  getPublicPackagePrimarySkill,
  getPublicSkillInstallKey,
  getGroupStatus,
  getRuntimeHosts,
  getSkillVersionCheck,
  getSkillVersionCheckKey,
  getSelectedManagedSkillGroup,
} from "./skill-route-model.ts"
import { SkillDetailContent } from "./SkillDetailContent.tsx"
import { SkillManagementSheet } from "./SkillUiParts.tsx"
import { buildTeamMemberViews } from "./team-management-model.ts"
import { applyMemberConnectionAccessDelta, MemberConnectionAccessError } from "./team-member-connection-access-model.ts"
import {
  EmptyTeamsState,
  TeamManagementSkeleton,
  TeamSkillGuidePanel,
  TeamSwitcherPanel,
} from "./TeamManagementPanels.tsx"
import { TeamMemberConnectionAccessPanel } from "./TeamMemberConnectionAccessDialog.tsx"
import {
  AddMemberDialog,
  CreateTeamDialog,
  ErrorBlock,
  TeamDetailPanel,
  Panel,
  TeamProfileSettingsPanel,
} from "./TeamMembersPanel.tsx"
import { TeamSettingsSheet } from "./TeamSettingsSheet.tsx"
import { useSkillService } from "@/components/AppContext"
import { useAuthStateResource, useSkillInventoryResource } from "@/components/AppDataHooks"
import { useSkillVersionReportResource } from "@/components/AppDataHooks"
import { DeleteSkillConfirmDialog } from "@/components/DeleteSkillConfirmDialog"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useSkillObjectActions } from "@/components/useSkillObjectActions"
import { useAppI18n } from "@/i18n"
import { invalidateTeamDetailsResource } from "@/lib/team-details-resource"
import { getTeamAppAccessSnapshot, listTeamConnectionApps, updateTeamAppAccess } from "@/lib/teams-client"
import { userFacingErrorDescription } from "@/lib/user-facing-error"
import { useRegistrySkillUpdate } from "@/routes/Skills/use-registry-skill-update"
import { useTeamDetails } from "@/routes/Skills/use-team-details"
import { useTeamForms } from "@/routes/Skills/use-team-forms"
import { useTeamMemberActions } from "@/routes/Skills/use-team-member-actions"
import { useTeamMemberSearch } from "@/routes/Skills/use-team-member-search"
import { useTeamSkillActions } from "@/routes/Skills/use-team-skill-actions"

type TeamManagementOverlay =
  | { kind: "none" }
  | { kind: "settings" }
  | { kind: "memberConnectionAccess"; member: MemberView }

export function TeamManagementRoute({
  connectionProviders,
  connectedProvidersLoading = false,
  onOpenConnection,
  teamSkills,
  providerSkillRecommendationsState,
  workspace,
}: {
  connectionProviders: ConnectionProviderSummary[]
  connectedProvidersLoading?: boolean
  onOpenConnection: (target: { appId: string; service: string }) => void
  teamSkills?: UseTeamSkills
  providerSkillRecommendationsState: ProviderSkillRecommendationsState
  workspace: UseTeamWorkspace
}) {
  const { locale, t } = useAppI18n()
  const authResource = useAuthStateResource()
  const skillInventory = useSkillInventoryResource()
  const skillVersions = useSkillVersionReportResource()
  const skillService = useSkillService()
  const activeAccount = authResource.data?.status === "authenticated" ? authResource.data.account : undefined
  const activeAccountId = activeAccount?.id
  const activeWorkspace = workspace.activeWorkspace
  const selectTeamWorkspace = workspace.selectTeam
  const refreshWorkspace = workspace.refresh
  const upsertWorkspaceTeam = workspace.upsertTeam
  const getWorkspaceTeamCanManage = workspace.getTeamCanManage
  const getWorkspaceTeamRole = workspace.getTeamRole
  const activeWorkspaceTeamId = activeWorkspace.teamId || null
  const [busyAction, setBusyAction] = React.useState<BusyAction | null>(null)
  const [addMemberOpen, setAddMemberOpen] = React.useState(false)
  const [addMemberError, setAddMemberError] = React.useState<string | null>(null)
  const [overlay, setOverlay] = React.useState<TeamManagementOverlay>({ kind: "none" })
  const [managedSkillId, setManagedSkillId] = React.useState<string | null>(null)
  const [selectedPackage, setSelectedPackage] = React.useState<PublicSkillPackage | null>(null)
  const [managedSkillError, setManagedSkillError] = React.useState<{ cause: unknown; skillId: string } | null>(null)
  const avatarPreviewUrls = workspace.teamAvatarPreviewUrls
  const clearTeamAvatarPreview = workspace.clearTeamAvatarPreview

  const teams = workspace.teams
  const selectedTeamId = activeWorkspaceTeamId
  const selectedTeam = React.useMemo(() => {
    return activeWorkspace.team ?? teams.find((item) => item.id === activeWorkspace.teamId) ?? null
  }, [activeWorkspace, teams])
  const selectedTeamSkills = selectedTeam && teamSkills?.teamId === selectedTeam.id ? teamSkills : null
  const {
    addTeamSkillBatch,
    addTeamSkillFromPackage,
    addTeamSkillFromRecommendation,
    installRuntimeSkill,
    installRuntimeSkills,
  } = useTeamSkillActions({
    busyAction,
    teamSkills: selectedTeamSkills,
    setBusyAction,
  })
  const skillGroupById = React.useMemo(
    () => new Map((skillInventory.data?.groups ?? []).map((group) => [group.id, group])),
    [skillInventory.data?.groups],
  )
  const selectedPackagePrimarySkill = selectedPackage ? getPublicPackagePrimarySkill(selectedPackage) : undefined
  const selectedPackageInstallSkill = selectedPackage
    ? (getPublicPackagePrimaryInstallSkill(skillGroupById, selectedPackage) ?? selectedPackagePrimarySkill)
    : undefined
  const selectedPackageInstallBusy = Boolean(
    selectedPackage &&
    selectedPackageInstallSkill &&
    busyAction === `installSkill:${selectedPackage.name}:${selectedPackageInstallSkill.name}`,
  )
  const selectedPackageAddBusy = Boolean(
    selectedPackage &&
    selectedPackagePrimarySkill &&
    busyAction === `addSkill:${selectedPackage.name}:${selectedPackagePrimarySkill.name}`,
  )
  const managedSkill = getSelectedManagedSkillGroup(skillInventory.data?.groups ?? [], managedSkillId)
  const managedSkillStatus = managedSkill ? getGroupStatus(managedSkill, t, getRuntimeHosts(managedSkill)) : null
  const skillVersionCheckByKey = React.useMemo(
    () =>
      new Map(
        (skillVersions.data?.skills ?? []).map((check) => [
          getSkillVersionCheckKey(check.skillId, check.packageName),
          check,
        ]),
      ),
    [skillVersions.data?.skills],
  )
  const managedSkillVersionCheck = getSkillVersionCheck(skillVersionCheckByKey, managedSkill)
  const { copySkillPath, isRemovingSkill, openSkillFolder, removeSkill, removeTarget, setRemoveTarget } =
    useSkillObjectActions({ onDeleted: () => setManagedSkillId(null) })
  const handleRegistrySkillUpdateError = React.useCallback((cause: unknown, skillId: string) => {
    setManagedSkillError({ cause, skillId })
  }, [])
  const clearRegistrySkillUpdateError = React.useCallback(() => setManagedSkillError(null), [])
  const { updateRegistrySkill, updatingRegistrySkillId } = useRegistrySkillUpdate({
    inventoryResource: skillInventory,
    onError: handleRegistrySkillUpdateError,
    onStart: clearRegistrySkillUpdateError,
    skillService,
    versionResource: skillVersions,
  })
  const openManagedSkill = React.useCallback((skillId: string) => {
    setSelectedPackage(null)
    setManagedSkillError(null)
    setManagedSkillId(skillId)
  }, [])
  const openPackageDetail = React.useCallback((pkg: PublicSkillPackage) => {
    setManagedSkillId(null)
    setManagedSkillError(null)
    setSelectedPackage(pkg)
  }, [])
  const providerSkillRecommendations = providerSkillRecommendationsState.recommendations
  const canManage = activeWorkspace.canManage
  const {
    appAccessState,
    connectionAppsState,
    membersState,
    refresh: refreshDetails,
    reload,
    summariesState,
  } = useTeamDetails({
    activeAccountId,
    canManage,
    selectedTeam,
  })
  const {
    activeSearchUserId,
    memberInput,
    memberSearch,
    moveActiveSearchUser,
    resetMemberSearch,
    selectedSearchUserId,
    setActiveSearchUserId,
    setMemberInput,
    setSelectedSearchUserId,
  } = useTeamMemberSearch({ addMemberOpen, members: membersState.data })
  const memberViews = React.useMemo(
    () =>
      buildTeamMemberViews({
        account: activeAccount,
        accountRole: activeWorkspace.role,
        members: membersState.data,
        team: selectedTeam,
        summaries: summariesState.data,
      }),
    [activeAccount, activeWorkspace, membersState.data, selectedTeam, summariesState.data],
  )
  const membersError = membersState.error
  const membersForbidden = membersState.errorStatus === 403
  const membersComplete = membersState.status === "ready"
  const showOverviewLoading = teams.length === 0 && (workspace.loading || !workspace.hasLoaded)
  const showOverviewError = teams.length === 0 && Boolean(workspace.error)
  const showTeamEmptyState = !showOverviewLoading && !showOverviewError && teams.length === 0

  React.useEffect(() => {
    resetMemberSearch()
    setBusyAction(null)
    setAddMemberOpen(false)
    setAddMemberError(null)
    setOverlay({ kind: "none" })
    setManagedSkillId(null)
    setManagedSkillError(null)
    setSelectedPackage(null)
  }, [resetMemberSearch, selectedTeam?.id])

  React.useEffect(() => {
    const handleWindowFocus = () => {
      void refreshWorkspace()
      void refreshDetails()
    }
    window.addEventListener("focus", handleWindowFocus)
    return () => window.removeEventListener("focus", handleWindowFocus)
  }, [refreshDetails, refreshWorkspace])

  const teamForms = useTeamForms({
    busyAction,
    canManageTeam: getWorkspaceTeamCanManage,
    teams,
    refreshWorkspace,
    selectedTeamId,
    selectTeam: selectTeamWorkspace,
    setBusyAction,
    upsertTeam: upsertWorkspaceTeam,
  })
  const closeTeamSettings = React.useCallback(() => {
    if (busyAction === "updateTeam") {
      return
    }
    teamForms.edit.close()
    setOverlay({ kind: "none" })
  }, [busyAction, teamForms.edit])

  const openMemberConnectionAccess = React.useCallback((member: MemberView) => {
    setOverlay({ kind: "memberConnectionAccess", member })
  }, [])

  const handleSelectTeamWorkspace = React.useCallback(
    (teamId: string) => {
      selectTeamWorkspace(teamId)
    },
    [selectTeamWorkspace],
  )

  const memberActions = useTeamMemberActions({
    activeAccountId,
    actorRole: activeWorkspace.role,
    canManage,
    memberInput,
    memberSearch,
    reloadDetails: reload,
    resetMemberSearch,
    selectedTeam,
    selectedSearchUserId,
    setAddMemberError,
    setAddMemberOpen,
    setBusyAction,
  })
  const saveMemberConnectionAccess = React.useCallback(
    async (delta: MemberConnectionAccessDelta) => {
      if (!selectedTeam || !canManage) throw new Error(t("teams.memberConnectionAccessReadOnly"))
      const [latest, apps] = await Promise.all([
        getTeamAppAccessSnapshot(selectedTeam.id),
        listTeamConnectionApps(selectedTeam.name, { forceRefresh: true }),
      ])
      if (!latest.etag) throw new MemberConnectionAccessError("concurrencyUnavailable")
      const next = applyMemberConnectionAccessDelta(latest.access, apps, delta)
      await updateTeamAppAccess(selectedTeam.id, next, { etag: latest.etag })
      invalidateTeamDetailsResource(activeAccountId, selectedTeam.id)
      await reload()
    },
    [activeAccountId, canManage, reload, selectedTeam, t],
  )
  return (
    <>
      <div className="h-full min-h-0 overflow-hidden px-3 py-3">
        {showOverviewError ? (
          <div className="flex min-h-full items-center justify-center px-4 py-10">
            <ErrorBlock
              error={workspace.error ? userFacingErrorDescription(workspace.error, t) : ""}
              onRetry={() => void refreshWorkspace({ forceRefresh: true })}
            />
          </div>
        ) : showTeamEmptyState ? (
          <EmptyTeamsState onCreate={teamForms.create.openDialog} />
        ) : (
          <div className="grid h-full min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] gap-3">
            {showOverviewLoading ? (
              <TeamManagementSkeleton />
            ) : (
              <>
                <TeamSwitcherPanel
                  canManage={canManage}
                  getTeamRole={getWorkspaceTeamRole}
                  members={memberViews}
                  membersComplete={membersComplete}
                  membersLoading={membersState.status === "loading"}
                  teams={teams}
                  avatarPreviewUrls={avatarPreviewUrls}
                  selectedTeam={selectedTeam}
                  selectedTeamId={selectedTeamId}
                  onCreate={teamForms.create.openDialog}
                  onAddMember={() => setAddMemberOpen(true)}
                  onOpenSettings={() => setOverlay({ kind: "settings" })}
                  onRemoteAvatarLoad={clearTeamAvatarPreview}
                  onSelect={handleSelectTeamWorkspace}
                />
                {selectedTeam ? (
                  <div className="grid min-h-0 min-w-0">
                    {selectedTeamSkills ? (
                      <TeamSkillGuidePanel
                        busyAction={busyAction}
                        groupById={skillGroupById}
                        teamSkills={selectedTeamSkills}
                        providerRecommendationsLoading={
                          connectedProvidersLoading || providerSkillRecommendationsState.isLoading
                        }
                        providerRecommendationsResolvedCount={providerSkillRecommendationsState.resolvedCount}
                        providerRecommendationsTotalCount={providerSkillRecommendationsState.totalCount}
                        providerRecommendations={providerSkillRecommendations}
                        onAddRecommendation={addTeamSkillFromRecommendation}
                        onAddRecommendationBatch={addTeamSkillBatch}
                        onAddMarketPackage={addTeamSkillFromPackage}
                        onInstallRuntimeSkill={installRuntimeSkill}
                        onInstallRuntimeSkills={installRuntimeSkills}
                        onOpenManagedSkill={openManagedSkill}
                        onOpenPackageDetail={openPackageDetail}
                      />
                    ) : (
                      <Panel title={t("teams.skillGuideTitle")} description={t("teams.skillGuideDescription")}>
                        <div className="p-3">
                          <Skeleton className="h-16 rounded-md" />
                        </div>
                      </Panel>
                    )}
                  </div>
                ) : null}
                {selectedTeam ? (
                  <TeamSettingsSheet
                    open={overlay.kind !== "none"}
                    title={
                      overlay.kind === "memberConnectionAccess"
                        ? t("teams.memberConnectionAccessTitle")
                        : t(canManage ? "teams.teamSettings" : "teams.viewMembers")
                    }
                    onBack={
                      overlay.kind === "memberConnectionAccess" ? () => setOverlay({ kind: "settings" }) : undefined
                    }
                    onClose={closeTeamSettings}
                  >
                    {overlay.kind === "memberConnectionAccess" ? (
                      <TeamMemberConnectionAccessPanel
                        data={{
                          access: appAccessState.data,
                          apps: connectionAppsState.data,
                          error: appAccessState.error ?? connectionAppsState.error,
                          loading: appAccessState.status === "loading" || connectionAppsState.status === "loading",
                          providers: connectionProviders,
                        }}
                        member={overlay.member}
                        onClose={closeTeamSettings}
                        onOpenConnection={(target) => {
                          setOverlay({ kind: "none" })
                          onOpenConnection(target)
                        }}
                        onRetry={() => void reload()}
                        onSave={saveMemberConnectionAccess}
                      />
                    ) : (
                      <div className="grid min-w-0 gap-3">
                        {canManage ? (
                          <TeamProfileSettingsPanel
                            avatar={teamForms.edit.avatar}
                            avatarFile={teamForms.edit.avatarFile}
                            busy={busyAction === "updateTeam"}
                            editing={teamForms.edit.open}
                            name={teamForms.edit.name}
                            nameError={teamForms.edit.nameError}
                            team={selectedTeam}
                            onAvatarChange={teamForms.edit.setAvatar}
                            onAvatarFileChange={teamForms.edit.changeAvatarFile}
                            onClose={teamForms.edit.close}
                            onEdit={() => teamForms.edit.openDialog(selectedTeam)}
                            onNameChange={teamForms.edit.setName}
                            onSubmit={teamForms.edit.submit}
                          />
                        ) : null}
                        <TeamDetailPanel
                          actorRole={activeWorkspace.role}
                          actorUserId={activeAccountId}
                          busyAction={busyAction}
                          canManage={canManage}
                          connectionAccess={{
                            access: appAccessState.data,
                            apps: connectionAppsState.data,
                            error: appAccessState.error ?? connectionAppsState.error,
                            loading: appAccessState.status === "loading" || connectionAppsState.status === "loading",
                            providers: connectionProviders,
                          }}
                          members={memberViews}
                          membersComplete={membersComplete}
                          membersError={membersError}
                          membersForbidden={membersForbidden}
                          membersLoading={membersState.status === "loading"}
                          team={selectedTeam}
                          onAddMember={() => setAddMemberOpen(true)}
                          onDisableMembers={memberActions.disableMembers}
                          onEnableMembers={memberActions.enableMembers}
                          onOpenMemberConnectionAccess={openMemberConnectionAccess}
                          onRemoveMember={memberActions.removeMember}
                          onRetryMembers={() => void reload()}
                          onUpdateMemberRole={memberActions.updateMemberRole}
                        />
                      </div>
                    )}
                  </TeamSettingsSheet>
                ) : null}
              </>
            )}
          </div>
        )}
      </div>
      {managedSkill ? (
        <SkillManagementSheet
          subjectName={managedSkill.name}
          onClose={() => {
            setManagedSkillId(null)
            setManagedSkillError(null)
          }}
        >
          <SkillDetailContent
            copySkillPath={copySkillPath}
            inventoryInitialLoading={skillInventory.isInitialLoading}
            isRemovingSkill={isRemovingSkill}
            isSkillLinkedToTeam={Boolean(
              selectedTeamSkills?.skills.some((skill) => skill.packageName === managedSkill.packageName),
            )}
            openSkillFolder={openSkillFolder}
            publishSkill={() => undefined}
            publishingSkillId={null}
            requestRemoveSkill={(skill) => setRemoveTarget({ skill })}
            requestTeamLink={() => undefined}
            selectedPlanError={managedSkillError?.skillId === managedSkill.id ? managedSkillError.cause : null}
            selectedSkill={managedSkill}
            selectedStatus={managedSkillStatus}
            selectedVersionCheck={managedSkillVersionCheck}
            showTeamLinkAction={false}
            showPublishAction={false}
            updateRegistrySkill={updateRegistrySkill}
            updatingRegistrySkillId={updatingRegistrySkillId}
          />
        </SkillManagementSheet>
      ) : null}
      {selectedPackage ? (
        <PublicSkillPackageSheet
          groupById={skillGroupById}
          installingKey={
            selectedPackageInstallBusy
              ? getPublicSkillInstallKey(selectedPackage, selectedPackageInstallSkill?.name)
              : null
          }
          locale={locale}
          pkg={selectedPackage}
          additionalActions={
            canManage &&
            !selectedTeamSkills?.skills.some((skill) => skill.packageName === selectedPackage.name) &&
            selectedPackagePrimarySkill ? (
              <Button
                type="button"
                size="sm"
                disabled={Boolean(busyAction)}
                onClick={() =>
                  void addTeamSkillFromPackage(selectedPackage, {
                    installRuntime: false,
                    skillName: selectedPackagePrimarySkill.name,
                  })
                }
              >
                {selectedPackageAddBusy ? <RefreshCwIcon className="size-3.5 animate-spin" /> : null}
                {selectedPackageAddBusy ? t("skills.teamAdding") : t("teams.skillManageAddOnly")}
              </Button>
            ) : null
          }
          onClose={() => setSelectedPackage(null)}
          onInstall={(pkg, skillName) => {
            const targetSkillName = skillName ?? getPublicPackagePrimarySkill(pkg)?.name
            if (targetSkillName) {
              void installRuntimeSkill({ packageName: pkg.name, skillName: targetSkillName })
            }
          }}
          onOpenManagedSkill={openManagedSkill}
        />
      ) : null}
      <DeleteSkillConfirmDialog
        isRemoving={isRemovingSkill}
        target={removeTarget}
        onConfirm={removeSkill}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            setRemoveTarget(null)
          }
        }}
      />
      <CreateTeamDialog
        avatarFile={teamForms.create.avatarFile}
        busy={busyAction === "create"}
        name={teamForms.create.name}
        nameError={teamForms.create.nameError}
        open={teamForms.create.open}
        onAvatarFileChange={teamForms.create.setAvatarFile}
        onClose={teamForms.create.close}
        onNameChange={teamForms.create.setName}
        onSubmit={teamForms.create.submit}
      />
      <AddMemberDialog
        activeUserId={activeSearchUserId}
        addError={addMemberError}
        busy={busyAction === "add"}
        input={memberInput}
        open={addMemberOpen}
        search={memberSearch}
        selectedUserId={selectedSearchUserId}
        onClose={() => {
          if (busyAction !== "add") {
            setAddMemberOpen(false)
            setAddMemberError(null)
            resetMemberSearch()
          }
        }}
        onInputChange={(value) => {
          setMemberInput(value)
          setActiveSearchUserId(null)
          setSelectedSearchUserId(null)
          setAddMemberError(null)
        }}
        onMoveActiveUser={moveActiveSearchUser}
        onSearchSelect={(user) => {
          setActiveSearchUserId(user.userId)
          setSelectedSearchUserId(user.userId)
          setAddMemberError(null)
        }}
        onSubmit={memberActions.addMember}
      />
    </>
  )
}
