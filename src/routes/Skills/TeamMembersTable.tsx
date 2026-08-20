import type { EditableTeamMemberRole, TeamMember, TeamRole } from "../../../electron/teams/common.ts"
import type { BusyAction, MemberView } from "./team-management-model.ts"
import type { TeamMemberConnectionAccessData } from "./TeamMemberConnectionAccessDialog.tsx"

import { MoreHorizontalIcon, Trash2Icon, UserCheckIcon, UserXIcon } from "lucide-react"
import * as React from "react"
import { projectTeamMemberConnectionAccessSummaries } from "./team-member-connection-access-model.ts"
import { MemberConnectionAccessButton } from "./TeamMemberConnectionAccessDialog.tsx"
import { TeamUserAvatar } from "./TeamUserAvatar.tsx"
import { hasMemberStatus, isBulkEditableMember, useMemberStatusSelection } from "./use-member-status-selection.ts"
import { CopyIconButton } from "@/components/CopyIconButton"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  ConfirmDialog,
  ConfirmDialogAction,
  ConfirmDialogCancel,
  ConfirmDialogContent,
  ConfirmDialogDescription,
  ConfirmDialogFooter,
  ConfirmDialogHeader,
  ConfirmDialogTitle,
} from "@/components/ui/confirm-dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useClipboardCopy } from "@/hooks/useClipboardCopy"
import { useAppI18n } from "@/i18n"
import { canChangeTeamMemberRole, teamRoleLabelKey } from "@/lib/team-permissions"
import { cn } from "@/lib/utils"

