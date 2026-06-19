import type {
  BuiltInSkillId,
  ManagedSkillGroup,
  ManagedSkillHostCoverage,
  ManagedSkillKind,
  PublicSkillPackage,
  PublicSkillPackageCatalog,
  SkillVersionReport,
} from "../../../electron/skills/common.ts"
import type { ObjectStatusTone } from "@/components/ObjectRow"
import type { TranslateFn as TFunction } from "@/i18n"

import * as React from "react"
import { toast } from "sonner"
import { AgentIcon } from "@/components/AgentIcon"
import { MessageResponse } from "@/components/ai-elements/message"
import { useSkillService } from "@/components/AppContext"
import {
  useHomeSummaryResource,
  useSkillInventoryResource,
  useSkillVersionReportResource,
} from "@/components/AppDataHooks"
import { AppIcons } from "@/components/AppIcons"
import { ErrorNotice } from "@/components/ErrorNotice"
import { InspectorCard, InspectorInsetCard } from "@/components/InspectorPanel"
import { ObjectRowSkeletonGroup, SkeletonText } from "@/components/LoadingSkeletons"
import { ObjectStatusIcon } from "@/components/ObjectRow"
import { SearchField } from "@/components/SearchField"
import { SkillIcon } from "@/components/SkillIcon"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item"
import { Skeleton } from "@/components/ui/skeleton"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useSkillObjectActions } from "@/components/useSkillObjectActions"
import { useAppI18n } from "@/i18n"
import { resolveUserFacingError, userFacingErrorDescription } from "@/lib/user-facing-error"
import { cn } from "@/lib/utils"

const builtInSelectionKey = "__built-in-skills__"

function SkillErrorNotice({ className, error }: { className?: string; error: string | null | undefined }) {
  if (!error) {
    return null
  }
  return <ErrorNotice error={resolveUserFacingError(error, { area: "skills" })} compact className={className} />
}

function skillErrorMessage(cause: unknown, t: TFunction): string {
  return userFacingErrorDescription(resolveUserFacingError(cause, { area: "skills" }), t)
}

type SkillSelectionKey = typeof builtInSelectionKey | string
type SkillPageTab = "discover" | "installed"
type InstalledSkillFilter = "all" | "updates" | "local"
type SkillDocumentViewMode = "preview" | "raw"
type PublicSkillInstallState = "installed" | "partially-installed" | "installable" | "name-conflict" | "unavailable"
type PublicPackageCatalogStatus = "idle" | "load-error" | "loading" | "loading-more" | "refreshing"
type ManagedSkillGroupById = ReadonlyMap<string, ManagedSkillGroup>
type SkillVersionCheckByKey = ReadonlyMap<string, SkillVersionReport["skills"][number]>

interface PublicPackageCatalogState {
  error: string | null
  items: PublicSkillPackage[]
  next: string | null
  requestId: number
  selectedId: string | null
  status: PublicPackageCatalogStatus
}

type PublicPackageCatalogAction =
  | { append: boolean; requestId: number; type: "load-start" }
  | { append: boolean; catalog: PublicSkillPackageCatalog; requestId: number; type: "load-success" }
  | { error: string; requestId: number; type: "load-error" }
  | { id: string | null; type: "select" }

const initialPublicPackageCatalogState: PublicPackageCatalogState = {
  error: null,
  items: [],
  next: null,
  requestId: 0,
  selectedId: null,
  status: "idle",
}

const discoverAutoLoadThresholdPx = 160

function isInstalledSkillFilter(value: string): value is InstalledSkillFilter {
  return value === "all" || value === "updates" || value === "local"
}

function skillDocumentPreviewSource(content: string): string {
  const normalized = content.replace(/^\uFEFF/, "")
  if (!normalized.startsWith("---")) {
    return content
  }

  const lines = normalized.split(/\r?\n/)
  if (lines[0]?.trim() !== "---") {
    return content
  }

  const closingIndex = lines.findIndex((line, index) => index > 0 && line.trim() === "---")
  if (closingIndex < 0) {
    return content
  }

  return lines
    .slice(closingIndex + 1)
    .join("\n")
    .trimStart()
}

function appendUniquePublicPackages(
  current: PublicSkillPackage[],
  nextItems: PublicSkillPackage[],
): PublicSkillPackage[] {
  const seen = new Set(current.map((item) => item.id))
  return [
    ...current,
    ...nextItems.filter((item) => {
      if (seen.has(item.id)) {
        return false
      }
      seen.add(item.id)
      return true
    }),
  ]
}

function publicPackageCatalogReducer(
  state: PublicPackageCatalogState,
  action: PublicPackageCatalogAction,
): PublicPackageCatalogState {
  switch (action.type) {
    case "load-start":
      return {
        ...state,
        error: null,
        requestId: action.requestId,
        status: action.append ? "loading-more" : state.items.length > 0 ? "refreshing" : "loading",
      }
    case "load-success":
      if (action.requestId !== state.requestId) {
        return state
      }

      return {
        ...state,
        error: null,
        items: action.append
          ? appendUniquePublicPackages(state.items, action.catalog.items)
          : appendUniquePublicPackages([], action.catalog.items),
        next: action.catalog.next,
        selectedId: action.append ? state.selectedId : null,
        status: "idle",
      }
    case "load-error":
      if (action.requestId !== state.requestId) {
        return state
      }

      return {
        ...state,
        error: action.error,
        status: "load-error",
      }
    case "select":
      return {
        ...state,
        selectedId: action.id,
      }
  }
}

function isNearScrollBottom(element: HTMLElement): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= discoverAutoLoadThresholdPx
}

function getRuntimeHosts(group: ManagedSkillGroup): ManagedSkillHostCoverage[] {
  return group.runtimeHosts
}

function getInstalledSkillHosts(group: ManagedSkillGroup): ManagedSkillHostCoverage[] {
  return group.hosts.filter((host) => host.status === "installed")
}

function getInstalledHostCount(group: ManagedSkillGroup, hosts = group.hosts): number {
  return hosts.filter((host) => host.status === "installed").length
}

function getAttentionHostCount(group: ManagedSkillGroup, hosts = group.hosts): number {
  return hosts.filter((host) => host.controlState === "modified" || host.controlState === "source-missing").length
}

function getMissingHostCount(group: ManagedSkillGroup, hosts = group.hosts): number {
  return hosts.filter((host) => host.status === "missing").length
}

function isInstalledSkillGroup(group: ManagedSkillGroup): boolean {
  return !group.isBuiltIn && getInstalledSkillHosts(group).length > 0
}

function getHostCoverageLabel(group: ManagedSkillGroup, t: TFunction, hosts = group.hosts): string | undefined {
  const totalHostCount = hosts.length

  if (totalHostCount === 0) {
    return undefined
  }

  return t("skills.availableCoverage", { installed: getInstalledHostCount(group, hosts), total: totalHostCount })
}

function shouldInstallBuiltInSkill(group: ManagedSkillGroup): group is ManagedSkillGroup & { id: BuiltInSkillId } {
  return group.isBuiltIn && (getMissingHostCount(group) > 0 || getAttentionHostCount(group) > 0)
}

function shouldUpdatePublishedSkill(group: ManagedSkillGroup): boolean {
  return (
    group.kind === "registry" &&
    Boolean(group.packageName?.trim()) &&
    getInstalledHostCount(group, getRuntimeHosts(group)) > 0
  )
}

function getLocalSkillPublishPath(group: ManagedSkillGroup): string | undefined {
  if (group.kind !== "local") {
    return undefined
  }

  const publishHost = group.hosts.find((host) => host.status === "installed" && (host.sourcePath || host.path))
  return publishHost?.sourcePath ?? publishHost?.path
}

function getSkillDocumentRootPath(group: ManagedSkillGroup): string | undefined {
  const installedHost = getInstalledSkillHosts(group).find((host) => host.path || host.sourcePath)
  return installedHost?.path ?? installedHost?.sourcePath
}

function isPublishableLocalSkill(group: ManagedSkillGroup): boolean {
  return Boolean(getLocalSkillPublishPath(group)) && !group.packageName?.trim()
}

function matchesInstalledSkillFilter(
  group: ManagedSkillGroup,
  filter: InstalledSkillFilter,
  versionCheck: SkillVersionReport["skills"][number] | undefined,
): boolean {
  switch (filter) {
    case "all":
      return true
    case "updates":
      return hasSkillUpdateAvailable(versionCheck)
    case "local":
      return group.kind === "local"
  }
}

function getSkillVersionCheckKey(skillId: string, packageName: string | undefined): string {
  return `${skillId}\0${packageName ?? ""}`
}

function getSkillVersionCheck(
  versionCheckByKey: SkillVersionCheckByKey,
  group: ManagedSkillGroup | undefined,
): SkillVersionReport["skills"][number] | undefined {
  if (!group) {
    return undefined
  }

  return versionCheckByKey.get(getSkillVersionCheckKey(group.id, group.packageName))
}

function hasSkillUpdateAvailable(versionCheck: SkillVersionReport["skills"][number] | undefined): boolean {
  return versionCheck?.status === "update-available"
}

function getSkillKindLabel(kind: ManagedSkillKind, t: TFunction): string {
  switch (kind) {
    case "bundled":
      return t("skills.kind.bundled")
    case "registry":
      return t("skills.kind.registry")
    case "local":
      return t("skills.kind.local")
    case "unknown":
      return t("skills.kind.unknown")
  }
}

function getGroupStatus(group: ManagedSkillGroup, t: TFunction, hosts = group.hosts) {
  const attentionHostCount = getAttentionHostCount(group, hosts)
  const sourceMissingHostCount = hosts.filter((host) => host.controlState === "source-missing").length
  const modifiedHostCount = hosts.filter((host) => host.controlState === "modified").length
  const installedHostCount = getInstalledHostCount(group, hosts)

  if (attentionHostCount > 0) {
    const isDanger = sourceMissingHostCount > 0
    const tone: ObjectStatusTone = isDanger ? "danger" : "attention"

    return {
      badge: isDanger ? ("destructive" as const) : ("outline" as const),
      description: isDanger
        ? t("skills.groupStatus.sourceMissingDescription", { count: sourceMissingHostCount })
        : t("skills.groupStatus.modifiedDescription", { count: modifiedHostCount }),
      label: isDanger ? t("skills.groupStatus.sourceMissing") : t("skills.groupStatus.modified"),
      tone,
    }
  }

  if (installedHostCount === 0) {
    return {
      badge: "outline" as const,
      description: t("skills.groupStatus.notInstalledDescription"),
      label: t("skills.groupStatus.notInstalled"),
      tone: "pending" as const satisfies ObjectStatusTone,
    }
  }

  return {
    badge: "secondary" as const,
    label: undefined,
    tone: "ready" as const satisfies ObjectStatusTone,
  }
}

function getHostStatus(host: ManagedSkillHostCoverage, t: TFunction) {
  if (host.status !== "installed") {
    return {
      label: t("skills.hostStatus.notInstalled"),
      tone: "pending" as const satisfies ObjectStatusTone,
      variant: "outline" as const,
    }
  }

  if (host.controlState === "modified") {
    return {
      label: t("skills.hostStatus.modified"),
      tone: "attention" as const satisfies ObjectStatusTone,
      variant: "outline" as const,
    }
  }

  if (host.controlState === "source-missing") {
    return {
      label: t("skills.hostStatus.sourceMissing"),
      tone: "danger" as const satisfies ObjectStatusTone,
      variant: "destructive" as const,
    }
  }

  return {
    label: undefined,
    tone: "ready" as const satisfies ObjectStatusTone,
    variant: "secondary" as const,
  }
}

