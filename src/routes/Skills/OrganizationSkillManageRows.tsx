import type { ManagedSkillGroup, PublicSkillPackage } from "../../../electron/skills/common.ts"
import type { BusyAction } from "./organization-management-model.ts"
import type { UseOrganizationSkills } from "@/hooks/useOrganizationSkills"
import type { ProviderSkillRecommendation } from "@/routes/Skills/provider-skill-recommendations"
import type { RuntimeSkillRemoveTarget } from "@/routes/Skills/skill-route-model"

import { Link2OffIcon, MoreHorizontalIcon, PackageIcon, RefreshCwIcon } from "lucide-react"
import {
  canInstallProviderRecommendationRuntime,
  canOpenManagedProviderRecommendation,
  organizationRuntimeStatusLabel,
  organizationRuntimeStatusTone,
  providerRecommendationSkillDescription,
  shouldOpenOrganizationSkillManagement,
} from "./organization-skill-manage-helpers.ts"
import { SkillListRow } from "./SkillListRow.tsx"
import { normalizeSkillIconSource } from "@/components/skill-icon-source"
import { SkillIcon } from "@/components/SkillIcon"
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
import { Skeleton } from "@/components/ui/skeleton"
import { useAppI18n } from "@/i18n"
import { cn } from "@/lib/utils"
import {
  canInstallPublicSkill,
  getOrganizationSkillRuntimeStatus,
  getPublicPackageInstallState,
  getPublicPackagePrimaryInstallSkill,
  getPublicPackagePrimarySkill,
  getPublicSkillInstallStateLabel,
  getSkillRowStatusBadgeClassName,
  isEmojiIcon,
  isImageIcon,
  shouldOpenPublicSkillManagement,
} from "@/routes/Skills/skill-route-model"

export function OrganizationInstallMissingButton({
  busy,
  className,
  count,
  disabled,
  onClick,
}: {
  busy: boolean
  className?: string
  count: number
  disabled?: boolean
  onClick: () => void
}) {
  const { t } = useAppI18n()

  return (
    <Button type="button" size="sm" className={className} disabled={disabled} onClick={onClick}>
      {busy ? <RefreshCwIcon className="size-3.5 animate-spin" /> : <PackageIcon className="size-3.5" />}
      <span className="truncate">{t("organizations.skillManageInstallMissingAll", { count })}</span>
    </Button>
  )
}

export function OrganizationSkillManageLoadingSkeleton({ inline }: { inline: boolean }) {
  const listClassName = inline
    ? "min-h-0 overflow-hidden bg-background pb-3"
    : "min-h-0 overflow-hidden rounded-md border bg-background"

  return (
    <div
      className={cn("grid min-h-0 grid-rows-[auto_minmax(0,1fr)]", inline ? "h-full gap-0" : "gap-3")}
      aria-hidden="true"
    >
      <div
        className={cn(
          "flex min-w-0 flex-wrap items-center justify-between gap-2",
          inline && "border-b border-[var(--oo-divider)] px-3 py-3",
        )}
      >
        <div className="max-w-full min-w-0 overflow-x-auto">
          <div className="flex h-[var(--oo-control-height-compact)] w-max min-w-0 items-center overflow-hidden rounded-md bg-muted/45 shadow-xs">
            <Skeleton className="mx-2 h-3.5 w-20 shrink-0 rounded-sm" />
            <div className="h-full w-px bg-[var(--oo-divider)]" />
            <Skeleton className="mx-2 h-3.5 w-14 shrink-0 rounded-sm" />
          </div>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2 sm:min-w-80 sm:flex-row sm:items-center sm:justify-end">
          <Skeleton className="h-[var(--oo-control-height-compact)] min-w-0 flex-1 rounded-md sm:max-w-80" />
          <Skeleton className="h-[var(--oo-control-height-compact)] w-24 shrink-0 rounded-md" />
          <Skeleton className="h-[var(--oo-control-height-compact)] w-28 shrink-0 rounded-md" />
        </div>
      </div>
      <div className={listClassName}>
        <OrganizationSkillManageRowSkeleton titleWidth="w-32" descriptionWidth="w-3/4 max-w-md" metaWidth="w-56" />
        <OrganizationSkillManageRowSkeleton titleWidth="w-40" descriptionWidth="w-5/6 max-w-lg" metaWidth="w-64" />
        <OrganizationSkillManageRowSkeleton titleWidth="w-28" descriptionWidth="w-2/3 max-w-sm" metaWidth="w-48" />
      </div>
    </div>
  )
}

