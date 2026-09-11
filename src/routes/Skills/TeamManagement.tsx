import type { PublicSkillPackage } from "../../../electron/skills/common.ts"
import type { BusyAction } from "./team-management-model.ts"
import type { ProviderSkillRecommendationsState } from "@/hooks/useProviderSkillRecommendations"
import type { UseTeamSkills } from "@/hooks/useTeamSkills"
import type { UseTeamWorkspace } from "@/hooks/useTeamWorkspace"

import { ArrowLeftIcon, RefreshCwIcon } from "lucide-react"
import * as React from "react"
import { PublicSkillPackageDetail } from "./PublicSkillPackageSheet.tsx"
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
import { buildTeamMemberViews } from "./team-management-model.ts"
import {
  EmptyTeamsState,
  TeamManagementSkeleton,
  TeamSkillGuidePanel,
  TeamSwitcherPanel,
} from "./TeamManagementPanels.tsx"
import {
  AddMemberDialog,
  TeamMemberAdditionNotice,
  CreateTeamDialog,
  ErrorBlock,
  TeamDetailPanel,
  Panel,
  TeamProfileSettingsPanel,
} from "./TeamMembersPanel.tsx"
import { useSkillService } from "@/components/AppContext"
import { useAuthStateResource, useSkillInventoryResource } from "@/components/AppDataHooks"
import { useSkillVersionReportResource } from "@/components/AppDataHooks"
import { DeleteSkillConfirmDialog } from "@/components/DeleteSkillConfirmDialog"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useSkillObjectActions } from "@/components/useSkillObjectActions"
import { useAppI18n } from "@/i18n"
import { userFacingErrorDescription } from "@/lib/user-facing-error"
import { useRegistrySkillUpdate } from "@/routes/Skills/use-registry-skill-update"
import { useTeamDetails } from "@/routes/Skills/use-team-details"
import { useTeamForms } from "@/routes/Skills/use-team-forms"
import { useTeamMemberActions } from "@/routes/Skills/use-team-member-actions"
import { useTeamMemberSearch } from "@/routes/Skills/use-team-member-search"
import { useTeamSkillActions } from "@/routes/Skills/use-team-skill-actions"

type TeamPageTab = "skills" | "members" | "settings"