function shouldShowStatusBadge(statusTone: ObjectStatusTone): boolean {
  return statusTone !== "ready"
}

function getStatusBadgeClassName(statusTone: ObjectStatusTone): string | undefined {
  if (statusTone !== "attention") {
    return undefined
  }

  return "border-[var(--oo-warning-border)] bg-[var(--oo-warning-surface)] text-[var(--oo-warning-foreground)]"
}

function getGroupRowPackageLine(group: ManagedSkillGroup): string | undefined {
  const line = [group.packageName, group.version].filter(Boolean).join(" · ")

  return line || undefined
}

function joinSkillMeta(parts: Array<string | undefined>): string | undefined {
  const line = parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(" · ")

  return line || undefined
}

function getBuiltInSkillDesign(skillId: string, t: TFunction) {
  switch (skillId) {
    case "oo":
      return {
        name: t("skills.builtInCatalog.oo.name"),
        role: t("skills.builtInCatalog.oo.role"),
        description: t("skills.builtInCatalog.oo.description"),
      }
    case "oo-find-skills":
      return {
        name: t("skills.builtInCatalog.find.name"),
        role: t("skills.builtInCatalog.find.role"),
        description: t("skills.builtInCatalog.find.description"),
      }
    case "oo-create-skill":
      return {
        name: t("skills.builtInCatalog.create.name"),
        role: t("skills.builtInCatalog.create.role"),
        description: t("skills.builtInCatalog.create.description"),
      }
    case "oo-publish-skill":
      return {
        name: t("skills.builtInCatalog.publish.name"),
        role: t("skills.builtInCatalog.publish.role"),
        description: t("skills.builtInCatalog.publish.description"),
      }
    default:
      return {
        name: skillId,
        role: t("skills.builtIn"),
        description: "",
      }
  }
}

function getPublicPackagePrimarySkill(pkg: PublicSkillPackage): PublicSkillPackage["skills"][number] | undefined {
  return pkg.skills[0]
}

function getPublicSkillInstallState(
  groupById: ManagedSkillGroupById | undefined,
  pkg: PublicSkillPackage,
  skillName: string | undefined,
): PublicSkillInstallState {
  if (!skillName) {
    return "unavailable"
  }

  const group = groupById?.get(skillName)
  if (!group) {
    return "installable"
  }

  const installedHosts = group.hosts.filter((host) => host.status === "installed")
  if (installedHosts.some((host) => (host.packageName ?? group.packageName) === pkg.name)) {
    return "installed"
  }

  return installedHosts.length > 0 ? "name-conflict" : "installable"
}

function getPublicPackageInstallState(
  groupById: ManagedSkillGroupById | undefined,
  pkg: PublicSkillPackage,
): PublicSkillInstallState {
  if (pkg.skills.length === 0) {
    return "unavailable"
  }

  const skillStates = pkg.skills.map((skill) => getPublicSkillInstallState(groupById, pkg, skill.name))

  if (skillStates.length > 0 && skillStates.every((state) => state === "installed")) {
    return "installed"
  }

  if (skillStates.some((state) => state === "name-conflict")) {
    return "name-conflict"
  }

  if (skillStates.some((state) => state === "installable") && skillStates.some((state) => state === "installed")) {
    return "partially-installed"
  }

  return skillStates.some((state) => state === "installable") ? "installable" : "unavailable"
}

function getPublicPackagePrimaryInstallSkill(
  groupById: ManagedSkillGroupById | undefined,
  pkg: PublicSkillPackage,
): PublicSkillPackage["skills"][number] | undefined {
  return pkg.skills.find((skill) => getPublicSkillInstallState(groupById, pkg, skill.name) === "installable")
}

function matchesPublicPackageQuery(pkg: PublicSkillPackage, normalizedQuery: string): boolean {
  if (!normalizedQuery) {
    return true
  }

  return (
    pkg.displayName.toLowerCase().includes(normalizedQuery) ||
    pkg.name.toLowerCase().includes(normalizedQuery) ||
    Boolean(pkg.description?.toLowerCase().includes(normalizedQuery)) ||
    pkg.skills.some((skill) => {
      return (
        skill.name.toLowerCase().includes(normalizedQuery) ||
        skill.title.toLowerCase().includes(normalizedQuery) ||
        Boolean(skill.description?.toLowerCase().includes(normalizedQuery))
      )
    })
  )
}

function getPublicPackageMaintainerLine(pkg: PublicSkillPackage, t: TFunction): string {
  const maintainerNames = pkg.maintainers.map((maintainer) => maintainer.name).filter(Boolean)
  if (maintainerNames.length > 0) {
    return maintainerNames.slice(0, 2).join(", ")
  }

  if (pkg.name.startsWith("oo-")) {
    return t("skills.discoverOfficialMaintainer")
  }

  const scopedName = pkg.name.startsWith("@") ? pkg.name.slice(1).split("/")[0] : undefined
  return scopedName || t("skills.discoverCommunityMaintainer")
}

function getPublicPackageMetaLine(pkg: PublicSkillPackage, t: TFunction): string {
  return (
    joinSkillMeta([
      getPublicPackageMaintainerLine(pkg, t),
      pkg.downloadCount === undefined ? undefined : t("skills.discoverDownloads", { count: pkg.downloadCount }),
    ]) ?? getPublicPackageMaintainerLine(pkg, t)
  )
}

function formatPublicPackageUpdateTime(updateTime: number | undefined, locale: string): string | undefined {
  if (!updateTime) {
    return undefined
  }

  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(updateTime))
  } catch {
    return undefined
  }
}

function getPublicSkillInstallStateLabel(state: PublicSkillInstallState, t: TFunction): string {
  switch (state) {
    case "installed":
      return t("skills.installed")
    case "partially-installed":
      return t("skills.discoverPartiallyInstalled")
    case "name-conflict":
      return t("skills.remoteNameConflict")
    case "installable":
      return t("skills.discoverAvailable")
    case "unavailable":
      return t("skills.discoverUnavailable")
  }
}

function getPublicSkillInstallActionLabel(state: PublicSkillInstallState, t: TFunction): string {
  switch (state) {
    case "partially-installed":
      return t("skills.discoverInstallMissing")
    case "installable":
      return t("skills.registryInstall")
    case "installed":
      return t("skills.discoverOpenManage")
    case "name-conflict":
      return t("skills.remoteConflictAction")
    case "unavailable":
      return t("skills.discoverUnavailable")
  }
}

function canInstallPublicSkill(state: PublicSkillInstallState): boolean {
  return state === "installable" || state === "partially-installed"
}

function getPublicSkillInstallKey(pkg: PublicSkillPackage, skillName: string | undefined): string {
  return `${pkg.id}:${skillName ?? ""}`
}

function isImageIcon(icon: string | undefined): boolean {
  return Boolean(icon?.startsWith("https://"))
}

function isEmojiIcon(icon: string | undefined): boolean {
  return Boolean(icon && !icon.includes(":") && /\p{Emoji}/u.test(icon))
}

function getSkillRowStatusBadgeClassName(tone: ObjectStatusTone): string {
  const baseClassName = "h-5 max-w-28 shrink-0 px-1.5 text-[11px] leading-none font-medium"

  if (tone === "attention") {
    return cn(
      baseClassName,
      "border-[var(--oo-warning-border)] bg-[var(--oo-warning-surface)] text-[var(--oo-warning-foreground)]",
    )
  }

  if (tone === "pending") {
    return cn(baseClassName, "border-[var(--oo-frame-border)] bg-muted/40 text-muted-foreground")
  }

  return baseClassName
}

const publishableSkillBadgeClassName =
  "h-5 shrink-0 border-blue-200 bg-blue-50 px-1.5 text-[11px] leading-none font-medium text-blue-700 dark:border-blue-400/30 dark:bg-blue-400/10 dark:text-blue-300"

const skillUpdateBadgeBaseClassName =
  "h-5 shrink-0 border-[var(--oo-warning-border)] bg-[var(--oo-warning-surface)] px-1.5 text-[11px] leading-none font-medium text-[var(--oo-warning-foreground)]"
const skillUpdateBadgeClassName = skillUpdateBadgeBaseClassName
const skillUpdateActionBadgeClassName = cn(
  "h-7 shrink-0 border-[var(--oo-warning-border)] bg-[var(--oo-warning-surface)] px-2 text-xs font-medium text-[var(--oo-warning-foreground)]",
  "border shadow-none hover:bg-[var(--oo-warning-surface)] hover:text-[var(--oo-warning-foreground)]",
)

function SkillUpdateBadge({ label }: { label: string }) {
  return (
    <Badge className={skillUpdateBadgeClassName} variant="outline">
      {label}
    </Badge>
  )
}

function SkillUpdateActionBadge({
  ariaLabel,
  disabled = false,
  isUpdating,
  label,
  onClick,
  updatingLabel,
}: {
  ariaLabel: string
  disabled?: boolean
  isUpdating: boolean
  label: string
  onClick: () => void
  updatingLabel: string
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={cn("gap-1", skillUpdateActionBadgeClassName)}
      disabled={disabled || isUpdating}
      aria-label={ariaLabel}
      onClick={onClick}
    >
      {isUpdating ? <AppIcons.status.loading className="size-3 animate-spin" /> : null}
      {isUpdating ? updatingLabel : label}
    </Button>
  )
}

function getBuiltInCoverageLabel(groups: ManagedSkillGroup[], t: TFunction): string | undefined {
  const installedHostCount = groups.reduce((count, group) => count + getInstalledHostCount(group), 0)
  const totalHostCount = groups.reduce((count, group) => count + group.hosts.length, 0)

  if (totalHostCount === 0) {
    return undefined
  }

  return t("skills.availableCoverage", { installed: installedHostCount, total: totalHostCount })
}

function getBuiltInStatus(groups: ManagedSkillGroup[], t: TFunction) {
  const attentionHostCount = groups.reduce((count, group) => count + getAttentionHostCount(group), 0)
  const installedHostCount = groups.reduce((count, group) => count + getInstalledHostCount(group), 0)

  if (attentionHostCount > 0) {
    return {
      badge: "outline" as const,
      label: t("skills.groupStatus.attention"),
      meta: t("skills.rowAttention", { count: attentionHostCount }),
      tone: "attention" as const satisfies ObjectStatusTone,
    }
  }

  if (installedHostCount === 0) {
    return {
      badge: "outline" as const,
      label: t("skills.notInstalled"),
      meta: undefined,
      tone: "pending" as const satisfies ObjectStatusTone,
    }
  }

  return {
    badge: "secondary" as const,
    label: undefined,
    meta: undefined,
    tone: "ready" as const satisfies ObjectStatusTone,
  }
}

function useDesktopDetailHeadingFocus<T extends HTMLElement>(dependency: string): React.RefObject<T | null> {
  const headingRef = React.useRef<T | null>(null)

  React.useEffect(() => {
    const mediaQuery = window.matchMedia("(min-width: 960px)")
    if (!mediaQuery.matches) {
      return
    }

    const frame = window.requestAnimationFrame(() => {
      const activeElement = document.activeElement
      if (
        activeElement instanceof HTMLElement &&
        (activeElement.matches("input, textarea, select") || activeElement.isContentEditable)
      ) {
        return
      }

      headingRef.current?.focus({ preventScroll: true })
    })

    return () => window.cancelAnimationFrame(frame)
  }, [dependency])

  return headingRef
}

