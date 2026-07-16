import type { Organization, OrganizationAppAccess, OrganizationMember } from "../../../electron/organizations/common.ts"
import type {
  BusyAction,
  LoadState,
  MemberSearchState,
  ProviderAccessForm,
  ProviderGrantView,
} from "./organization-management-model.ts"

import * as React from "react"
import { toast } from "sonner"
import { organizationErrorMessage } from "./organization-errors.ts"
import { errorMessage, initialProviderAccessForm, readyState, uniqueStrings } from "./organization-management-model.ts"
import { parseProviderGrants, removeProviderGrant, setProviderGrant } from "./organization-provider-access.ts"
import { useAppI18n } from "@/i18n"
import { invalidateOrganizationDetailsResource } from "@/lib/organization-details-resource"
import {
  addOrganizationMember,
  disableOrganizationMembers,
  enableOrganizationMembers,
  getOrganizationAppAccess,
  isOrganizationMemberLimitError,
  removeOrganizationMember,
  updateOrganizationAppAccess,
} from "@/lib/organizations-client"

interface OrganizationMemberActionsOptions {
  activeAccountId: string | undefined
  activeSearchUserId: string | null
  busyAction: BusyAction | null
  canManage: boolean
  memberInput: string
  memberSearch: MemberSearchState
  providerAccessError: string | null
  providerAccessForm: ProviderAccessForm
  reloadDetails: () => Promise<void>
  resetMemberSearch: () => void
  selectedOrganization: Organization | null
  selectedSearchUserId: string | null
  setAddMemberError: React.Dispatch<React.SetStateAction<string | null>>
  setAddMemberOpen: React.Dispatch<React.SetStateAction<boolean>>
  setAppAccessState: React.Dispatch<React.SetStateAction<LoadState<OrganizationAppAccess | null>>>
  setBusyAction: React.Dispatch<React.SetStateAction<BusyAction | null>>
  setProviderAccessForm: React.Dispatch<React.SetStateAction<ProviderAccessForm>>
}

