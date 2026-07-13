import type { ConnectionProvider } from "../../../electron/connections/common.ts"
import type { ManagedSkillGroup, PublicSkillPackage } from "../../../electron/skills/common.ts"
import type { BusyAction, ProviderAccessForm } from "./organization-management-model.ts"
import type { UseOrganizationSkills } from "@/hooks/useOrganizationSkills"
import type { UseOrganizationWorkspace } from "@/hooks/useOrganizationWorkspace"

import { RefreshCwIcon } from "lucide-react"
import * as React from "react"
import {
  buildGrantViews,
  buildOrganizationMemberViews,
  initialProviderAccessForm,
  providerOptionsWithSelected,
} from "./organization-management-model.ts"
import {
  EmptyOrganizationsState,
  OrganizationManagementSkeleton,
  OrganizationSkillGuidePanel,
  OrganizationSwitcherPanel,
  PersonalWorkspaceState,
} from "./OrganizationManagementPanels.tsx"
import {
  AddMemberDialog,
  CreateOrganizationDialog,
  EditOrganizationDialog,
  ErrorBlock,
  OrganizationDetailPanel,
  Panel,
  ProviderAccessDialog,
} from "./OrganizationMembersPanel.tsx"
import { OrganizationMembersSheet } from "./OrganizationMembersSheet.tsx"
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
import { useSkillService } from "@/components/AppContext"
import { useAuthStateResource, useSkillInventoryResource } from "@/components/AppDataHooks"
import { useHomeSummaryResource, useSkillVersionReportResource } from "@/components/AppDataHooks"
import { DeleteSkillConfirmDialog } from "@/components/DeleteSkillConfirmDialog"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useSkillObjectActions } from "@/components/useSkillObjectActions"
import { useAppI18n } from "@/i18n"
import { userFacingErrorDescription } from "@/lib/user-facing-error"
import { useProviderSkillPackageLookup } from "@/routes/Skills/provider-skill-package-lookup"
import { buildProviderSkillRecommendations } from "@/routes/Skills/provider-skill-recommendations"
import { useOrganizationDetails } from "@/routes/Skills/use-organization-details"
import { useOrganizationForms } from "@/routes/Skills/use-organization-forms"
import { useOrganizationMemberActions } from "@/routes/Skills/use-organization-member-actions"
import { useOrganizationMemberSearch } from "@/routes/Skills/use-organization-member-search"
import { useOrganizationSkillActions } from "@/routes/Skills/use-organization-skill-actions"