export function SkillsRoute() {
  const { locale, t } = useAppI18n()
  const skillService = useSkillService()
  const inventoryResource = useSkillInventoryResource()
  const versionResource = useSkillVersionReportResource()
  const homeSummaryResource = useHomeSummaryResource()
  const inventory = inventoryResource.data
  const installedSkillGroupById = React.useMemo<ManagedSkillGroupById>(() => {
    return new Map((inventory?.groups ?? []).map((group) => [group.id, group]))
  }, [inventory?.groups])
  const versionCheckByKey = React.useMemo<SkillVersionCheckByKey>(() => {
    return new Map(
      (versionResource.data?.skills ?? []).map((check) => [
        getSkillVersionCheckKey(check.skillId, check.packageName),
        check,
      ]),
    )
  }, [versionResource.data?.skills])
  const [activeTab, setActiveTab] = React.useState<SkillPageTab>("discover")
  const [selectedSkillId, setSelectedSkillId] = React.useState<SkillSelectionKey | null>(null)
  const [query, setQuery] = React.useState("")
  const [installedFilter, setInstalledFilter] = React.useState<InstalledSkillFilter>("all")
  const [discoveryQuery, setDiscoveryQuery] = React.useState("")
  const [publicPackageCatalog, dispatchPublicPackageCatalog] = React.useReducer(
    publicPackageCatalogReducer,
    initialPublicPackageCatalogState,
  )
  const [installingRegistryResultId, setInstallingRegistryResultId] = React.useState<string | null>(null)
  const [planError, setPlanError] = React.useState<string | null>(null)
  const [installingBuiltInSkillId, setInstallingBuiltInSkillId] = React.useState<BuiltInSkillId | null>(null)
  const [publishingSkillId, setPublishingSkillId] = React.useState<string | null>(null)
  const [updatingRegistrySkillId, setUpdatingRegistrySkillId] = React.useState<string | null>(null)
  const [isCheckingVersions, setIsCheckingVersions] = React.useState(false)
  const [isExecutingCliUpdate, setIsExecutingCliUpdate] = React.useState(false)
  const [narrowPane, setNarrowPane] = React.useState<"detail" | "list">("list")
  const installBuiltInInFlightRef = React.useRef(false)
  const publishSkillInFlightRef = React.useRef(false)
  const updateRegistryInFlightRef = React.useRef(false)
  const cliUpdateInFlightRef = React.useRef(false)
  const installRegistryInFlightRef = React.useRef(false)
  const requestedVersionCheckRef = React.useRef(false)
  const publicPackageRequestIdRef = React.useRef(0)
  const { copySkillPath, openSkillFolder } = useSkillObjectActions()

  React.useEffect(() => {
    if (!selectedSkillId && inventory?.groups[0]) {
      const firstManagedGroup = inventory.groups.find((group) => !group.isBuiltIn)
      setSelectedSkillId(firstManagedGroup?.id ?? builtInSelectionKey)
    }
  }, [inventory?.groups, selectedSkillId])

  const searchedBuiltInGroups = React.useMemo(() => {
    const groups = inventory?.groups ?? []
    const normalizedQuery = query.trim().toLowerCase()
    const builtInGroups = groups.filter((group) => group.isBuiltIn)

    if (!normalizedQuery) {
      return builtInGroups
    }

    return builtInGroups.filter((group) => {
      const design = getBuiltInSkillDesign(group.id, t)

      return [group.name, group.description, design.name, design.role, design.description].some((value) =>
        value?.toLowerCase().includes(normalizedQuery),
      )
    })
  }, [inventory?.groups, query, t])

  const searchedGroups = React.useMemo(() => {
    const groups = inventory?.groups ?? []
    const normalizedQuery = query.trim().toLowerCase()
    const managedGroups = groups.filter((group) => !group.isBuiltIn)

    if (!normalizedQuery) {
      return managedGroups
    }

    return managedGroups.filter((group) => {
      return (
        group.name.toLowerCase().includes(normalizedQuery) ||
        Boolean(group.description?.toLowerCase().includes(normalizedQuery)) ||
        Boolean(group.packageName?.toLowerCase().includes(normalizedQuery))
      )
    })
  }, [inventory?.groups, query])

  const filteredBuiltInGroups = React.useMemo(() => {
    return searchedBuiltInGroups
  }, [searchedBuiltInGroups])
  const installedGroups = React.useMemo(() => searchedGroups.filter(isInstalledSkillGroup), [searchedGroups])
  const filteredInstalledGroups = React.useMemo(() => {
    return installedGroups.filter((group) => {
      return matchesInstalledSkillFilter(group, installedFilter, getSkillVersionCheck(versionCheckByKey, group))
    })
  }, [installedFilter, installedGroups, versionCheckByKey])
  const systemAttentionGroups = React.useMemo(() => {
    return searchedBuiltInGroups.filter((group) => getAttentionHostCount(group, getRuntimeHosts(group)) > 0)
  }, [searchedBuiltInGroups])
  const selectedSkill =
    selectedSkillId === builtInSelectionKey
      ? undefined
      : searchedGroups.find((group) => group.id === selectedSkillId) || searchedGroups[0]
  const isBuiltInSelected =
    selectedSkillId === builtInSelectionKey || (!selectedSkill && filteredBuiltInGroups.length > 0)
  const builtInStatus = React.useMemo(() => getBuiltInStatus(filteredBuiltInGroups, t), [filteredBuiltInGroups, t])
  const selectedStatus = selectedSkill ? getGroupStatus(selectedSkill, t, getInstalledSkillHosts(selectedSkill)) : null
  const selectedVersionCheck = getSkillVersionCheck(versionCheckByKey, selectedSkill)
  React.useEffect(() => {
    if (requestedVersionCheckRef.current) {
      return
    }

    requestedVersionCheckRef.current = true
    void versionResource.refresh({ silent: true }).catch(() => {})
  }, [versionResource])

  const selectSkill = React.useCallback((skillId: SkillSelectionKey) => {
    setSelectedSkillId(skillId)
    setNarrowPane("detail")
  }, [])

  const loadPublicSkillPackages = React.useCallback(
    async (options: { forceRefresh?: boolean; next?: string | null } = {}) => {
      const next = options.next?.trim() || undefined
      const append = Boolean(next && !options.forceRefresh)
      const requestId = publicPackageRequestIdRef.current + 1
      publicPackageRequestIdRef.current = requestId
      dispatchPublicPackageCatalog({ append, requestId, type: "load-start" })

      try {
        const catalog = await skillService.invoke("listPublicSkillPackages", {
          forceRefresh: options.forceRefresh,
          next,
        })
        dispatchPublicPackageCatalog({ append, catalog, requestId, type: "load-success" })
      } catch (cause) {
        dispatchPublicPackageCatalog({
          error: cause instanceof Error ? cause.message : String(cause),
          requestId,
          type: "load-error",
        })
      }
    },
    [skillService],
  )

  React.useEffect(() => {
    if (activeTab !== "discover" || publicPackageCatalog.items.length > 0 || publicPackageCatalog.status !== "idle") {
      return
    }

    void loadPublicSkillPackages().catch(() => undefined)
  }, [activeTab, loadPublicSkillPackages, publicPackageCatalog.items.length, publicPackageCatalog.status])

  const filteredPublicPackages = React.useMemo(() => {
    const normalizedQuery = discoveryQuery.trim().toLowerCase()
    return publicPackageCatalog.items.filter((pkg) => matchesPublicPackageQuery(pkg, normalizedQuery))
  }, [discoveryQuery, publicPackageCatalog.items])

  const selectedPublicPackage = React.useMemo(() => {
    return publicPackageCatalog.selectedId
      ? publicPackageCatalog.items.find((pkg) => pkg.id === publicPackageCatalog.selectedId)
      : undefined
  }, [publicPackageCatalog.items, publicPackageCatalog.selectedId])

  const openManagedPublicSkill = React.useCallback((skillName: string) => {
    setActiveTab("installed")
    setQuery("")
    setSelectedSkillId(skillName)
    setNarrowPane("detail")
  }, [])

  const installPublicSkill = React.useCallback(
    async (pkg: PublicSkillPackage, skillName?: string) => {
      if (installRegistryInFlightRef.current) {
        return
      }

      const targetSkillName = skillName ?? getPublicPackagePrimarySkill(pkg)?.name
      if (!targetSkillName) {
        toast.error(t("skills.discoverInstallNoSkill"))
        return
      }

      installRegistryInFlightRef.current = true
      setInstallingRegistryResultId(`${pkg.id}:${targetSkillName}`)

      try {
        const nextInventory = await skillService.invoke("installRegistrySkill", {
          packageName: pkg.name,
          skillId: targetSkillName,
        })
        inventoryResource.setData(nextInventory)
        homeSummaryResource.invalidate()
        versionResource.invalidate()
        toast.success(t("skills.registryInstallDone", { name: targetSkillName }))
      } catch (cause) {
        toast.error(t("skills.registryInstallFailed", { error: skillErrorMessage(cause, t) }))
      } finally {
        installRegistryInFlightRef.current = false
        setInstallingRegistryResultId(null)
      }
    },
    [homeSummaryResource, inventoryResource, skillService, t, versionResource],
  )

  const installBuiltInSkill = React.useCallback(
    async (skillId: BuiltInSkillId) => {
      if (installBuiltInInFlightRef.current) {
        return
      }

      installBuiltInInFlightRef.current = true
      setInstallingBuiltInSkillId(skillId)
      setPlanError(null)

      try {
        const nextInventory = await skillService.invoke("installBuiltInSkill", { skillId })
        inventoryResource.setData(nextInventory)
        homeSummaryResource.invalidate()
      } catch (cause) {
        setPlanError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        installBuiltInInFlightRef.current = false
        setInstallingBuiltInSkillId(null)
      }
    },
    [homeSummaryResource, inventoryResource, skillService],
  )

  const updateRegistrySkill = React.useCallback(
    async (skill: Pick<ManagedSkillGroup, "id" | "kind" | "packageName">) => {
      if (updateRegistryInFlightRef.current) {
        return
      }

      const packageName = skill.packageName?.trim()
      if (!packageName) {
        return
      }

      updateRegistryInFlightRef.current = true
      setUpdatingRegistrySkillId(skill.id)
      setPlanError(null)

      try {
        if (skill.kind !== "registry") {
          return
        }

        const nextInventory = await skillService.invoke("updateRegistrySkill", {
          packageName,
          skillId: skill.id,
        })
        inventoryResource.setData(nextInventory)
        await versionResource.refresh({ forceRefresh: true, silent: true })
        homeSummaryResource.invalidate()
      } catch (cause) {
        setPlanError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        updateRegistryInFlightRef.current = false
        setUpdatingRegistrySkillId(null)
      }
    },
    [homeSummaryResource, inventoryResource, skillService, versionResource],
  )

  const publishSkill = React.useCallback(
    async (skill: ManagedSkillGroup) => {
      if (publishSkillInFlightRef.current) {
        return
      }

      const skillPath = getLocalSkillPublishPath(skill)
      if (!skillPath) {
        toast.error(t("skills.publishNoLocalPath"))
        return
      }

      publishSkillInFlightRef.current = true
      setPublishingSkillId(skill.id)
      setPlanError(null)

      try {
        const result = await skillService.invoke("publishSkill", {
          path: skillPath,
          visibility: "public",
        })
        inventoryResource.setData(result.inventory)
        await versionResource.refresh({ forceRefresh: true, silent: true }).catch(() => {})
        homeSummaryResource.invalidate()
        toast.success(t("skills.publishDone", { name: skill.name }))
      } catch (cause) {
        const message = skillErrorMessage(cause, t)
        setPlanError(message)
        toast.error(t("skills.publishFailed", { error: message }))
      } finally {
        publishSkillInFlightRef.current = false
        setPublishingSkillId(null)
      }
    },
    [homeSummaryResource, inventoryResource, skillService, t, versionResource],
  )

  const checkVersions = React.useCallback(async () => {
    if (isCheckingVersions) {
      return
    }

    setIsCheckingVersions(true)
    setPlanError(null)

    try {
      await versionResource.refresh({ forceRefresh: true })
      homeSummaryResource.invalidate()
    } catch (cause) {
      setPlanError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setIsCheckingVersions(false)
    }
  }, [homeSummaryResource, isCheckingVersions, versionResource])

  const executeCliUpdate = React.useCallback(async () => {
    if (cliUpdateInFlightRef.current) {
      return
    }

    cliUpdateInFlightRef.current = true
    setIsExecutingCliUpdate(true)
    setPlanError(null)

    try {
      const report = await skillService.invoke("executeCliUpdate")
      versionResource.setData(report)
      await inventoryResource.refresh({ forceRefresh: true, silent: true })
      homeSummaryResource.invalidate()
    } catch (cause) {
      setPlanError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      cliUpdateInFlightRef.current = false
      setIsExecutingCliUpdate(false)
    }
  }, [homeSummaryResource, inventoryResource, skillService, versionResource])

  const isPublicPackageBusy =
    publicPackageCatalog.status === "loading" ||
    publicPackageCatalog.status === "loading-more" ||
    publicPackageCatalog.status === "refreshing"
  const isPublicPackageLoadingMore = publicPackageCatalog.status === "loading-more"
  const isPublicPackageReplacing =
    publicPackageCatalog.status === "loading" || publicPackageCatalog.status === "refreshing"
  const detailContentProps: SkillDetailContentProps = {
    builtInStatus,
    copySkillPath,
    filteredBuiltInGroups,
    installBuiltInSkill,
    installingBuiltInSkillId,
    inventoryInitialLoading: inventoryResource.isInitialLoading,
    isBuiltInSelected,
    openSkillFolder,
    publishSkill,
    publishingSkillId,
    selectedPlanError: planError,
    selectedSkill,
    selectedStatus,
    selectedVersionCheck,
    updateRegistrySkill,
    updatingRegistrySkillId,
  }

  return (
    <>
      <section className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
        <SkillPageHeader
          activeTab={activeTab}
          checkVersions={checkVersions}
          disabled={inventoryResource.isInitialLoading}
          discoveryQuery={discoveryQuery}
          executeCliUpdate={executeCliUpdate}
          installedQuery={query}
          isExecutingCliUpdate={isExecutingCliUpdate}
          isDiscoveryLoading={isPublicPackageBusy}
          onDiscoveryQueryChange={setDiscoveryQuery}
          onDiscoveryRefresh={() => void loadPublicSkillPackages({ forceRefresh: true })}
          onInstalledQueryChange={setQuery}
          onTabChange={setActiveTab}
          versionReport={versionResource.data}
          versionsRefreshing={isCheckingVersions}
        />
        {activeTab === "discover" ? (
          <DiscoverSkillsPane
            error={publicPackageCatalog.error}
            groupById={installedSkillGroupById}
            installingKey={installingRegistryResultId}
            isLoading={isPublicPackageReplacing}
            isLoadingMore={isPublicPackageLoadingMore}
            locale={locale}
            next={publicPackageCatalog.next}
            packages={filteredPublicPackages}
            selectedPackage={selectedPublicPackage}
            onClosePackage={() => dispatchPublicPackageCatalog({ id: null, type: "select" })}
            onInstall={installPublicSkill}
            onLoadMore={() => void loadPublicSkillPackages({ next: publicPackageCatalog.next })}
            onOpenManagedSkill={openManagedPublicSkill}
            onSelectPackage={(pkg) => dispatchPublicPackageCatalog({ id: pkg.id, type: "select" })}
          />
        ) : (
          <InstalledSkillsPane
            detailContentProps={detailContentProps}
            filter={installedFilter}
            groups={filteredInstalledGroups}
            isDetailOpen={narrowPane === "detail"}
            systemAttentionGroups={systemAttentionGroups}
            updateRegistrySkill={updateRegistrySkill}
            updatingRegistrySkillId={updatingRegistrySkillId}
            versionCheckByKey={versionCheckByKey}
            selectedSkill={
              selectedSkill && filteredInstalledGroups.some((group) => group.id === selectedSkill.id)
                ? selectedSkill
                : undefined
            }
            onCloseDetail={() => setNarrowPane("list")}
            onSelectBuiltIn={() => {
              selectSkill(builtInSelectionKey)
            }}
            onSelectSkill={(skillId) => {
              selectSkill(skillId)
            }}
            onFilterChange={setInstalledFilter}
          />
        )}
      </section>
    </>
  )
}

