import type { TeamMember } from "../../../electron/teams/common.ts"
import type { BusyAction, MemberView, ProviderGrantView } from "./team-management-model.ts"

import { MoreHorizontalIcon, PencilIcon, ShieldCheckIcon, Trash2Icon, UserCheckIcon, UserXIcon } from "lucide-react"
import * as React from "react"
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useClipboardCopy } from "@/hooks/useClipboardCopy"
import { useAppI18n } from "@/i18n"
import { teamRoleHasDefaultConnectionAccess, teamRoleLabelKey } from "@/lib/team-permissions"
import { cn } from "@/lib/utils"

export function MembersTable({
  appAccessLoading,
  busyAction,
  canManage,
  grantsByUserId,
  members,
  onEditProviderAccess,
  onDisableMembers,
  onEnableMembers,
  onGrantProviderAccess,
  onRemoveMember,
  onRevokeProviderAccess,
  providerAccessMutationError,
  providerOptionsError,
  providerOptionsLoading,
  showProviderAccess,
}: {
  appAccessLoading: boolean
  busyAction: BusyAction | null
  canManage: boolean
  grantsByUserId: Map<string, ProviderGrantView>
  members: MemberView[]
  onDisableMembers: (userIds: string[]) => void
  onEditProviderAccess: (grant: ProviderGrantView) => void
  onEnableMembers: (userIds: string[]) => void
  onGrantProviderAccess: (userId: string) => void
  onRemoveMember: (member: TeamMember) => Promise<void>
  onRevokeProviderAccess: (grant: ProviderGrantView) => Promise<void>
  providerAccessMutationError: string | null
  providerOptionsError: string | null
  providerOptionsLoading: boolean
  showProviderAccess: boolean
}) {
  const { t } = useAppI18n()
  const [removeTarget, setRemoveTarget] = React.useState<MemberView | null>(null)
  const [revokeTarget, setRevokeTarget] = React.useState<ProviderGrantView | null>(null)
  const removeTargetBusy = removeTarget ? busyAction === `remove:${removeTarget.user_id}` : false
  const revokeTargetBusy = revokeTarget ? busyAction === `revokeProviderAccess:${revokeTarget.userId}` : false
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

  const revokeConfirmDialog = (
    <ConfirmDialog
      open={Boolean(revokeTarget)}
      onOpenChange={(open) => {
        if (!open && !revokeTargetBusy) {
          setRevokeTarget(null)
        }
      }}
    >
      <ConfirmDialogContent>
        <ConfirmDialogHeader>
          <ConfirmDialogTitle>{t("teams.revokeProviderAccessConfirmTitle")}</ConfirmDialogTitle>
          <ConfirmDialogDescription>{t("teams.revokeProviderAccessConfirmDescription")}</ConfirmDialogDescription>
        </ConfirmDialogHeader>
        <ConfirmDialogFooter>
          <ConfirmDialogCancel disabled={revokeTargetBusy}>{t("common.cancel")}</ConfirmDialogCancel>
          <ConfirmDialogAction
            disabled={revokeTargetBusy || !revokeTarget}
            onClick={(event) => {
              if (revokeTarget) {
                event.preventDefault()
                void onRevokeProviderAccess(revokeTarget).finally(() => setRevokeTarget(null))
              }
            }}
          >
            {t("teams.revokeProviderAccess")}
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
          const grant = grantsByUserId.get(member.user_id) ?? null
          const canRemove = canManage && member.role !== "creator"
          const canManageProviderAccess = showProviderAccess && member.role === "member"
          const selectable = isBulkEditableMember(member)
          const accessDisabled = appAccessLoading || bulkBusy || Boolean(providerAccessMutationError)
          const accessEditDisabled = accessDisabled || providerOptionsLoading || Boolean(providerOptionsError)
          const removeBusy = busyAction === `remove:${member.user_id}`
          const revokeBusy = grant ? busyAction === `revokeProviderAccess:${grant.userId}` : false
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
                  {teamRoleHasDefaultConnectionAccess(member.role) && showProviderAccess ? (
                    <Badge variant="secondary">
                      {t("teams.roleDefaultAccessCompact", { role: t(teamRoleLabelKey(member.role)) })}
                    </Badge>
                  ) : (
                    <Badge variant="secondary">{t(teamRoleLabelKey(member.role))}</Badge>
                  )}
                  {showStatusColumn ? <MemberStatusBadge member={member} /> : null}
                  {canManageProviderAccess ? (
                    <ProviderAccessSummary
                      allProvidersLabel={t("teams.allProviders")}
                      grant={grant}
                      loading={appAccessLoading}
                      notAuthorizedLabel={
                        providerAccessMutationError ? t("teams.providerAccessUnavailable") : t("teams.notAuthorized")
                      }
                    />
                  ) : null}
                </CompactMemberIdentity>
              </div>

              <div className="flex min-w-0 items-center justify-end gap-2">
                {canRemove && canManageProviderAccess && !grant && !appAccessLoading ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 shrink-0 px-2"
                    disabled={accessEditDisabled}
                    onClick={() => onGrantProviderAccess(member.user_id)}
                  >
                    <ShieldCheckIcon className="size-3.5" />
                    {t("teams.grantProviderAccessAction")}
                  </Button>
                ) : null}
                {canRemove ? (
                  <MemberActionsMenu
                    editProviderAccessDisabled={accessEditDisabled || busyAction === "saveProviderAccess" || revokeBusy}
                    removeDisabled={bulkBusy || removeBusy}
                    revokeProviderAccessDisabled={accessDisabled || busyAction === "saveProviderAccess" || revokeBusy}
                    onEditProviderAccess={
                      grant && canManageProviderAccess ? () => onEditProviderAccess(grant) : undefined
                    }
                    onRemove={() => setRemoveTarget(member)}
                    onRevokeProviderAccess={grant && canManageProviderAccess ? () => setRevokeTarget(grant) : undefined}
                  />
                ) : null}
              </div>
            </div>
          )
        })}
      </div>
      {removeConfirmDialog}
      {revokeConfirmDialog}
    </>
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

