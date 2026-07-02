import type { ManagedSkillGroup, PublicSkillPackage } from "../../../electron/skills/common.ts"
import type { BusyAction } from "./organization-management-model.ts"
import type { UseOrganizationSkills } from "@/hooks/useOrganizationSkills"
import type { ProviderSkillRecommendation } from "@/routes/Skills/provider-skill-recommendations"
import type { RuntimeSkillRemoveTarget } from "@/routes/Skills/skill-route-model"

import {
  CheckCircle2Icon,
  Link2OffIcon,
  MoreHorizontalIcon,
  PackageMinusIcon,
  PackageIcon,
  PauseCircleIcon,
  PlayCircleIcon,
  RefreshCwIcon,
} from "lucide-react"
import { runtimeSkillRemoveBusyKey } from "./organization-management-model.ts"
import { organizationRuntimeStatusLabel, organizationRuntimeStatusTone } from "./organization-skill-manage-helpers.ts"
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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
  getRuntimeSkillRemoveTarget,
  getSkillRowStatusBadgeClassName,
  isEmojiIcon,
  isImageIcon,
} from "@/routes/Skills/skill-route-model"

const skillManageMenuLabelClassName = "oo-text-caption-compact px-2 py-1 text-muted-foreground"
const skillManageMenuIconClassName = "text-muted-foreground"

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
            <Skeleton className="mx-2 h-3.5 w-16 shrink-0 rounded-sm" />
            <div className="h-full w-px bg-[var(--oo-divider)]" />
            <Skeleton className="mx-2 h-3.5 w-14 shrink-0 rounded-sm" />
          </div>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2 sm:min-w-80 sm:flex-row sm:items-center sm:justify-end">
          <Skeleton className="h-[var(--oo-control-height-compact)] min-w-0 flex-1 rounded-md sm:max-w-80" />
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
  onAddAndInstall,
  onManageLinked,
  pkg,
}: {
  busyAction: BusyAction | null
  canManage: boolean
  groupById: ReadonlyMap<string, ManagedSkillGroup>
  linked: boolean
  onAdd: (skillName?: string) => Promise<void>
  onAddAndInstall: (skillName?: string) => Promise<void>
  onManageLinked: () => void
  pkg: PublicSkillPackage
}) {
  const { t } = useAppI18n()
  const primarySkill = getPublicPackagePrimarySkill(pkg)
  const primaryInstallSkill = getPublicPackagePrimaryInstallSkill(groupById, pkg) ?? primarySkill
  const installState = getPublicPackageInstallState(groupById, pkg)
  const canInstallRuntime = canInstallPublicSkill(installState)
  const targetSkillName = canInstallRuntime ? primaryInstallSkill?.name : primarySkill?.name
  const busy = targetSkillName ? busyAction === `addSkill:${pkg.name}:${targetSkillName}` : false
  const disabled = Boolean(busyAction && !busy)
  const canLink = canManage && Boolean(primarySkill) && !linked
  const skillDescription = primarySkill?.description ?? pkg.description
  const skillLine = primarySkill
    ? `${pkg.name} · ${primarySkill.name} · ${pkg.version}`
    : `${pkg.name} · ${pkg.version}`
  const primaryLabel = busy
    ? t("skills.organizationAdding")
    : canInstallRuntime
      ? t("organizations.skillManageAddAndInstall")
      : t("organizations.skillManageAddOnly")

  return (
    <div
      className={cn(
        "grid min-w-0 gap-3 border-b border-[var(--oo-divider)] px-3 py-2.5 md:items-center",
        "md:grid-cols-[auto_minmax(0,1fr)_auto_auto]",
      )}
    >
      <OrganizationSkillIconFrame icon={pkg.icon} />
      <div className="grid min-w-0 gap-0.5">
        <div className="oo-text-label min-w-0 truncate text-foreground">{pkg.displayName}</div>
        {skillDescription ? (
          <div className="oo-text-caption line-clamp-1 text-foreground/75">{skillDescription}</div>
        ) : null}
        <div className="oo-text-caption-compact min-w-0 truncate text-muted-foreground" title={skillLine}>
          {skillLine}
        </div>
      </div>
      <Badge className="shrink-0 justify-self-start md:justify-self-end" variant={linked ? "secondary" : "outline"}>
        {linked ? t("skills.organizationAdded") : getPublicSkillInstallStateLabel(installState, t)}
      </Badge>
      <div className="flex min-w-0 flex-wrap justify-start gap-2 md:justify-end">
        {linked ? (
          <Button type="button" variant="outline" size="sm" onClick={onManageLinked}>
            {t("skills.discoverOpenManage")}
          </Button>
        ) : !canManage ? (
          <Badge variant="outline">{t("organizations.readOnly")}</Badge>
        ) : canInstallRuntime && canLink ? (
          <div className="inline-flex items-center gap-0">
            <Button
              type="button"
              size="sm"
              className="rounded-r-none"
              disabled={disabled || busy || !targetSkillName}
              onClick={() => void onAddAndInstall(targetSkillName)}
            >
              {busy ? <RefreshCwIcon className="size-3.5 animate-spin" /> : <PackageIcon className="size-3.5" />}
              {primaryLabel}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  className="-ml-px w-[var(--oo-control-height-compact)] rounded-l-none border-l border-primary-foreground/25 px-0"
                  disabled={disabled || busy}
                  aria-label={t("organizations.skillManageMoreActions")}
                >
                  <MoreHorizontalIcon className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => void onAdd(primarySkill?.name)}>
                  {t("organizations.skillManageLinkOnly")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : (
          <Button
            type="button"
            size="sm"
            disabled={disabled || busy || !canLink}
            onClick={() => void onAdd(primarySkill?.name)}
          >
            {busy ? <RefreshCwIcon className="size-3.5 animate-spin" /> : null}
            {primaryLabel}
          </Button>
        )}
      </div>
    </div>
  )
}

function OrganizationConfiguredSkillActionsMenu({
  busy,
  canManage,
  enabled,
  onRemove,
  onRequestRemoveRuntimeSkill,
  onToggleEnabled,
  removeBusy,
  runtimeRemoveTarget,
}: {
  busy: boolean
  canManage: boolean
  enabled: boolean
  onRemove: () => void
  onRequestRemoveRuntimeSkill: (target: RuntimeSkillRemoveTarget) => void
  onToggleEnabled: () => void
  removeBusy: boolean
  runtimeRemoveTarget: RuntimeSkillRemoveTarget | null
}) {
  const { t } = useAppI18n()
  const hasRuntimeRemoveAction = Boolean(runtimeRemoveTarget)
  if (!canManage && !hasRuntimeRemoveAction) {
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
          disabled={busy || removeBusy}
          aria-label={t("organizations.skillManageMoreActions")}
        >
          {busy || removeBusy ? (
            <RefreshCwIcon className="size-3.5 animate-spin" />
          ) : (
            <MoreHorizontalIcon className="size-4" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {canManage ? (
          <>
            <DropdownMenuLabel className={skillManageMenuLabelClassName}>
              {t("organizations.skillManageOrganizationSection")}
            </DropdownMenuLabel>
            <DropdownMenuItem onSelect={onToggleEnabled}>
              {enabled ? (
                <PauseCircleIcon className={skillManageMenuIconClassName} />
              ) : (
                <PlayCircleIcon className={skillManageMenuIconClassName} />
              )}
              {enabled
                ? t("organizations.skillManagePauseRecommendation")
                : t("organizations.skillManageResumeRecommendation")}
            </DropdownMenuItem>
          </>
        ) : null}
        {runtimeRemoveTarget ? (
          <>
            {canManage ? <DropdownMenuSeparator /> : null}
            <DropdownMenuLabel className={skillManageMenuLabelClassName}>
              {t("organizations.skillManageRuntimeSection")}
            </DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => onRequestRemoveRuntimeSkill(runtimeRemoveTarget)}>
              <PackageMinusIcon className={skillManageMenuIconClassName} />
              {t("organizations.skillManageRemoveRuntime")}
            </DropdownMenuItem>
          </>
        ) : null}
        {canManage ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={onRemove}>
              <Link2OffIcon className="size-4" />
              {t("organizations.skillManageUnrecommend")}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function OrganizationRecommendedSkillActionsMenu({
  addBusy,
  busy,
  canManage,
  onAdd,
  onRequestRemoveRuntimeSkill,
  removeBusy,
  runtimeRemoveTarget,
}: {
  addBusy: boolean
  busy: boolean
  canManage: boolean
  onAdd: () => Promise<void>
  onRequestRemoveRuntimeSkill: (target: RuntimeSkillRemoveTarget) => void
  removeBusy: boolean
  runtimeRemoveTarget: RuntimeSkillRemoveTarget | null
}) {
  const { t } = useAppI18n()
  const hasRuntimeRemoveAction = Boolean(runtimeRemoveTarget)
  if (!canManage && !hasRuntimeRemoveAction) {
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
          disabled={busy || addBusy || removeBusy}
          aria-label={t("organizations.skillManageMoreActions")}
        >
          {busy || addBusy || removeBusy ? (
            <RefreshCwIcon className="size-3.5 animate-spin" />
          ) : (
            <MoreHorizontalIcon className="size-4" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {canManage ? (
          <>
            <DropdownMenuLabel className={skillManageMenuLabelClassName}>
              {t("organizations.skillManageOrganizationSection")}
            </DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => void onAdd()}>
              <CheckCircle2Icon className={skillManageMenuIconClassName} />
              {t("organizations.skillManageAddOnly")}
            </DropdownMenuItem>
          </>
        ) : null}
        {canManage && runtimeRemoveTarget ? <DropdownMenuSeparator /> : null}
        {runtimeRemoveTarget ? (
          <>
            <DropdownMenuLabel className={skillManageMenuLabelClassName}>
              {t("organizations.skillManageRuntimeSection")}
            </DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => onRequestRemoveRuntimeSkill(runtimeRemoveTarget)}>
              <PackageMinusIcon className={skillManageMenuIconClassName} />
              {t("organizations.skillManageRemoveRuntime")}
            </DropdownMenuItem>
          </>
        ) : null}
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

export function OrganizationRecommendationRemoveConfirmDialog({
  busy,
  onClose,
  onConfirm,
  target,
}: {
  busy: boolean
  onClose: () => void
  onConfirm: () => void
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
              ? t("organizations.skillManageUnrecommendConfirmTitle", { name: target.displayName })
              : t("organizations.skillManageUnrecommend")}
          </ConfirmDialogTitle>
          <ConfirmDialogDescription>
            {t("organizations.skillManageUnrecommendConfirmDescription")}
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
            {t("organizations.skillManageUnrecommend")}
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
  onRemove,
  onRequestRemoveRuntimeSkill,
  onToggleEnabled,
  skill,
}: {
  busy: boolean
  busyAction: BusyAction | null
  canManage: boolean
  groupById: ReadonlyMap<string, ManagedSkillGroup>
  installBusy: boolean
  onInstallRuntime: () => void
  onRemove: () => void
  onRequestRemoveRuntimeSkill: (target: RuntimeSkillRemoveTarget) => void
  onToggleEnabled: () => void
  skill: UseOrganizationSkills["skills"][number]
}) {
  const { t } = useAppI18n()
  const runtimeStatus = getOrganizationSkillRuntimeStatus(groupById, skill)
  const runtimeTone = organizationRuntimeStatusTone(runtimeStatus.state)
  const runtimeInstallable = runtimeStatus.state === "missing" || runtimeStatus.state === "external-only"
  const runtimeRemoveTarget = getRuntimeSkillRemoveTarget(groupById, {
    displayName: skill.displayName,
    packageName: skill.packageName,
    skillName: skill.skillName,
  })
  const removeBusy = runtimeRemoveTarget ? busyAction === runtimeSkillRemoveBusyKey(runtimeRemoveTarget) : false
  const menuBusy = Boolean(busyAction && !removeBusy) || busy || installBusy

  return (
    <div className="group/skill-row grid min-w-0 gap-3 border-b border-[var(--oo-divider)] px-3 py-2.5 md:grid-cols-[auto_minmax(0,1fr)_auto] md:items-center">
      <OrganizationSkillIconFrame icon={skill.icon} />
      <div className="grid min-w-0 gap-0.5">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <div className="oo-text-label min-w-0 truncate text-foreground">{skill.displayName}</div>
          <Badge variant={skill.enabled ? "secondary" : "outline"} className="shrink-0">
            {skill.enabled ? t("skills.organizationEnabled") : t("skills.organizationDisabled")}
          </Badge>
          <Badge className={cn("shrink-0", getSkillRowStatusBadgeClassName(runtimeTone))} variant="outline">
            {organizationRuntimeStatusLabel(runtimeStatus.state, t)}
          </Badge>
        </div>
        {skill.description ? (
          <div className="oo-text-caption line-clamp-1 text-foreground/75">{skill.description}</div>
        ) : null}
        <div
          className="oo-text-caption-compact min-w-0 truncate text-muted-foreground"
          title={`${skill.packageName} · ${skill.skillName} · ${skill.version}`}
        >
          {skill.packageName} · {skill.skillName} · {skill.version}
        </div>
      </div>
      <div className="flex min-w-0 flex-wrap justify-start gap-2 md:justify-end">
        {runtimeInstallable ? (
          <Button type="button" variant="outline" size="sm" disabled={installBusy} onClick={onInstallRuntime}>
            {installBusy ? <RefreshCwIcon className="size-3.5 animate-spin" /> : <PackageIcon className="size-3.5" />}
            {installBusy ? t("skills.registryInstalling") : t("organizations.skillManageInstallRuntime")}
          </Button>
        ) : null}
        <OrganizationConfiguredSkillActionsMenu
          busy={menuBusy}
          canManage={canManage}
          enabled={skill.enabled}
          removeBusy={removeBusy}
          runtimeRemoveTarget={runtimeRemoveTarget}
          onRemove={onRemove}
          onRequestRemoveRuntimeSkill={onRequestRemoveRuntimeSkill}
          onToggleEnabled={onToggleEnabled}
        />
      </div>
    </div>
  )
}

export function OrganizationSkillRecommendationRow({
  busyAction,
  canManage,
  groupById,
  onAdd,
  onAddAndInstall,
  onInstallRuntime,
  onRequestRemoveRuntimeSkill,
  recommendation,
}: {
  busyAction: BusyAction | null
  canManage: boolean
  groupById: ReadonlyMap<string, ManagedSkillGroup>
  onAdd: () => Promise<void>
  onAddAndInstall: () => Promise<void>
  onInstallRuntime: () => void
  onRequestRemoveRuntimeSkill: (target: RuntimeSkillRemoveTarget) => void
  recommendation: ProviderSkillRecommendation
}) {
  const { t } = useAppI18n()
  const canInstallRuntime =
    recommendation.installState === "installable" || recommendation.installState === "partially-installed"
  const addBusyKey = `addSkill:${recommendation.packageName}:${recommendation.skillId}`
  const installBusyKey = `installSkill:${recommendation.packageName}:${recommendation.skillId}`
  const addBusy = busyAction === addBusyKey || busyAction === "addSkillBatch"
  const installBusy = busyAction === installBusyKey || busyAction === "installSkillBatch"
  const disabled = Boolean(busyAction && !addBusy && !installBusy)
  const skillDescription =
    recommendation.package.skills.find((skill) => skill.name === recommendation.skillId)?.description ??
    recommendation.package.description
  const runtimeRemoveTarget = getRuntimeSkillRemoveTarget(
    groupById,
    {
      displayName: recommendation.package.displayName,
      packageName: recommendation.packageName,
      skillName: recommendation.skillId,
    },
    { requirePackageMatch: true },
  )
  const runtimeRemoveBusy = runtimeRemoveTarget ? busyAction === runtimeSkillRemoveBusyKey(runtimeRemoveTarget) : false
  const menuBusy = Boolean(busyAction && !addBusy && !runtimeRemoveBusy)

  return (
    <div className="group/skill-row grid min-w-0 gap-3 border-b border-[var(--oo-divider)] px-3 py-2.5 md:grid-cols-[auto_minmax(0,1fr)_auto] md:items-center">
      <OrganizationSkillIconFrame icon={recommendation.package.icon} />
      <div className="grid min-w-0 gap-0.5">
        <div className="oo-text-label min-w-0 truncate text-foreground">{recommendation.package.displayName}</div>
        {skillDescription ? (
          <div className="oo-text-caption line-clamp-1 text-foreground/75">{skillDescription}</div>
        ) : null}
        <div
          className="oo-text-caption-compact min-w-0 truncate text-muted-foreground"
          title={recommendation.packageName}
        >
          {recommendation.providerDisplayName} · {recommendation.packageName} · {recommendation.skillId}
        </div>
      </div>
      <div className="flex min-w-0 flex-wrap justify-start gap-2 md:justify-end">
        {runtimeRemoveTarget ? (
          <OrganizationRecommendedSkillActionsMenu
            addBusy={addBusy}
            busy={menuBusy}
            canManage={canManage}
            removeBusy={runtimeRemoveBusy}
            runtimeRemoveTarget={runtimeRemoveTarget}
            onAdd={onAdd}
            onRequestRemoveRuntimeSkill={onRequestRemoveRuntimeSkill}
          />
        ) : canInstallRuntime ? (
          <div className="inline-flex items-center gap-0">
            <Button
              type="button"
              variant={canManage ? "default" : "outline"}
              size="sm"
              className={cn(canManage && "rounded-r-none")}
              disabled={disabled || installBusy}
              onClick={onInstallRuntime}
            >
              {installBusy ? <RefreshCwIcon className="size-3.5 animate-spin" /> : <PackageIcon className="size-3.5" />}
              {installBusy ? t("skills.registryInstalling") : t("organizations.skillManageInstallRuntime")}
            </Button>
            {canManage ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="default"
                    size="sm"
                    className="-ml-px w-[var(--oo-control-height-compact)] rounded-l-none border-l border-primary-foreground/25 px-0"
                    disabled={disabled || addBusy || installBusy}
                    aria-label={t("organizations.skillManageMoreActions")}
                  >
                    <MoreHorizontalIcon className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => void onAddAndInstall()}>
                    {t("organizations.skillManageAddAndInstall")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => void onAdd()}>
                    {t("organizations.skillManageLinkOnly")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        ) : !canManage ? (
          <Badge variant="outline">{getPublicSkillInstallStateLabel(recommendation.installState, t)}</Badge>
        ) : (
          <Button type="button" size="sm" disabled={disabled || addBusy} onClick={() => void onAdd()}>
            {addBusy ? <RefreshCwIcon className="size-3.5 animate-spin" /> : null}
            {t("organizations.skillManageAddOnly")}
          </Button>
        )}
      </div>
    </div>
  )
}