interface SkillsSyncMenuProps {
  checkVersions: () => void
  disabled: boolean
  executeCliUpdate: () => void
  isExecutingCliUpdate: boolean
  versionReport: SkillVersionReport | null
  versionsRefreshing: boolean
}

function SkillDetailSkeleton() {
  return (
    <div className="grid min-w-0 gap-3 overflow-hidden">
      <section className="grid gap-2 rounded-md border px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <SkeletonText className="h-4 w-36" />
          <SkeletonText className="h-5 w-14 rounded-md" />
        </div>
        <div className="grid gap-1.5">
          <SkeletonText className="w-56 max-w-full" />
          <SkeletonText className="w-44 max-w-full" />
          <Skeleton className="mt-1 h-16 rounded-md" />
        </div>
      </section>

      <section className="grid gap-2 rounded-md border px-3 py-2.5">
        <SkeletonText className="h-4 w-24" />
        <ObjectRowSkeletonGroup count={2} rows={1} />
      </section>
    </div>
  )
}

interface SkillDetailContentProps {
  builtInStatus: ReturnType<typeof getBuiltInStatus>
  copySkillPath: (pathname: string) => void
  filteredBuiltInGroups: ManagedSkillGroup[]
  installBuiltInSkill: (skillId: BuiltInSkillId) => Promise<void>
  installingBuiltInSkillId: BuiltInSkillId | null
  inventoryInitialLoading: boolean
  isBuiltInSelected: boolean
  openSkillFolder: (pathname: string) => void
  publishSkill: (skill: ManagedSkillGroup) => Promise<void>
  publishingSkillId: string | null
  selectedPlanError: string | null
  selectedSkill: ManagedSkillGroup | undefined
  selectedStatus: ReturnType<typeof getGroupStatus> | null
  selectedVersionCheck?: SkillVersionReport["skills"][number]
  updateRegistrySkill: (skill: Pick<ManagedSkillGroup, "id" | "kind" | "packageName">) => void
  updatingRegistrySkillId: string | null
}

function SkillDetailContent({
  builtInStatus,
  copySkillPath,
  filteredBuiltInGroups,
  installBuiltInSkill,
  installingBuiltInSkillId,
  inventoryInitialLoading,
  isBuiltInSelected,
  openSkillFolder,
  publishSkill,
  publishingSkillId,
  selectedPlanError,
  selectedSkill,
  selectedStatus,
  selectedVersionCheck,
  updateRegistrySkill,
  updatingRegistrySkillId,
}: SkillDetailContentProps) {
  const { t } = useAppI18n()

  if (inventoryInitialLoading) {
    return <SkillDetailSkeleton />
  }

  if (isBuiltInSelected && filteredBuiltInGroups.length > 0) {
    return (
      <BuiltInSkillsPeek
        installBuiltInSkill={installBuiltInSkill}
        installingBuiltInSkillId={installingBuiltInSkillId}
        groups={filteredBuiltInGroups}
        status={builtInStatus}
      />
    )
  }

  if (selectedSkill && selectedStatus) {
    return (
      <SkillPeek
        installBuiltInSkill={installBuiltInSkill}
        installingBuiltInSkillId={installingBuiltInSkillId}
        copySkillPath={copySkillPath}
        openSkillFolder={openSkillFolder}
        planError={selectedPlanError}
        publishSkill={publishSkill}
        publishingSkillId={publishingSkillId}
        selectedSkill={selectedSkill}
        selectedStatus={selectedStatus}
        selectedVersionCheck={selectedVersionCheck}
        updateRegistrySkill={updateRegistrySkill}
        updatingRegistrySkillId={updatingRegistrySkillId}
      />
    )
  }

  return <div className="oo-text-body oo-text-muted p-4">{t("skills.detailPlaceholder")}</div>
}

interface SkillPageHeaderProps extends SkillsSyncMenuProps {
  activeTab: SkillPageTab
  discoveryQuery: string
  installedQuery: string
  isDiscoveryLoading: boolean
  onDiscoveryQueryChange: (value: string) => void
  onInstalledQueryChange: (value: string) => void
  onDiscoveryRefresh: () => void
  onTabChange: (tab: SkillPageTab) => void
}

function SkillPageHeader({
  activeTab,
  checkVersions,
  disabled,
  discoveryQuery,
  installedQuery,
  executeCliUpdate,
  isExecutingCliUpdate,
  isDiscoveryLoading,
  onDiscoveryQueryChange,
  onDiscoveryRefresh,
  onInstalledQueryChange,
  onTabChange,
  versionReport,
  versionsRefreshing,
}: SkillPageHeaderProps) {
  const { t } = useAppI18n()
  const isDiscoverTab = activeTab === "discover"
  const searchValue = isDiscoverTab ? discoveryQuery : installedQuery
  const searchPlaceholder = isDiscoverTab ? "skills.discoverSearch" : "skills.installedSearch"

  return (
    <header className="oo-border-divider flex min-h-12 items-center gap-3 border-b px-3 py-2">
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        className="shrink-0"
        value={activeTab}
        onValueChange={(value) => {
          if (value === "discover" || value === "installed") {
            onTabChange(value)
          }
        }}
      >
        <ToggleGroupItem value="discover">{t("skills.tab.discover")}</ToggleGroupItem>
        <ToggleGroupItem value="installed">{t("skills.tab.installed")}</ToggleGroupItem>
      </ToggleGroup>
      <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
        <SearchField
          placeholder={t(searchPlaceholder)}
          value={searchValue}
          onChange={(event) => {
            const value = event.currentTarget.value
            if (isDiscoverTab) {
              onDiscoveryQueryChange(value)
            } else {
              onInstalledQueryChange(value)
            }
          }}
        />
        {isDiscoverTab ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t("skills.discoverRefresh")}
                disabled={isDiscoveryLoading}
                onClick={onDiscoveryRefresh}
              >
                {isDiscoveryLoading ? (
                  <AppIcons.status.loading className="animate-spin" />
                ) : (
                  <AppIcons.action.refresh />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("skills.discoverRefresh")}</TooltipContent>
          </Tooltip>
        ) : (
          <SkillsSyncMenu
            checkVersions={checkVersions}
            disabled={disabled}
            executeCliUpdate={executeCliUpdate}
            isExecutingCliUpdate={isExecutingCliUpdate}
            versionReport={versionReport}
            versionsRefreshing={versionsRefreshing}
          />
        )}
      </div>
    </header>
  )
}