export function TeamManagementRoute({
  connectedProvidersLoading = false,
  teamSkills,
  providerSkillRecommendationsState,
  workspace,
}: {
  connectedProvidersLoading?: boolean
  teamSkills?: UseTeamSkills
  providerSkillRecommendationsState: ProviderSkillRecommendationsState
  workspace: UseTeamWorkspace
}) {
  const { locale, t } = useAppI18n()
  const pageRef = React.useRef<HTMLDivElement>(null)
  const authResource = useAuthStateResource()
  const skillInventory = useSkillInventoryResource()
  const skillVersions = useSkillVersionReportResource({ autoLoad: true })
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
  const [skillActionsContainer, setSkillActionsContainer] = React.useState<HTMLDivElement | null>(null)
  const [activeTab, setActiveTab] = React.useState<TeamPageTab>("skills")
  const [managedSkillId, setManagedSkillId] = React.useState<string | null>(null)
  const [selectedPackage, setSelectedPackage] = React.useState<PublicSkillPackage | null>(null)
  const [managedSkillError, setManagedSkillError] = React.useState<{ cause: unknown; skillId: string } | null>(null)
  const detailBackRef = React.useRef<HTMLButtonElement>(null)
  const detailOriginRef = React.useRef<HTMLElement | null>(null)

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
  const managedSkillReady = Boolean(managedSkill)
  React.useEffect(() => {
    if (managedSkillId || selectedPackage) {
      detailBackRef.current?.focus()
    } else if (detailOriginRef.current) {
      const origin = detailOriginRef.current
      detailOriginRef.current = null
      if (origin.isConnected && !origin.closest("[hidden]")) origin.focus()
      else pageRef.current?.focus()
    }
  }, [managedSkillId, selectedPackage, managedSkillReady])
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
    if (!detailOriginRef.current && document.activeElement instanceof HTMLElement) {
      detailOriginRef.current = document.activeElement
    }
    setSelectedPackage(null)
    setManagedSkillError(null)
    setManagedSkillId(skillId)
  }, [])
  const openPackageDetail = React.useCallback((pkg: PublicSkillPackage) => {
    if (!detailOriginRef.current && document.activeElement instanceof HTMLElement) {
      detailOriginRef.current = document.activeElement
    }
    setManagedSkillId(null)
    setManagedSkillError(null)
    setSelectedPackage(pkg)
  }, [])
  const providerSkillRecommendations = providerSkillRecommendationsState.recommendations
  const canManage = activeWorkspace.canManage
  const visibleTab = activeTab === "settings" && !canManage ? "members" : activeTab
  const {
    membersState,
    refresh: refreshDetails,
    reload,
    summariesState,
  } = useTeamDetails({
    activeAccountId,
    selectedTeam,
    includeAllSummaries: visibleTab === "members",
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
    [activeAccount, activeWorkspace.role, membersState.data, selectedTeam, summariesState.data],
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
    setActiveTab("skills")
    setManagedSkillId(null)
    setManagedSkillError(null)
    setSelectedPackage(null)
  }, [resetMemberSearch, selectedTeam?.id])

  const refreshTeamSkills = selectedTeamSkills?.refresh
  React.useEffect(() => {
    void refreshTeamSkills?.()
    const handleWindowFocus = () => {
      void refreshWorkspace()
      void refreshDetails()
      void refreshTeamSkills?.()
    }
    window.addEventListener("focus", handleWindowFocus)
    return () => window.removeEventListener("focus", handleWindowFocus)
  }, [refreshDetails, refreshTeamSkills, refreshWorkspace])

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
      teamForms.edit.close()
      selectTeamWorkspace(teamId)
    },
    [selectTeamWorkspace, teamForms.edit],
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
  const additionNotice = (
    <TeamMemberAdditionNotice
      userId={memberActions.addedMemberUserId}
      failed={Boolean(membersError)}
      onRetry={() => void reload()}
      onDismiss={memberActions.dismissAddition}
    />
  )
  return (
    <>
      <div ref={pageRef} tabIndex={-1} className="h-full min-h-0 overflow-hidden px-5 py-3 outline-none lg:px-7">
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
                <div className="grid gap-3">
                  {additionNotice}
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
                    onOpenMembers={() => setActiveTab("members")}
                    onRemoteAvatarLoad={clearTeamAvatarPreview}
                    onSelect={handleSelectTeamWorkspace}
                  />
                </div>
                {selectedTeam ? (
                  <Tabs
                    value={visibleTab}
                    onValueChange={(value) => {
                      if (value !== "skills" && value !== "members" && value !== "settings") return
                      setActiveTab(value)
                      if (
                        value === "settings" &&
                        canManage &&
                        (!teamForms.edit.open || teamForms.edit.team?.id !== selectedTeam.id)
                      )
                        teamForms.edit.openDialog(selectedTeam)
                    }}
                    className="min-h-0 min-w-0 gap-0"
                  >
                    <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b">
                      <TabsList variant="line" className="shrink-0 justify-start">
                        <TabsTrigger className="flex-none px-4" value="skills">
                          {t("nav.skills")}
                        </TabsTrigger>
                        <TabsTrigger className="flex-none px-4" value="members">
                          {t("teams.membersTab")}
                        </TabsTrigger>
                        {canManage ? (
                          <TabsTrigger className="flex-none px-4" value="settings">
                            {t("teams.settingsTab")}
                          </TabsTrigger>
                        ) : null}
                      </TabsList>
                      <div
                        ref={setSkillActionsContainer}
                        hidden={visibleTab !== "skills" || Boolean(managedSkill || selectedPackage)}
                        className="pb-1"
                      />
                    </div>
                    <TabsContent value="skills" className="min-h-0 overflow-hidden pt-3">
                      <div hidden={Boolean(managedSkill || selectedPackage)} className="h-full min-h-0">
                        {selectedTeamSkills ? (
                          <TeamSkillGuidePanel
                            actionsContainer={skillActionsContainer}
                            busyAction={busyAction}
                            runtimeInventoryLoading={skillInventory.isInitialLoading}
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
                      {managedSkill || selectedPackage ? (
                        <div className="flex h-full min-h-0 flex-col gap-4">
                          <div className="shrink-0">
                            <Button
                              ref={detailBackRef}
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setManagedSkillId(null)
                                setManagedSkillError(null)
                                setSelectedPackage(null)
                              }}
                            >
                              <ArrowLeftIcon data-icon="inline-start" />
                              {t("teams.backToSkills")}
                            </Button>
                          </div>
                          <div className="min-h-0 overflow-y-auto">
                            <div className="mx-auto grid max-w-3xl gap-3 pb-4">
                              {managedSkill ? (
                                <SkillDetailContent
                                  copySkillPath={copySkillPath}
                                  inventoryInitialLoading={skillInventory.isInitialLoading}
                                  isRemovingSkill={isRemovingSkill}
                                  isSkillLinkedToTeam={Boolean(
                                    selectedTeamSkills?.skills.some(
                                      (skill) => skill.packageName === managedSkill.packageName,
                                    ),
                                  )}
                                  openSkillFolder={openSkillFolder}
                                  publishSkill={() => undefined}
                                  publishingSkillId={null}
                                  requestRemoveSkill={(skill) => setRemoveTarget({ skill })}
                                  requestTeamLink={() => undefined}
                                  selectedPlanError={
                                    managedSkillError?.skillId === managedSkill.id ? managedSkillError.cause : null
                                  }
                                  selectedSkill={managedSkill}
                                  selectedStatus={managedSkillStatus}
                                  selectedVersionCheck={managedSkillVersionCheck}
                                  showTeamLinkAction={false}
                                  showPublishAction={false}
                                  updateRegistrySkill={updateRegistrySkill}
                                  updatingRegistrySkillId={updatingRegistrySkillId}
                                />
                              ) : selectedPackage ? (
                                <PublicSkillPackageDetail
                                  canInstall
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
                                    !selectedTeamSkills?.skills.some(
                                      (skill) => skill.packageName === selectedPackage.name,
                                    ) &&
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
                                        {selectedPackageAddBusy ? (
                                          <RefreshCwIcon className="size-3.5 animate-spin" />
                                        ) : null}
                                        {selectedPackageAddBusy
                                          ? t("skills.teamAdding")
                                          : t("teams.skillManageAddOnly")}
                                      </Button>
                                    ) : null
                                  }
                                  onInstall={(pkg, skillName) => {
                                    const targetSkillName = skillName ?? getPublicPackagePrimarySkill(pkg)?.name
                                    if (targetSkillName) {
                                      void installRuntimeSkill({ packageName: pkg.name, skillName: targetSkillName })
                                    }
                                  }}
                                  onOpenManagedSkill={openManagedSkill}
                                />
                              ) : null}
                            </div>
                          </div>
                        </div>
                      ) : null}
                    </TabsContent>
                    <TabsContent value="members" className="min-h-0 overflow-y-auto pt-3">
                      <TeamDetailPanel
                        inline
                        actorRole={activeWorkspace.role}
                        actorUserId={activeAccountId}
                        busyAction={busyAction}
                        canManage={canManage}
                        members={memberViews}
                        membersComplete={membersComplete}
                        membersError={membersError}
                        membersForbidden={membersForbidden}
                        membersLoading={membersState.status === "loading"}
                        membersRefreshing={membersState.status === "loading" && membersState.data.length > 0}
                        team={selectedTeam}
                        onAddMember={() => setAddMemberOpen(true)}
                        onDisableMembers={memberActions.disableMembers}
                        onEnableMembers={memberActions.enableMembers}
                        onRemoveMember={memberActions.removeMember}
                        onRetryMembers={() => void reload()}
                        onUpdateMemberRole={memberActions.updateMemberRole}
                      />
                    </TabsContent>
                    {canManage ? (
                      <TabsContent value="settings" className="min-h-0 overflow-y-auto pt-3">
                        <div className="max-w-[35rem]">
                          <TeamProfileSettingsPanel
                            avatar={teamForms.edit.avatar}
                            avatarFile={teamForms.edit.avatarFile}
                            busy={busyAction === "updateTeam"}
                            error={teamForms.edit.error}
                            editing={teamForms.edit.open && teamForms.edit.team?.id === selectedTeam.id}
                            name={teamForms.edit.name}
                            nameError={teamForms.edit.nameError}
                            team={selectedTeam}
                            onAvatarChange={teamForms.edit.setAvatar}
                            onAvatarFileChange={teamForms.edit.changeAvatarFile}
                            onClose={() => teamForms.edit.openDialog(selectedTeam)}
                            onEdit={() => teamForms.edit.openDialog(selectedTeam)}
                            onNameChange={teamForms.edit.setName}
                            onSubmit={teamForms.edit.submit}
                          />
                        </div>
                      </TabsContent>
                    ) : null}
                  </Tabs>
                ) : null}
              </>
            )}
          </div>
        )}
      </div>
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
        open={addMemberOpen && canManage}
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
