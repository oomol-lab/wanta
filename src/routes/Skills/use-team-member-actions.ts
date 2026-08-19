import type { EditableTeamMemberRole, Team, TeamMember, TeamRole } from "../../../electron/teams/common.ts"
import type { BusyAction, MemberSearchState } from "./team-management-model.ts"

import * as React from "react"
import { toast } from "sonner"
import { teamErrorMessage } from "./team-errors.ts"
import { errorMessage, uniqueStrings } from "./team-management-model.ts"
import { useAppI18n } from "@/i18n"
import { invalidateTeamDetailsResource } from "@/lib/team-details-resource"
import { canChangeTeamMemberRole } from "@/lib/team-permissions"
import {
  addTeamMember,
  disableTeamMembers,
  enableTeamMembers,
  isTeamMemberLimitError,
  removeTeamMember,
  updateTeamMemberRole,
} from "@/lib/teams-client"

interface TeamMemberActionsOptions {
  activeAccountId: string | undefined
  actorRole: TeamRole | null
  canManage: boolean
  memberInput: string
  memberSearch: MemberSearchState
  reloadDetails: () => Promise<void>
  resetMemberSearch: () => void
  selectedTeam: Team | null
  selectedSearchUserId: string | null
  setAddMemberError: React.Dispatch<React.SetStateAction<string | null>>
  setAddMemberOpen: React.Dispatch<React.SetStateAction<boolean>>
  setBusyAction: React.Dispatch<React.SetStateAction<BusyAction | null>>
}

interface MemberActionOperation {
  busyAction: BusyAction
  id: number
}

export function useTeamMemberActions({
  activeAccountId,
  actorRole,
  canManage,
  memberInput,
  memberSearch,
  reloadDetails,
  resetMemberSearch,
  selectedTeam,
  selectedSearchUserId,
  setAddMemberError,
  setAddMemberOpen,
  setBusyAction,
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

  const updateMemberRole = React.useCallback(
    async (member: TeamMember, role: EditableTeamMemberRole) => {
      if (
        !selectedTeam ||
        member.role === role ||
        !canChangeTeamMemberRole({
          actorCanManage: canManage,
          actorRole,
          actorUserId: activeAccountId,
          member,
        })
      ) {
        return
      }
      const operation = beginOperation(`updateMemberRole:${member.user_id}`)
      try {
        await updateTeamMemberRole({ role, teamId: selectedTeam.id, userId: member.user_id })
        invalidateTeamDetailsResource(activeAccountId, selectedTeam.id)
        if (!operationIsCurrent(operation)) return
        toast.success(t("teams.updateMemberRoleSuccess"))
        await reloadDetails()
      } catch (error) {
        if (operationIsCurrent(operation)) toast.error(teamErrorMessage(error, t))
      } finally {
        finishOperation(operation)
      }
    },
    [
      activeAccountId,
      actorRole,
      beginOperation,
      canManage,
      finishOperation,
      operationIsCurrent,
      reloadDetails,
      selectedTeam,
      t,
    ],
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

  const enableMembers = React.useCallback(
    (userIds: string[]) => updateMembersStatus(userIds, false),
    [updateMembersStatus],
  )

  const disableMembers = React.useCallback(
    (userIds: string[]) => updateMembersStatus(userIds, true),
    [updateMembersStatus],
  )

  return {
    addMember,
    disableMembers,
    enableMembers,
    removeMember,
    updateMemberRole,
  }
}