interface DiscoverSkillsPaneProps {
  error: string | null
  groupById: ManagedSkillGroupById
  installingKey: string | null
  isLoading: boolean
  isLoadingMore: boolean
  locale: string
  next: string | null
  onClosePackage: () => void
  onInstall: (pkg: PublicSkillPackage, skillName?: string) => void
  onLoadMore: () => void
  onOpenManagedSkill: (skillName: string) => void
  onSelectPackage: (pkg: PublicSkillPackage) => void
  packages: PublicSkillPackage[]
  selectedPackage: PublicSkillPackage | undefined
}

function DiscoverSkillsPane({
  error,
  groupById,
  installingKey,
  isLoading,
  isLoadingMore,
  locale,
  next,
  onClosePackage,
  onInstall,
  onLoadMore,
  onOpenManagedSkill,
  onSelectPackage,
  packages,
  selectedPackage,
}: DiscoverSkillsPaneProps) {
  const { t } = useAppI18n()
  const autoLoadRequestedRef = React.useRef(false)
  const canLoadMore = Boolean(next) && !isLoading && !isLoadingMore && packages.length > 0

  React.useEffect(() => {
    if (!isLoadingMore) {
      autoLoadRequestedRef.current = false
    }
  }, [isLoadingMore, next])

  const handleScroll = React.useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      if (!canLoadMore || autoLoadRequestedRef.current || !isNearScrollBottom(event.currentTarget)) {
        return
      }

      autoLoadRequestedRef.current = true
      onLoadMore()
    },
    [canLoadMore, onLoadMore],
  )

  return (
    <div className="min-h-0 overflow-auto px-3 py-3" onScroll={handleScroll}>
      <div className="grid gap-3 pr-1">
        <SkillErrorNotice error={error} />
        {isLoading && packages.length === 0 ? (
          <PublicSkillGridSkeleton />
        ) : packages.length === 0 ? (
          <div className="oo-text-body oo-text-muted px-1 py-3">{t("skills.discoverEmpty")}</div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(15.5rem,1fr))] gap-2.5">
            {packages.map((pkg) => (
              <PublicSkillPackageCard
                key={pkg.id}
                groupById={groupById}
                installingKey={installingKey}
                pkg={pkg}
                selected={selectedPackage?.id === pkg.id}
                onInstall={(skillName) => onInstall(pkg, skillName)}
                onOpenManagedSkill={onOpenManagedSkill}
                onSelect={() => onSelectPackage(pkg)}
              />
            ))}
          </div>
        )}
        {next ? (
          <div className="flex justify-center py-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isLoading || isLoadingMore}
              onClick={onLoadMore}
            >
              {isLoadingMore ? <AppIcons.status.loading className="animate-spin" /> : null}
              {isLoadingMore ? t("skills.discoverLoadingMore") : t("skills.discoverLoadMore")}
            </Button>
          </div>
        ) : null}
      </div>

      {selectedPackage ? (
        <PublicSkillPackageSheet
          installingKey={installingKey}
          groupById={groupById}
          locale={locale}
          pkg={selectedPackage}
          onClose={onClosePackage}
          onInstall={onInstall}
          onOpenManagedSkill={onOpenManagedSkill}
        />
      ) : null}
    </div>
  )
}

function PublicSkillGridSkeleton() {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(15.5rem,1fr))] gap-2.5">
      {Array.from({ length: 6 }).map((_, index) => (
        <div key={index} className="grid gap-3 rounded-md border bg-card px-3 py-3">
          <div className="flex items-start gap-3">
            <Skeleton className="size-10 rounded-md" />
            <div className="grid flex-1 gap-2">
              <SkeletonText className="h-4 w-28" />
              <SkeletonText className="h-3 w-full" />
              <SkeletonText className="h-3 w-20" />
            </div>
          </div>
          <Skeleton className="h-8 rounded-md" />
        </div>
      ))}
    </div>
  )
}

interface PublicSkillPackageCardProps {
  groupById: ManagedSkillGroupById
  installingKey: string | null
  onInstall: (skillName?: string) => void
  onOpenManagedSkill: (skillName: string) => void
  onSelect: () => void
  pkg: PublicSkillPackage
  selected: boolean
}

function PublicSkillPackageCard({
  groupById,
  installingKey,
  onInstall,
  onOpenManagedSkill,
  onSelect,
  pkg,
  selected,
}: PublicSkillPackageCardProps) {
  const { t } = useAppI18n()
  const primarySkill = getPublicPackagePrimarySkill(pkg)
  const primaryInstallSkill = getPublicPackagePrimaryInstallSkill(groupById, pkg)
  const state = getPublicPackageInstallState(groupById, pkg)
  const isInstalling = installingKey === getPublicSkillInstallKey(pkg, primaryInstallSkill?.name)

  return (
    <div
      className={cn(
        "grid min-h-44 grid-rows-[minmax(0,1fr)_auto] overflow-hidden rounded-md border bg-card text-card-foreground transition-colors hover:bg-[var(--oo-row-hover)]",
        selected && "border-[var(--accent-ring)] bg-[var(--oo-row-selected)] hover:bg-[var(--oo-row-selected)]",
      )}
    >
      <button
        type="button"
        className="grid min-w-0 gap-2 p-3 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
        onClick={onSelect}
      >
        <div className="flex min-w-0 items-start gap-3">
          <PublicSkillIcon icon={pkg.icon} />
          <div className="grid min-w-0 gap-1">
            <div className="min-w-0 truncate text-sm font-medium">{pkg.displayName}</div>
            <div className="oo-text-caption oo-text-muted min-w-0 truncate" title={pkg.name}>
              {pkg.name}
            </div>
          </div>
        </div>
        {pkg.description ? <p className="oo-text-caption line-clamp-2 text-foreground/75">{pkg.description}</p> : null}
        <div className="oo-text-caption oo-text-muted min-w-0 truncate" title={getPublicPackageMetaLine(pkg, t)}>
          {getPublicPackageMetaLine(pkg, t)}
        </div>
      </button>
      <div className="oo-border-divider flex items-center justify-between gap-2 border-t px-3 py-2">
        <Badge variant={state === "installed" ? "secondary" : "outline"}>
          {getPublicSkillInstallStateLabel(state, t)}
        </Badge>
        {state === "name-conflict" && primarySkill ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => onOpenManagedSkill(primarySkill.name)}>
            {t("skills.discoverOpenManage")}
          </Button>
        ) : state === "installed" && primarySkill ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => onOpenManagedSkill(primarySkill.name)}>
            {t("skills.discoverOpenManage")}
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isInstalling || !canInstallPublicSkill(state)}
            onClick={() => onInstall(primaryInstallSkill?.name)}
          >
            {isInstalling ? <AppIcons.status.loading className="animate-spin" /> : <AppIcons.action.installPackage />}
            {isInstalling ? t("skills.registryInstalling") : getPublicSkillInstallActionLabel(state, t)}
          </Button>
        )}
      </div>
    </div>
  )
}

interface InstalledSkillsPaneProps {
  detailContentProps: SkillDetailContentProps
  filter: InstalledSkillFilter
  groups: ManagedSkillGroup[]
  isDetailOpen: boolean
  onCloseDetail: () => void
  onFilterChange: (filter: InstalledSkillFilter) => void
  onSelectBuiltIn: () => void
  onSelectSkill: (skillId: string) => void
  selectedSkill: ManagedSkillGroup | undefined
  systemAttentionGroups: ManagedSkillGroup[]
  updateRegistrySkill: (skill: Pick<ManagedSkillGroup, "id" | "kind" | "packageName">) => void
  updatingRegistrySkillId: string | null
  versionCheckByKey: SkillVersionCheckByKey
}

function InstalledSkillsPane({
  detailContentProps,
  filter,
  groups,
  isDetailOpen,
  onCloseDetail,
  onFilterChange,
  onSelectBuiltIn,
  onSelectSkill,
  selectedSkill,
  systemAttentionGroups,
  updateRegistrySkill,
  updatingRegistrySkillId,
  versionCheckByKey,
}: InstalledSkillsPaneProps) {
  const { t } = useAppI18n()

  return (
    <div className="min-h-0 overflow-auto px-3 py-3">
      <div className="grid gap-3 pr-1">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          className="w-fit max-w-full flex-wrap justify-start"
          value={filter}
          onValueChange={(value) => {
            if (isInstalledSkillFilter(value)) {
              onFilterChange(value)
            }
          }}
        >
          <ToggleGroupItem value="all">{t("skills.installedFilter.all")}</ToggleGroupItem>
          <ToggleGroupItem value="updates">{t("skills.installedFilter.updates")}</ToggleGroupItem>
          <ToggleGroupItem value="local">{t("skills.installedFilter.local")}</ToggleGroupItem>
        </ToggleGroup>
        {systemAttentionGroups.length > 0 ? (
          <SystemSkillAttentionCard groups={systemAttentionGroups} onOpen={onSelectBuiltIn} />
        ) : null}
        {groups.length === 0 ? (
          <div className="oo-text-body oo-text-muted px-1 py-3">{t("skills.installedEmpty")}</div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(15.5rem,1fr))] gap-2.5">
            {groups.map((group) => (
              <InstalledSkillCard
                key={group.id}
                group={group}
                selected={selectedSkill?.id === group.id}
                updateRegistrySkill={updateRegistrySkill}
                updatingRegistrySkillId={updatingRegistrySkillId}
                versionCheck={getSkillVersionCheck(versionCheckByKey, group)}
                onOpen={() => onSelectSkill(group.id)}
              />
            ))}
          </div>
        )}
      </div>

      {isDetailOpen && (selectedSkill || detailContentProps.isBuiltInSelected) ? (
        <SkillManagementSheet title={selectedSkill?.name ?? t("skills.builtInGroupTitle")} onClose={onCloseDetail}>
          <SkillDetailContent {...detailContentProps} />
        </SkillManagementSheet>
      ) : null}
    </div>
  )
}

interface InstalledSkillCardProps {
  group: ManagedSkillGroup
  onOpen: () => void
  selected: boolean
  updateRegistrySkill: (skill: Pick<ManagedSkillGroup, "id" | "kind" | "packageName">) => void
  updatingRegistrySkillId: string | null
  versionCheck: SkillVersionReport["skills"][number] | undefined
}

