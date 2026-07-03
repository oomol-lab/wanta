import type { Organization, OrganizationMember } from "../../../electron/organizations/common.ts"
import type { BusyAction, MemberView, ProviderGrantView } from "./organization-management-model.ts"

import {
  CrownIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
  Trash2Icon,
  UsersIcon,
} from "lucide-react"
import * as React from "react"
import { userFallback } from "./organization-management-model.ts"
import { CachedAvatarImage } from "@/components/CachedAvatarImage"
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { organizationAvatarStyle, organizationInitials } from "@/hooks/useOrganizationWorkspace"
import { useAppI18n } from "@/i18n"
import { cn } from "@/lib/utils"

export {
  AddMemberDialog,
  CreateOrganizationDialog,
  EditOrganizationDialog,
  ProviderAccessDialog,
} from "./OrganizationMemberDialogs.tsx"

export function OrganizationMemberAccessButton({
  canManage,
  members,
  membersLoading,
  onAddMember,
  onOpen,
}: {
  canManage: boolean
  members: MemberView[]
  membersLoading: boolean
  onAddMember?: () => void
  onOpen: () => void
}) {
  const { t } = useAppI18n()
  const label = canManage ? t("organizations.manageMembers") : t("organizations.viewMembers")
  const countLabel = membersLoading
    ? t("organizations.memberCountLoading")
    : t("organizations.memberCountCompact", { count: members.length })
  const onlyCreatorVisible =
    canManage && !membersLoading && members.length <= 1 && members.every((member) => member.role === "creator")
  const summaryLabel = onlyCreatorVisible ? t("organizations.noOtherMembers") : label

  return (
    <div className="-ml-1 flex min-w-0 flex-wrap items-center gap-2">
      <button
        type="button"
        className="group flex w-fit max-w-full min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-accent focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        aria-label={t("organizations.memberAccessAriaLabel", { count: countLabel, label })}
        onClick={onOpen}
      >
        {membersLoading ? (
          <MemberAvatarStackSkeleton />
        ) : members.length > 0 ? (
          <MemberAvatarStack members={members} />
        ) : (
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <UsersIcon className="size-3.5" />
          </span>
        )}
        <span className="flex min-w-0 items-center gap-1.5">
          {canManage ? (
            <CrownIcon className="size-3.5 shrink-0 text-[var(--oo-warning-foreground)]" aria-hidden="true" />
          ) : null}
          <span className="oo-text-caption-compact shrink-0 font-medium text-foreground">{summaryLabel}</span>
          {onlyCreatorVisible ? null : (
            <span className="oo-text-caption-compact min-w-0 truncate text-muted-foreground">{countLabel}</span>
          )}
        </span>
      </button>
      {canManage && onAddMember ? (
        <Button type="button" variant="outline" size="sm" className="h-7 px-2" onClick={onAddMember}>
          <PlusIcon className="size-3.5" />
          {t("organizations.addMember")}
        </Button>
      ) : null}
    </div>
  )
}
function MemberAvatarStack({ members }: { members: MemberView[] }) {
  const visibleMemberCount = members.length > 5 ? 4 : 5
  const visibleMembers = members.slice(0, visibleMemberCount)
  const hiddenMemberCount = members.length - visibleMembers.length

  return (
    <span className="flex shrink-0 items-center -space-x-2" aria-hidden="true">
      {visibleMembers.map((member) => (
        <span
          key={member.user_id}
          className="relative flex size-6 items-center justify-center overflow-hidden rounded-full border-2 border-background bg-muted text-[10px] font-medium text-foreground"
          title={member.displayName}
        >
          <span>{member.fallback}</span>
          <CachedAvatarImage src={member.avatar} alt="" className="absolute inset-0 size-full object-cover" />
        </span>
      ))}
      {hiddenMemberCount > 0 ? (
        <span className="flex size-6 items-center justify-center rounded-full border-2 border-background bg-muted text-[10px] font-medium text-muted-foreground">
          +{hiddenMemberCount}
        </span>
      ) : null}
    </span>
  )
}

function MemberAvatarStackSkeleton() {
  return (
    <span className="flex shrink-0 items-center -space-x-2" aria-hidden="true">
      <Skeleton className="size-6 rounded-full border-2 border-background" />
      <Skeleton className="size-6 rounded-full border-2 border-background" />
      <Skeleton className="size-6 rounded-full border-2 border-background" />
    </span>
  )
}