export function useOrganizationMemberActions({
  activeAccountId,
  activeSearchUserId,
  busyAction,
  canManage,
  memberInput,
  memberSearch,
  providerAccessError,
  providerAccessForm,
  reloadDetails,
  resetMemberSearch,
  selectedOrganization,
  selectedSearchUserId,
  setAddMemberError,
  setAddMemberOpen,
  setAppAccessState,
  setBusyAction,
  setProviderAccessForm,
}: OrganizationMemberActionsOptions) {
  const { t } = useAppI18n()

  const addMember = React.useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault()
      if (!selectedOrganization || !canManage) return

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
        invalidateOrganizationDetailsResource(activeAccountId, selectedOrganization.id)
        toast.success(t("organizations.addMemberSuccess"))
        resetMemberSearch()
        setAddMemberOpen(false)
        await reloadDetails()
      } catch (error) {
        const message = errorMessage(error)
        setAddMemberError(
          isOrganizationMemberLimitError(error)
            ? t("organizations.addMemberLimitExceeded")
            : message.toLowerCase().includes("user does not exist")
              ? t("organizations.addMemberUserNotFound")
              : organizationErrorMessage(error, t),
        )
      } finally {
        setBusyAction(null)
      }
    },
    [
      activeAccountId,
      activeSearchUserId,
      canManage,
      memberInput,
      memberSearch.items.length,
      reloadDetails,
      resetMemberSearch,
      selectedOrganization,
      selectedSearchUserId,
      setAddMemberError,
      setAddMemberOpen,
      setBusyAction,
      t,
    ],
  )

  const removeMember = React.useCallback(
    async (member: OrganizationMember) => {
      if (!selectedOrganization || !canManage) return
      setBusyAction(`remove:${member.user_id}`)
      try {
        await removeOrganizationMember({ orgId: selectedOrganization.id, userId: member.user_id })
        invalidateOrganizationDetailsResource(activeAccountId, selectedOrganization.id)
        toast.success(t("organizations.removeMemberSuccess"))
        await reloadDetails()
      } catch (error) {
        toast.error(organizationErrorMessage(error, t))
      } finally {
        setBusyAction(null)
      }
    },
    [activeAccountId, canManage, reloadDetails, selectedOrganization, setBusyAction, t],
  )

  const updateMembersStatus = React.useCallback(
    async (userIds: string[], disabled: boolean) => {
      if (!selectedOrganization || !canManage) return
      const normalizedUserIds = uniqueStrings(userIds.map((userId) => userId.trim()).filter(Boolean))
      if (normalizedUserIds.length === 0) return

      setBusyAction(disabled ? "disableMembers" : "enableMembers")
      try {
        const input = { orgId: selectedOrganization.id, userIds: normalizedUserIds }
        await (disabled ? disableOrganizationMembers(input) : enableOrganizationMembers(input))
        invalidateOrganizationDetailsResource(activeAccountId, selectedOrganization.id)
        toast.success(disabled ? t("organizations.disableMembersSuccess") : t("organizations.enableMembersSuccess"))
        await reloadDetails()
      } catch (error) {
        toast.error(organizationErrorMessage(error, t))
      } finally {
        setBusyAction(null)
      }
    },
    [activeAccountId, canManage, reloadDetails, selectedOrganization, setBusyAction, t],
  )

  const openGrantProviderAccess = React.useCallback(
    (userId?: string) => {
      setProviderAccessForm({ allProviders: false, mode: "create", open: true, providers: [], userId: userId ?? "" })
    },
    [setProviderAccessForm],
  )

  const openEditProviderAccess = React.useCallback(
    (grant: ProviderGrantView) => {
      setProviderAccessForm({
        allProviders: grant.allProviders,
        mode: "edit",
        open: true,
        providers: grant.providers.map((provider) => provider.service),
        userId: grant.userId,
      })
    },
    [setProviderAccessForm],
  )

  const closeProviderAccess = React.useCallback(() => {
    if (busyAction !== "saveProviderAccess") setProviderAccessForm(initialProviderAccessForm)
  }, [busyAction, setProviderAccessForm])

  const enableMembers = React.useCallback(
    (userIds: string[]) => updateMembersStatus(userIds, false),
    [updateMembersStatus],
  )

  const disableMembers = React.useCallback(
    (userIds: string[]) => updateMembersStatus(userIds, true),
    [updateMembersStatus],
  )

  const saveProviderAccess = React.useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault()
      if (!selectedOrganization || !canManage || providerAccessError) return
      const userId = providerAccessForm.userId.trim()
      if (!userId) return void toast.error(t("organizations.memberRequired"))
      if (!providerAccessForm.allProviders && providerAccessForm.providers.length === 0) {
        return void toast.error(t("organizations.providerRequired"))
      }

      setBusyAction("saveProviderAccess")
      try {
        const parsed = parseProviderGrants(await getOrganizationAppAccess(selectedOrganization.id))
        if (!parsed.ok) return void toast.error(t("organizations.providerAccessLoadFailed"))
        const existingGrant = parsed.grants.find((grant) => grant.userId === userId)
        const allProviders =
          providerAccessForm.mode === "create"
            ? providerAccessForm.allProviders || Boolean(existingGrant?.allProviders)
            : providerAccessForm.allProviders
        const providers =
          providerAccessForm.mode === "create" && existingGrant && !allProviders
            ? uniqueStrings([...existingGrant.providers, ...providerAccessForm.providers]).sort()
            : providerAccessForm.providers
        const updated = await updateOrganizationAppAccess(
          selectedOrganization.id,
          setProviderGrant(parsed.access, userId, providers, allProviders),
        )
        invalidateOrganizationDetailsResource(activeAccountId, selectedOrganization.id)
        setAppAccessState(readyState(updated))
        setProviderAccessForm(initialProviderAccessForm)
        toast.success(t("organizations.providerAccessSaveSuccess"))
      } catch (error) {
        toast.error(organizationErrorMessage(error, t))
      } finally {
        setBusyAction(null)
      }
    },
    [
      activeAccountId,
      canManage,
      providerAccessError,
      providerAccessForm,
      selectedOrganization,
      setAppAccessState,
      setBusyAction,
      setProviderAccessForm,
      t,
    ],
  )

  const revokeProviderAccess = React.useCallback(
    async (grant: ProviderGrantView) => {
      if (!selectedOrganization || !canManage || providerAccessError) return
      setBusyAction(`revokeProviderAccess:${grant.userId}`)
      try {
        const parsed = parseProviderGrants(await getOrganizationAppAccess(selectedOrganization.id))
        if (!parsed.ok) return void toast.error(t("organizations.providerAccessLoadFailed"))
        const updated = await updateOrganizationAppAccess(
          selectedOrganization.id,
          removeProviderGrant(parsed.access, grant.userId),
        )
        invalidateOrganizationDetailsResource(activeAccountId, selectedOrganization.id)
        setAppAccessState(readyState(updated))
        toast.success(t("organizations.providerAccessRevokeSuccess"))
      } catch (error) {
        toast.error(organizationErrorMessage(error, t))
      } finally {
        setBusyAction(null)
      }
    },
    [activeAccountId, canManage, providerAccessError, selectedOrganization, setAppAccessState, setBusyAction, t],
  )

  return {
    addMember,
    closeProviderAccess,
    disableMembers,
    enableMembers,
    openEditProviderAccess,
    openGrantProviderAccess,
    removeMember,
    revokeProviderAccess,
    saveProviderAccess,
  }
}