function InstalledSkillCard({
  group,
  onOpen,
  selected,
  updateRegistrySkill,
  updatingRegistrySkillId,
  versionCheck,
}: InstalledSkillCardProps) {
  const { t } = useAppI18n()
  const status = getGroupStatus(group, t, getInstalledSkillHosts(group))
  const hasUpdate = hasSkillUpdateAvailable(versionCheck)
  const canUpdate = hasUpdate && shouldUpdatePublishedSkill(group)
  const isPublishable = isPublishableLocalSkill(group)
  const hasAttention = status.tone === "attention" || status.tone === "danger"
  const statusLabel = hasUpdate
    ? t("skills.updateAvailable")
    : hasAttention
      ? (status.label ?? t("skills.groupStatus.modified"))
      : isPublishable
        ? t("skills.publishable")
        : t("skills.installed")
  const badgeTone: ObjectStatusTone = hasUpdate ? "attention" : hasAttention ? status.tone : "ready"
  const badgeClassName =
    isPublishable && !hasUpdate && !hasAttention
      ? publishableSkillBadgeClassName
      : getSkillRowStatusBadgeClassName(badgeTone)
  const packageLine = getGroupRowPackageLine(group) ?? getSkillKindLabel(group.kind, t)
  const runtimeLabel =
    hasUpdate && versionCheck
      ? t("skills.versionUpdateAvailable", {
          current: versionCheck.currentVersion ?? group.version ?? "",
          latest: versionCheck.latestVersion ?? "",
        })
      : hasAttention
        ? (status.description ?? t("skills.groupStatus.modifiedDescription", { count: 1 }))
        : isPublishable
          ? t("skills.publishableDescription")
          : t("skills.installedDescription")
  const isUpdating = updatingRegistrySkillId === group.id

  return (
    <div
      className={cn(
        "grid min-h-44 grid-rows-[minmax(0,1fr)_auto] overflow-hidden rounded-md border bg-card text-card-foreground transition-colors hover:bg-[var(--oo-row-hover)]",
        selected && "border-[var(--accent-ring)] bg-[var(--oo-row-selected)] hover:bg-[var(--oo-row-selected)]",
      )}
    >
      <button
        type="button"
        className="grid min-w-0 gap-2 p-3 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
        onClick={onOpen}
      >
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-md border bg-background">
            <SkillIcon icon={group.icon} className="size-5" />
          </span>
          <div className="grid min-w-0 gap-1">
            <div className="min-w-0 truncate text-sm font-medium">{group.name}</div>
            <div className="oo-text-caption oo-text-muted min-w-0 truncate" title={packageLine}>
              {packageLine}
            </div>
          </div>
        </div>
        {group.description ? (
          <p className="oo-text-caption line-clamp-2 text-foreground/75">{group.description}</p>
        ) : null}
        <div className="oo-text-caption oo-text-muted min-w-0 truncate" title={runtimeLabel}>
          {runtimeLabel}
        </div>
      </button>
      <div className="oo-border-divider flex items-center justify-between gap-2 border-t px-3 py-2">
        <Badge className={badgeClassName} variant={badgeTone === "danger" ? "destructive" : "outline"}>
          {statusLabel}
        </Badge>
        {canUpdate ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isUpdating}
            onClick={() => updateRegistrySkill(group)}
          >
            {isUpdating ? <AppIcons.status.loading className="animate-spin" /> : null}
            {isUpdating ? t("skills.updatingRegistry") : t("skills.updateRegistry")}
          </Button>
        ) : (
          <Button type="button" variant="ghost" size="sm" onClick={onOpen}>
            {t("skills.installedManage")}
          </Button>
        )}
      </div>
    </div>
  )
}

function SystemSkillAttentionCard({ groups, onOpen }: { groups: ManagedSkillGroup[]; onOpen: () => void }) {
  const { t } = useAppI18n()
  const attentionCount = groups.reduce(
    (count, group) => count + getAttentionHostCount(group) + getMissingHostCount(group),
    0,
  )

  return (
    <Card className="grid gap-2 rounded-md border-[var(--oo-warning-border)] bg-[var(--oo-warning-surface)] px-3 py-2 shadow-none">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="grid min-w-0 gap-1">
          <div className="text-sm font-medium">{t("skills.systemAttentionTitle")}</div>
          <CardDescription className="text-xs">
            {t("skills.systemAttentionDescription", { count: attentionCount })}
          </CardDescription>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onOpen}>
          {t("skills.systemAttentionAction")}
        </Button>
      </div>
    </Card>
  )
}

function SkillManagementSheet({
  children,
  onClose,
  title,
}: {
  children: React.ReactNode
  onClose: () => void
  title: string
}) {
  const { t } = useAppI18n()
  const sheetRef = React.useRef<HTMLElement | null>(null)

  React.useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      sheetRef.current?.focus()
    })

    return () => window.cancelAnimationFrame(frame)
  }, [])

  return (
    <div
      className="fixed inset-0 z-50 bg-black/15"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <aside
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="absolute top-0 right-0 grid h-full w-[min(30rem,calc(100vw-2rem))] grid-rows-[auto_minmax(0,1fr)] border-l bg-background shadow-xl"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation()
            onClose()
          }
        }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="oo-border-divider flex min-w-0 items-center justify-between gap-3 border-b px-3 py-2">
          <div className="min-w-0 truncate text-sm font-medium">{title}</div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t("skills.discoverCloseDetail")}
            onClick={onClose}
          >
            <AppIcons.action.cancel />
          </Button>
        </div>
        <div className="min-h-0 overflow-auto p-3">{children}</div>
      </aside>
    </div>
  )
}

function PublicSkillIcon({ icon }: { icon?: string }) {
  if (isImageIcon(icon)) {
    return (
      <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-background">
        <img alt="" src={icon} className="size-full object-contain p-1.5" />
      </span>
    )
  }

  if (isEmojiIcon(icon)) {
    return (
      <span className="flex size-10 shrink-0 items-center justify-center rounded-md border bg-background text-xl">
        {icon}
      </span>
    )
  }

  return (
    <span className="flex size-10 shrink-0 items-center justify-center rounded-md border bg-background">
      <SkillIcon icon={icon} className="size-5" />
    </span>
  )
}

interface PublicSkillPackageSheetProps {
  groupById: ManagedSkillGroupById
  installingKey: string | null
  locale: string
  onClose: () => void
  onInstall: (pkg: PublicSkillPackage, skillName?: string) => void
  onOpenManagedSkill: (skillName: string) => void
  pkg: PublicSkillPackage
}

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      [
        "a[href]",
        "button:not([disabled])",
        "input:not([disabled])",
        "select:not([disabled])",
        "textarea:not([disabled])",
        "[tabindex]:not([tabindex='-1'])",
      ].join(","),
    ),
  ).filter((element) => !element.hasAttribute("disabled") && element.getAttribute("aria-hidden") !== "true")
}

function PublicSkillPackageSheet({
  groupById,
  installingKey,
  locale,
  onClose,
  onInstall,
  onOpenManagedSkill,
  pkg,
}: PublicSkillPackageSheetProps) {
  const { t } = useAppI18n()
  const sheetRef = React.useRef<HTMLElement | null>(null)

  React.useEffect(() => {
    const previousActiveElement = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const frame = window.requestAnimationFrame(() => {
      sheetRef.current?.focus()
    })

    return () => {
      window.cancelAnimationFrame(frame)
      previousActiveElement?.focus()
    }
  }, [])

  return (
    <div
      className="fixed inset-0 z-50 bg-black/15"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <aside
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label={pkg.displayName}
        tabIndex={-1}
        className="absolute top-0 right-0 grid h-full w-[min(30rem,calc(100vw-2rem))] grid-rows-[auto_minmax(0,1fr)] border-l bg-background shadow-xl"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation()
            onClose()
            return
          }
          if (event.key !== "Tab") {
            return
          }

          const sheet = sheetRef.current
          if (!sheet) {
            return
          }

          const focusableElements = getFocusableElements(sheet)
          if (focusableElements.length === 0) {
            event.preventDefault()
            sheet.focus()
            return
          }

          const firstElement = focusableElements[0]
          const lastElement = focusableElements[focusableElements.length - 1]
          const activeElement = document.activeElement
          if (event.shiftKey) {
            if (activeElement === firstElement || activeElement === sheet || !sheet.contains(activeElement)) {
              event.preventDefault()
              lastElement.focus()
            }
            return
          }

          if (activeElement === lastElement || activeElement === sheet || !sheet.contains(activeElement)) {
            event.preventDefault()
            firstElement.focus()
          }
        }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="oo-border-divider flex min-w-0 items-center justify-between gap-3 border-b px-3 py-2">
          <div className="min-w-0 truncate text-sm font-medium">{pkg.displayName}</div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t("skills.discoverCloseDetail")}
            onClick={onClose}
          >
            <AppIcons.action.cancel />
          </Button>
        </div>
        <div className="min-h-0 overflow-auto p-3">
          <PublicSkillPackageDetail
            groupById={groupById}
            installingKey={installingKey}
            locale={locale}
            pkg={pkg}
            onInstall={onInstall}
            onOpenManagedSkill={onOpenManagedSkill}
          />
        </div>
      </aside>
    </div>
  )
}

interface PublicSkillPackageDetailProps {
  className?: string
  groupById: ManagedSkillGroupById
  installingKey: string | null
  locale: string
  onInstall: (pkg: PublicSkillPackage, skillName?: string) => void
  onOpenManagedSkill: (skillName: string) => void
  pkg: PublicSkillPackage
}