export function OrganizationDetailPanel({
  appAccessLoading,
  busyAction,
  canManage,
  compact = false,
  grantsByUserId,
  members,
  membersError,
  membersLoading,
  onAddMember,
  onEditProviderAccess,
  onGrantProviderAccess,
  onRemoveMember,
  onRevokeProviderAccess,
  organization,
  providerAccessError,
}: {
  appAccessLoading: boolean
  busyAction: BusyAction | null
  canManage: boolean
  compact?: boolean
  grantsByUserId: Map<string, ProviderGrantView>
  members: MemberView[]
  membersError: string | null
  membersLoading: boolean
  onAddMember: () => void
  onEditProviderAccess: (grant: ProviderGrantView) => void
  onGrantProviderAccess: (userId: string) => void
  onRemoveMember: (member: OrganizationMember) => void
  onRevokeProviderAccess: (grant: ProviderGrantView) => void
  organization: Organization | null
  providerAccessError: string | null
}) {
  const { t } = useAppI18n()
  const showProviderAccess = false

  if (!organization) {
    return (
      <Panel title={t("organizations.memberManagement")}>
        <EmptyBlock>{t("organizations.teamNoSelectionDescription")}</EmptyBlock>
      </Panel>
    )
  }

  const memberCountLabel = membersLoading ? "..." : String(members.length)
  const compactMemberCountLabel = membersLoading
    ? t("organizations.memberCountLoading")
    : t("organizations.memberCountCompact", { count: members.length })
  const permissionModeLabel = canManage ? t("organizations.canManage") : t("organizations.readOnly")

  return (
    <div className="grid min-w-0 gap-3">
      <Panel
        title={t("organizations.memberManagement")}
        description={
          compact ? (
            <span className="oo-text-caption-compact truncate text-muted-foreground">
              {compactMemberCountLabel} · {permissionModeLabel}
            </span>
          ) : (
            <div className="grid min-w-0 gap-1">
              <span className="min-w-0 truncate">
                {showProviderAccess
                  ? t("organizations.membersAndPermissionsDescription")
                  : t("organizations.memberManagementDescription")}
              </span>
              <span className="oo-text-caption-compact flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
                <span className="flex min-w-0 items-center gap-1.5">
                  <UsersIcon className="size-3.5 shrink-0" />
                  <span className="truncate">
                    {t("organizations.memberCount")}: {memberCountLabel}
                  </span>
                </span>
                <span className="flex min-w-0 items-center gap-1.5">
                  <ShieldCheckIcon className="size-3.5 shrink-0" />
                  <span className="truncate">
                    {t("organizations.permissionMode")}: {permissionModeLabel}
                  </span>
                </span>
              </span>
            </div>
          )
        }
        action={
          canManage ? (
            <Button type="button" size="sm" disabled={busyAction === "add"} onClick={onAddMember}>
              <PlusIcon className="size-3.5" />
              {t("organizations.addMember")}
            </Button>
          ) : null
        }
      >
        <>
          {showProviderAccess && providerAccessError && !membersError ? (
            <ProviderAccessWarning error={providerAccessError} />
          ) : null}
          {membersLoading ? (
            <MemberRowsSkeleton canManage={canManage && showProviderAccess} />
          ) : membersError ? (
            <EmptyBlock>
              {membersError.includes("HTTP 403") ? t("organizations.membersForbidden") : membersError}
            </EmptyBlock>
          ) : members.length === 0 ? (
            <EmptyBlock>{t("organizations.emptyMembersDescription")}</EmptyBlock>
          ) : (
            <MembersTable
              appAccessLoading={appAccessLoading}
              busyAction={busyAction}
              canManage={canManage}
              compact={compact}
              grantsByUserId={grantsByUserId}
              members={members}
              showProviderAccess={showProviderAccess}
              providerAccessError={providerAccessError}
              onEditProviderAccess={onEditProviderAccess}
              onGrantProviderAccess={onGrantProviderAccess}
              onRemoveMember={onRemoveMember}
              onRevokeProviderAccess={onRevokeProviderAccess}
            />
          )}
        </>
      </Panel>
    </div>
  )
}

function ProviderAccessWarning({ error }: { error: string }) {
  const { t } = useAppI18n()
  return (
    <div className="mx-3 mt-3 rounded-md border border-[var(--oo-warning-border)] bg-[var(--oo-warning-surface)] px-3 py-2">
      <div className="oo-text-label text-foreground">{t("organizations.providerAccessLoadFailed")}</div>
      <div className="oo-text-caption mt-0.5 break-words" title={error}>
        {t("organizations.providerAccessLoadFailedDescription")}
      </div>
    </div>
  )
}