function OrganizationSkillManageRowSkeleton({
  descriptionWidth,
  metaWidth,
  titleWidth,
}: {
  descriptionWidth: string
  metaWidth: string
  titleWidth: string
}) {
  return (
    <div className="grid min-w-0 gap-3 border-b border-[var(--oo-divider)] px-3 py-2.5 md:grid-cols-[auto_minmax(0,1fr)_auto] md:items-center">
      <Skeleton className="size-9 rounded-md" />
      <div className="grid min-w-0 gap-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <Skeleton className={cn("h-4 rounded-md", titleWidth)} />
          <Skeleton className="h-5 w-14 shrink-0 rounded-full" />
          <Skeleton className="hidden h-5 w-20 shrink-0 rounded-full sm:block" />
        </div>
        <Skeleton className={cn("h-3.5 rounded-md", descriptionWidth)} />
        <Skeleton className={cn("h-3 rounded-md", metaWidth)} />
      </div>
      <div className="flex min-w-0 justify-start gap-2 md:justify-end">
        <Skeleton className="h-[var(--oo-control-height-compact)] w-24 rounded-md" />
        <Skeleton className="h-[var(--oo-control-height-compact)] w-[var(--oo-control-height-compact)] rounded-md" />
      </div>
    </div>
  )
}

export function OrganizationSkillDialogEmpty({
  className,
  description,
  title,
}: {
  className?: string
  description: string
  title: string
}) {
  return (
    <div
      className={cn(
        "grid min-h-36 place-items-center rounded-md border border-dashed bg-muted/20 px-4 py-8 text-center",
        className,
      )}
    >
      <div className="grid max-w-md justify-items-center gap-2">
        <div className="grid size-10 place-items-center rounded-md border bg-background text-muted-foreground">
          <PackageIcon className="size-5" />
        </div>
        <div className="oo-text-label text-foreground">{title}</div>
        <p className="oo-text-caption text-muted-foreground">{description}</p>
      </div>
    </div>
  )
}

function OrganizationSkillIconFrame({ icon }: { icon?: string }) {
  const normalizedIcon = normalizeSkillIconSource(icon)
  const frameClassName = "grid size-9 shrink-0 place-items-center rounded-md border bg-background"

  if (isImageIcon(normalizedIcon)) {
    return (
      <span className={cn(frameClassName, "overflow-hidden")}>
        <img alt="" src={normalizedIcon} className="size-full object-contain p-1.5" />
      </span>
    )
  }

  if (isEmojiIcon(normalizedIcon)) {
    return <span className={cn(frameClassName, "text-xl")}>{normalizedIcon}</span>
  }

  return (
    <span className={frameClassName}>
      <SkillIcon icon={normalizedIcon} className="size-5" />
    </span>
  )
}

export function OrganizationSkillPackageListSkeleton() {
  return (
    <div className="divide-y">
      {Array.from({ length: 5 }).map((_, index) => (
        <div key={index} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5">
          <Skeleton className="size-9 rounded-md" />
          <div className="grid min-w-0 gap-2">
            <Skeleton className="h-4 w-40 rounded-md" />
            <Skeleton className="h-3 w-60 max-w-full rounded-md" />
          </div>
          <Skeleton className="h-[var(--oo-control-height-compact)] w-24 rounded-md" />
        </div>
      ))}
    </div>
  )
}

