import type { Team, TeamAppAccess, TeamMember } from "../../../electron/teams/common.ts"
import type { BusyAction, MemberSearchState, ProviderAccessForm, ProviderGrantView } from "./team-management-model.ts"

import * as React from "react"
import { toast } from "sonner"
import { teamErrorMessage } from "./team-errors.ts"
import { errorMessage, initialProviderAccessForm, uniqueStrings } from "./team-management-model.ts"
import { parseProviderGrants, removeProviderGrant, setProviderGrant } from "./team-provider-access.ts"
import { useAppI18n } from "@/i18n"
import { invalidateTeamDetailsResource } from "@/lib/team-details-resource"
import {
  addTeamMember,
  disableTeamMembers,
  enableTeamMembers,
  getTeamAppAccessSnapshot,
  isTeamMemberLimitError,
  removeTeamMember,
  updateTeamAppAccess,
} from "@/lib/teams-client"

interface TeamMemberActionsOptions {
  activeAccountId: string | undefined
  busyAction: BusyAction | null
  canManage: boolean
  memberInput: string
  memberSearch: MemberSearchState
  providerAccessMutationError: string | null
  providerOptionsError: string | null
  providerAccessForm: ProviderAccessForm
  reloadDetails: () => Promise<void>
  resetMemberSearch: () => void
  selectedTeam: Team | null
  selectedSearchUserId: string | null
  setAddMemberError: React.Dispatch<React.SetStateAction<string | null>>
  setAddMemberOpen: React.Dispatch<React.SetStateAction<boolean>>
  setAppAccessForTeam: (accountId: string | undefined, teamId: string, access: TeamAppAccess) => void
  setBusyAction: React.Dispatch<React.SetStateAction<BusyAction | null>>
  setProviderAccessForm: React.Dispatch<React.SetStateAction<ProviderAccessForm>>
}

interface MemberActionOperation {
  busyAction: BusyAction
  id: number
}

