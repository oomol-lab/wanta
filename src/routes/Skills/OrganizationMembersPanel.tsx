import type {
  Organization,
  OrganizationMember,
  OrganizationProviderOption,
} from "../../../electron/organizations/common.ts"
import type {
  BusyAction,
  MemberSearchState,
  MemberView,
  ProviderAccessForm,
  ProviderGrantView,
} from "./organization-management-model.ts"

import {
  CheckIcon,
  CrownIcon,
  LoaderCircleIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
  ShieldCheckIcon,
  Trash2Icon,
  UploadIcon,
  UsersIcon,
  XIcon,
} from "lucide-react"
import * as React from "react"
import {
  maxOrganizationNameLength,
  minimumMemberSearchLength,
  organizationNameValidation,
  userFallback,
} from "./organization-management-model.ts"
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
import { Dialog } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { organizationAvatarStyle, organizationInitials } from "@/hooks/useOrganizationWorkspace"
import { useAppI18n } from "@/i18n"
import { cn } from "@/lib/utils"

export function OrganizationMemberAccessButton({
  canManage,
  members,
  membersLoading,
  onOpen,
}: {
  canManage: boolean
  members: MemberView[]
  membersLoading: boolean
  onOpen: () => void
}) {
  const { t } = useAppI18n()
  const label = canManage ? t("organizations.manageMembers") : t("organizations.viewMembers")
  const countLabel = membersLoading
    ? t("organizations.memberCountLoading")
    : t("organizations.memberCountCompact", { count: members.length })

  return (
    <button
      type="button"
      className="group -ml-1 flex w-fit max-w-full min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-accent focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
      aria-label={`${label}，${countLabel}`}
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
        <span className="oo-text-caption-compact shrink-0 font-medium text-foreground">{label}</span>
        <span className="oo-text-caption-compact min-w-0 truncate text-muted-foreground">{countLabel}</span>
      </span>
    </button>
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
  if (compact) {
    return (
      <div className="divide-y">
        {members.map((member) => {
          const grant = grantsByUserId.get(member.user_id) ?? null
          const removeBusy = busyAction === `remove:${member.user_id}`
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
              </div>
              {canManage && member.role !== "creator" ? (
                <div className="grid min-w-0 gap-2 pl-10">
                  {showProviderAccess ? (
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
                  ) : null}
                  <div className="flex min-w-0 flex-wrap gap-2">
                    {showProviderAccess ? (
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
                    ) : null}
                    <ConfirmDialog>
                      <ConfirmDialogTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={removeBusy}
                          aria-label={t("organizations.removeMember")}
                        >
                          <Trash2Icon className="size-4" />
                        </Button>
                      </ConfirmDialogTrigger>
                      <ConfirmDialogContent>
                        <ConfirmDialogHeader>
                          <ConfirmDialogTitle>{t("organizations.removeMemberConfirmTitle")}</ConfirmDialogTitle>
                          <ConfirmDialogDescription>
                            {t("organizations.removeMemberConfirmDescription", { name: member.displayName })}
                          </ConfirmDialogDescription>
                        </ConfirmDialogHeader>
                        <ConfirmDialogFooter>
                          <ConfirmDialogCancel>{t("common.cancel")}</ConfirmDialogCancel>
                          <ConfirmDialogAction onClick={() => onRemoveMember(member)}>
                            {t("organizations.removeMember")}
                          </ConfirmDialogAction>
                        </ConfirmDialogFooter>
                      </ConfirmDialogContent>
                    </ConfirmDialog>
                  </div>
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
    )
  }

  const gridClassName = canManage
    ? showProviderAccess
      ? "grid-cols-[minmax(12rem,1fr)_7rem_minmax(12rem,1fr)_auto]"
      : "grid-cols-[minmax(12rem,1fr)_7rem_auto]"
    : "grid-cols-[minmax(12rem,1fr)_7rem]"

  const minWidthClassName = canManage && showProviderAccess ? "min-w-[44rem]" : "min-w-[32rem]"

  return (
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
            const removeBusy = busyAction === `remove:${member.user_id}`
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
                      <span className="oo-text-body text-muted-foreground">{t("organizations.creatorProtected")}</span>
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
                        <ConfirmDialog>
                          <ConfirmDialogTrigger asChild>
                            <Button type="button" variant="outline" size="sm" disabled={removeBusy}>
                              <Trash2Icon className="size-4" />
                              {t("organizations.removeMember")}
                            </Button>
                          </ConfirmDialogTrigger>
                          <ConfirmDialogContent>
                            <ConfirmDialogHeader>
                              <ConfirmDialogTitle>{t("organizations.removeMemberConfirmTitle")}</ConfirmDialogTitle>
                              <ConfirmDialogDescription>
                                {t("organizations.removeMemberConfirmDescription", { name: member.displayName })}
                              </ConfirmDialogDescription>
                            </ConfirmDialogHeader>
                            <ConfirmDialogFooter>
                              <ConfirmDialogCancel>{t("common.cancel")}</ConfirmDialogCancel>
                              <ConfirmDialogAction onClick={() => onRemoveMember(member)}>
                                {t("organizations.removeMember")}
                              </ConfirmDialogAction>
                            </ConfirmDialogFooter>
                          </ConfirmDialogContent>
                        </ConfirmDialog>
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

export function CreateOrganizationDialog({
  avatarFile,
  busy,
  name,
  nameError,
  onAvatarFileChange,
  onClose,
  onNameChange,
  onSubmit,
  open,
}: {
  avatarFile: File | null
  busy: boolean
  name: string
  nameError: string | null
  onAvatarFileChange: (file: File | null) => void
  onClose: () => void
  onNameChange: (value: string) => void
  onSubmit: (event: React.FormEvent) => void
  open: boolean
}) {
  const { t } = useAppI18n()
  const disabled = organizationNameValidation(name.trim()) !== "valid" || Boolean(nameError) || busy
  const avatarPreviewUrl = useObjectUrl(avatarFile)

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("organizations.createOrganization")}
      description={t("organizations.createOrganizationDescription")}
      footer={
        <>
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form="create-organization-form" disabled={disabled}>
            {busy ? t("organizations.creatingOrganization") : t("organizations.create")}
          </Button>
        </>
      }
    >
      <form id="create-organization-form" className="grid gap-4" onSubmit={onSubmit}>
        <OrganizationAvatarField
          file={avatarFile}
          name={name}
          previewUrl={avatarPreviewUrl}
          seed={name}
          title={t("organizations.organizationAvatar")}
          onFileChange={onAvatarFileChange}
        />
        <div className="grid gap-2">
          <Label htmlFor="organization-name">{t("organizations.organizationName")}</Label>
          <Input
            id="organization-name"
            value={name}
            maxLength={maxOrganizationNameLength}
            aria-invalid={Boolean(nameError)}
            autoFocus
            onChange={(event) => onNameChange(event.currentTarget.value)}
          />
          {nameError ? (
            <p className="oo-text-caption-compact text-destructive">{nameError}</p>
          ) : (
            <p className="oo-text-caption-compact text-muted-foreground">
              {t("organizations.organizationNameDescription")}
            </p>
          )}
        </div>
      </form>
    </Dialog>
  )
}

export function EditOrganizationDialog({
  avatar,
  avatarFile,
  avatarUploading,
  busy,
  name,
  nameError,
  onAvatarChange,
  onAvatarFileChange,
  onClose,
  onNameChange,
  onSubmit,
  open,
  organization,
}: {
  avatar: string
  avatarFile: File | null
  avatarUploading: boolean
  busy: boolean
  name: string
  nameError: string | null
  onAvatarChange: (value: string) => void
  onAvatarFileChange: (file: File | null) => void
  onClose: () => void
  onNameChange: (value: string) => void
  onSubmit: (event: React.FormEvent) => void
  open: boolean
  organization: Organization | null
}) {
  const { t } = useAppI18n()
  const disabled = organizationNameValidation(name.trim()) !== "valid" || Boolean(nameError) || busy || avatarUploading
  const avatarPreviewUrl = useObjectUrl(avatarFile)

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("organizations.editOrganization")}
      description={t("organizations.editOrganizationDescription")}
      footer={
        <>
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form="edit-organization-form" disabled={disabled}>
            {busy ? <LoaderCircleIcon className="size-3.5 animate-spin" /> : null}
            {busy ? t("organizations.savingOrganization") : t("common.save")}
          </Button>
        </>
      }
    >
      <form id="edit-organization-form" className="grid gap-4" onSubmit={onSubmit}>
        <OrganizationAvatarField
          avatar={avatar}
          file={avatarFile}
          name={name || organization?.name || ""}
          previewUrl={avatarPreviewUrl}
          seed={organization?.id || organization?.name || name}
          title={t("organizations.organizationAvatar")}
          uploading={avatarUploading}
          onAvatarClear={() => {
            onAvatarChange("")
            onAvatarFileChange(null)
          }}
          onFileChange={onAvatarFileChange}
        />
        <div className="grid gap-2">
          <Label htmlFor="edit-organization-name">{t("organizations.organizationName")}</Label>
          <Input
            id="edit-organization-name"
            value={name}
            maxLength={maxOrganizationNameLength}
            aria-invalid={Boolean(nameError)}
            autoFocus
            onChange={(event) => onNameChange(event.currentTarget.value)}
          />
          {nameError ? (
            <p className="oo-text-caption-compact text-destructive">{nameError}</p>
          ) : (
            <p className="oo-text-caption-compact text-muted-foreground">
              {t("organizations.organizationNameDescription")}
            </p>
          )}
        </div>
      </form>
    </Dialog>
  )
}

function useObjectUrl(file: File | null): string {
  const [url, setUrl] = React.useState("")

  React.useEffect(() => {
    if (!file) {
      setUrl("")
      return
    }
    const objectUrl = URL.createObjectURL(file)
    setUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [file])

  return url
}

function OrganizationAvatarField({
  avatar = "",
  file,
  name,
  onAvatarClear,
  onFileChange,
  previewUrl,
  seed,
  title,
  uploading = false,
}: {
  avatar?: string
  file: File | null
  name: string
  onAvatarClear?: () => void
  onFileChange: (file: File | null) => void
  previewUrl: string
  seed: string
  title: string
  uploading?: boolean
}) {
  const { t } = useAppI18n()
  const inputId = React.useId()
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const remoteAvatar = previewUrl ? "" : avatar.trim()
  const [loadedRemoteAvatar, setLoadedRemoteAvatar] = React.useState<string | null>(null)
  const imageVisible = Boolean(previewUrl || (remoteAvatar && loadedRemoteAvatar === remoteAvatar))
  const canClear = Boolean(file || avatar)
  const fallbackStyle = imageVisible ? undefined : organizationAvatarStyle(seed || name || "organization")

  return (
    <div className="grid gap-2">
      <Label htmlFor={inputId}>{title}</Label>
      <div className="flex min-w-0 items-center gap-3">
        <span
          className={cn(
            "relative flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-md text-lg font-medium",
            imageVisible ? "bg-transparent text-transparent" : "border border-[var(--oo-frame-border)] text-foreground",
          )}
          style={fallbackStyle}
        >
          {imageVisible ? null : <span aria-hidden="true">{organizationInitials(name || "Organization")}</span>}
          {previewUrl ? <img src={previewUrl} alt="" className="absolute inset-0 size-full object-contain" /> : null}
          {remoteAvatar ? (
            <CachedAvatarImage
              src={remoteAvatar}
              alt=""
              className="absolute inset-0 size-full object-contain"
              onLoad={() => setLoadedRemoteAvatar(remoteAvatar)}
              onError={() => setLoadedRemoteAvatar((current) => (current === remoteAvatar ? null : current))}
            />
          ) : null}
        </span>
        <div className="grid min-w-0 flex-1 gap-2">
          <div className="flex min-w-0 flex-wrap gap-2">
            <input
              ref={fileInputRef}
              id={inputId}
              type="file"
              accept="image/*"
              className="sr-only"
              disabled={uploading}
              onChange={(event) => {
                onFileChange(event.currentTarget.files?.[0] ?? null)
                event.currentTarget.value = ""
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={uploading}
              onClick={() => {
                if (fileInputRef.current) {
                  fileInputRef.current.value = ""
                  fileInputRef.current.click()
                }
              }}
            >
              {uploading ? <LoaderCircleIcon className="size-3.5 animate-spin" /> : <UploadIcon className="size-3.5" />}
              {uploading
                ? t("organizations.uploadingOrganizationAvatar")
                : file || avatar
                  ? t("organizations.changeOrganizationAvatar")
                  : t("organizations.uploadOrganizationAvatar")}
            </Button>
            {canClear ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={uploading}
                onClick={() => {
                  onFileChange(null)
                  onAvatarClear?.()
                  if (fileInputRef.current) {
                    fileInputRef.current.value = ""
                  }
                }}
              >
                <XIcon className="size-3.5" />
                {t("organizations.removeOrganizationAvatar")}
              </Button>
            ) : null}
          </div>
          <p className="oo-text-caption-compact truncate text-muted-foreground">
            {file ? file.name : t("organizations.organizationAvatarUploadHint")}
          </p>
        </div>
      </div>
    </div>
  )
}

export function AddMemberDialog({
  busy,
  input,
  onClose,
  onInputChange,
  onSearchSelect,
  onSubmit,
  open,
  search,
}: {
  busy: boolean
  input: string
  onClose: () => void
  onInputChange: (value: string) => void
  onSearchSelect: (user: MemberSearchState["items"][number]) => void
  onSubmit: (event: React.FormEvent) => void
  open: boolean
  search: MemberSearchState
}) {
  const { t } = useAppI18n()
  const canSubmit = input.trim().length > 0 && !busy

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("organizations.addMember")}
      description={t("organizations.addMemberDescription")}
      footer={
        <>
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form="add-organization-member-form" disabled={!canSubmit}>
            <PlusIcon className="size-4" />
            {busy ? t("organizations.addingMember") : t("organizations.addMember")}
          </Button>
        </>
      }
    >
      <form id="add-organization-member-form" className="grid gap-4" autoComplete="off" onSubmit={onSubmit}>
        <div className="grid gap-2">
          <Label htmlFor="organization-member-search">{t("organizations.memberIdentifier")}</Label>
          <InputGroup>
            <InputGroupAddon align="inline-start">
              <SearchIcon />
            </InputGroupAddon>
            <InputGroupInput
              id="organization-member-search"
              type="search"
              value={input}
              autoCapitalize="none"
              autoComplete="off"
              autoCorrect="off"
              data-1p-ignore="true"
              data-form-type="other"
              data-lpignore="true"
              disabled={busy}
              placeholder={t("organizations.userSearchPlaceholder")}
              spellCheck={false}
              onChange={(event) => onInputChange(event.currentTarget.value)}
            />
          </InputGroup>
          <MemberSearchResults search={search} onSelect={onSearchSelect} />
        </div>
      </form>
    </Dialog>
  )
}

function MemberSearchResults({
  onSelect,
  search,
}: {
  onSelect: (user: MemberSearchState["items"][number]) => void
  search: MemberSearchState
}) {
  const { t } = useAppI18n()
  const showInitial = search.query.length < minimumMemberSearchLength
  const showEmpty =
    search.query.length >= minimumMemberSearchLength && !search.loading && !search.error && search.items.length === 0

  return (
    <div className="min-h-28 overflow-hidden rounded-md border">
      {search.items.length > 0 ? (
        <div className="max-h-64 overflow-y-auto p-1">
          {search.items.map((user) => (
            <button
              type="button"
              key={user.userId}
              className="flex w-full min-w-0 items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-accent hover:text-accent-foreground"
              onClick={() => onSelect(user)}
            >
              <UserAvatar avatar={user.avatar} fallback={user.fallback} />
              <span className="min-w-0">
                <span className="oo-text-label block truncate">{user.displayName}</span>
                <span className="oo-text-caption-compact block truncate font-mono text-muted-foreground">
                  {user.username}
                </span>
              </span>
            </button>
          ))}
        </div>
      ) : null}
      {search.loading ? <DialogHint>{t("organizations.loading")}</DialogHint> : null}
      {showInitial ? <DialogHint>{t("organizations.searchUsersInitial")}</DialogHint> : null}
      {showEmpty ? <DialogHint>{t("organizations.noUsersFoundCanAddId")}</DialogHint> : null}
      {search.error ? <DialogHint danger>{search.error}</DialogHint> : null}
    </div>
  )
}

export function ProviderAccessDialog({
  busy,
  form,
  memberOptions,
  onClose,
  onFormChange,
  onSubmit,
  providerOptions,
}: {
  busy: boolean
  form: ProviderAccessForm
  memberOptions: MemberView[]
  onClose: () => void
  onFormChange: React.Dispatch<React.SetStateAction<ProviderAccessForm>>
  onSubmit: (event: React.FormEvent) => void
  providerOptions: OrganizationProviderOption[]
}) {
  const { t } = useAppI18n()

  return (
    <Dialog
      open={form.open}
      onClose={onClose}
      title={form.mode === "create" ? t("organizations.grantProviderAccess") : t("organizations.editProviderAccess")}
      description={t("organizations.providerAccessDescription")}
      footer={
        <>
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form="provider-access-form" disabled={busy}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      <form id="provider-access-form" className="grid gap-4" onSubmit={onSubmit}>
        <div className="grid gap-2">
          <Label htmlFor="provider-access-member">{t("organizations.member")}</Label>
          {form.mode === "create" && !form.userId ? (
            <Select
              value={form.userId}
              onValueChange={(value) => onFormChange((current) => ({ ...current, userId: value ?? "" }))}
            >
              <SelectTrigger id="provider-access-member" className="w-full">
                <SelectValue placeholder={t("organizations.memberRequired")} />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {memberOptions.map((member) => (
                    <SelectItem key={member.user_id} value={member.user_id}>
                      {member.displayName}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          ) : (
            <MemberDisplay userId={form.userId} members={memberOptions} />
          )}
        </div>
        <div className="grid gap-2">
          <Label>{t("organizations.connectionScope")}</Label>
          <ProviderSelect
            allProviders={form.allProviders}
            allProvidersLabel={t("organizations.allProviders")}
            emptyLabel={t("organizations.emptyProviders")}
            options={providerOptions}
            selectLabel={t("organizations.selectProviders")}
            selectedProviders={form.providers}
            onAllProvidersChange={(allProviders) =>
              onFormChange((current) => ({
                ...current,
                allProviders,
                providers: allProviders ? [] : current.providers,
              }))
            }
            onToggleProvider={(service) =>
              onFormChange((current) => ({
                ...current,
                allProviders: false,
                providers: current.providers.includes(service)
                  ? current.providers.filter((item) => item !== service)
                  : [...current.providers, service].sort(),
              }))
            }
          />
        </div>
      </form>
    </Dialog>
  )
}

function ProviderSelect({
  allProviders,
  allProvidersLabel,
  emptyLabel,
  onAllProvidersChange,
  onToggleProvider,
  options,
  selectLabel,
  selectedProviders,
}: {
  allProviders: boolean
  allProvidersLabel: string
  emptyLabel: string
  onAllProvidersChange: (value: boolean) => void
  onToggleProvider: (service: string) => void
  options: OrganizationProviderOption[]
  selectLabel: string
  selectedProviders: string[]
}) {
  const [open, setOpen] = React.useState(false)
  const labelsByService = React.useMemo(
    () => new Map(options.map((option) => [option.service, option.label])),
    [options],
  )
  const label = allProviders
    ? allProvidersLabel
    : selectedProviders.map((service) => labelsByService.get(service) ?? service).join(", ")

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className="w-full justify-between">
          <span className="min-w-0 truncate text-left">{label || selectLabel}</span>
          {allProviders ? null : <span className="shrink-0 text-muted-foreground">{selectedProviders.length}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-[min(26rem,calc(100vw-2rem))] p-1">
        <button
          type="button"
          className="oo-text-body flex w-full min-w-0 items-center justify-between gap-2 rounded-md px-2 py-2 text-left hover:bg-accent hover:text-accent-foreground"
          onClick={() => {
            onAllProvidersChange(true)
            setOpen(false)
          }}
        >
          <span className="truncate">{allProvidersLabel}</span>
          {allProviders ? <CheckIcon className="size-4" /> : null}
        </button>
        <div className="my-1 h-px bg-border" />
        {options.length === 0 ? (
          <div className="oo-text-body px-2 py-6 text-center text-muted-foreground">{emptyLabel}</div>
        ) : (
          <div className="max-h-64 overflow-y-auto">
            {options.map((provider) => {
              const selected = !allProviders && selectedProviders.includes(provider.service)
              return (
                <button
                  type="button"
                  key={provider.service}
                  className="flex w-full min-w-0 items-center justify-between gap-2 rounded-md px-2 py-2 text-left hover:bg-accent hover:text-accent-foreground"
                  onClick={() => {
                    onToggleProvider(provider.service)
                    setOpen(false)
                  }}
                >
                  <span className="min-w-0">
                    <span className="oo-text-body block truncate">{provider.label}</span>
                    <span className="oo-text-caption-compact block truncate font-mono text-muted-foreground">
                      {provider.service}
                    </span>
                  </span>
                  {selected ? <CheckIcon className="size-4 shrink-0" /> : null}
                </button>
              )
            })}
          </div>
        )}
      </PopoverContent>
    </Popover>
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

function MemberDisplay({ members, userId }: { members: MemberView[]; userId: string }) {
  const member = members.find((item) => item.user_id === userId)
  const label = member?.displayName ?? userId
  const secondary = member?.secondaryLabel ?? userId
  return (
    <div className="flex min-h-9 min-w-0 items-center gap-3 rounded-md border bg-muted/40 px-3 py-2">
      <UserAvatar avatar={member?.avatar ?? ""} fallback={member?.fallback ?? userFallback(label)} />
      <span className="min-w-0">
        <span className="oo-text-label block truncate">{label}</span>
        <span className="oo-text-caption-compact block truncate font-mono text-muted-foreground">{secondary}</span>
      </span>
    </div>
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

function DialogHint({ children, danger = false }: { children: React.ReactNode; danger?: boolean }) {
  return (
    <div className={cn("oo-text-body px-2 py-6 text-center text-muted-foreground", danger && "text-destructive")}>
      {children}
    </div>
  )
}