function PublicSkillPackageDetail({
  className,
  groupById,
  installingKey,
  locale,
  onInstall,
  onOpenManagedSkill,
  pkg,
}: PublicSkillPackageDetailProps) {
  const { t } = useAppI18n()
  const updateTime = formatPublicPackageUpdateTime(pkg.updateTime, locale)
  const primarySkill = getPublicPackagePrimarySkill(pkg)
  const primaryInstallSkill = getPublicPackagePrimaryInstallSkill(groupById, pkg)
  const primaryState = getPublicPackageInstallState(groupById, pkg)
  const isInstallingPrimary = installingKey === getPublicSkillInstallKey(pkg, primaryInstallSkill?.name)
  const maintainerLine = getPublicPackageMaintainerLine(pkg, t)

  return (
    <aside className={cn("flex h-full min-h-0 min-w-0 flex-col gap-3 overflow-hidden", className)}>
      <InspectorCard className="shrink-0">
        <CardHeader className="flex-row items-start gap-3 px-3 py-0">
          <PublicSkillIcon icon={pkg.icon} />
          <div className="grid min-w-0 flex-1 gap-1">
            <CardTitle className="min-w-0 truncate text-sm">{pkg.displayName}</CardTitle>
            <CardDescription className="min-w-0 truncate">{pkg.name}</CardDescription>
            <CardDescription className="min-w-0 truncate">{maintainerLine}</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="grid gap-2 px-3">
          <div className="flex min-w-0 flex-wrap items-center gap-1">
            <Badge variant="secondary">{pkg.version}</Badge>
            {pkg.downloadCount === undefined ? null : (
              <Badge variant="outline">{t("skills.discoverDownloads", { count: pkg.downloadCount })}</Badge>
            )}
            {updateTime ? <Badge variant="outline">{updateTime}</Badge> : null}
          </div>
          {pkg.description ? (
            <CardDescription className="min-w-0 break-words text-foreground/80">{pkg.description}</CardDescription>
          ) : null}
          {primarySkill ? (
            <div className="flex min-w-0 flex-wrap gap-1">
              {primaryState === "installed" || primaryState === "name-conflict" ? (
                <Button type="button" variant="outline" size="sm" onClick={() => onOpenManagedSkill(primarySkill.name)}>
                  {t("skills.discoverOpenManage")}
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isInstallingPrimary || !canInstallPublicSkill(primaryState)}
                  onClick={() => onInstall(pkg, primaryInstallSkill?.name)}
                >
                  {isInstallingPrimary ? (
                    <AppIcons.status.loading className="animate-spin" />
                  ) : (
                    <AppIcons.action.installPackage />
                  )}
                  {isInstallingPrimary
                    ? t("skills.registryInstalling")
                    : getPublicSkillInstallActionLabel(primaryState, t)}
                </Button>
              )}
            </div>
          ) : null}
        </CardContent>
      </InspectorCard>

      <InspectorInsetCard className="flex min-h-0 flex-1 flex-col gap-2 px-3 py-3">
        <div className="min-w-0 truncate text-sm font-medium">{t("skills.discoverIncludedSkills")}</div>
        <div className="grid min-h-0 gap-2 overflow-auto">
          {pkg.skills.map((skill) => {
            const state = getPublicSkillInstallState(groupById, pkg, skill.name)
            const installKey = getPublicSkillInstallKey(pkg, skill.name)
            const isInstalling = installingKey === installKey

            return (
              <div key={skill.name} className="grid gap-3 rounded-md border bg-background p-3">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-md border bg-card">
                    <SkillIcon icon={pkg.icon} className="size-5" />
                  </span>
                  <div className="grid min-w-0 flex-1 gap-1">
                    <div className="min-w-0 truncate text-sm font-medium">{skill.title}</div>
                    <CardDescription className="min-w-0 truncate">{skill.name}</CardDescription>
                  </div>
                </div>
                {skill.description ? (
                  <CardDescription className="min-w-0 break-words text-foreground/80">
                    {skill.description}
                  </CardDescription>
                ) : null}
                <div className="oo-border-divider flex min-w-0 items-center justify-between gap-2 border-t pt-2">
                  <Badge variant={state === "installed" ? "secondary" : "outline"}>
                    {getPublicSkillInstallStateLabel(state, t)}
                  </Badge>
                  {state === "installed" || state === "name-conflict" ? (
                    <Button type="button" variant="ghost" size="sm" onClick={() => onOpenManagedSkill(skill.name)}>
                      {t("skills.discoverOpenManage")}
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={isInstalling || !canInstallPublicSkill(state)}
                      onClick={() => onInstall(pkg, skill.name)}
                    >
                      {isInstalling ? <AppIcons.status.loading className="animate-spin" /> : null}
                      {isInstalling ? t("skills.registryInstalling") : getPublicSkillInstallActionLabel(state, t)}
                    </Button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </InspectorInsetCard>
    </aside>
  )
}

function SkillsSyncMenu({
  checkVersions,
  disabled,
  executeCliUpdate,
  isExecutingCliUpdate,
  versionReport,
  versionsRefreshing,
}: SkillsSyncMenuProps) {
  const { t } = useAppI18n()
  const hasCliUpdate = versionReport?.cli.status === "update-available"
  const isBusy = versionsRefreshing || isExecutingCliUpdate

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t("skills.syncMenu")}
              title={t("skills.syncMenu")}
              disabled={disabled}
              className="oo-icon-muted"
            >
              {isBusy ? <AppIcons.status.loading className="animate-spin" /> : <AppIcons.action.refresh />}
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{t("skills.syncMenu")}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuItem
          disabled={disabled || isBusy}
          onSelect={(event) => {
            event.preventDefault()
            checkVersions()
          }}
        >
          {versionsRefreshing ? (
            <AppIcons.status.loading className="animate-spin" />
          ) : (
            <AppIcons.action.checkForUpdates />
          )}
          <span>{versionsRefreshing ? t("skills.checkingVersions") : t("skills.checkVersions")}</span>
        </DropdownMenuItem>
        {hasCliUpdate ? (
          <DropdownMenuItem
            disabled={disabled || isBusy}
            onSelect={(event) => {
              event.preventDefault()
              executeCliUpdate()
            }}
          >
            {isExecutingCliUpdate ? <AppIcons.status.loading className="animate-spin" /> : <AppIcons.action.download />}
            <span>{isExecutingCliUpdate ? t("skills.updatingCli") : t("skills.updateCli")}</span>
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

interface SkillPeekProps {
  copySkillPath: (pathname: string) => void
  installBuiltInSkill: (skillId: BuiltInSkillId) => Promise<void>
  installingBuiltInSkillId: BuiltInSkillId | null
  openSkillFolder: (pathname: string) => void
  planError: string | null
  publishSkill: (skill: ManagedSkillGroup) => Promise<void>
  publishingSkillId: string | null
  selectedSkill: ManagedSkillGroup
  selectedStatus: ReturnType<typeof getGroupStatus>
  selectedVersionCheck?: SkillVersionReport["skills"][number]
  updateRegistrySkill: (skill: Pick<ManagedSkillGroup, "id" | "kind" | "packageName">) => void
  updatingRegistrySkillId: string | null
}

interface BuiltInSkillsPeekProps {
  groups: ManagedSkillGroup[]
  installBuiltInSkill: (skillId: BuiltInSkillId) => Promise<void>
  installingBuiltInSkillId: BuiltInSkillId | null
  status: ReturnType<typeof getBuiltInStatus>
}

function BuiltInSkillsPeek({ groups, installBuiltInSkill, installingBuiltInSkillId, status }: BuiltInSkillsPeekProps) {
  const { t } = useAppI18n()
  const repairableGroups = React.useMemo(() => groups.filter(shouldInstallBuiltInSkill), [groups])
  const coverageLabel = getBuiltInCoverageLabel(groups, t)
  const isRepairing = installingBuiltInSkillId !== null
  const headingRef = useDesktopDetailHeadingFocus<HTMLHeadingElement>(groups.map((group) => group.id).join("|"))

  const repairAll = React.useCallback(async () => {
    for (const group of repairableGroups) {
      await installBuiltInSkill(group.id)
    }
  }, [installBuiltInSkill, repairableGroups])

  return (
    <div className="grid min-w-0 gap-3 overflow-hidden">
      <InspectorCard>
        <CardHeader className="flex-row items-center gap-2 px-3 py-0">
          <CardTitle ref={headingRef} className="min-w-0 truncate text-sm outline-none" tabIndex={-1}>
            {t("skills.builtInGroupTitle")}
          </CardTitle>
          {shouldShowStatusBadge(status.tone) && status.label ? (
            <Badge className={cn("shrink-0", getStatusBadgeClassName(status.tone))} variant={status.badge}>
              {status.label}
            </Badge>
          ) : null}
        </CardHeader>
        <CardContent className="grid gap-2 px-3">
          <CardDescription className="min-w-0 break-words">{t("skills.builtInGroupDescription")}</CardDescription>
          {coverageLabel ? (
            <div className="flex min-w-0 flex-wrap items-center gap-1">
              <Badge variant="outline">{coverageLabel}</Badge>
              <Badge variant="secondary">{t("skills.builtInSkillCount", { count: groups.length })}</Badge>
            </div>
          ) : null}
          {repairableGroups.length > 0 ? (
            <div>
              <Button type="button" variant="outline" size="sm" disabled={isRepairing} onClick={() => void repairAll()}>
                {isRepairing ? <AppIcons.status.loading className="animate-spin" /> : null}
                {isRepairing ? t("skills.installingBuiltIn") : t("skills.repairBuiltInGroup")}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </InspectorCard>

      <ItemGroup className="min-w-0 gap-1">
        {groups.map((group) => {
          const groupStatus = getGroupStatus(group, t)
          const isInstallingBuiltInSkill = installingBuiltInSkillId === group.id
          const canInstallBuiltInSkill = shouldInstallBuiltInSkill(group)
          const design = getBuiltInSkillDesign(group.id, t)
          const coverageLabel = getHostCoverageLabel(group, t)

          return (
            <Item key={group.id} size="sm" className="gap-3 rounded-md border-0 px-3 py-2">
              <ItemMedia className="size-auto gap-2">
                <ObjectStatusIcon tone={groupStatus.tone} />
                <SkillIcon icon={group.icon} />
              </ItemMedia>
              <ItemContent className="min-w-0 gap-0.5">
                <ItemTitle className="max-w-full truncate">{design.name}</ItemTitle>
                <ItemDescription className="max-w-full truncate">{design.role}</ItemDescription>
                <ItemDescription className="line-clamp-2">{design.description}</ItemDescription>
              </ItemContent>
              <ItemActions className="min-w-0 justify-end">
                {coverageLabel ? <Badge variant="outline">{coverageLabel}</Badge> : null}
                {canInstallBuiltInSkill ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={isInstallingBuiltInSkill}
                    onClick={() => void installBuiltInSkill(group.id)}
                  >
                    {isInstallingBuiltInSkill ? <AppIcons.status.loading className="animate-spin" /> : null}
                    {isInstallingBuiltInSkill ? t("skills.installingBuiltIn") : t("skills.installBuiltInShort")}
                  </Button>
                ) : null}
                {shouldShowStatusBadge(groupStatus.tone) && groupStatus.label ? (
                  <Badge
                    className={cn("shrink-0", getStatusBadgeClassName(groupStatus.tone))}
                    variant={groupStatus.badge}
                  >
                    {groupStatus.label}
                  </Badge>
                ) : null}
              </ItemActions>
            </Item>
          )
        })}
      </ItemGroup>
    </div>
  )
}

function SkillPeek({
  copySkillPath,
  installBuiltInSkill,
  installingBuiltInSkillId,
  openSkillFolder,
  planError,
  publishSkill,
  publishingSkillId,
  selectedSkill,
  selectedStatus,
  selectedVersionCheck,
  updateRegistrySkill,
  updatingRegistrySkillId,
}: SkillPeekProps) {
  const { t } = useAppI18n()
  const skillService = useSkillService()
  const runtimeHosts = getRuntimeHosts(selectedSkill)
  const installedHosts = getInstalledSkillHosts(selectedSkill)
  const allHosts = runtimeHosts.length > 0 ? runtimeHosts : installedHosts
  const skillDocumentRootPath = getSkillDocumentRootPath(selectedSkill)
  const canInstallBuiltInSkill = shouldInstallBuiltInSkill(selectedSkill)
  const isInstallingBuiltInSkill = canInstallBuiltInSkill && installingBuiltInSkillId === selectedSkill.id
  const hasPublishedUpdate = hasSkillUpdateAvailable(selectedVersionCheck)
  const canUpdatePublishedSkill = hasPublishedUpdate && shouldUpdatePublishedSkill(selectedSkill)
  const isUpdatingRegistrySkill = updatingRegistrySkillId === selectedSkill.id
  const localPublishPath = getLocalSkillPublishPath(selectedSkill)
  const canPublishLocalSkill = Boolean(localPublishPath)
  const isPublishingSkill = publishingSkillId === selectedSkill.id
  const hostAttentionCount = allHosts.filter(
    (host) => host.controlState === "modified" || host.controlState === "source-missing",
  ).length
  const headingRef = useDesktopDetailHeadingFocus<HTMLHeadingElement>(selectedSkill.id)
  const [isHostDetailsOpen, setIsHostDetailsOpen] = React.useState(false)
  const [skillDocument, setSkillDocument] = React.useState<{ content: string; path: string } | null>(null)
  const [skillDocumentError, setSkillDocumentError] = React.useState<string | null>(null)
  const [isSkillDocumentLoading, setIsSkillDocumentLoading] = React.useState(false)
  const [skillDocumentViewMode, setSkillDocumentViewMode] = React.useState<SkillDocumentViewMode>("preview")
  const hasSourceMissingHost = allHosts.some((host) => host.controlState === "source-missing")
  const hostAttentionTone: ObjectStatusTone = hasSourceMissingHost ? "danger" : "attention"
  const canShowInstallLocations = allHosts.length > 0
  const packageLine = getGroupRowPackageLine(selectedSkill)
  const statusDescription = hasPublishedUpdate
    ? t("skills.versionUpdateAvailable", {
        current: selectedVersionCheck?.currentVersion ?? "",
        latest: selectedVersionCheck?.latestVersion ?? "",
      })
    : packageLine
  const previewDocumentContent = skillDocument ? skillDocumentPreviewSource(skillDocument.content) : ""

  React.useEffect(() => {
    setIsHostDetailsOpen(false)
    setSkillDocumentViewMode("preview")
  }, [selectedSkill.id])

  React.useEffect(() => {
    let cancelled = false

    setSkillDocument(null)
    setSkillDocumentError(null)

    if (!skillDocumentRootPath) {
      setIsSkillDocumentLoading(false)
      return () => {
        cancelled = true
      }
    }

    setIsSkillDocumentLoading(true)
    void skillService
      .invoke("readSkillDocument", { path: skillDocumentRootPath })
      .then((document) => {
        if (!cancelled) {
          setSkillDocument(document)
        }
      })
      .catch((cause) => {
        if (!cancelled) {
          setSkillDocumentError(skillErrorMessage(cause, t))
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsSkillDocumentLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [skillDocumentRootPath, skillService, t])

  const openSkillDocument = React.useCallback(async () => {
    if (!skillDocumentRootPath) {
      return
    }

    try {
      await skillService.invoke("openSkillDocument", { path: skillDocumentRootPath })
    } catch (cause) {
      toast.error(t("skills.openDocumentFailed", { error: skillErrorMessage(cause, t) }))
    }
  }, [skillDocumentRootPath, skillService, t])

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col gap-3 overflow-hidden">
      <InspectorCard className="shrink-0">
        <CardHeader className="grid gap-1 px-3 py-0">
          <CardTitle ref={headingRef} className="min-w-0 truncate text-sm outline-none" tabIndex={-1}>
            {selectedSkill.name}
          </CardTitle>
          {statusDescription ? (
            <CardDescription className="min-w-0 truncate">{statusDescription}</CardDescription>
          ) : null}
        </CardHeader>
        <CardContent className="grid gap-2 px-3">
          <div className="flex min-w-0 flex-wrap items-center gap-1">
            <Badge variant="secondary">{getSkillKindLabel(selectedSkill.kind, t)}</Badge>
            {shouldShowStatusBadge(selectedStatus.tone) && selectedStatus.label ? (
              <Badge
                className={cn("shrink-0", getStatusBadgeClassName(selectedStatus.tone))}
                variant={selectedStatus.badge}
              >
                {selectedStatus.label}
              </Badge>
            ) : null}
            {isPublishableLocalSkill(selectedSkill) ? (
              <Badge className={publishableSkillBadgeClassName} variant="outline">
                {t("skills.publishable")}
              </Badge>
            ) : null}
            {hasPublishedUpdate && canUpdatePublishedSkill ? (
              <SkillUpdateActionBadge
                ariaLabel={t("skills.updateRegistryToVersion", {
                  current: selectedVersionCheck?.currentVersion ?? selectedSkill.version ?? "",
                  latest: selectedVersionCheck?.latestVersion ?? "",
                })}
                isUpdating={isUpdatingRegistrySkill}
                label={t("skills.updateAvailable")}
                updatingLabel={t("skills.updatingRegistry")}
                onClick={() => updateRegistrySkill(selectedSkill)}
              />
            ) : hasPublishedUpdate ? (
              <SkillUpdateBadge label={t("skills.updateAvailable")} />
            ) : null}
            {!packageLine && selectedSkill.version ? <Badge variant="outline">{selectedSkill.version}</Badge> : null}
          </div>
          {selectedSkill.description ? (
            <CardDescription className="min-w-0 break-words text-foreground/80">
              {selectedSkill.description}
            </CardDescription>
          ) : null}
          <div className="flex flex-wrap items-center gap-1">
            {canInstallBuiltInSkill ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isInstallingBuiltInSkill}
                onClick={() => installBuiltInSkill(selectedSkill.id)}
              >
                {isInstallingBuiltInSkill ? <AppIcons.status.loading className="animate-spin" /> : null}
                {isInstallingBuiltInSkill ? t("skills.installingBuiltIn") : t("skills.installBuiltIn")}
              </Button>
            ) : null}
            {canPublishLocalSkill ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isPublishingSkill}
                onClick={() => void publishSkill(selectedSkill)}
              >
                {isPublishingSkill ? <AppIcons.status.loading className="animate-spin" /> : <AppIcons.action.publish />}
                {isPublishingSkill
                  ? t("skills.publishing")
                  : selectedSkill.packageName?.trim()
                    ? t("skills.republishToMarket")
                    : t("skills.publishToMarket")}
              </Button>
            ) : null}
          </div>
        </CardContent>
      </InspectorCard>

      <InspectorInsetCard className="flex min-h-0 flex-1 flex-col gap-2 px-3 py-3">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <div className="min-w-0 truncate text-sm font-medium">{t("skills.documentTitle")}</div>
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
            <ToggleGroup
              type="single"
              variant="default"
              size="sm"
              spacing={0.5}
              className="rounded-md border bg-background/80 p-0.5 shadow-xs"
              value={skillDocumentViewMode}
              onValueChange={(value) => {
                if (value === "preview" || value === "raw") {
                  setSkillDocumentViewMode(value)
                }
              }}
            >
              <ToggleGroupItem
                value="preview"
                className="rounded-sm text-muted-foreground data-[state=on]:bg-card data-[state=on]:text-foreground data-[state=on]:shadow-sm"
              >
                {t("skills.documentPreview")}
              </ToggleGroupItem>
              <ToggleGroupItem
                value="raw"
                className="rounded-sm text-muted-foreground data-[state=on]:bg-card data-[state=on]:text-foreground data-[state=on]:shadow-sm"
              >
                {t("skills.documentRaw")}
              </ToggleGroupItem>
            </ToggleGroup>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!skillDocumentRootPath}
              onClick={() => void openSkillDocument()}
            >
              <AppIcons.action.openExternal />
              {t("skills.openDocument")}
            </Button>
          </div>
        </div>
        <div className="min-h-0 flex-1">
          {isSkillDocumentLoading ? (
            <div className="grid h-full min-h-32 content-start gap-2 rounded-md border bg-background p-2.5">
              <SkeletonText className="w-5/6" />
              <SkeletonText className="w-4/6" />
              <SkeletonText className="w-3/4" />
            </div>
          ) : skillDocumentError ? (
            <ErrorNotice error={resolveUserFacingError(skillDocumentError, { area: "skills" })} compact />
          ) : skillDocument ? (
            <div className="h-full min-h-32 overflow-auto rounded-md border bg-background p-3">
              {skillDocumentViewMode === "preview" ? (
                <MessageResponse className="max-w-none text-sm leading-6 text-foreground/85">
                  {previewDocumentContent}
                </MessageResponse>
              ) : (
                <pre className="font-mono text-xs leading-relaxed break-words whitespace-pre-wrap text-foreground/80">
                  {skillDocument.content}
                </pre>
              )}
            </div>
          ) : (
            <CardDescription className="text-xs">{t("skills.documentUnavailable")}</CardDescription>
          )}
        </div>
      </InspectorInsetCard>

      {hostAttentionCount > 0 ? (
        <InspectorInsetCard
          className={cn(
            "shrink-0 gap-3 px-3 py-3",
            hasSourceMissingHost
              ? "border-[var(--oo-danger-border)] bg-[var(--oo-danger-surface)]"
              : "border-[var(--oo-warning-border)] bg-[var(--oo-warning-surface)]",
          )}
        >
          <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-2">
            <ObjectStatusIcon tone={hostAttentionTone} />
            <div className="grid min-w-0 gap-1">
              <div className="text-xs font-medium">{selectedStatus.label}</div>
              <CardDescription className="text-xs">{selectedStatus.description}</CardDescription>
            </div>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            {localPublishPath ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isPublishingSkill}
                onClick={() => void publishSkill(selectedSkill)}
              >
                {isPublishingSkill ? <AppIcons.status.loading className="animate-spin" /> : null}
                {isPublishingSkill ? t("skills.publishing") : t("skills.publishToMarket")}
              </Button>
            ) : null}
            {canShowInstallLocations ? (
              <Button type="button" variant="outline" size="sm" onClick={() => setIsHostDetailsOpen(true)}>
                {t("skills.installedLocationsAction")}
              </Button>
            ) : null}
          </div>
        </InspectorInsetCard>
      ) : null}

      {hasPublishedUpdate && canUpdatePublishedSkill ? (
        <InspectorInsetCard className="shrink-0 gap-2 border-[var(--oo-warning-border)] bg-[var(--oo-warning-surface)] px-3 py-2">
          <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-2">
            <ObjectStatusIcon tone="attention" />
            <div className="grid min-w-0 gap-1">
              <div className="text-xs font-medium">{t("skills.installedSuggestedActionTitle")}</div>
              <CardDescription className="text-xs">
                {t("skills.installedSuggestedUpdateDescription", {
                  latest: selectedVersionCheck?.latestVersion ?? "",
                })}
              </CardDescription>
            </div>
          </div>
          <div className="flex justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isUpdatingRegistrySkill}
              onClick={() => updateRegistrySkill(selectedSkill)}
            >
              {isUpdatingRegistrySkill ? <AppIcons.status.loading className="animate-spin" /> : null}
              {isUpdatingRegistrySkill ? t("skills.updatingRegistry") : t("skills.updateRegistry")}
            </Button>
          </div>
        </InspectorInsetCard>
      ) : null}

      {isHostDetailsOpen && canShowInstallLocations ? (
        <InspectorInsetCard className="shrink-0 gap-3 px-3 py-3">
          <div className="flex min-w-0 items-start justify-between gap-3">
            <div className="grid min-w-0 gap-1">
              <div className="truncate text-sm font-medium">{t("skills.installedLocationsTitle")}</div>
              <CardDescription className="text-xs">{t("skills.installedLocationsHelper")}</CardDescription>
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => setIsHostDetailsOpen(false)}>
              {t("skills.agentScopeHide")}
            </Button>
          </div>
          <ItemGroup className="min-w-0 gap-1">
            {allHosts.map((host) => {
              const hostStatus = getHostStatus(host, t)
              const hostPath = host.path

              return (
                <Item key={host.agentId} size="sm" className="gap-3 rounded-md border-0 px-2 py-2">
                  <ItemMedia className="size-auto gap-2">
                    <ObjectStatusIcon tone={hostStatus.tone} />
                    <AgentIcon host={host.agentName} />
                  </ItemMedia>
                  <ItemContent className="min-w-0">
                    <ItemTitle className="max-w-full truncate">{host.agentName}</ItemTitle>
                  </ItemContent>
                  <ItemActions className="min-w-0 justify-end gap-1.5">
                    {shouldShowStatusBadge(hostStatus.tone) && (
                      <Badge
                        className={cn("shrink-0", getStatusBadgeClassName(hostStatus.tone))}
                        variant={hostStatus.variant}
                      >
                        {hostStatus.label}
                      </Badge>
                    )}
                    {hostPath ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button type="button" variant="ghost" size="icon" aria-label={t("skills.actions")}>
                            <AppIcons.action.more />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="min-w-48">
                          <DropdownMenuItem onSelect={() => openSkillFolder(hostPath)}>
                            <AppIcons.action.openFolder />
                            <span>{t("skills.openFolder")}</span>
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => copySkillPath(hostPath)}>
                            <AppIcons.action.copy />
                            <span>{t("skills.copyPath")}</span>
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : null}
                  </ItemActions>
                </Item>
              )
            })}
          </ItemGroup>
        </InspectorInsetCard>
      ) : null}

      <SkillErrorNotice error={planError} />
    </div>
  )
}