export function OrganizationManagementRoute({
  connectedProviders = [],
  connectedProvidersLoading = false,
  organizationSkills,
  workspace,
}: {
  connectedProviders?: ConnectionProvider[]
  connectedProvidersLoading?: boolean
  organizationSkills?: UseOrganizationSkills
  workspace: UseOrganizationWorkspace
}) {
  const { locale, t } = useAppI18n()
  const authResource = useAuthStateResource()
  const skillInventory = useSkillInventoryResource()
  const skillVersions = useSkillVersionReportResource()
  const homeSummary = useHomeSummaryResource()
  const skillService = useSkillService()
  const activeAccount = authResource.data?.status === "authenticated" ? authResource.data.account : undefined
  const activeAccountId = activeAccount?.id
  const activeWorkspace = workspace.activeWorkspace
  const selectPersonalWorkspace = workspace.selectPersonal
  const selectOrganizationWorkspace = workspace.selectOrganization
  const refreshWorkspace = workspace.refresh
  const upsertWorkspaceOrganization = workspace.upsertOrganization
  const getWorkspaceOrganizationCanManage = workspace.getOrganizationCanManage
  const getWorkspaceOrganizationRole = workspace.getOrganizationRole
  const activeWorkspaceOrganizationId = activeWorkspace?.type === "organization" ? activeWorkspace.organizationId : null
  const activeWorkspaceIsPersonal = activeWorkspace?.type === "personal"
  const [busyAction, setBusyAction] = React.useState<BusyAction | null>(null)
  const [addMemberOpen, setAddMemberOpen] = React.useState(false)
  const [addMemberError, setAddMemberError] = React.useState<string | null>(null)
  const [membersPanelOpen, setMembersPanelOpen] = React.useState(false)
  const [managedSkillId, setManagedSkillId] = React.useState<string | null>(null)
  const [selectedPackage, setSelectedPackage] = React.useState<PublicSkillPackage | null>(null)
  const [updatingRegistrySkillId, setUpdatingRegistrySkillId] = React.useState<string | null>(null)
  const [managedSkillError, setManagedSkillError] = React.useState<{ cause: unknown; skillId: string } | null>(null)
  const updateRegistryInFlightRef = React.useRef(false)
  const [providerAccessForm, setProviderAccessForm] = React.useState<ProviderAccessForm>(initialProviderAccessForm)
  const avatarPreviewUrls = workspace.organizationAvatarPreviewUrls
  const clearOrganizationAvatarPreview = workspace.clearOrganizationAvatarPreview

  const organizations = workspace.organizations
  const selectedOrganizationId = activeWorkspaceOrganizationId
  const selectedOrganization = React.useMemo(() => {
    if (activeWorkspace.type !== "organization") {
      return null
    }
    return (
      activeWorkspace.organization ?? organizations.find((item) => item.id === activeWorkspace.organizationId) ?? null
    )
  }, [activeWorkspace, organizations])
  const selectedOrganizationSkills =
    selectedOrganization && organizationSkills?.organizationId === selectedOrganization.id ? organizationSkills : null
  const {
    addOrganizationSkillBatch,
    addOrganizationSkillFromPackage,
    addOrganizationSkillFromRecommendation,
    installRuntimeSkill,
    installRuntimeSkills,
  } = useOrganizationSkillActions({
    busyAction,
    organizationSkills: selectedOrganizationSkills,
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

  const updateRegistrySkill = React.useCallback(
    async (skill: Pick<ManagedSkillGroup, "id" | "kind" | "packageName">) => {
      const packageName = skill.packageName?.trim()
      if (updateRegistryInFlightRef.current || skill.kind !== "registry" || !packageName) {
        return
      }
      updateRegistryInFlightRef.current = true
      setUpdatingRegistrySkillId(skill.id)
      setManagedSkillError(null)
      try {
        const nextInventory = await skillService.invoke("updateRegistrySkill", { packageName, skillId: skill.id })
        skillInventory.setData(nextInventory)
        await skillVersions.refresh({ forceRefresh: true, silent: true })
        homeSummary.invalidate()
      } catch (cause) {
        setManagedSkillError({ cause, skillId: skill.id })
      } finally {
        updateRegistryInFlightRef.current = false
        setUpdatingRegistrySkillId(null)
      }
    },
    [homeSummary, skillInventory, skillService, skillVersions],
  )
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
  const providerSkillPackageLookup = useProviderSkillPackageLookup(connectedProviders)
  const providerSkillRecommendations = React.useMemo(
    () =>
      buildProviderSkillRecommendations({
        groupById: skillGroupById,
        packagesByService: providerSkillPackageLookup.packagesByService,
        providers: connectedProviders,
      }),
    [connectedProviders, providerSkillPackageLookup.packagesByService, skillGroupById],
  )
  const canManage = activeWorkspace.type === "organization" ? activeWorkspace.canManage : false
  const { appAccessState, membersState, providerOptionsState, reload, setAppAccessState, summariesState } =
    useOrganizationDetails({
      activeAccountId,
      activeOrganizationId: activeWorkspaceOrganizationId,
      canManage,
      selectedOrganization,
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
  } = useOrganizationMemberSearch({ addMemberOpen, members: membersState.data })
  const memberViews = React.useMemo(
    () =>
      buildOrganizationMemberViews({
        account: activeAccount,
        accountRole: activeWorkspace.type === "organization" ? activeWorkspace.role : null,
        members: membersState.data,
        organization: selectedOrganization,
        summaries: summariesState.data,
      }),
    [activeAccount, activeWorkspace, membersState.data, selectedOrganization, summariesState.data],
  )
  const membersError = memberViews.length > 0 && membersState.error?.includes("HTTP 403") ? null : membersState.error
  const grantState = React.useMemo(
    () => buildGrantViews(appAccessState.data, memberViews, providerOptionsState.data),
    [appAccessState.data, memberViews, providerOptionsState.data],
  )
  const grantsByUserId = React.useMemo(
    () => new Map(grantState.grants.map((grant) => [grant.userId, grant])),
    [grantState.grants],
  )
  const providerAccessError = appAccessState.error ?? providerOptionsState.error ?? grantState.error
  const showOverviewLoading = organizations.length === 0 && (workspace.loading || !workspace.hasLoaded)
  const showOverviewError = organizations.length === 0 && Boolean(workspace.error)
  const showOrganizationEmptyState = !showOverviewLoading && !showOverviewError && organizations.length === 0

  React.useEffect(() => {
    setMembersPanelOpen(false)
    setManagedSkillId(null)
    setManagedSkillError(null)
    setSelectedPackage(null)
  }, [selectedOrganization?.id])

  React.useEffect(() => {
    const handleWindowFocus = () => {
      void refreshWorkspace()
    }
    window.addEventListener("focus", handleWindowFocus)
    return () => window.removeEventListener("focus", handleWindowFocus)
  }, [refreshWorkspace])

  const organizationForms = useOrganizationForms({
    busyAction,
    canManageOrganization: getWorkspaceOrganizationCanManage,
    organizations,
    refreshWorkspace,
    selectOrganization: selectOrganizationWorkspace,
    setBusyAction,
    upsertOrganization: upsertWorkspaceOrganization,
  })

  const handleSelectPersonalWorkspace = React.useCallback(() => {
    selectPersonalWorkspace()
  }, [selectPersonalWorkspace])

  const handleSelectOrganizationWorkspace = React.useCallback(
    (organizationId: string) => {
      selectOrganizationWorkspace(organizationId)
    },
    [selectOrganizationWorkspace],
  )

  const memberActions = useOrganizationMemberActions({
    activeAccountId,
    activeSearchUserId,
    busyAction,
    canManage,
    memberInput,
    memberSearch,
    providerAccessError,
    providerAccessForm,
    reloadDetails: reload,
    resetMemberSearch,
    selectedOrganization,
    selectedSearchUserId,
    setAddMemberError,
    setAddMemberOpen,
    setAppAccessState,
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
        ) : showOrganizationEmptyState ? (
          <EmptyOrganizationsState onCreate={organizationForms.create.openDialog} />
        ) : (
          <div className="grid h-full min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] gap-3">
            {showOverviewLoading ? (
              <OrganizationManagementSkeleton mode={activeWorkspaceIsPersonal ? "personal" : "organization"} />
            ) : (
              <>
                <OrganizationSwitcherPanel
                  activeWorkspace={activeWorkspace}
                  accountAvatarUrl={activeAccount?.avatarUrl}
                  accountName={activeAccount?.name}
                  canManage={canManage}
                  getOrganizationRole={getWorkspaceOrganizationRole}
                  members={memberViews}
                  membersLoading={membersState.status === "loading"}
                  organizations={organizations}
                  avatarPreviewUrls={avatarPreviewUrls}
                  selectedOrganization={selectedOrganization}
                  selectedOrganizationId={selectedOrganizationId}
                  onCreate={organizationForms.create.openDialog}
                  onEdit={organizationForms.edit.openDialog}
                  onAddMember={() => setAddMemberOpen(true)}
                  onOpenMembers={() => setMembersPanelOpen(true)}
                  onRemoteAvatarLoad={clearOrganizationAvatarPreview}
                  onSelect={handleSelectOrganizationWorkspace}
                  onSelectPersonal={handleSelectPersonalWorkspace}
                />
                {selectedOrganization ? (
                  <div className="grid min-h-0 min-w-0">
                    {selectedOrganizationSkills ? (
                      <OrganizationSkillGuidePanel
                        busyAction={busyAction}
                        groupById={skillGroupById}
                        organizationSkills={selectedOrganizationSkills}
                        providerRecommendationsLoading={
                          connectedProvidersLoading || providerSkillPackageLookup.isLoading
                        }
                        providerRecommendationsResolvedCount={providerSkillPackageLookup.resolvedCount}
                        providerRecommendationsTotalCount={providerSkillPackageLookup.totalCount}
                        providerRecommendations={providerSkillRecommendations}
                        onAddRecommendation={addOrganizationSkillFromRecommendation}
                        onAddRecommendationBatch={addOrganizationSkillBatch}
                        onAddMarketPackage={addOrganizationSkillFromPackage}
                        onInstallRuntimeSkill={installRuntimeSkill}
                        onInstallRuntimeSkills={installRuntimeSkills}
                        onOpenManagedSkill={openManagedSkill}
                        onOpenPackageDetail={openPackageDetail}
                      />
                    ) : (
                      <Panel
                        title={t("organizations.skillGuideTitle")}
                        description={t("organizations.skillGuideDescription")}
                      >
                        <div className="p-3">
                          <Skeleton className="h-16 rounded-md" />
                        </div>
                      </Panel>
                    )}
                  </div>
                ) : (
                  <PersonalWorkspaceState
                    organizations={organizations}
                    avatarPreviewUrls={avatarPreviewUrls}
                    getOrganizationRole={getWorkspaceOrganizationRole}
                    onCreate={organizationForms.create.openDialog}
                    onRemoteAvatarLoad={clearOrganizationAvatarPreview}
                    onSelectOrganization={handleSelectOrganizationWorkspace}
                  />
                )}
                {selectedOrganization ? (
                  <OrganizationMembersSheet open={membersPanelOpen} onClose={() => setMembersPanelOpen(false)}>
                    <OrganizationDetailPanel
                      compact
                      appAccessLoading={
                        appAccessState.status === "loading" || providerOptionsState.status === "loading"
                      }
                      busyAction={busyAction}
                      canManage={canManage}
                      grantsByUserId={grantsByUserId}
                      members={memberViews}
                      membersError={membersError}
                      membersLoading={membersState.status === "loading"}
                      organization={selectedOrganization}
                      providerAccessError={providerAccessError}
                      onAddMember={() => setAddMemberOpen(true)}
                      onDisableMembers={memberActions.disableMembers}
                      onEditProviderAccess={memberActions.openEditProviderAccess}
                      onEnableMembers={memberActions.enableMembers}
                      onGrantProviderAccess={memberActions.openGrantProviderAccess}
                      onRemoveMember={memberActions.removeMember}
                      onRevokeProviderAccess={memberActions.revokeProviderAccess}
                    />
                  </OrganizationMembersSheet>
                ) : null}
              </>
            )}
          </div>
        )}
      </div>
      {managedSkill ? (
        <SkillManagementSheet
          title={managedSkill.name}
          onClose={() => {
            setManagedSkillId(null)
            setManagedSkillError(null)
          }}
        >
          <SkillDetailContent
            copySkillPath={copySkillPath}
            inventoryInitialLoading={skillInventory.isInitialLoading}
            isRemovingSkill={isRemovingSkill}
            isSkillLinkedToOrganization={Boolean(
              selectedOrganizationSkills?.skills.some((skill) => skill.packageName === managedSkill.packageName),
            )}
            openSkillFolder={openSkillFolder}
            publishSkill={() => undefined}
            publishingSkillId={null}
            requestRemoveSkill={(skill) => setRemoveTarget({ skill })}
            requestOrganizationLink={() => undefined}
            selectedPlanError={managedSkillError?.skillId === managedSkill.id ? managedSkillError.cause : null}
            selectedSkill={managedSkill}
            selectedStatus={managedSkillStatus}
            selectedVersionCheck={managedSkillVersionCheck}
            showOrganizationLinkAction={false}
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
            !selectedOrganizationSkills?.skills.some((skill) => skill.packageName === selectedPackage.name) &&
            selectedPackagePrimarySkill ? (
              <Button
                type="button"
                size="sm"
                disabled={Boolean(busyAction)}
                onClick={() =>
                  void addOrganizationSkillFromPackage(selectedPackage, {
                    installRuntime: false,
                    skillName: selectedPackagePrimarySkill.name,
                  })
                }
              >
                {selectedPackageAddBusy ? <RefreshCwIcon className="size-3.5 animate-spin" /> : null}
                {selectedPackageAddBusy ? t("skills.organizationAdding") : t("organizations.skillManageAddOnly")}
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
      <CreateOrganizationDialog
        avatarFile={organizationForms.create.avatarFile}
        busy={busyAction === "create"}
        name={organizationForms.create.name}
        nameError={organizationForms.create.nameError}
        open={organizationForms.create.open}
        onAvatarFileChange={organizationForms.create.setAvatarFile}
        onClose={organizationForms.create.close}
        onNameChange={organizationForms.create.setName}
        onSubmit={organizationForms.create.submit}
      />
      <EditOrganizationDialog
        avatar={organizationForms.edit.avatar}
        avatarFile={organizationForms.edit.avatarFile}
        busy={busyAction === "updateOrganization"}
        name={organizationForms.edit.name}
        nameError={organizationForms.edit.nameError}
        open={organizationForms.edit.open}
        organization={organizationForms.edit.organization}
        avatarUploading={busyAction === "uploadOrganizationAvatar"}
        onAvatarChange={organizationForms.edit.setAvatar}
        onAvatarFileChange={organizationForms.edit.changeAvatarFile}
        onClose={organizationForms.edit.close}
        onNameChange={organizationForms.edit.setName}
        onSubmit={organizationForms.edit.submit}
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