function MembersTable({
  appAccessLoading,
  busyAction,
  canManage,
  compact = false,
  grantsByUserId,
  members,
  onEditProviderAccess,
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
  onEditProviderAccess: (grant: ProviderGrantView) => void
  onGrantProviderAccess: (userId: string) => void
  onRemoveMember: (member: OrganizationMember) => void
  onRevokeProviderAccess: (grant: ProviderGrantView) => void
  providerAccessError: string | null
  showProviderAccess: boolean
}) {
  const { t } = useAppI18n()
  const [removeTarget, setRemoveTarget] = React.useState<MemberView | null>(null)
  const removeTargetBusy = removeTarget ? busyAction === `remove:${removeTarget.user_id}` : false
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

  if (compact) {
    return (
      <>
        <div className="divide-y">
          {members.map((member) => {
            const grant = grantsByUserId.get(member.user_id) ?? null
            const canRemove = canManage && member.role !== "creator"
            return (
              <div key={member.user_id} className="grid min-w-0 gap-2 px-3 py-3">
                <div className="flex min-w-0 items-start gap-2.5">
                  <UserAvatar avatar={member.avatar} fallback={member.fallback} />
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <div className="oo-text-label min-w-0 truncate">{member.displayName}</div>
                      <Badge variant="secondary" className="shrink-0">
                        {member.role === "creator" ? t("organizations.roleCreator") : t("organizations.roleMember")}
                      </Badge>
                    </div>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="oo-text-caption-compact mt-0.5 truncate font-mono text-muted-foreground">
                          {member.secondaryLabel}
                        </div>
                      </TooltipTrigger>
                      <TooltipContent className="font-mono break-all">{member.user_id}</TooltipContent>
                    </Tooltip>
                  </div>
                  {canRemove ? (
                    <MemberActionsMenu
                      disabled={busyAction === `remove:${member.user_id}`}
                      onRemove={() => setRemoveTarget(member)}
                    />
                  ) : null}
                </div>
                {canRemove && showProviderAccess ? (
                  <div className="grid min-w-0 gap-2 pl-10">
                    <div className="min-w-0">
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
                    </div>
                    <div className="flex min-w-0 flex-wrap gap-2">
                      <ProviderAccessActions
                        compact
                        busyAction={busyAction}
                        disabled={appAccessLoading || Boolean(providerAccessError)}
                        grant={grant}
                        memberId={member.user_id}
                        onEdit={onEditProviderAccess}
                        onGrant={onGrantProviderAccess}
                        onRevoke={onRevokeProviderAccess}
                      />
                    </div>
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
        {removeConfirmDialog}
      </>
    )
  }

  const gridClassName = canManage
    ? showProviderAccess
      ? "grid-cols-[minmax(12rem,1fr)_7rem_minmax(12rem,1fr)_auto]"
      : "grid-cols-[minmax(12rem,1fr)_7rem_auto]"
    : "grid-cols-[minmax(12rem,1fr)_7rem]"

  const minWidthClassName = canManage && showProviderAccess ? "min-w-[44rem]" : "min-w-[32rem]"

  return (
    <>
      <div className="min-w-0 overflow-x-auto">
        <div className={minWidthClassName}>
          <div
            className={cn(
              "oo-text-caption-compact grid gap-3 border-b bg-muted/30 px-3 py-2 font-medium text-muted-foreground",
              gridClassName,
            )}
          >
            <div>{t("organizations.member")}</div>
            <div>{t("organizations.role")}</div>
            {canManage && showProviderAccess ? <div>{t("organizations.usableConnections")}</div> : null}
            {canManage ? <div className="text-right">{t("organizations.actions")}</div> : null}
          </div>
          <div className="divide-y">
            {members.map((member) => {
              const grant = grantsByUserId.get(member.user_id) ?? null
              const canRemove = canManage && member.role !== "creator"
              return (
                <div key={member.user_id} className={cn("grid items-center gap-3 px-3 py-3", gridClassName)}>
                  <div className="flex min-w-0 items-center gap-3">
                    <UserAvatar avatar={member.avatar} fallback={member.fallback} />
                    <div className="min-w-0">
                      <div className="oo-text-label truncate">{member.displayName}</div>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="oo-text-caption-compact mt-0.5 truncate font-mono text-muted-foreground">
                            {member.secondaryLabel}
                          </div>
                        </TooltipTrigger>
                        <TooltipContent className="font-mono break-all">{member.user_id}</TooltipContent>
                      </Tooltip>
                    </div>
                  </div>
                  <div>
                    <Badge variant="secondary">
                      {member.role === "creator" ? t("organizations.roleCreator") : t("organizations.roleMember")}
                    </Badge>
                  </div>
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
                              disabled={appAccessLoading || Boolean(providerAccessError)}
                              grant={grant}
                              memberId={member.user_id}
                              onEdit={onEditProviderAccess}
                              onGrant={onGrantProviderAccess}
                              onRevoke={onRevokeProviderAccess}
                            />
                          ) : null}
                          <MemberActionsMenu
                            disabled={!canRemove || busyAction === `remove:${member.user_id}`}
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

function MemberActionsMenu({ disabled, onRemove }: { disabled: boolean; onRemove: () => void }) {
  const { t } = useAppI18n()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="icon" disabled={disabled} aria-label={t("organizations.actions")}>
          <MoreHorizontalIcon className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} className="w-36">
        <DropdownMenuItem variant="destructive" onSelect={onRemove}>
          <Trash2Icon className="size-4" />
          {t("organizations.removeMember")}
        </DropdownMenuItem>
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
    return <span className="oo-text-body text-muted-foreground">{notAuthorizedLabel}</span>
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

export function Panel({
  action,
  children,
  description,
  title,
}: {
  action?: React.ReactNode
  children: React.ReactNode
  description?: React.ReactNode
  title: React.ReactNode
}) {
  return (
    <section className="min-w-0 overflow-hidden rounded-md border border-[var(--oo-divider)] bg-background">
      <div className="flex min-h-14 items-center justify-between gap-3 border-b border-[var(--oo-divider)] px-3 py-2">
        <div className="min-w-0">
          <h2 className="oo-text-title truncate text-foreground">{title}</h2>
          {description ? <div className="oo-text-caption mt-0.5 min-w-0">{description}</div> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children}
    </section>
  )
}

export function OrganizationAvatar({
  className,
  onRemoteAvatarLoad,
  organization,
  previewUrl,
}: {
  className?: string
  onRemoteAvatarLoad?: (organizationId: string, file: File | null) => void
  organization: Organization
  previewUrl?: string
}) {
  const avatar = organization.avatar.trim()
  const [loadedAvatar, setLoadedAvatar] = React.useState<string | null>(null)
  const avatarLoaded = Boolean(avatar && loadedAvatar === avatar)
  const showPreview = Boolean(previewUrl && !avatarLoaded)
  const showImage = showPreview || avatarLoaded

  return (
    <span
      className={cn(
        "relative flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-md text-xs font-medium",
        showImage ? "bg-transparent text-transparent" : "border border-[var(--oo-frame-border)] text-foreground",
        className,
      )}
      style={showImage ? undefined : organizationAvatarStyle(organization.id || organization.name)}
    >
      {showImage ? null : <span aria-hidden="true">{organizationInitials(organization.name)}</span>}
      {showPreview ? <img src={previewUrl} alt="" className="absolute inset-0 size-full object-contain" /> : null}
      {avatar ? (
        <CachedAvatarImage
          src={avatar}
          alt=""
          className="absolute inset-0 size-full object-contain"
          onLoad={() => {
            setLoadedAvatar(avatar)
            onRemoteAvatarLoad?.(organization.id, null)
          }}
          onError={() => setLoadedAvatar((current) => (current === avatar ? null : current))}
        />
      ) : null}
    </span>
  )
}

export function AccountWorkspaceAvatar({
  avatarUrl,
  className,
  name,
}: {
  avatarUrl?: string
  className?: string
  name?: string
}) {
  const label = name?.trim() || "User"

  return (
    <span
      className={cn(
        "relative flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[var(--oo-frame-border)] bg-background text-xs font-medium text-foreground",
        className,
      )}
    >
      <span aria-hidden="true">{userFallback(label)}</span>
      <CachedAvatarImage src={avatarUrl} alt="" className="absolute inset-0 size-full object-cover" />
    </span>
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

function MemberRowsSkeleton({ canManage }: { canManage: boolean }) {
  return (
    <div className="divide-y">
      {Array.from({ length: 4 }, (_, index) => (
        <div
          key={index}
          className={cn(
            "grid items-center gap-3 px-3 py-3",
            canManage ? "md:grid-cols-[1fr_7rem_1fr_18rem]" : "md:grid-cols-[1fr_7rem]",
          )}
        >
          <div className="flex items-center gap-3">
            <Skeleton className="size-8 rounded-full" />
            <div className="grid flex-1 gap-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-44" />
            </div>
          </div>
          <Skeleton className="h-6 w-20 rounded-md" />
          {canManage ? (
            <>
              <Skeleton className="h-6 w-32 rounded-md" />
              <Skeleton className="h-8 w-full rounded-md" />
            </>
          ) : null}
        </div>
      ))}
    </div>
  )
}

function EmptyBlock({ children }: { children: React.ReactNode }) {
  return (
    <div className="oo-text-body flex min-h-32 items-center justify-center px-4 py-8 text-center text-muted-foreground">
      {children}
    </div>
  )
}

export function ErrorBlock({ error, onRetry }: { error: string; onRetry: () => void }) {
  const { t } = useAppI18n()
  return (
    <div className="flex min-h-32 flex-col items-start justify-center gap-3 px-4 py-5">
      <div className="oo-text-body text-muted-foreground">{error || t("organizations.loadFailed")}</div>
      <Button type="button" variant="outline" size="sm" onClick={onRetry}>
        <RefreshCwIcon className="size-4" />
        {t("organizations.retry")}
      </Button>
    </div>
  )
}