export function OrganizationSkillMarketRow({
  busyAction,
  canManage,
  groupById,
  linked,
  onAdd,
  onInstallRuntime,
  onOpenManagedSkill,
  onOpenPackageDetail,
  pkg,
}: {
  busyAction: BusyAction | null
  canManage: boolean
  groupById: ReadonlyMap<string, ManagedSkillGroup>
  linked: boolean
  onAdd: (skillName?: string) => Promise<void>
  onInstallRuntime: (skillName: string) => void
  onOpenManagedSkill: (skillName: string) => void
  onOpenPackageDetail: () => void
  pkg: PublicSkillPackage
}) {
  const { t } = useAppI18n()
  const primarySkill = getPublicPackagePrimarySkill(pkg)
  const primaryInstallSkill = getPublicPackagePrimaryInstallSkill(groupById, pkg) ?? primarySkill
  const installState = getPublicPackageInstallState(groupById, pkg)
  const canInstallRuntime = canInstallPublicSkill(installState)
  const targetSkillName = canInstallRuntime ? primaryInstallSkill?.name : primarySkill?.name
  const addBusy = targetSkillName ? busyAction === `addSkill:${pkg.name}:${targetSkillName}` : false
  const installBusy = targetSkillName ? busyAction === `installSkill:${pkg.name}:${targetSkillName}` : false
  const disabled = Boolean(busyAction && !addBusy && !installBusy)
  const canLink = canManage && Boolean(primarySkill) && !linked
  const skillDescription = primarySkill?.description ?? pkg.description
  const skillLine = primarySkill
    ? `${pkg.name} · ${primarySkill.name} · ${pkg.version}`
    : `${pkg.name} · ${pkg.version}`
  const opensManagement = Boolean(primarySkill && shouldOpenPublicSkillManagement(installState))

  return (
    <SkillListRow
      icon={<OrganizationSkillIconFrame icon={pkg.icon} />}
      showTrailingDivider
      title={pkg.displayName}
      description={skillDescription}
      badges={
        <Badge variant={linked ? "secondary" : "outline"}>
          {linked ? t("skills.organizationAdded") : getPublicSkillInstallStateLabel(installState, t)}
        </Badge>
      }
      meta={
        <div className="min-w-0 truncate" title={skillLine}>
          {skillLine}
        </div>
      }
      actions={
        <>
          {primarySkill && opensManagement ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => onOpenManagedSkill(primarySkill.name)}>
              {t("skills.installedManage")}
            </Button>
          ) : null}
          {canInstallRuntime && targetSkillName ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled || installBusy || !targetSkillName}
              onClick={() => onInstallRuntime(targetSkillName)}
            >
              {installBusy ? <RefreshCwIcon className="size-3.5 animate-spin" /> : <PackageIcon className="size-3.5" />}
              {installBusy ? t("skills.registryInstalling") : t("organizations.skillManageInstallRuntime")}
            </Button>
          ) : null}
          {!linked && canManage && canLink ? (
            <Button
              type="button"
              size="sm"
              disabled={disabled || addBusy}
              onClick={() => void onAdd(primarySkill?.name)}
            >
              {addBusy ? <RefreshCwIcon className="size-3.5 animate-spin" /> : null}
              {addBusy ? t("skills.organizationAdding") : t("organizations.skillManageAddOnly")}
            </Button>
          ) : null}
        </>
      }
      onSelect={primarySkill && opensManagement ? () => onOpenManagedSkill(primarySkill.name) : onOpenPackageDetail}
    />
  )
}

