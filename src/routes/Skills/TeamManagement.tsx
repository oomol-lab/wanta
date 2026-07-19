import type { PublicSkillPackage } from "../../../electron/skills/common.ts"
import type { TeamProviderOption } from "../../../electron/teams/common.ts"
import type { BusyAction, ProviderAccessForm } from "./team-management-model.ts"
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
import {
  buildGrantViews,
  buildTeamMemberViews,
  initialProviderAccessForm,
  providerOptionsWithSelected,
} from "./team-management-model.ts"
import {
  EmptyTeamsState,
  TeamManagementSkeleton,
  TeamSkillGuidePanel,
  TeamSwitcherPanel,
} from "./TeamManagementPanels.tsx"
import {
  AddMemberDialog,
  CreateTeamDialog,
  EditTeamDialog,
  ErrorBlock,
  TeamDetailPanel,
  Panel,
  ProviderAccessDialog,
} from "./TeamMembersPanel.tsx"
import { TeamMembersSheet } from "./TeamMembersSheet.tsx"
import { useSkillService } from "@/components/AppContext"
import { useAuthStateResource, useSkillInventoryResource } from "@/components/AppDataHooks"
import { useSkillVersionReportResource } from "@/components/AppDataHooks"
import { DeleteSkillConfirmDialog } from "@/components/DeleteSkillConfirmDialog"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useSkillObjectActions } from "@/components/useSkillObjectActions"
import { useAppI18n } from "@/i18n"
import { userFacingErrorDescription } from "@/lib/user-facing-error"
import { useRegistrySkillUpdate } from "@/routes/Skills/use-registry-skill-update"
import { useTeamDetails } from "@/routes/Skills/use-team-details"
import { useTeamForms } from "@/routes/Skills/use-team-forms"
import { useTeamMemberActions } from "@/routes/Skills/use-team-member-actions"
import { useTeamMemberSearch } from "@/routes/Skills/use-team-member-search"
import { useTeamSkillActions } from "@/routes/Skills/use-team-skill-actions"

export function TeamManagementRoute({
  connectedProvidersLoading = false,
  teamSkills,
  providerOptions,
  providerSkillRecommendationsState,
  workspace,
}: {
  connectedProvidersLoading?: boolean
  teamSkills?: UseTeamSkills
  providerOptions?: TeamProviderOption[] | null
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
  const [membersPanelOpen, setMembersPanelOpen] = React.useState(false)
  const [managedSkillId, setManagedSkillId] = React.useState<string | null>(null)
  const [selectedPackage, setSelectedPackage] = React.useState<PublicSkillPackage | null>(null)
  const [managedSkillError, setManagedSkillError] = React.useState<{ cause: unknown; skillId: string } | null>(null)
  const [providerAccessForm, setProviderAccessForm] = React.useState<ProviderAccessForm>(initialProviderAccessForm)
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
    membersState,
    providerOptionsState,
    refresh: refreshDetails,
    reload,
    setAppAccessForTeam,
    summariesState,
  } = useTeamDetails({
    activeAccountId,
    canManage,
    providerOptions,
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
  const grantState = React.useMemo(
    () => buildGrantViews(appAccessState.data, memberViews, providerOptionsState.data),
    [appAccessState.data, memberViews, providerOptionsState.data],
  )
  const grantsByUserId = React.useMemo(
    () => new Map(grantState.grants.map((grant) => [grant.userId, grant])),
    [grantState.grants],
  )
  const providerAccessMutationError = appAccessState.error ?? grantState.error
  const providerOptionsError = providerOptionsState.error
  const providerAccessError = providerAccessMutationError ?? providerOptionsError
  const showOverviewLoading = teams.length === 0 && (workspace.loading || !workspace.hasLoaded)
  const showOverviewError = teams.length === 0 && Boolean(workspace.error)
  const showTeamEmptyState = !showOverviewLoading && !showOverviewError && teams.length === 0

  React.useEffect(() => {
    resetMemberSearch()
    setBusyAction(null)
    setAddMemberOpen(false)
    setAddMemberError(null)
    setMembersPanelOpen(false)
    setManagedSkillId(null)
    setManagedSkillError(null)
    setProviderAccessForm(initialProviderAccessForm)
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

  const handleSelectTeamWorkspace = React.useCallback(
    (teamId: string) => {
      selectTeamWorkspace(teamId)
    },
    [selectTeamWorkspace],
  )

  const memberActions = useTeamMemberActions({
    activeAccountId,
    busyAction,
    canManage,
    memberInput,
    memberSearch,
    providerAccessMutationError,
    providerOptionsError,
    providerAccessForm,
    reloadDetails: reload,
    resetMemberSearch,
    selectedTeam,
    selectedSearchUserId,
    setAddMemberError,
    setAddMemberOpen,
    setAppAccessForTeam,
    setBusyAction,
    setProviderAccessForm,
  })
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
                  onEdit={teamForms.edit.openDialog}
                  onAddMember={() => setAddMemberOpen(true)}
                  onOpenMembers={() => setMembersPanelOpen(true)}
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
                  <TeamMembersSheet open={membersPanelOpen} onClose={() => setMembersPanelOpen(false)}>
                    <TeamDetailPanel
                      appAccessLoading={appAccessState.status === "loading"}
                      busyAction={busyAction}
                      canManage={canManage}
                      grantsByUserId={grantsByUserId}
                      members={memberViews}
                      membersComplete={membersComplete}
                      membersError={membersError}
                      membersForbidden={membersForbidden}
                      membersLoading={membersState.status === "loading"}
                      team={selectedTeam}
                      providerAccessError={providerAccessError}
                      providerAccessMutationError={providerAccessMutationError}
                      providerOptionsError={providerOptionsError}
                      providerOptionsLoading={providerOptionsState.status === "loading"}
                      onAddMember={() => setAddMemberOpen(true)}
                      onDisableMembers={memberActions.disableMembers}
                      onEditProviderAccess={memberActions.openEditProviderAccess}
                      onEnableMembers={memberActions.enableMembers}
                      onGrantProviderAccess={memberActions.openGrantProviderAccess}
                      onRemoveMember={memberActions.removeMember}
                      onRetryMembers={() => void reload()}
                      onRevokeProviderAccess={memberActions.revokeProviderAccess}
                    />
                  </TeamMembersSheet>
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
      <EditTeamDialog
        avatar={teamForms.edit.avatar}
        avatarFile={teamForms.edit.avatarFile}
        busy={busyAction === "updateTeam"}
        name={teamForms.edit.name}
        nameError={teamForms.edit.nameError}
        open={teamForms.edit.open}
        team={teamForms.edit.team}
        onAvatarChange={teamForms.edit.setAvatar}
        onAvatarFileChange={teamForms.edit.changeAvatarFile}
        onClose={teamForms.edit.close}
        onNameChange={teamForms.edit.setName}
        onSubmit={teamForms.edit.submit}
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
          setMemberInput(user.username)
          setActiveSearchUserId(user.userId)
          setSelectedSearchUserId(user.userId)
          setAddMemberError(null)
        }}
        onSubmit={memberActions.addMember}
      />
      <ProviderAccessDialog
        busy={busyAction === "saveProviderAccess"}
        form={providerAccessForm}
        memberOptions={memberViews.filter((member) => member.role !== "creator")}
        providerOptions={providerOptionsWithSelected(providerOptionsState.data, providerAccessForm.providers)}
        onClose={memberActions.closeProviderAccess}
        onFormChange={setProviderAccessForm}
        onSubmit={memberActions.saveProviderAccess}
      />
    </>
  )
}
