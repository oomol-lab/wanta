import type { ConnectionProvider } from "../../../electron/connections/common.ts"
import type {
  Organization,
  OrganizationAppAccess,
  OrganizationMember,
  OrganizationProviderOption,
  OrganizationUserSummary,
} from "../../../electron/organizations/common.ts"
import type { BusyAction, LoadState, ProviderAccessForm, ProviderGrantView } from "./organization-management-model.ts"
import type { UseOrganizationSkills } from "@/hooks/useOrganizationSkills"
import type { UseOrganizationWorkspace } from "@/hooks/useOrganizationWorkspace"

import * as React from "react"
import { toast } from "sonner"
import {
  buildGrantViews,
  buildOrganizationMemberViews,
  errorMessage,
  errorState,
  initialProviderAccessForm,
  isConflictError,
  loadState,
  loadingState,
  maxOrganizationNameLength,
  organizationManagementSnapshotsByAccountId,
  organizationNameValidation,
  providerOptionsWithSelected,
  readyState,
  readOrganizationManagementSnapshot,
  runtimeSkillRemoveBusyKey,
  uniqueStrings,
} from "./organization-management-model.ts"
import { parseProviderGrants, removeProviderGrant, setProviderGrant } from "./organization-provider-access.ts"
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
import { RuntimeSkillRemoveConfirmDialog } from "./OrganizationSkillManageDialog.tsx"
import { useAuthStateResource, useSkillInventoryResource } from "@/components/AppDataHooks"
import { Skeleton } from "@/components/ui/skeleton"
import { useAppI18n } from "@/i18n"
import {
  addOrganizationMember,
  createOrganization,
  disableOrganizationMembers,
  enableOrganizationMembers,
  getOrganizationAppAccess,
  isOrganizationMemberLimitError,
  listOrganizationMembers,
  listOrganizationProviderOptions,
  listUserSummaries,
  removeOrganizationMember,
  updateOrganizationAppAccess,
  updateOrganization,
  uploadOrganizationAvatar,
} from "@/lib/organizations-client"
import { userFacingErrorDescription } from "@/lib/user-facing-error"
import { useProviderSkillPackageLookup } from "@/routes/Skills/provider-skill-package-lookup"
import { buildProviderSkillRecommendations } from "@/routes/Skills/provider-skill-recommendations"
import { useOrganizationMemberSearch } from "@/routes/Skills/use-organization-member-search"
import { useOrganizationSkillActions } from "@/routes/Skills/use-organization-skill-actions"

type AsyncResult<T> = { ok: true; value: T } | { error: unknown; ok: false }