export function MembersTable({
  actorRole,
  actorUserId,
  busyAction,
  canManage,
  members,
  connectionAccess,
  onOpenMemberConnectionAccess,
  onDisableMembers,
  onEnableMembers,
  onRemoveMember,
  onUpdateMemberRole,
}: {
  actorRole: TeamRole | null
  actorUserId: string | undefined
  busyAction: BusyAction | null
  canManage: boolean
  members: MemberView[]
  connectionAccess: TeamMemberConnectionAccessData
  onOpenMemberConnectionAccess: (member: MemberView) => void
  onDisableMembers: (userIds: string[]) => void
  onEnableMembers: (userIds: string[]) => void
  onRemoveMember: (member: TeamMember) => Promise<void>
  onUpdateMemberRole: (member: TeamMember, role: EditableTeamMemberRole) => Promise<void>
}) {
  const { t } = useAppI18n()
  const [removeTarget, setRemoveTarget] = React.useState<MemberView | null>(null)
  const [roleChangeTarget, setRoleChangeTarget] = React.useState<{
    member: MemberView
    role: EditableTeamMemberRole
  } | null>(null)
  const connectionProjections = React.useMemo(() => {
    if (!connectionAccess.access) return null
    return projectTeamMemberConnectionAccessSummaries(
      connectionAccess.access,
      connectionAccess.apps,
      members.map((member) => member.user_id),
    )
  }, [connectionAccess.access, connectionAccess.apps, members])
  const removeTargetBusy = removeTarget ? busyAction === `remove:${removeTarget.user_id}` : false
  const roleChangeTargetBusy = roleChangeTarget
    ? busyAction === `updateMemberRole:${roleChangeTarget.member.user_id}`
    : false
  const {
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
  } = useMemberStatusSelection({ busyAction, canManage, members, onDisableMembers, onEnableMembers })

  const removeConfirmDialog = (
    <ConfirmDialog
      open={Boolean(removeTarget)}
      onOpenChange={(open) => {
        if (!open && !removeTargetBusy) {
          setRemoveTarget(null)
        }
      }}
    >
      <ConfirmDialogContent>
        <ConfirmDialogHeader>
          <ConfirmDialogTitle>{t("teams.removeMemberConfirmTitle")}</ConfirmDialogTitle>
          <ConfirmDialogDescription>
            {removeTarget ? t("teams.removeMemberConfirmDescription", { name: removeTarget.displayName }) : null}
          </ConfirmDialogDescription>
        </ConfirmDialogHeader>
        <ConfirmDialogFooter>
          <ConfirmDialogCancel disabled={removeTargetBusy}>{t("common.cancel")}</ConfirmDialogCancel>
          <ConfirmDialogAction
            disabled={removeTargetBusy || !removeTarget}
            onClick={(event) => {
              if (removeTarget) {
                event.preventDefault()
                void onRemoveMember(removeTarget).finally(() => setRemoveTarget(null))
              }
            }}
          >
            {t("teams.removeMember")}
          </ConfirmDialogAction>
        </ConfirmDialogFooter>
      </ConfirmDialogContent>
    </ConfirmDialog>
  )

  const roleChangeConfirmDialog = (
    <ConfirmDialog
      open={Boolean(roleChangeTarget)}
      onOpenChange={(open) => {
        if (!open && !roleChangeTargetBusy) {
          setRoleChangeTarget(null)
        }
      }}
    >
      <ConfirmDialogContent>
        <ConfirmDialogHeader>
          <ConfirmDialogTitle>
            {t(roleChangeTarget?.role === "admin" ? "teams.promoteAdminConfirmTitle" : "teams.demoteAdminConfirmTitle")}
          </ConfirmDialogTitle>
          <ConfirmDialogDescription>
            {roleChangeTarget
              ? t(
                  roleChangeTarget.role === "admin"
                    ? "teams.promoteAdminConfirmDescription"
                    : "teams.demoteAdminConfirmDescription",
                  { name: roleChangeTarget.member.displayName },
                )
              : null}
          </ConfirmDialogDescription>
        </ConfirmDialogHeader>
        <ConfirmDialogFooter>
          <ConfirmDialogCancel disabled={roleChangeTargetBusy}>{t("common.cancel")}</ConfirmDialogCancel>
          <ConfirmDialogAction
            disabled={roleChangeTargetBusy || !roleChangeTarget}
            onClick={(event) => {
              if (roleChangeTarget) {
                event.preventDefault()
                void onUpdateMemberRole(roleChangeTarget.member, roleChangeTarget.role).finally(() =>
                  setRoleChangeTarget(null),
                )
              }
            }}
          >
            {t(roleChangeTarget?.role === "admin" ? "teams.promoteToAdmin" : "teams.demoteToMember")}
          </ConfirmDialogAction>
        </ConfirmDialogFooter>
      </ConfirmDialogContent>
    </ConfirmDialog>
  )

  return (
    <>
      {canBulkManage ? (
        <MemberStatusBulkToolbar
          allSelected={allSelected}
          bulkBusy={bulkBusy}
          disableBusy={busyAction === "disableMembers"}
          enableBusy={busyAction === "enableMembers"}
          enableDisabled={selectedEnableUserIds.length === 0}
          disableDisabled={selectedDisableUserIds.length === 0}
          selectAllDisabled={selectableMembers.length === 0}
          selectedCount={selectedCount}
          showSelectAll
          someSelected={someSelected}
          onDisable={disableSelectedMembers}
          onEnable={enableSelectedMembers}
          onToggleAll={toggleAll}
        />
      ) : null}
      <div className="divide-y">
        {members.map((member) => {
          const canRemove = canManage && member.role !== "creator"
          const canUpdateRole =
            member.role !== "creator" &&
            canChangeTeamMemberRole({
              actorCanManage: canManage,
              actorRole,
              actorUserId,
              member,
            })
          const selectable = isBulkEditableMember(member)
          const removeBusy = busyAction === `remove:${member.user_id}`
          const roleUpdateBusy = busyAction === `updateMemberRole:${member.user_id}`
          return (
            <div
              key={member.user_id}
              className={cn(
                "oo-list-render-boundary grid min-w-0 items-center gap-x-3 px-3 py-2.5",
                canBulkManage ? "grid-cols-[auto_auto_minmax(0,1fr)_auto]" : "grid-cols-[auto_minmax(0,1fr)_auto]",
              )}
            >
              {canBulkManage ? (
                <MemberStatusCheckbox
                  ariaLabel={t("teams.selectMember", { name: member.displayName })}
                  checked={selectedUserIds.has(member.user_id)}
                  disabled={bulkBusy || !selectable}
                  onCheckedChange={(checked) => toggleMember(member.user_id, checked)}
                />
              ) : null}
              <TeamUserAvatar avatar={member.avatar} fallback={member.fallback} />
              <div className="min-w-0 self-center">
                <CompactMemberIdentity member={member}>
                  <MemberRoleControl
                    canUpdate={canUpdateRole}
                    disabled={bulkBusy || roleUpdateBusy}
                    member={member}
                    onChange={(role) => setRoleChangeTarget({ member, role })}
                  />
                  {showStatusColumn ? <MemberStatusBadge member={member} /> : null}
                </CompactMemberIdentity>
              </div>

              <div className="flex min-w-0 items-center justify-end gap-2">
                {canManage ? (
                  <MemberConnectionAccessButton
                    disabled={bulkBusy}
                    loading={connectionAccess.loading}
                    invalid={connectionProjections?.ok === false}
                    summary={
                      connectionProjections?.ok ? (connectionProjections.byUserId.get(member.user_id) ?? null) : null
                    }
                    onClick={() => onOpenMemberConnectionAccess(member)}
                  />
                ) : null}
                {canRemove ? (
                  <MemberActionsMenu removeDisabled={bulkBusy || removeBusy} onRemove={() => setRemoveTarget(member)} />
                ) : null}
              </div>
            </div>
          )
        })}
      </div>
      {removeConfirmDialog}
      {roleChangeConfirmDialog}
    </>
  )
}

