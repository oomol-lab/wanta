import type { OrganizationMember } from "../../../electron/organizations/common.ts"
import type { BusyAction, MemberView, ProviderGrantView } from "./organization-management-model.ts"

import { MoreHorizontalIcon, PencilIcon, ShieldCheckIcon, Trash2Icon, UserCheckIcon, UserXIcon } from "lucide-react"
import * as React from "react"
import { hasMemberStatus, isBulkEditableMember, useMemberStatusSelection } from "./use-member-status-selection.ts"
import { CachedAvatarImage } from "@/components/CachedAvatarImage"
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
  ConfirmDialogTrigger,
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
import { cn } from "@/lib/utils"

export function MembersTable({
  appAccessLoading,
  busyAction,
  canManage,
  compact = false,
  grantsByUserId,
  members,
  onEditProviderAccess,
  onDisableMembers,
  onEnableMembers,
  onGrantProviderAccess,
  onRemoveMember,
  onRevokeProviderAccess,
  providerAccessError,
  showProviderAccess,
}: {
  appAccessLoading: boolean
  busyAction: BusyAction | null
  canManage: boolean
  compact?: boolean
  grantsByUserId: Map<string, ProviderGrantView>
  members: MemberView[]
  onDisableMembers: (userIds: string[]) => void
  onEditProviderAccess: (grant: ProviderGrantView) => void
  onEnableMembers: (userIds: string[]) => void
  onGrantProviderAccess: (userId: string) => void
  onRemoveMember: (member: OrganizationMember) => void
  onRevokeProviderAccess: (grant: ProviderGrantView) => void
  providerAccessError: string | null
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
          <ConfirmDialogTitle>{t("organizations.removeMemberConfirmTitle")}</ConfirmDialogTitle>
          <ConfirmDialogDescription>
            {removeTarget
              ? t("organizations.removeMemberConfirmDescription", { name: removeTarget.displayName })
              : null}
          </ConfirmDialogDescription>
        </ConfirmDialogHeader>
        <ConfirmDialogFooter>
          <ConfirmDialogCancel disabled={removeTargetBusy}>{t("common.cancel")}</ConfirmDialogCancel>
          <ConfirmDialogAction
            disabled={removeTargetBusy || !removeTarget}
            onClick={() => {
              if (removeTarget) {
                onRemoveMember(removeTarget)
                setRemoveTarget(null)
              }
            }}
          >
            {t("organizations.removeMember")}
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
          <ConfirmDialogTitle>{t("organizations.revokeProviderAccessConfirmTitle")}</ConfirmDialogTitle>
          <ConfirmDialogDescription>
            {t("organizations.revokeProviderAccessConfirmDescription")}
          </ConfirmDialogDescription>
        </ConfirmDialogHeader>
        <ConfirmDialogFooter>
          <ConfirmDialogCancel disabled={revokeTargetBusy}>{t("common.cancel")}</ConfirmDialogCancel>
          <ConfirmDialogAction
            disabled={revokeTargetBusy || !revokeTarget}
            onClick={() => {
              if (revokeTarget) {
                onRevokeProviderAccess(revokeTarget)
                setRevokeTarget(null)
              }
            }}
          >
            {t("organizations.revokeProviderAccess")}
          </ConfirmDialogAction>
        </ConfirmDialogFooter>
      </ConfirmDialogContent>
    </ConfirmDialog>
  )

  if (compact) {
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
            const selectable = isBulkEditableMember(member)
            const accessDisabled = appAccessLoading || bulkBusy || Boolean(providerAccessError)
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
                    ariaLabel={t("organizations.selectMember", { name: member.displayName })}
                    checked={selectedUserIds.has(member.user_id)}
                    disabled={bulkBusy || !selectable}
                    onCheckedChange={(checked) => toggleMember(member.user_id, checked)}
                  />
                ) : null}
                <UserAvatar avatar={member.avatar} fallback={member.fallback} />
                <div className="min-w-0 self-center">
                  <CompactMemberIdentity member={member}>
                    {member.role === "creator" && showProviderAccess ? (
                      <Badge variant="secondary">{t("organizations.creatorDefaultAccessCompact")}</Badge>
                    ) : (
                      <Badge variant="secondary">
                        {member.role === "creator" ? t("organizations.roleCreator") : t("organizations.roleMember")}
                      </Badge>
                    )}
                    {showStatusColumn ? <MemberStatusBadge member={member} /> : null}
                    {showProviderAccess && member.role !== "creator" ? (
                      <ProviderAccessSummary
                        compact
                        allProvidersLabel={t("organizations.allProviders")}
                        grant={grant}
                        loading={appAccessLoading}
                        notAuthorizedLabel={
                          providerAccessError
                            ? t("organizations.providerAccessUnavailable")
                            : t("organizations.notAuthorized")
                        }
                      />
                    ) : null}
                  </CompactMemberIdentity>
                </div>

                <div className="flex min-w-0 items-center justify-end gap-2">
                  {canRemove && showProviderAccess && !grant && !appAccessLoading ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 shrink-0 px-2"
                      disabled={accessDisabled}
                      onClick={() => onGrantProviderAccess(member.user_id)}
                    >
                      <ShieldCheckIcon className="size-3.5" />
                      {t("organizations.grantProviderAccessAction")}
                    </Button>
                  ) : null}
                  {canRemove ? (
                    <MemberActionsMenu
                      compact
                      editProviderAccessDisabled={accessDisabled || busyAction === "saveProviderAccess" || revokeBusy}
                      removeDisabled={bulkBusy || removeBusy}
                      revokeProviderAccessDisabled={accessDisabled || busyAction === "saveProviderAccess" || revokeBusy}
                      onEditProviderAccess={grant && showProviderAccess ? () => onEditProviderAccess(grant) : undefined}
                      onRemove={() => setRemoveTarget(member)}
                      onRevokeProviderAccess={grant && showProviderAccess ? () => setRevokeTarget(grant) : undefined}
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

  const gridTemplateColumns = [
    canBulkManage ? "2rem" : null,
    "minmax(12rem,1fr)",
    "7rem",
    showStatusColumn ? "7rem" : null,
    canManage && showProviderAccess ? "minmax(12rem,1fr)" : null,
    canManage ? "auto" : null,
  ]
    .filter(Boolean)
    .join(" ")
  const minWidthClassName =
    canBulkManage && canManage && showProviderAccess
      ? "min-w-[50rem]"
      : canBulkManage || (canManage && showProviderAccess)
        ? "min-w-[40rem]"
        : "min-w-[32rem]"

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
          showSelectAll={false}
          someSelected={someSelected}
          onDisable={disableSelectedMembers}
          onEnable={enableSelectedMembers}
          onToggleAll={toggleAll}
        />
      ) : null}
      <div className="min-w-0 overflow-x-auto">
        <div className={minWidthClassName}>
          <div
            className={cn(
              "oo-text-caption-compact grid gap-3 border-b bg-muted/30 px-3 py-2 font-medium text-muted-foreground",
            )}
            style={{ gridTemplateColumns }}
          >
            {canBulkManage ? (
              <MemberStatusCheckbox
                ariaLabel={t("organizations.selectAllMembers")}
                checked={allSelected}
                disabled={bulkBusy || selectableMembers.length === 0}
                indeterminate={someSelected}
                onCheckedChange={toggleAll}
              />
            ) : null}
            <div>{t("organizations.member")}</div>
            <div>{t("organizations.role")}</div>
            {showStatusColumn ? <div>{t("organizations.memberStatus")}</div> : null}
            {canManage && showProviderAccess ? <div>{t("organizations.usableConnections")}</div> : null}
            {canManage ? <div className="text-right">{t("organizations.actions")}</div> : null}
          </div>
          <div className="divide-y">
            {members.map((member) => {
              const grant = grantsByUserId.get(member.user_id) ?? null
              const canRemove = canManage && member.role !== "creator"
              const selectable = isBulkEditableMember(member)
              return (
                <div
                  key={member.user_id}
                  className="oo-list-render-boundary grid items-center gap-3 px-3 py-3"
                  style={{ gridTemplateColumns }}
                >
                  {canBulkManage ? (
                    <MemberStatusCheckbox
                      ariaLabel={t("organizations.selectMember", { name: member.displayName })}
                      checked={selectedUserIds.has(member.user_id)}
                      disabled={bulkBusy || !selectable}
                      onCheckedChange={(checked) => toggleMember(member.user_id, checked)}
                    />
                  ) : null}
                  <div className="flex min-w-0 items-center gap-3">
                    <UserAvatar avatar={member.avatar} fallback={member.fallback} />
                    <div className="min-w-0">
                      <MemberIdentity member={member} />
                    </div>
                  </div>
                  <div>
                    <Badge variant="secondary">
                      {member.role === "creator" ? t("organizations.roleCreator") : t("organizations.roleMember")}
                    </Badge>
                  </div>
                  {showStatusColumn ? (
                    <div>
                      <MemberStatusBadge member={member} />
                    </div>
                  ) : null}
                  {canManage && showProviderAccess ? (
                    <div>
                      {member.role === "creator" ? (
                        <Badge variant="secondary">{t("organizations.creatorDefaultAccess")}</Badge>
                      ) : (
                        <ProviderAccessSummary
                          allProvidersLabel={t("organizations.allProviders")}
                          grant={grant}
                          loading={appAccessLoading}
                          notAuthorizedLabel={
                            providerAccessError
                              ? t("organizations.providerAccessUnavailable")
                              : t("organizations.notAuthorized")
                          }
                        />
                      )}
                    </div>
                  ) : null}
                  {canManage ? (
                    <div className="flex justify-end gap-2">
                      {member.role === "creator" ? (
                        <span className="oo-text-body text-muted-foreground">
                          {t("organizations.creatorProtected")}
                        </span>
                      ) : (
                        <>
                          {showProviderAccess ? (
                            <ProviderAccessActions
                              busyAction={busyAction}
                              disabled={appAccessLoading || bulkBusy || Boolean(providerAccessError)}
                              grant={grant}
                              memberId={member.user_id}
                              onEdit={onEditProviderAccess}
                              onGrant={onGrantProviderAccess}
                              onRevoke={onRevokeProviderAccess}
                            />
                          ) : null}
                          <MemberActionsMenu
                            removeDisabled={!canRemove || bulkBusy || busyAction === `remove:${member.user_id}`}
                            onRemove={() => setRemoveTarget(member)}
                          />
                        </>
                      )}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        </div>
      </div>
      {removeConfirmDialog}
    </>
  )
}

function MemberIdentity({ member }: { member: MemberView }) {
  const { t } = useAppI18n()

  return (
    <div className="group/member-identity grid min-w-0 gap-0.5">
      <div className="flex min-w-0 items-center">
        <CopyTextButton
          ariaLabel={t("organizations.copyMemberName")}
          className="oo-text-label min-w-0 truncate"
          copiedLabel={t("organizations.memberNameCopied")}
          value={member.displayName}
        />
      </div>
      <div className="flex min-w-0 items-center gap-1.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="oo-text-caption-compact min-w-0 truncate font-mono text-muted-foreground">
              {member.secondaryLabel}
            </span>
          </TooltipTrigger>
          <TooltipContent className="max-w-80 font-mono break-all">{member.user_id}</TooltipContent>
        </Tooltip>
        <CopyValueButton
          ariaLabel={t("organizations.copyMemberUserId")}
          copiedLabel={t("organizations.memberUserIdCopied")}
          value={member.user_id}
        />
      </div>
    </div>
  )
}

function CompactMemberIdentity({ children, member }: { children: React.ReactNode; member: MemberView }) {
  const { t } = useAppI18n()

  return (
    <div className="group/member-identity grid min-w-0 gap-1">
      <div className="flex min-w-0 items-center gap-2">
        <CopyTextButton
          ariaLabel={t("organizations.copyMemberName")}
          className="oo-text-label max-w-[12rem] min-w-0 shrink truncate"
          copiedLabel={t("organizations.memberNameCopied")}
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
          ariaLabel={t("organizations.copyMemberUserId")}
          copiedLabel={t("organizations.memberUserIdCopied")}
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
  const { copied, copyText } = useClipboardCopy({ failureMessage: t("organizations.memberCopyFailed") })

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
            ariaLabel={t("organizations.selectAllMembers")}
            checked={allSelected}
            disabled={bulkBusy || selectAllDisabled}
            indeterminate={someSelected}
            onCheckedChange={onToggleAll}
          />
        ) : null}
        <span className="truncate">{t("organizations.selectedMembers", { count: selectedCount })}</span>
      </label>
      <div className="flex min-w-0 flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" disabled={bulkBusy || enableDisabled} onClick={onEnable}>
          <UserCheckIcon className="size-3.5" />
          {enableBusy ? t("organizations.enablingMembers") : t("organizations.enableSelectedMembers")}
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={bulkBusy || disableDisabled} onClick={onDisable}>
          <UserXIcon className="size-3.5" />
          {disableBusy ? t("organizations.disablingMembers") : t("organizations.disableSelectedMembers")}
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
      {member.disable ? t("organizations.memberDisabled") : t("organizations.memberEnabled")}
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
      failureMessage={t("organizations.memberCopyFailed")}
      tooltipLabel={`${ariaLabel}: ${value}`}
      value={value}
    />
  )
}

function MemberActionsMenu({
  compact = false,
  editProviderAccessDisabled = false,
  onEditProviderAccess,
  onRemove,
  onRevokeProviderAccess,
  removeDisabled = false,
  revokeProviderAccessDisabled = false,
}: {
  compact?: boolean
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
          className={compact ? "size-[1.375rem]" : undefined}
          disabled={disabled}
          aria-label={t("organizations.actions")}
        >
          <MoreHorizontalIcon className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} className="w-44">
        {onEditProviderAccess ? (
          <DropdownMenuItem disabled={editProviderAccessDisabled} onSelect={onEditProviderAccess}>
            <PencilIcon className="size-4" />
            {t("organizations.editProviderAccessAction")}
          </DropdownMenuItem>
        ) : null}
        {onRevokeProviderAccess ? (
          <DropdownMenuItem
            variant="destructive"
            disabled={revokeProviderAccessDisabled}
            onSelect={onRevokeProviderAccess}
          >
            <Trash2Icon className="size-4" />
            {t("organizations.revokeProviderAccess")}
          </DropdownMenuItem>
        ) : null}
        {hasProviderActions && onRemove ? <DropdownMenuSeparator /> : null}
        {onRemove ? (
          <DropdownMenuItem variant="destructive" disabled={removeDisabled} onSelect={onRemove}>
            <Trash2Icon className="size-4" />
            {t("organizations.removeMember")}
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ProviderAccessSummary({
  allProvidersLabel,
  compact = false,
  grant,
  loading,
  notAuthorizedLabel,
}: {
  allProvidersLabel: string
  compact?: boolean
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

  const visibleProviders = grant.providers.slice(0, compact ? 1 : 3)
  const hiddenProviderCount = grant.providers.length - visibleProviders.length
  return (
    <div
      className={cn("flex min-w-0 gap-2", compact ? "flex-wrap" : "flex-nowrap")}
      title={grant.providers.map((provider) => provider.label).join(", ")}
    >
      {visibleProviders.map((provider) => (
        <Badge key={provider.service} variant="secondary" className="max-w-full" title={provider.service}>
          <span className="truncate">{provider.label}</span>
        </Badge>
      ))}
      {hiddenProviderCount > 0 ? <Badge variant="secondary">+{hiddenProviderCount}</Badge> : null}
    </div>
  )
}

function ProviderAccessActions({
  busyAction,
  compact = false,
  disabled,
  grant,
  memberId,
  onEdit,
  onGrant,
  onRevoke,
}: {
  busyAction: BusyAction | null
  compact?: boolean
  disabled: boolean
  grant: ProviderGrantView | null
  memberId: string
  onEdit: (grant: ProviderGrantView) => void
  onGrant: (userId: string) => void
  onRevoke: (grant: ProviderGrantView) => void
}) {
  const { t } = useAppI18n()
  if (!grant) {
    return (
      <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => onGrant(memberId)}>
        {compact ? <ShieldCheckIcon className="size-4" /> : null}
        {t("organizations.grantProviderAccessAction")}
      </Button>
    )
  }

  const revokeBusy = busyAction === `revokeProviderAccess:${grant.userId}`
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled || revokeBusy}
        aria-label={compact ? t("organizations.editProviderAccessAction") : undefined}
        onClick={() => onEdit(grant)}
      >
        <PencilIcon className="size-4" />
        {compact ? null : t("organizations.editProviderAccessAction")}
      </Button>
      <ConfirmDialog>
        <ConfirmDialogTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled || revokeBusy}
            aria-label={compact ? t("organizations.revokeProviderAccess") : undefined}
          >
            <Trash2Icon className="size-4" />
            {compact ? null : t("organizations.revokeProviderAccess")}
          </Button>
        </ConfirmDialogTrigger>
        <ConfirmDialogContent>
          <ConfirmDialogHeader>
            <ConfirmDialogTitle>{t("organizations.revokeProviderAccessConfirmTitle")}</ConfirmDialogTitle>
            <ConfirmDialogDescription>
              {t("organizations.revokeProviderAccessConfirmDescription")}
            </ConfirmDialogDescription>
          </ConfirmDialogHeader>
          <ConfirmDialogFooter>
            <ConfirmDialogCancel>{t("common.cancel")}</ConfirmDialogCancel>
            <ConfirmDialogAction onClick={() => onRevoke(grant)}>
              {t("organizations.revokeProviderAccess")}
            </ConfirmDialogAction>
          </ConfirmDialogFooter>
        </ConfirmDialogContent>
      </ConfirmDialog>
    </>
  )
}

function UserAvatar({ avatar, fallback }: { avatar: string; fallback: string }) {
  return (
    <span className="relative flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-xs font-medium text-foreground">
      <span aria-hidden="true">{fallback}</span>
      <CachedAvatarImage src={avatar} alt="" className="absolute inset-0 size-full object-cover" />
    </span>
  )
}
