import type { Organization, OrganizationMember } from "../../../electron/organizations/common.ts"
import type { BusyAction, MemberView, ProviderGrantView } from "./organization-management-model.ts"

import { CrownIcon, PlusIcon, RefreshCwIcon, ShieldCheckIcon, UsersIcon } from "lucide-react"
import * as React from "react"
import { userFallback } from "./organization-management-model.ts"
import { MembersTable } from "./OrganizationMembersTable.tsx"
import { CachedAvatarImage } from "@/components/CachedAvatarImage"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
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
  onDisableMembers,
  onEditProviderAccess,
  onEnableMembers,
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
  onDisableMembers: (userIds: string[]) => void
  onEditProviderAccess: (grant: ProviderGrantView) => void
  onEnableMembers: (userIds: string[]) => void
  onGrantProviderAccess: (userId: string) => void
  onRemoveMember: (member: OrganizationMember) => void
  onRevokeProviderAccess: (grant: ProviderGrantView) => void
  organization: Organization | null
  providerAccessError: string | null
}) {
  const { t } = useAppI18n()
  const showProviderAccess = canManage

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
        title={showProviderAccess ? t("organizations.membersAndPermissions") : t("organizations.memberManagement")}
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
              onDisableMembers={onDisableMembers}
              onEditProviderAccess={onEditProviderAccess}
              onEnableMembers={onEnableMembers}
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