function OrganizationConfiguredSkillActionsMenu({
  busy,
  canManage,
  onRemove,
}: {
  busy: boolean
  canManage: boolean
  onRemove: () => void
}) {
  const { t } = useAppI18n()
  if (!canManage) {
    return null
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-[var(--oo-control-height-compact)] px-0"
          disabled={busy}
          aria-label={t("organizations.skillManageMoreActions")}
        >
          {busy ? <RefreshCwIcon className="size-3.5 animate-spin" /> : <MoreHorizontalIcon className="size-4" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem variant="destructive" onSelect={onRemove}>
          <Link2OffIcon className="size-4" />
          {t("organizations.skillManageRemovePackage")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function RuntimeSkillRemoveConfirmDialog({
  busy,
  onClose,
  onConfirm,
  target,
}: {
  busy: boolean
  onClose: () => void
  onConfirm: () => void
  target: RuntimeSkillRemoveTarget | null
}) {
  const { t } = useAppI18n()

  return (
    <ConfirmDialog
      open={Boolean(target)}
      onOpenChange={(open) => {
        if (!open && !busy) {
          onClose()
        }
      }}
    >
      <ConfirmDialogContent>
        <ConfirmDialogHeader>
          <ConfirmDialogTitle>
            {target
              ? t("organizations.skillManageRemoveRuntimeConfirmTitle", { name: target.displayName })
              : t("organizations.skillManageRemoveRuntime")}
          </ConfirmDialogTitle>
          <ConfirmDialogDescription>
            {t("organizations.skillManageRemoveRuntimeConfirmDescription")}
          </ConfirmDialogDescription>
        </ConfirmDialogHeader>
        <ConfirmDialogFooter>
          <ConfirmDialogCancel disabled={busy}>{t("common.cancel")}</ConfirmDialogCancel>
          <ConfirmDialogAction
            disabled={busy || !target}
            onClick={(event) => {
              event.preventDefault()
              onConfirm()
            }}
          >
            {busy ? <RefreshCwIcon className="size-3.5 animate-spin" /> : null}
            {t("organizations.skillManageRemoveRuntime")}
          </ConfirmDialogAction>
        </ConfirmDialogFooter>
      </ConfirmDialogContent>
    </ConfirmDialog>
  )
}

export function OrganizationPackageRemoveConfirmDialog({
  busy,
  onClose,
  onConfirm,
  packageSkillCount,
  target,
}: {
  busy: boolean
  onClose: () => void
  onConfirm: () => void
  packageSkillCount: number
  target: UseOrganizationSkills["skills"][number] | null
}) {
  const { t } = useAppI18n()

  return (
    <ConfirmDialog
      open={Boolean(target)}
      onOpenChange={(open) => {
        if (!open && !busy) {
          onClose()
        }
      }}
    >
      <ConfirmDialogContent>
        <ConfirmDialogHeader>
          <ConfirmDialogTitle>
            {target
              ? t("organizations.skillManageRemovePackageConfirmTitle", { name: target.packageName })
              : t("organizations.skillManageRemovePackage")}
          </ConfirmDialogTitle>
          <ConfirmDialogDescription>
            {t("organizations.skillManageRemovePackageConfirmDescription", { count: packageSkillCount })}
          </ConfirmDialogDescription>
        </ConfirmDialogHeader>
        <ConfirmDialogFooter>
          <ConfirmDialogCancel disabled={busy}>{t("common.cancel")}</ConfirmDialogCancel>
          <ConfirmDialogAction
            disabled={busy || !target}
            onClick={(event) => {
              event.preventDefault()
              onConfirm()
            }}
          >
            {busy ? <RefreshCwIcon className="size-3.5 animate-spin" /> : null}
            {t("organizations.skillManageRemovePackage")}
          </ConfirmDialogAction>
        </ConfirmDialogFooter>
      </ConfirmDialogContent>
    </ConfirmDialog>
  )
}

export function OrganizationSkillManageRow({
  busy,
  busyAction,
  canManage,
  groupById,
  installBusy,
  onInstallRuntime,
  onOpenManagedSkill,
  onRemove,
  skill,
}: {
  busy: boolean
  busyAction: BusyAction | null
  canManage: boolean
  groupById: ReadonlyMap<string, ManagedSkillGroup>
  installBusy: boolean
  onInstallRuntime: () => void
  onOpenManagedSkill: () => void
  onRemove: () => void
  skill: UseOrganizationSkills["skills"][number]
}) {
  const { t } = useAppI18n()
  const runtimeStatus = getOrganizationSkillRuntimeStatus(groupById, skill)
  const runtimeTone = organizationRuntimeStatusTone(runtimeStatus.state)
  const runtimeInstallable = runtimeStatus.state === "missing" || runtimeStatus.state === "external-only"
  const menuBusy = Boolean(busyAction) || busy || installBusy
  const opensManagement = shouldOpenOrganizationSkillManagement(runtimeStatus.state)

  return (
    <SkillListRow
      icon={<OrganizationSkillIconFrame icon={skill.icon} />}
      showTrailingDivider
      title={skill.displayName}
      description={skill.description}
      badges={
        <>
          <Badge variant="secondary" className="shrink-0">
            {t("organizations.skillManageConfigured")}
          </Badge>
          <Badge className={cn("shrink-0", getSkillRowStatusBadgeClassName(runtimeTone))} variant="outline">
            {organizationRuntimeStatusLabel(runtimeStatus.state, t)}
          </Badge>
        </>
      }
      meta={
        <div className="min-w-0 truncate" title={`${skill.packageName} · ${skill.skillName} · ${skill.version}`}>
          {skill.packageName} · {skill.skillName} · {skill.version}
        </div>
      }
      actions={
        <>
          {runtimeInstallable ? (
            <Button type="button" variant="outline" size="sm" disabled={installBusy} onClick={onInstallRuntime}>
              {installBusy ? <RefreshCwIcon className="size-3.5 animate-spin" /> : <PackageIcon className="size-3.5" />}
              {installBusy ? t("skills.registryInstalling") : t("organizations.skillManageInstallRuntime")}
            </Button>
          ) : null}
          {opensManagement ? (
            <Button type="button" variant="ghost" size="sm" onClick={onOpenManagedSkill}>
              {t("skills.installedManage")}
            </Button>
          ) : null}
          <OrganizationConfiguredSkillActionsMenu busy={menuBusy} canManage={canManage} onRemove={onRemove} />
        </>
      }
      onSelect={opensManagement ? onOpenManagedSkill : undefined}
    />
  )
}

export function OrganizationSkillRecommendationRow({
  busyAction,
  canManage,
  onAdd,
  onInstallRuntime,
  onOpenManagedSkill,
  onOpenPackageDetail,
  recommendation,
}: {
  busyAction: BusyAction | null
  canManage: boolean
  onAdd: () => Promise<void>
  onInstallRuntime: () => void
  onOpenManagedSkill: () => void
  onOpenPackageDetail: () => void
  recommendation: ProviderSkillRecommendation
}) {
  const { t } = useAppI18n()
  const canInstallRuntime = canInstallProviderRecommendationRuntime(recommendation)
  const addBusyKey = `addSkill:${recommendation.packageName}:${recommendation.skillId}`
  const installBusyKey = `installSkill:${recommendation.packageName}:${recommendation.skillId}`
  const addBusy = busyAction === addBusyKey || busyAction === "addSkillBatch"
  const installBusy = busyAction === installBusyKey || busyAction === "installSkillBatch"
  const disabled = Boolean(busyAction && !addBusy && !installBusy)
  const skillDescription = providerRecommendationSkillDescription(recommendation)
  const menuBusy = Boolean(busyAction && !addBusy)
  const opensManagement = canOpenManagedProviderRecommendation(recommendation)

  return (
    <SkillListRow
      icon={<OrganizationSkillIconFrame icon={recommendation.package.icon} />}
      showTrailingDivider
      title={recommendation.package.displayName}
      description={skillDescription}
      badges={
        <>
          <Badge variant="secondary" className="shrink-0">
            {t("organizations.skillManageRecommended")}
          </Badge>
        </>
      }
      meta={
        <div className="min-w-0 truncate" title={recommendation.packageName}>
          {recommendation.providerDisplayName} · {recommendation.packageName} · {recommendation.skillId}
        </div>
      }
      actions={
        <>
          {opensManagement ? (
            <Button type="button" variant="ghost" size="sm" onClick={onOpenManagedSkill}>
              {t("skills.installedManage")}
            </Button>
          ) : null}
          {canInstallRuntime ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled || installBusy}
              onClick={onInstallRuntime}
            >
              {installBusy ? <RefreshCwIcon className="size-3.5 animate-spin" /> : <PackageIcon className="size-3.5" />}
              {installBusy ? t("skills.registryInstalling") : t("organizations.skillManageInstallRuntime")}
            </Button>
          ) : null}
          {canManage ? (
            <Button type="button" size="sm" disabled={menuBusy || addBusy} onClick={() => void onAdd()}>
              {addBusy ? <RefreshCwIcon className="size-3.5 animate-spin" /> : null}
              {t("organizations.skillManageAddOnly")}
            </Button>
          ) : null}
        </>
      }
      onSelect={opensManagement ? onOpenManagedSkill : onOpenPackageDetail}
    />
  )
}