function MemberActionsMenu({
  editProviderAccessDisabled = false,
  onEditProviderAccess,
  onRemove,
  onRevokeProviderAccess,
  removeDisabled = false,
  revokeProviderAccessDisabled = false,
}: {
  editProviderAccessDisabled?: boolean
  onEditProviderAccess?: () => void
  onRemove?: () => void
  onRevokeProviderAccess?: () => void
  removeDisabled?: boolean
  revokeProviderAccessDisabled?: boolean
}) {
  const { t } = useAppI18n()
  const hasProviderActions = Boolean(onEditProviderAccess || onRevokeProviderAccess)
  const disabled =
    (!onEditProviderAccess || editProviderAccessDisabled) &&
    (!onRevokeProviderAccess || revokeProviderAccessDisabled) &&
    (!onRemove || removeDisabled)

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
        {onEditProviderAccess ? (
          <DropdownMenuItem disabled={editProviderAccessDisabled} onSelect={onEditProviderAccess}>
            <PencilIcon className="size-4" />
            {t("teams.editProviderAccessAction")}
          </DropdownMenuItem>
        ) : null}
        {onRevokeProviderAccess ? (
          <DropdownMenuItem
            variant="destructive"
            disabled={revokeProviderAccessDisabled}
            onSelect={onRevokeProviderAccess}
          >
            <Trash2Icon className="size-4" />
            {t("teams.revokeProviderAccess")}
          </DropdownMenuItem>
        ) : null}
        {hasProviderActions && onRemove ? <DropdownMenuSeparator /> : null}
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

function ProviderAccessSummary({
  allProvidersLabel,
  grant,
  loading,
  notAuthorizedLabel,
}: {
  allProvidersLabel: string
  grant: ProviderGrantView | null
  loading: boolean
  notAuthorizedLabel: string
}) {
  if (loading) {
    return <Skeleton className="h-6 w-28 rounded-md" />
  }
  if (!grant) {
    return <Badge variant="secondary">{notAuthorizedLabel}</Badge>
  }
  if (grant.allProviders) {
    return <Badge variant="secondary">{allProvidersLabel}</Badge>
  }

  const visibleProviders = grant.providers.slice(0, 1)
  const hiddenProviderCount = grant.providers.length - visibleProviders.length
  return (
    <div className="flex min-w-0 flex-wrap gap-2" title={grant.providers.map((provider) => provider.label).join(", ")}>
      {visibleProviders.map((provider) => (
        <Badge key={provider.service} variant="secondary" className="max-w-full" title={provider.service}>
          <span className="truncate">{provider.label}</span>
        </Badge>
      ))}
      {hiddenProviderCount > 0 ? <Badge variant="secondary">+{hiddenProviderCount}</Badge> : null}
    </div>
  )
}