function settle<T>(promise: Promise<T>): Promise<AsyncResult<T>> {
  return promise.then(
    (value) => ({ ok: true, value }),
    (error: unknown) => ({ error, ok: false }),
  )
}

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
  const { t } = useAppI18n()
  const authResource = useAuthStateResource()
  const skillInventory = useSkillInventoryResource()
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
  const initialSnapshot = readOrganizationManagementSnapshot(activeAccountId)
  const [membersState, setMembersState] = React.useState<LoadState<OrganizationMember[]>>(
    () => initialSnapshot?.membersState ?? loadState([]),
  )
  const [summariesState, setSummariesState] = React.useState<LoadState<Record<string, OrganizationUserSummary>>>(
    () => initialSnapshot?.summariesState ?? loadState({}),
  )
  const [providerOptionsState, setProviderOptionsState] = React.useState<LoadState<OrganizationProviderOption[]>>(
    () => initialSnapshot?.providerOptionsState ?? loadState([]),
  )
  const [appAccessState, setAppAccessState] = React.useState<LoadState<OrganizationAppAccess | null>>(
    () => initialSnapshot?.appAccessState ?? loadState(null),
  )
  const [busyAction, setBusyAction] = React.useState<BusyAction | null>(null)
  const [createOpen, setCreateOpen] = React.useState(false)
  const [createName, setCreateName] = React.useState("")
  const [createAvatarFile, setCreateAvatarFile] = React.useState<File | null>(null)
  const [createDuplicated, setCreateDuplicated] = React.useState(false)
  const [editOpen, setEditOpen] = React.useState(false)
  const [editOrganizationId, setEditOrganizationId] = React.useState<string | null>(null)
  const [editName, setEditName] = React.useState("")
  const [editAvatar, setEditAvatar] = React.useState("")
  const [editAvatarFile, setEditAvatarFile] = React.useState<File | null>(null)
  const [editDuplicated, setEditDuplicated] = React.useState(false)
  const [addMemberOpen, setAddMemberOpen] = React.useState(false)
  const [addMemberError, setAddMemberError] = React.useState<string | null>(null)
  const [membersPanelOpen, setMembersPanelOpen] = React.useState(false)
  const [providerAccessForm, setProviderAccessForm] = React.useState<ProviderAccessForm>(initialProviderAccessForm)
  const detailsRequestId = React.useRef(0)
  const editAvatarUploadVersion = React.useRef(0)
  const detailsOrganizationIdRef = React.useRef<string | null>(initialSnapshot?.detailsOrganizationId ?? null)
  const skipInitialDetailsLoadRef = React.useRef(
    Boolean(
      initialSnapshot?.detailsOrganizationId && initialSnapshot.detailsOrganizationId === activeWorkspaceOrganizationId,
    ),
  )
  const resetAccountIdRef = React.useRef<string | null>(null)
  const avatarPreviewUrls = workspace.organizationAvatarPreviewUrls
  const clearOrganizationAvatarPreview = workspace.clearOrganizationAvatarPreview
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
  const editingOrganization = React.useMemo(() => {
    return editOrganizationId ? (organizations.find((item) => item.id === editOrganizationId) ?? null) : null
  }, [editOrganizationId, organizations])
  const selectedOrganizationSkills =
    selectedOrganization && organizationSkills?.organizationId === selectedOrganization.id ? organizationSkills : null
  const {
    addOrganizationSkillBatch,
    addOrganizationSkillFromPackage,
    addOrganizationSkillFromRecommendation,
    installRuntimeSkill,
    installRuntimeSkills,
    removeRuntimeSkill,
    runtimeSkillRemoveTarget,
    setRuntimeSkillRemoveTarget,
  } = useOrganizationSkillActions({
    busyAction,
    organizationSkills: selectedOrganizationSkills,
    setBusyAction,
  })
  const skillGroupById = React.useMemo(
    () => new Map((skillInventory.data?.groups ?? []).map((group) => [group.id, group])),
    [skillInventory.data?.groups],
  )
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
  }, [selectedOrganization?.id])

  const createNameError = React.useMemo(() => {
    if (!createName) {
      return null
    }
    switch (organizationNameValidation(createName.trim())) {
      case "empty":
        return t("organizations.organizationNameRequired")
      case "invalid":
        return t("organizations.organizationNameInvalid")
      case "too-long":
        return t("organizations.organizationNameTooLong", { max: maxOrganizationNameLength })
      case "valid":
        return createDuplicated ? t("organizations.organizationNameDuplicated") : null
    }
  }, [createDuplicated, createName, t])

  const editNameError = React.useMemo(() => {
    if (!editName) {
      return null
    }
    switch (organizationNameValidation(editName.trim())) {
      case "empty":
        return t("organizations.organizationNameRequired")
      case "invalid":
        return t("organizations.organizationNameInvalid")
      case "too-long":
        return t("organizations.organizationNameTooLong", { max: maxOrganizationNameLength })
      case "valid":
        return editDuplicated ? t("organizations.organizationNameDuplicated") : null
    }
  }, [editDuplicated, editName, t])

  const resetOrganizationState = React.useCallback((accountId: string | null) => {
    resetAccountIdRef.current = accountId
    detailsRequestId.current += 1
    detailsOrganizationIdRef.current = null
    skipInitialDetailsLoadRef.current = false
    setMembersState(loadState([]))
    setSummariesState(loadState({}))
    setProviderOptionsState(loadState([]))
    setAppAccessState(loadState(null))
  }, [])

  const loadSelectedDetails = React.useCallback(
    async (organization: Organization, canManageDetails: boolean, _options: { forceRefresh?: boolean } = {}) => {
      const requestId = detailsRequestId.current + 1
      const preserveCurrentData = detailsOrganizationIdRef.current === organization.id
      detailsRequestId.current = requestId
      detailsOrganizationIdRef.current = null
      setMembersState((current) => loadingState(preserveCurrentData ? current : loadState([])))
      setSummariesState((current) => loadingState(preserveCurrentData ? current : loadState({})))
      setProviderOptionsState(
        canManageDetails ? (current) => loadingState(preserveCurrentData ? current : loadState([])) : loadState([]),
      )
      setAppAccessState(
        canManageDetails ? (current) => loadingState(preserveCurrentData ? current : loadState(null)) : loadState(null),
      )

      try {
        const membersRequest = settle(listOrganizationMembers(organization.id))
        const providerOptionsRequest = canManageDetails
          ? settle(listOrganizationProviderOptions(organization.name))
          : Promise.resolve<AsyncResult<OrganizationProviderOption[]>>({ ok: true, value: [] })
        const appAccessRequest = canManageDetails
          ? settle(getOrganizationAppAccess(organization.id))
          : Promise.resolve<AsyncResult<OrganizationAppAccess | null>>({ ok: true, value: null })
        const fallbackUserIds = uniqueStrings([organization.creator_user_id, activeAccountId ?? ""])
        const loadSummaries = (userIds: string[]): Promise<AsyncResult<Record<string, OrganizationUserSummary>>> =>
          userIds.length > 0
            ? settle(listUserSummaries(userIds))
            : Promise.resolve<AsyncResult<Record<string, OrganizationUserSummary>>>({ ok: true, value: {} })

        const membersResult = await membersRequest
        if (detailsRequestId.current !== requestId) {
          return
        }
        if (!membersResult.ok) {
          setMembersState((current) => errorState(current, membersResult.error))
          setSummariesState((current) => errorState(current, membersResult.error))
          const summariesResult = await loadSummaries(fallbackUserIds)
          if (detailsRequestId.current !== requestId) {
            return
          }
          if (summariesResult.ok) {
            setSummariesState(readyState(summariesResult.value))
          } else {
            setSummariesState((current) => errorState(current, summariesResult.error))
          }
          return
        }

        const members = membersResult.value
        setMembersState(readyState(members))

        const userIds = uniqueStrings([...members.map((member) => member.user_id), ...fallbackUserIds])
        const summariesRequest = loadSummaries(userIds)
        const detailTasks = [
          summariesRequest.then((summariesResult) => {
            if (detailsRequestId.current !== requestId) {
              return
            }
            if (summariesResult.ok) {
              setSummariesState(readyState(summariesResult.value))
            } else {
              setSummariesState((current) => errorState(current, summariesResult.error))
            }
          }),
        ]

        if (!canManageDetails) {
          setProviderOptionsState(loadState([]))
          setAppAccessState(loadState(null))
        } else {
          detailTasks.push(
            providerOptionsRequest.then((providerOptionsResult) => {
              if (detailsRequestId.current !== requestId) {
                return
              }
              if (providerOptionsResult.ok) {
                setProviderOptionsState(readyState(providerOptionsResult.value))
              } else {
                setProviderOptionsState((current) => errorState(current, providerOptionsResult.error))
              }
            }),
            appAccessRequest.then((appAccessResult) => {
              if (detailsRequestId.current !== requestId) {
                return
              }
              if (appAccessResult.ok) {
                setAppAccessState(readyState(appAccessResult.value))
              } else {
                setAppAccessState((current) => errorState(current, appAccessResult.error))
              }
            }),
          )
        }

        await Promise.all(detailTasks)
        if (detailsRequestId.current === requestId) {
          detailsOrganizationIdRef.current = organization.id
        }
      } catch (error) {
        if (detailsRequestId.current !== requestId) {
          return
        }
        setMembersState((current) => (current.status === "loading" ? errorState(current, error) : current))
        setSummariesState((current) => (current.status === "loading" ? errorState(current, error) : current))
        if (canManageDetails) {
          setProviderOptionsState((current) => (current.status === "loading" ? errorState(current, error) : current))
          setAppAccessState((current) => (current.status === "loading" ? errorState(current, error) : current))
        }
      }
    },
    [activeAccountId],
  )

  const applySavedOrganization = React.useCallback(
    (organization: Organization, options?: { avatarFile?: File | null }) => {
      upsertWorkspaceOrganization(organization, options)
    },
    [upsertWorkspaceOrganization],
  )

  React.useEffect(() => {
    const snapshot = readOrganizationManagementSnapshot(activeAccountId)
    if (!activeAccountId) {
      if (resetAccountIdRef.current !== null || detailsOrganizationIdRef.current !== null) {
        resetOrganizationState(null)
      }
      return
    }
    if (!snapshot) {
      if (resetAccountIdRef.current !== activeAccountId) {
        resetOrganizationState(activeAccountId)
      }
      return
    }

    resetAccountIdRef.current = null
    setMembersState(snapshot.membersState)
    setSummariesState(snapshot.summariesState)
    setProviderOptionsState(snapshot.providerOptionsState)
    setAppAccessState(snapshot.appAccessState)
    detailsOrganizationIdRef.current = snapshot.detailsOrganizationId
    skipInitialDetailsLoadRef.current = Boolean(
      snapshot.detailsOrganizationId && snapshot.detailsOrganizationId === activeWorkspaceOrganizationId,
    )
  }, [activeAccountId, activeWorkspaceOrganizationId, resetOrganizationState])

  React.useEffect(() => {
    if (!activeAccountId) {
      return
    }

    organizationManagementSnapshotsByAccountId.set(activeAccountId, {
      appAccessState,
      detailsOrganizationId: detailsOrganizationIdRef.current,
      membersState,
      providerOptionsState,
      savedAt: Date.now(),
      summariesState,
    })
  }, [activeAccountId, appAccessState, membersState, providerOptionsState, summariesState])

  React.useEffect(() => {
    const handleWindowFocus = () => {
      void refreshWorkspace()
    }
    window.addEventListener("focus", handleWindowFocus)
    return () => window.removeEventListener("focus", handleWindowFocus)
  }, [refreshWorkspace])

  React.useEffect(() => {
    if (!selectedOrganization) {
      detailsRequestId.current += 1
      detailsOrganizationIdRef.current = null
      setMembersState(loadState([]))
      setSummariesState(loadState({}))
      setProviderOptionsState(loadState([]))
      setAppAccessState(loadState(null))
      return
    }

    if (skipInitialDetailsLoadRef.current && detailsOrganizationIdRef.current === selectedOrganization.id) {
      skipInitialDetailsLoadRef.current = false
      return
    }

    skipInitialDetailsLoadRef.current = false
    void loadSelectedDetails(selectedOrganization, canManage)
  }, [canManage, loadSelectedDetails, selectedOrganization?.id, selectedOrganization?.name])

  const handleCreateOrganization = React.useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault()
      const orgName = createName.trim()
      const validation = organizationNameValidation(orgName)
      if (validation !== "valid") {
        toast.error(
          validation === "empty"
            ? t("organizations.organizationNameRequired")
            : validation === "invalid"
              ? t("organizations.organizationNameInvalid")
              : t("organizations.organizationNameTooLong", { max: maxOrganizationNameLength }),
        )
        return
      }

      setBusyAction("create")
      try {
        let organization = await createOrganization({ orgName })
        if (createAvatarFile) {
          const { avatar } = await uploadOrganizationAvatar(organization.id, createAvatarFile)
          organization = await updateOrganization({
            avatar,
            orgId: organization.id,
            orgName: organization.name,
          })
          applySavedOrganization(organization, { avatarFile: createAvatarFile })
        } else {
          applySavedOrganization(organization)
        }
        toast.success(t("organizations.createOrganizationSuccess"))
        setCreateOpen(false)
        setCreateName("")
        setCreateAvatarFile(null)
        setCreateDuplicated(false)
        selectOrganizationWorkspace(organization.id)
        await refreshWorkspace({ forceRefresh: true })
      } catch (error) {
        if (isConflictError(error)) {
          setCreateDuplicated(true)
          toast.error(t("organizations.organizationNameDuplicated"))
        } else {
          toast.error(errorMessage(error))
        }
      } finally {
        setBusyAction(null)
      }
    },
    [applySavedOrganization, createAvatarFile, createName, refreshWorkspace, selectOrganizationWorkspace, t],
  )

  const openEditOrganization = React.useCallback((organization: Organization) => {
    setEditOrganizationId(organization.id)
    setEditName(organization.name)
    setEditAvatar(organization.avatar)
    setEditAvatarFile(null)
    setEditDuplicated(false)
    setEditOpen(true)
  }, [])

  const closeEditOrganization = React.useCallback(() => {
    if (busyAction === "updateOrganization" || busyAction === "uploadOrganizationAvatar") {
      return
    }
    setEditOpen(false)
    setEditOrganizationId(null)
    setEditName("")
    setEditAvatar("")
    setEditAvatarFile(null)
    setEditDuplicated(false)
  }, [busyAction])

  const handleEditAvatarFileChange = React.useCallback(
    (file: File | null) => {
      editAvatarUploadVersion.current += 1
      setEditAvatarFile(file)
      if (!file) {
        return
      }
      if (!editingOrganization || !getWorkspaceOrganizationCanManage(editingOrganization)) {
        setEditAvatarFile(null)
        return
      }

      const version = editAvatarUploadVersion.current
      setBusyAction("uploadOrganizationAvatar")
      void uploadOrganizationAvatar(editingOrganization.id, file)
        .then((uploaded) => {
          if (editAvatarUploadVersion.current !== version) {
            return
          }
          setEditAvatar(uploaded.avatar)
        })
        .catch((error) => {
          if (editAvatarUploadVersion.current !== version) {
            return
          }
          setEditAvatarFile(null)
          toast.error(errorMessage(error))
        })
        .finally(() => {
          if (editAvatarUploadVersion.current === version) {
            setBusyAction((current) => (current === "uploadOrganizationAvatar" ? null : current))
          }
        })
    },
    [editingOrganization, getWorkspaceOrganizationCanManage],
  )

  const handleUpdateOrganization = React.useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault()
      if (!editingOrganization || !getWorkspaceOrganizationCanManage(editingOrganization)) {
        return
      }

      const orgName = editName.trim()
      const validation = organizationNameValidation(orgName)
      if (validation !== "valid") {
        toast.error(
          validation === "empty"
            ? t("organizations.organizationNameRequired")
            : validation === "invalid"
              ? t("organizations.organizationNameInvalid")
              : t("organizations.organizationNameTooLong", { max: maxOrganizationNameLength }),
        )
        return
      }

      setBusyAction("updateOrganization")
      try {
        const avatar = editAvatar.trim()
        const organization = await updateOrganization({
          avatar,
          orgId: editingOrganization.id,
          orgName,
        })
        if (editAvatarFile || avatar !== editingOrganization.avatar) {
          applySavedOrganization(organization, { avatarFile: editAvatarFile })
        } else {
          applySavedOrganization(organization)
        }
        toast.success(t("organizations.updateOrganizationSuccess"))
        setEditOpen(false)
        setEditOrganizationId(null)
        setEditName("")
        setEditAvatar("")
        setEditAvatarFile(null)
        setEditDuplicated(false)
        applySavedOrganization(organization)
        selectOrganizationWorkspace(organization.id)
        await refreshWorkspace({ forceRefresh: true })
      } catch (error) {
        if (isConflictError(error)) {
          setEditDuplicated(true)
          toast.error(t("organizations.organizationNameDuplicated"))
        } else {
          toast.error(errorMessage(error))
        }
      } finally {
        setBusyAction(null)
      }
    },
    [
      applySavedOrganization,
      editAvatar,
      editAvatarFile,
      editName,
      editingOrganization,
      getWorkspaceOrganizationCanManage,
      refreshWorkspace,
      selectOrganizationWorkspace,
      t,
    ],
  )

  const reloadMembersAndAccess = React.useCallback(async () => {
    if (selectedOrganization) {
      await loadSelectedDetails(selectedOrganization, canManage, { forceRefresh: true })
    }
  }, [canManage, loadSelectedDetails, selectedOrganization])

  const handleSelectPersonalWorkspace = React.useCallback(() => {
    selectPersonalWorkspace()
  }, [selectPersonalWorkspace])

  const handleSelectOrganizationWorkspace = React.useCallback(
    (organizationId: string) => {
      selectOrganizationWorkspace(organizationId)
    },
    [selectOrganizationWorkspace],
  )

  const handleAddMember = React.useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault()
      if (!selectedOrganization || !canManage) {
        return
      }

      const currentSearchUserId = selectedSearchUserId ?? activeSearchUserId
      if (memberSearch.items.length > 0 && !currentSearchUserId) {
        setAddMemberError(t("organizations.addMemberSelectRequired"))
        return
      }

      const userId = memberSearch.items.length > 0 ? currentSearchUserId : memberInput.trim()
      if (!userId) {
        setAddMemberError(t("organizations.userIdRequired"))
        return
      }

      setBusyAction("add")
      setAddMemberError(null)
      try {
        await addOrganizationMember({ orgId: selectedOrganization.id, userId })
        toast.success(t("organizations.addMemberSuccess"))
        resetMemberSearch()
        setAddMemberOpen(false)
        await reloadMembersAndAccess()
      } catch (error) {
        const message = errorMessage(error)
        setAddMemberError(
          isOrganizationMemberLimitError(error)
            ? t("organizations.addMemberLimitExceeded")
            : message.toLowerCase().includes("user does not exist")
              ? t("organizations.addMemberUserNotFound")
              : message,
        )
      } finally {
        setBusyAction(null)
      }
    },
    [
      activeSearchUserId,
      canManage,
      memberInput,
      memberSearch.items.length,
      reloadMembersAndAccess,
      resetMemberSearch,
      selectedOrganization,
      selectedSearchUserId,
      t,
    ],
  )

  const handleRemoveMember = React.useCallback(
    async (member: OrganizationMember) => {
      if (!selectedOrganization || !canManage) {
        return
      }

      setBusyAction(`remove:${member.user_id}`)
      try {
        await removeOrganizationMember({
          orgId: selectedOrganization.id,
          userId: member.user_id,
        })
        toast.success(t("organizations.removeMemberSuccess"))
        await reloadMembersAndAccess()
      } catch (error) {
        toast.error(errorMessage(error))
      } finally {
        setBusyAction(null)
      }
    },
    [canManage, reloadMembersAndAccess, selectedOrganization, t],
  )

  const updateMembersStatus = React.useCallback(
    async (userIds: string[], disabled: boolean) => {
      if (!selectedOrganization || !canManage) {
        return
      }

      const normalizedUserIds = uniqueStrings(userIds.map((userId) => userId.trim()).filter(Boolean))
      if (normalizedUserIds.length === 0) {
        return
      }

      setBusyAction(disabled ? "disableMembers" : "enableMembers")
      try {
        if (disabled) {
          await disableOrganizationMembers({ orgId: selectedOrganization.id, userIds: normalizedUserIds })
        } else {
          await enableOrganizationMembers({ orgId: selectedOrganization.id, userIds: normalizedUserIds })
        }
        toast.success(disabled ? t("organizations.disableMembersSuccess") : t("organizations.enableMembersSuccess"))
        await reloadMembersAndAccess()
      } catch (error) {
        toast.error(errorMessage(error))
      } finally {
        setBusyAction(null)
      }
    },
    [canManage, reloadMembersAndAccess, selectedOrganization, t],
  )

  const handleEnableMembers = React.useCallback(
    async (userIds: string[]) => {
      await updateMembersStatus(userIds, false)
    },
    [updateMembersStatus],
  )

  const handleDisableMembers = React.useCallback(
    async (userIds: string[]) => {
      await updateMembersStatus(userIds, true)
    },
    [updateMembersStatus],
  )

  const openGrantProviderAccess = React.useCallback((userId?: string) => {
    setProviderAccessForm({
      allProviders: false,
      mode: "create",
      open: true,
      providers: [],
      userId: userId ?? "",
    })
  }, [])

  const openEditProviderAccess = React.useCallback((grant: ProviderGrantView) => {
    setProviderAccessForm({
      allProviders: grant.allProviders,
      mode: "edit",
      open: true,
      providers: grant.providers.map((provider) => provider.service),
      userId: grant.userId,
    })
  }, [])

  const closeProviderAccess = React.useCallback(() => {
    if (busyAction === "saveProviderAccess") {
      return
    }
    setProviderAccessForm(initialProviderAccessForm)
  }, [busyAction])

  const handleSaveProviderAccess = React.useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault()
      if (!selectedOrganization || !canManage || providerAccessError) {
        return
      }

      const userId = providerAccessForm.userId.trim()
      if (!userId) {
        toast.error(t("organizations.memberRequired"))
        return
      }
      if (!providerAccessForm.allProviders && providerAccessForm.providers.length === 0) {
        toast.error(t("organizations.providerRequired"))
        return
      }

      setBusyAction("saveProviderAccess")
      try {
        const latest = await getOrganizationAppAccess(selectedOrganization.id)
        const parsed = parseProviderGrants(latest)
        if (!parsed.ok) {
          toast.error(t("organizations.providerAccessLoadFailed"))
          return
        }

        const existingGrant = parsed.grants.find((grant) => grant.userId === userId)
        const allProviders =
          providerAccessForm.mode === "create"
            ? providerAccessForm.allProviders || Boolean(existingGrant?.allProviders)
            : providerAccessForm.allProviders
        const providers =
          providerAccessForm.mode === "create" && existingGrant && !allProviders
            ? uniqueStrings([...existingGrant.providers, ...providerAccessForm.providers]).sort()
            : providerAccessForm.providers
        const nextAccess = setProviderGrant(parsed.access, userId, providers, allProviders)
        const updated = await updateOrganizationAppAccess(selectedOrganization.id, nextAccess)
        setAppAccessState(readyState(updated))
        setProviderAccessForm(initialProviderAccessForm)
        toast.success(t("organizations.providerAccessSaveSuccess"))
      } catch (error) {
        toast.error(errorMessage(error))
      } finally {
        setBusyAction(null)
      }
    },
    [canManage, providerAccessError, providerAccessForm, selectedOrganization, t],
  )

  const handleRevokeProviderAccess = React.useCallback(
    async (grant: ProviderGrantView) => {
      if (!selectedOrganization || !canManage || providerAccessError) {
        return
      }

      setBusyAction(`revokeProviderAccess:${grant.userId}`)
      try {
        const latest = await getOrganizationAppAccess(selectedOrganization.id)
        const parsed = parseProviderGrants(latest)
        if (!parsed.ok) {
          toast.error(t("organizations.providerAccessLoadFailed"))
          return
        }
        const updated = await updateOrganizationAppAccess(
          selectedOrganization.id,
          removeProviderGrant(parsed.access, grant.userId),
        )
        setAppAccessState(readyState(updated))
        toast.success(t("organizations.providerAccessRevokeSuccess"))
      } catch (error) {
        toast.error(errorMessage(error))
      } finally {
        setBusyAction(null)
      }
    },
    [canManage, providerAccessError, selectedOrganization, t],
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
        ) : showOrganizationEmptyState ? (
          <EmptyOrganizationsState onCreate={() => setCreateOpen(true)} />
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
                  onCreate={() => setCreateOpen(true)}
                  onEdit={openEditOrganization}
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
                        providerRecommendations={providerSkillRecommendations}
                        onAddRecommendation={addOrganizationSkillFromRecommendation}
                        onAddRecommendationBatch={addOrganizationSkillBatch}
                        onAddMarketPackage={addOrganizationSkillFromPackage}
                        onInstallRuntimeSkill={installRuntimeSkill}
                        onInstallRuntimeSkills={installRuntimeSkills}
                        onRequestRemoveRuntimeSkill={setRuntimeSkillRemoveTarget}
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
                    onCreate={() => setCreateOpen(true)}
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
                      onDisableMembers={handleDisableMembers}
                      onEditProviderAccess={openEditProviderAccess}
                      onEnableMembers={handleEnableMembers}
                      onGrantProviderAccess={openGrantProviderAccess}
                      onRemoveMember={handleRemoveMember}
                      onRevokeProviderAccess={handleRevokeProviderAccess}
                    />
                  </OrganizationMembersSheet>
                ) : null}
              </>
            )}
          </div>
        )}
      </div>
      <CreateOrganizationDialog
        avatarFile={createAvatarFile}
        busy={busyAction === "create"}
        name={createName}
        nameError={createNameError}
        open={createOpen}
        onAvatarFileChange={setCreateAvatarFile}
        onClose={() => {
          if (busyAction !== "create") {
            setCreateOpen(false)
            setCreateAvatarFile(null)
          }
        }}
        onNameChange={(value) => {
          setCreateName(value)
          setCreateDuplicated(false)
        }}
        onSubmit={handleCreateOrganization}
      />
      <EditOrganizationDialog
        avatar={editAvatar}
        avatarFile={editAvatarFile}
        busy={busyAction === "updateOrganization"}
        name={editName}
        nameError={editNameError}
        open={editOpen}
        organization={editingOrganization}
        avatarUploading={busyAction === "uploadOrganizationAvatar"}
        onAvatarChange={setEditAvatar}
        onAvatarFileChange={handleEditAvatarFileChange}
        onClose={closeEditOrganization}
        onNameChange={(value) => {
          setEditName(value)
          setEditDuplicated(false)
        }}
        onSubmit={handleUpdateOrganization}
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
        onSubmit={handleAddMember}
      />
      <ProviderAccessDialog
        busy={busyAction === "saveProviderAccess"}
        form={providerAccessForm}
        memberOptions={memberViews.filter((member) => member.role !== "creator")}
        providerOptions={providerOptionsWithSelected(providerOptionsState.data, providerAccessForm.providers)}
        onClose={closeProviderAccess}
        onFormChange={setProviderAccessForm}
        onSubmit={handleSaveProviderAccess}
      />
      <RuntimeSkillRemoveConfirmDialog
        busy={runtimeSkillRemoveTarget ? busyAction === runtimeSkillRemoveBusyKey(runtimeSkillRemoveTarget) : false}
        target={runtimeSkillRemoveTarget}
        onClose={() => {
          if (!busyAction?.startsWith("removeSkill:")) {
            setRuntimeSkillRemoveTarget(null)
          }
        }}
        onConfirm={() => void removeRuntimeSkill()}
      />
    </>
  )
}