function MemberRoleControl({
  canUpdate,
  disabled,
  member,
  onChange,
}: {
  canUpdate: boolean
  disabled: boolean
  member: MemberView
  onChange: (role: EditableTeamMemberRole) => void
}) {
  const { t } = useAppI18n()
  const label = t(teamRoleLabelKey(member.role))

  if (!canUpdate || member.role === "creator") {
    return <Badge variant="secondary">{label}</Badge>
  }

  return (
    <Select
      value={member.role}
      onValueChange={(value) => {
        if ((value === "member" || value === "admin") && value !== member.role) {
          onChange(value)
        }
      }}
    >
      <SelectTrigger
        size="sm"
        className="h-6 min-w-[6.5rem] rounded-full border-0 bg-secondary px-2.5 text-xs font-medium text-secondary-foreground hover:bg-secondary/80"
        disabled={disabled}
        aria-label={t("teams.changeMemberRole", { name: member.displayName })}
      >
        <SelectValue>{label}</SelectValue>
      </SelectTrigger>
      <SelectContent align="start">
        <SelectItem value="member">{t("teams.roleMember")}</SelectItem>
        <SelectItem value="admin">{t("teams.roleAdmin")}</SelectItem>
      </SelectContent>
    </Select>
  )
}

function CompactMemberIdentity({ children, member }: { children: React.ReactNode; member: MemberView }) {
  const { t } = useAppI18n()

  return (
    <div className="group/member-identity grid min-w-0 gap-1">
      <div className="flex min-w-0 items-center gap-2">
        <CopyTextButton
          ariaLabel={t("teams.copyMemberName")}
          className="oo-text-label max-w-[12rem] min-w-0 shrink truncate"
          copiedLabel={t("teams.memberNameCopied")}
          value={member.displayName}
        />
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="oo-text-caption-compact min-w-0 truncate font-mono text-muted-foreground">
              {member.secondaryLabel}
            </span>
          </TooltipTrigger>
          <TooltipContent className="max-w-80 font-mono break-all">{member.user_id}</TooltipContent>
        </Tooltip>
        <CopyValueButton
          ariaLabel={t("teams.copyMemberUserId")}
          copiedLabel={t("teams.memberUserIdCopied")}
          value={member.user_id}
        />
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2">{children}</div>
    </div>
  )
}

function CopyTextButton({
  ariaLabel,
  className,
  copiedLabel,
  value,
}: {
  ariaLabel: string
  className?: string
  copiedLabel: string
  value: string
}) {
  const { t } = useAppI18n()
  const { copied, copyText } = useClipboardCopy({ failureMessage: t("teams.memberCopyFailed") })

  const copyValue = React.useCallback(async () => {
    await copyText(value)
  }, [copyText, value])

  const buttonAriaLabel = copied ? copiedLabel : ariaLabel
  const tooltipLabel = copied ? copiedLabel : `${ariaLabel}: ${value}`

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={cn(
            "rounded-sm text-left transition hover:text-foreground hover:underline focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
            className,
          )}
          aria-label={buttonAriaLabel}
          onClick={() => void copyValue()}
        >
          {value}
        </button>
      </TooltipTrigger>
      <TooltipContent>{tooltipLabel}</TooltipContent>
    </Tooltip>
  )
}