export function useTeamMemberActions({
  activeAccountId,
  busyAction,
  canManage,
  memberInput,
  memberSearch,
  providerAccessMutationError,
  providerOptionsError,
  providerAccessForm,
  reloadDetails,
  resetMemberSearch,
  selectedTeam,
  selectedSearchUserId,
  setAddMemberError,
  setAddMemberOpen,
  setAppAccessForTeam,
  setBusyAction,
  setProviderAccessForm,
}: TeamMemberActionsOptions) {
  const { t } = useAppI18n()
  const actionSequenceRef = React.useRef(0)
  const actionContextKey = `${activeAccountId ?? "anonymous"}\u0000${selectedTeam?.id ?? "none"}`
  const actionContextKeyRef = React.useRef(actionContextKey)
  React.useLayoutEffect(() => {
    if (actionContextKeyRef.current !== actionContextKey) {
      actionContextKeyRef.current = actionContextKey
      actionSequenceRef.current += 1
    }
  }, [actionContextKey])

  const beginOperation = React.useCallback(
    (nextBusyAction: BusyAction): MemberActionOperation => {
      const operation = { busyAction: nextBusyAction, id: actionSequenceRef.current + 1 }
      actionSequenceRef.current = operation.id
      setBusyAction(nextBusyAction)
      return operation
    },
    [setBusyAction],
  )
  const operationIsCurrent = React.useCallback(
    (operation: MemberActionOperation): boolean => actionSequenceRef.current === operation.id,
    [],
  )
  const finishOperation = React.useCallback(
    (operation: MemberActionOperation): void => {
      if (!operationIsCurrent(operation)) return
      setBusyAction((current) => (current === operation.busyAction ? null : current))
    },
    [operationIsCurrent, setBusyAction],
  )

  const addMember = React.useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault()
      if (!selectedTeam || !canManage) return

      const currentSearchUserId = selectedSearchUserId
      if (memberSearch.items.length > 0 && !currentSearchUserId) {
        setAddMemberError(t("teams.addMemberSelectRequired"))
        return
      }
      const userId = memberSearch.items.length > 0 ? currentSearchUserId : memberInput.trim()
      if (!userId) {
        setAddMemberError(t("teams.userIdRequired"))
        return
      }

      const operation = beginOperation("add")
      setAddMemberError(null)
      try {
        await addTeamMember({ teamId: selectedTeam.id, userId })
        invalidateTeamDetailsResource(activeAccountId, selectedTeam.id)
        if (!operationIsCurrent(operation)) return
        toast.success(t("teams.addMemberSuccess"))
        resetMemberSearch()
        setAddMemberOpen(false)
        await reloadDetails()
      } catch (error) {
        if (!operationIsCurrent(operation)) return
        const message = errorMessage(error)
        setAddMemberError(
          isTeamMemberLimitError(error)
            ? t("teams.addMemberLimitExceeded")
            : message.toLowerCase().includes("user does not exist")
              ? t("teams.addMemberUserNotFound")
              : teamErrorMessage(error, t),
        )
      } finally {
        finishOperation(operation)
      }
    },
    [
      activeAccountId,
      beginOperation,
      canManage,
      finishOperation,
      memberInput,
      memberSearch.items.length,
      operationIsCurrent,
      reloadDetails,
      resetMemberSearch,
      selectedTeam,
      selectedSearchUserId,
      setAddMemberError,
      setAddMemberOpen,
      t,
    ],
  )

  const removeMember = React.useCallback(
    async (member: TeamMember) => {
      if (!selectedTeam || !canManage) return
      const operation = beginOperation(`remove:${member.user_id}`)
      try {
        await removeTeamMember({ teamId: selectedTeam.id, userId: member.user_id })
        invalidateTeamDetailsResource(activeAccountId, selectedTeam.id)
        if (!operationIsCurrent(operation)) return
        toast.success(t("teams.removeMemberSuccess"))
        await reloadDetails()
      } catch (error) {
        if (operationIsCurrent(operation)) toast.error(teamErrorMessage(error, t))
      } finally {
        finishOperation(operation)
      }
    },
    [activeAccountId, beginOperation, canManage, finishOperation, operationIsCurrent, reloadDetails, selectedTeam, t],
  )

  const updateMembersStatus = React.useCallback(
    async (userIds: string[], disabled: boolean) => {
      if (!selectedTeam || !canManage) return
      const normalizedUserIds = uniqueStrings(userIds.map((userId) => userId.trim()).filter(Boolean))
      if (normalizedUserIds.length === 0) return

      const operation = beginOperation(disabled ? "disableMembers" : "enableMembers")
      try {
        const input = { teamId: selectedTeam.id, userIds: normalizedUserIds }
        await (disabled ? disableTeamMembers(input) : enableTeamMembers(input))
        invalidateTeamDetailsResource(activeAccountId, selectedTeam.id)
        if (!operationIsCurrent(operation)) return
        toast.success(disabled ? t("teams.disableMembersSuccess") : t("teams.enableMembersSuccess"))
        await reloadDetails()
      } catch (error) {
        if (operationIsCurrent(operation)) toast.error(teamErrorMessage(error, t))
      } finally {
        finishOperation(operation)
      }
    },
    [activeAccountId, beginOperation, canManage, finishOperation, operationIsCurrent, reloadDetails, selectedTeam, t],
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
      if (!selectedTeam || !canManage || providerAccessMutationError || providerOptionsError) return
      const userId = providerAccessForm.userId.trim()
      if (!userId) return void toast.error(t("teams.memberRequired"))
      if (!providerAccessForm.allProviders && providerAccessForm.providers.length === 0) {
        return void toast.error(t("teams.providerRequired"))
      }

      const operation = beginOperation("saveProviderAccess")
      try {
        const snapshot = await getTeamAppAccessSnapshot(selectedTeam.id)
        const parsed = parseProviderGrants(snapshot.access)
        if (!parsed.ok) {
          if (operationIsCurrent(operation)) toast.error(t("teams.providerAccessLoadFailed"))
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
        const updated = await updateTeamAppAccess(
          selectedTeam.id,
          setProviderGrant(parsed.access, userId, providers, allProviders),
          { etag: snapshot.etag },
        )
        invalidateTeamDetailsResource(activeAccountId, selectedTeam.id)
        if (!operationIsCurrent(operation)) return
        setAppAccessForTeam(activeAccountId, selectedTeam.id, updated)
        setProviderAccessForm(initialProviderAccessForm)
        toast.success(t("teams.providerAccessSaveSuccess"))
      } catch (error) {
        if (operationIsCurrent(operation)) toast.error(teamErrorMessage(error, t))
      } finally {
        finishOperation(operation)
      }
    },
    [
      activeAccountId,
      beginOperation,
      canManage,
      finishOperation,
      operationIsCurrent,
      providerAccessMutationError,
      providerOptionsError,
      providerAccessForm,
      selectedTeam,
      setAppAccessForTeam,
      setProviderAccessForm,
      t,
    ],
  )

  const revokeProviderAccess = React.useCallback(
    async (grant: ProviderGrantView) => {
      if (!selectedTeam || !canManage || providerAccessMutationError) return
      const operation = beginOperation(`revokeProviderAccess:${grant.userId}`)
      try {
        const snapshot = await getTeamAppAccessSnapshot(selectedTeam.id)
        const parsed = parseProviderGrants(snapshot.access)
        if (!parsed.ok) {
          if (operationIsCurrent(operation)) toast.error(t("teams.providerAccessLoadFailed"))
          return
        }
        const updated = await updateTeamAppAccess(selectedTeam.id, removeProviderGrant(parsed.access, grant.userId), {
          etag: snapshot.etag,
        })
        invalidateTeamDetailsResource(activeAccountId, selectedTeam.id)
        if (!operationIsCurrent(operation)) return
        setAppAccessForTeam(activeAccountId, selectedTeam.id, updated)
        toast.success(t("teams.providerAccessRevokeSuccess"))
      } catch (error) {
        if (operationIsCurrent(operation)) toast.error(teamErrorMessage(error, t))
      } finally {
        finishOperation(operation)
      }
    },
    [
      activeAccountId,
      beginOperation,
      canManage,
      finishOperation,
      operationIsCurrent,
      providerAccessMutationError,
      selectedTeam,
      setAppAccessForTeam,
      t,
    ],
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
