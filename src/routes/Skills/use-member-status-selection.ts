import type { BusyAction, MemberView } from "./team-management-model.ts"

import * as React from "react"

export function useMemberStatusSelection({
  busyAction,
  canManage,
  members,
  onDisableMembers,
  onEnableMembers,
}: {
  busyAction: BusyAction | null
  canManage: boolean
  members: MemberView[]
  onDisableMembers: (userIds: string[]) => void
  onEnableMembers: (userIds: string[]) => void
}) {
  const [selectedUserIds, setSelectedUserIds] = React.useState<Set<string>>(() => new Set())
  const showStatusColumn = members.some(hasMemberStatus)
  const canBulkManage = canManage && showStatusColumn
  const selectableMembers = React.useMemo(
    () => (canBulkManage ? members.filter(isBulkEditableMember) : []),
    [canBulkManage, members],
  )
  const selectableUserIds = React.useMemo(
    () => new Set(selectableMembers.map((member) => member.user_id)),
    [selectableMembers],
  )
  const selectedMembers = React.useMemo(
    () => selectableMembers.filter((member) => selectedUserIds.has(member.user_id)),
    [selectableMembers, selectedUserIds],
  )
  const selectedEnableUserIds = React.useMemo(
    () => selectedMembers.filter((member) => member.disable).map((member) => member.user_id),
    [selectedMembers],
  )
  const selectedDisableUserIds = React.useMemo(
    () => selectedMembers.filter((member) => !member.disable).map((member) => member.user_id),
    [selectedMembers],
  )
  const selectedCount = selectedMembers.length
  const allSelected = selectableMembers.length > 0 && selectedCount === selectableMembers.length
  const someSelected = selectedCount > 0 && !allSelected
  const bulkBusy = busyAction === "enableMembers" || busyAction === "disableMembers"

  React.useEffect(() => {
    setSelectedUserIds((current) => {
      const next = new Set([...current].filter((userId) => selectableUserIds.has(userId)))
      return next.size === current.size ? current : next
    })
  }, [selectableUserIds])

  const toggleAll = React.useCallback(
    (checked: boolean) => {
      setSelectedUserIds(checked ? selectableUserIds : new Set<string>())
    },
    [selectableUserIds],
  )

  const toggleMember = React.useCallback((userId: string, checked: boolean) => {
    setSelectedUserIds((current) => {
      const next = new Set(current)
      if (checked) {
        next.add(userId)
      } else {
        next.delete(userId)
      }
      return next
    })
  }, [])

  const enableSelectedMembers = React.useCallback(() => {
    if (selectedEnableUserIds.length === 0) {
      return
    }
    onEnableMembers(selectedEnableUserIds)
    setSelectedUserIds(new Set<string>())
  }, [onEnableMembers, selectedEnableUserIds])

  const disableSelectedMembers = React.useCallback(() => {
    if (selectedDisableUserIds.length === 0) {
      return
    }
    onDisableMembers(selectedDisableUserIds)
    setSelectedUserIds(new Set<string>())
  }, [onDisableMembers, selectedDisableUserIds])

  return {
    allSelected,
    bulkBusy,
    canBulkManage,
    disableSelectedMembers,
    enableSelectedMembers,
    selectedCount,
    selectedDisableUserIds,
    selectedEnableUserIds,
    selectedUserIds,
    selectableMembers,
    showStatusColumn,
    someSelected,
    toggleAll,
    toggleMember,
  }
}

export function hasMemberStatus(member: MemberView): member is MemberView & { disable: boolean } {
  return typeof member.disable === "boolean"
}

export function isBulkEditableMember(member: MemberView): member is MemberView & { disable: boolean } {
  return member.role !== "creator" && hasMemberStatus(member)
}