function MemberStatusBulkToolbar({
  allSelected,
  bulkBusy,
  disableBusy,
  disableDisabled,
  enableBusy,
  enableDisabled,
  onDisable,
  onEnable,
  onToggleAll,
  selectAllDisabled,
  selectedCount,
  showSelectAll,
  someSelected,
}: {
  allSelected: boolean
  bulkBusy: boolean
  disableBusy: boolean
  disableDisabled: boolean
  enableBusy: boolean
  enableDisabled: boolean
  onDisable: () => void
  onEnable: () => void
  onToggleAll: (checked: boolean) => void
  selectAllDisabled: boolean
  selectedCount: number
  showSelectAll: boolean
  someSelected: boolean
}) {
  const { t } = useAppI18n()

  return (
    <div className="flex min-w-0 flex-col gap-2 border-b px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
      <label className="oo-text-caption-compact flex min-w-0 items-center gap-2 text-muted-foreground">
        {showSelectAll ? (
          <MemberStatusCheckbox
            ariaLabel={t("teams.selectAllMembers")}
            checked={allSelected}
            disabled={bulkBusy || selectAllDisabled}
            indeterminate={someSelected}
            onCheckedChange={onToggleAll}
          />
        ) : null}
        <span className="truncate">{t("teams.selectedMembers", { count: selectedCount })}</span>
      </label>
      <div className="flex min-w-0 flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" disabled={bulkBusy || enableDisabled} onClick={onEnable}>
          <UserCheckIcon className="size-3.5" />
          {enableBusy ? t("teams.enablingMembers") : t("teams.enableSelectedMembers")}
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={bulkBusy || disableDisabled} onClick={onDisable}>
          <UserXIcon className="size-3.5" />
          {disableBusy ? t("teams.disablingMembers") : t("teams.disableSelectedMembers")}
        </Button>
      </div>
    </div>
  )
}

function MemberStatusBadge({ member }: { member: MemberView }) {
  const { t } = useAppI18n()
  if (!hasMemberStatus(member)) {
    return null
  }
  return (
    <Badge variant={member.disable ? "destructive" : "success"}>
      {member.disable ? t("teams.memberDisabled") : t("teams.memberEnabled")}
    </Badge>
  )
}

function MemberStatusCheckbox({
  ariaLabel,
  checked,
  disabled,
  indeterminate = false,
  onCheckedChange,
}: {
  ariaLabel: string
  checked: boolean
  disabled: boolean
  indeterminate?: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  const inputRef = React.useRef<HTMLInputElement | null>(null)

  React.useEffect(() => {
    if (inputRef.current) {
      inputRef.current.indeterminate = indeterminate
    }
  }, [indeterminate])

  return (
    <input
      ref={inputRef}
      type="checkbox"
      className="mt-0.5 size-4 shrink-0 accent-primary disabled:cursor-not-allowed disabled:opacity-50"
      checked={checked}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(event) => onCheckedChange(event.currentTarget.checked)}
    />
  )
}

function CopyValueButton({ ariaLabel, copiedLabel, value }: { ariaLabel: string; copiedLabel: string; value: string }) {
  const { t } = useAppI18n()

  return (
    <CopyIconButton
      ariaLabel={ariaLabel}
      className="opacity-70 group-hover/member-identity:opacity-100 focus-visible:opacity-100 data-[copied=true]:opacity-100"
      copiedLabel={copiedLabel}
      failureMessage={t("teams.memberCopyFailed")}
      tooltipLabel={`${ariaLabel}: ${value}`}
      value={value}
    />
  )
}

function MemberActionsMenu({ onRemove, removeDisabled = false }: { onRemove?: () => void; removeDisabled?: boolean }) {
  const { t } = useAppI18n()
  const disabled = !onRemove || removeDisabled

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-[1.375rem]"
          disabled={disabled}
          aria-label={t("teams.actions")}
        >
          <MoreHorizontalIcon className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} className="w-44">
        {onRemove ? (
          <DropdownMenuItem variant="destructive" disabled={removeDisabled} onSelect={onRemove}>
            <Trash2Icon className="size-4" />
            {t("teams.removeMember")}
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
