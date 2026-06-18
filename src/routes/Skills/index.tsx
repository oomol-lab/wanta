import type {
  BuiltInSkillId,
  LocalSkillProject,
  ManagedSkillGroup,
  ManagedSkillHostCoverage,
  ManagedSkillKind,
  MyPublishedSkill,
  PublicSkillPackage,
  PublicSkillPackageCatalog,
  ShareSkillRequest,
  SkillEditorApp,
  SkillEditorAppId,
  SkillEnablePlan,
  SkillShareInfo,
  SkillInventory,
  SkillRepairPlan,
  SkillSyncDirection,
  SkillShareResult,
  SkillVersionReport,
} from "../../../electron/skills/common.ts"
import type { ObjectStatusTone } from "@/components/ObjectRow"
import type { SkillRemoveTarget } from "@/components/useSkillObjectActions"
import type { MessageKey, TranslateFn as TFunction } from "@/i18n"
import type { SkillShareInfoEntry } from "@/lib/skill-share-info-store"

import * as React from "react"
import { toast } from "sonner"
import { AgentIcon } from "@/components/AgentIcon"
import { useSkillService } from "@/components/AppContext"
import {
  useHomeSummaryResource,
  useAuthStateResource,
  useMyPublishedSkillsResource,
  useSkillInventoryResource,
  useSkillShareInfoStore,
  useSkillVersionReportResource,
} from "@/components/AppDataHooks"
import { AppIcons } from "@/components/AppIcons"
import { InspectorAccordionItem, InspectorCard, InspectorInsetCard } from "@/components/InspectorPanel"
import { ObjectRowSkeletonGroup, SkeletonText } from "@/components/LoadingSkeletons"
import { objectRowLeadingClassName } from "@/components/object-row-styles"
import { ObjectStatusIcon } from "@/components/ObjectRow"
import { SearchField } from "@/components/SearchField"
import { SectionHeading } from "@/components/SectionHeading"
import { DeleteSkillConfirmDialog, SkillActionsMenu } from "@/components/SkillActionsMenu"
import { SkillIcon } from "@/components/SkillIcon"
import { Accordion, AccordionContent, AccordionTrigger } from "@/components/ui/accordion"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
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
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import {
  SplitViewBody,
  SplitViewDesktopDetailPane,
  SplitViewListPane,
  SplitViewMobileDetailPane,
  SplitViewRoot,
} from "@/components/ui/split-view"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useSkillObjectActions } from "@/components/useSkillObjectActions"
import { useAppI18n } from "@/i18n"
import { getPrimarySkillPath } from "@/lib/skill-utils"
import { cn } from "@/lib/utils"

const builtInSelectionKey = "__built-in-skills__"
const localProjectSelectionPrefix = "__local-project__:"
const remotePublishedSkillSelectionPrefix = "__remote-published-skill__:"

type SkillSelectionKey = typeof builtInSelectionKey | string
type SkillPageTab = "discover" | "manage"
type SkillListScope = "all" | "mine" | "oo" | "local"
type SkillPublishFilter = "all" | "private" | "public" | "unpublished"
type SkillPublishState = Exclude<SkillPublishFilter, "all"> | "none" | "unknown"
type SkillSectionKind = "mine" | "ooManaged" | "local"
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

interface SkillSection {
  groups: ManagedSkillGroup[]
  kind: SkillSectionKind
  localProjects?: LocalSkillProject[]
  remoteSkills?: MyPublishedSkill[]
  titleKey: MessageKey
}

const initialPublicPackageCatalogState: PublicPackageCatalogState = {
  error: null,
  items: [],
  next: null,
  requestId: 0,
  selectedId: null,
  status: "idle",
}

const unpublishedSkillShareInfo: SkillShareInfo = {
  limitsRequired: false,
  visibility: "unpublished",
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

function getInstalledHostCount(group: ManagedSkillGroup): number {
  return group.hosts.filter((host) => host.status === "installed").length
}

function getAttentionHostCount(group: ManagedSkillGroup): number {
  return group.hosts.filter((host) => host.controlState === "modified" || host.controlState === "source-missing").length
}

function getMissingHostCount(group: ManagedSkillGroup): number {
  return group.hosts.filter((host) => host.status === "missing").length
}

function normalizeAccountName(name: string | undefined): string | undefined {
  const trimmed = name?.trim()
  return trimmed ? trimmed.replace(/^@/, "").toLowerCase() : undefined
}

function getPackageScope(packageName: string | undefined): string | undefined {
  const trimmed = packageName?.trim()

  if (!trimmed?.startsWith("@")) {
    return undefined
  }

  const scope = trimmed.slice(1).split("/")[0]?.trim()
  return scope ? scope.toLowerCase() : undefined
}

function isCurrentAccountPackage(packageName: string | undefined, accountName: string | undefined): boolean {
  // registry package-info 当前未提供稳定 owner 字段，先按 oo publish 的账号 scope 约定归类“我的发布”。
  const normalizedAccountName = normalizeAccountName(accountName)
  return Boolean(normalizedAccountName && getPackageScope(packageName) === normalizedAccountName)
}

function getGroupPublishState(
  group: ManagedSkillGroup,
  visibilityEntry: SkillShareInfoEntry | undefined,
): SkillPublishState {
  if (visibilityEntry?.info?.visibility) {
    return visibilityEntry.info.visibility
  }

  if (group.kind === "local") {
    return "unpublished"
  }

  if (group.packageName?.trim()) {
    return "unknown"
  }

  return "none"
}

function isMySkillGroup(group: ManagedSkillGroup, accountName: string | undefined): boolean {
  return group.kind === "local" || isCurrentAccountPackage(group.packageName, accountName)
}

function isOoRelatedSkillGroup(group: ManagedSkillGroup): boolean {
  return group.isBuiltIn || group.kind !== "unknown" || Boolean(group.packageName?.trim())
}

function isOoRelatedLocalProject(project: LocalSkillProject): boolean {
  return Boolean(project.packageName?.trim())
}

function isMyLocalProject(project: LocalSkillProject, accountName: string | undefined): boolean {
  const packageName = project.packageName?.trim()
  return isCurrentAccountPackage(packageName, accountName)
}

function getRemotePublishedSkillSelectionKey(skill: MyPublishedSkill): SkillSelectionKey {
  return `${remotePublishedSkillSelectionPrefix}${skill.id}`
}

function getLocalProjectSelectionKey(project: LocalSkillProject): SkillSelectionKey {
  return `${localProjectSelectionPrefix}${project.id}`
}

function getLocalProjectId(selectionKey: SkillSelectionKey | null): string | null {
  return selectionKey?.startsWith(localProjectSelectionPrefix)
    ? selectionKey.slice(localProjectSelectionPrefix.length)
    : null
}

function getRemotePublishedSkillId(selectionKey: SkillSelectionKey | null): string | null {
  return selectionKey?.startsWith(remotePublishedSkillSelectionPrefix)
    ? selectionKey.slice(remotePublishedSkillSelectionPrefix.length)
    : null
}

function getRemotePublishedSkillBaseId(remoteSkillId: string): string {
  const separatorIndex = remoteSkillId.lastIndexOf(":")
  return separatorIndex >= 0 ? remoteSkillId.slice(separatorIndex + 1) : remoteSkillId
}

function matchesRemotePublishedSkillSearch(skill: MyPublishedSkill, normalizedQuery: string): boolean {
  if (!normalizedQuery) {
    return true
  }

  return (
    skill.displayName.toLowerCase().includes(normalizedQuery) ||
    skill.skillId.toLowerCase().includes(normalizedQuery) ||
    skill.packageName.toLowerCase().includes(normalizedQuery) ||
    Boolean(skill.description?.toLowerCase().includes(normalizedQuery))
  )
}

function matchesRemotePublishedSkillScopeFilter(skill: MyPublishedSkill, scopeFilter: SkillListScope): boolean {
  if (skill.installState === "installed") {
    return false
  }

  switch (scopeFilter) {
    case "all":
    case "mine":
      return true
    case "oo":
    case "local":
      return false
  }
}

function isRemotePublishedSkillInstallable(skill: MyPublishedSkill): boolean {
  return skill.installState === "installable"
}

function getRemotePublishedSkillStatusLabel(skill: MyPublishedSkill, t: TFunction): string {
  switch (skill.installState) {
    case "installed":
      return t("skills.installed")
    case "name-conflict":
      return t("skills.remoteNameConflict")
    case "installable":
      return t("skills.notInstalled")
  }
}

function getRemotePublishedSkillConflictDescription(skill: MyPublishedSkill, t: TFunction): string {
  return t("skills.remoteNameConflictDescription", {
    name: skill.conflictingSkill?.name ?? skill.skillId,
  })
}

function getRemotePublishedSkillVisibilityInfo(skill: MyPublishedSkill): SkillShareInfo | undefined {
  if (skill.visibility !== "private" && skill.visibility !== "public") {
    return undefined
  }

  return {
    limitsRequired: skill.visibility === "private",
    packageName: skill.packageName,
    visibility: skill.visibility,
  }
}

function getRemotePublishedSkillPublishState(skill: MyPublishedSkill): SkillPublishState {
  if (skill.visibility === "private" || skill.visibility === "public") {
    return skill.visibility
  }

  return "unknown"
}

function matchesScopeFilter(
  group: ManagedSkillGroup,
  scopeFilter: SkillListScope,
  accountName: string | undefined,
): boolean {
  switch (scopeFilter) {
    case "all":
      return true
    case "mine":
      return isMySkillGroup(group, accountName)
    case "oo":
      return isOoRelatedSkillGroup(group)
    case "local":
      return group.kind === "local" || !isOoRelatedSkillGroup(group)
  }
}

function matchesLocalProjectScopeFilter(
  project: LocalSkillProject,
  scopeFilter: SkillListScope,
  accountName: string | undefined,
): boolean {
  switch (scopeFilter) {
    case "all":
      return true
    case "mine":
      return isMyLocalProject(project, accountName)
    case "oo":
      return isOoRelatedLocalProject(project)
    case "local":
      return true
  }
}

function getGroupSectionKind(group: ManagedSkillGroup, accountName: string | undefined): SkillSectionKind {
  if (isMySkillGroup(group, accountName)) {
    return "mine"
  }

  if (isOoRelatedSkillGroup(group)) {
    return "ooManaged"
  }

  return "local"
}

function getLocalProjectSectionKind(project: LocalSkillProject, accountName: string | undefined): SkillSectionKind {
  if (isMyLocalProject(project, accountName)) {
    return "mine"
  }

  if (isOoRelatedLocalProject(project)) {
    return "ooManaged"
  }

  return "local"
}

function getSectionOrder(scopeFilter: SkillListScope): SkillSectionKind[] {
  switch (scopeFilter) {
    case "all":
    case "local":
      return ["mine", "ooManaged", "local"]
    case "mine":
      return ["mine"]
    case "oo":
      return ["mine", "ooManaged"]
  }
}

function getSectionTitleKey(kind: SkillSectionKind): MessageKey {
  switch (kind) {
    case "mine":
      return "skills.sectionMine"
    case "ooManaged":
      return "skills.sectionOoManaged"
    case "local":
      return "skills.sectionLocal"
  }
}

function matchesPublishFilter(publishState: SkillPublishState, publishFilter: SkillPublishFilter): boolean {
  return publishFilter === "all" || publishState === publishFilter
}

function getPublishFilterButtonLabel(value: SkillPublishFilter, t: TFunction): string {
  switch (value) {
    case "all":
      return t("skills.publishFilterButton.all")
    case "private":
      return t("skills.publishFilterButton.private")
    case "public":
      return t("skills.publishFilterButton.public")
    case "unpublished":
      return t("skills.publishFilterButton.unpublished")
  }
}

function getLocalProjectPublishState(): SkillPublishState {
  return "unpublished"
}

function getFallbackVisibilityInfo(publishState: SkillPublishState | undefined): SkillShareInfo | undefined {
  return publishState === "unpublished" ? unpublishedSkillShareInfo : undefined
}

function getHostCoverageLabel(group: ManagedSkillGroup, t: TFunction): string | undefined {
  const totalHostCount = group.hosts.length

  if (totalHostCount === 0) {
    return undefined
  }

  return t("skills.availableCoverage", { installed: getInstalledHostCount(group), total: totalHostCount })
}

function canEnableSkillForAllAgents(group: ManagedSkillGroup): boolean {
  if (getMissingHostCount(group) === 0) {
    return false
  }

  if (group.isBuiltIn) {
    return true
  }

  if (group.kind === "local") {
    return hasLocalSkillEnableSource(group)
  }

  return group.kind === "registry" && Boolean(group.packageName?.trim())
}

function getEnableAllAgentsUnavailableReason(group: ManagedSkillGroup, t: TFunction): string | undefined {
  if (getMissingHostCount(group) === 0) {
    return undefined
  }

  if (group.isBuiltIn || group.kind === "registry") {
    return undefined
  }

  if (group.kind === "local" && !hasLocalSkillEnableSource(group)) {
    return t("skills.enableAllAgentsNoSourceUnavailable")
  }

  return t("skills.enableAllAgentsUnknownUnavailable")
}

function hasLocalSkillEnableSource(group: ManagedSkillGroup): boolean {
  return group.hosts.some((host) => host.status === "installed" && Boolean(host.path?.trim()))
}

function shouldInstallBuiltInSkill(group: ManagedSkillGroup): group is ManagedSkillGroup & { id: BuiltInSkillId } {
  return group.isBuiltIn && (getMissingHostCount(group) > 0 || getAttentionHostCount(group) > 0)
}

function shouldUpdatePublishedSkill(group: ManagedSkillGroup): boolean {
  return (
    (group.kind === "registry" || group.kind === "local") &&
    Boolean(group.packageName?.trim()) &&
    getInstalledHostCount(group) > 0
  )
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

function getGroupStatus(group: ManagedSkillGroup, t: TFunction) {
  const attentionHostCount = getAttentionHostCount(group)
  const sourceMissingHostCount = group.hosts.filter((host) => host.controlState === "source-missing").length
  const installedHostCount = getInstalledHostCount(group)

  if (attentionHostCount > 0) {
    const isDanger = sourceMissingHostCount > 0
    const tone: ObjectStatusTone = isDanger ? "danger" : "attention"

    return {
      badge: isDanger ? ("destructive" as const) : ("outline" as const),
      description: t("skills.groupStatus.attentionDescription", { count: attentionHostCount }),
      label: t("skills.groupStatus.attention"),
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

function getGroupRowMeta(group: ManagedSkillGroup, t: TFunction): string | undefined {
  const attentionHostCount = getAttentionHostCount(group)
  const installedHostCount = getInstalledHostCount(group)

  if (attentionHostCount > 0) {
    return t("skills.rowAttention", { count: attentionHostCount })
  }

  if (installedHostCount === 0) {
    return t("skills.notInstalled")
  }

  return undefined
}

function getGroupRowKindLine(group: ManagedSkillGroup, t: TFunction): string {
  return getSkillKindLabel(group.kind, t)
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

function getSkillVisibilityLabel(
  info: SkillShareInfo | undefined,
  t: TFunction,
  isLoading = false,
): string | undefined {
  if (isLoading) {
    return t("skills.visibility.checking")
  }

  if (!info) {
    return undefined
  }

  if (info.visibility === "public") {
    return t("skills.visibility.public")
  }

  if (info.visibility === "private") {
    return t("skills.visibility.private")
  }

  return t("skills.visibility.unpublished")
}

function getSkillVisibilityBadgeClassName(info: SkillShareInfo | undefined, isLoading = false): string {
  const baseClassName = "h-6 shrink-0 px-2 text-xs font-medium"

  if (isLoading) {
    return cn(baseClassName, "gap-1.5 border-[var(--oo-frame-border)] bg-muted/40 text-muted-foreground")
  }

  if (info?.visibility === "public") {
    return cn(
      baseClassName,
      "border-[var(--oo-success-border)] bg-[var(--oo-success-surface)] text-[var(--oo-success-foreground)]",
    )
  }

  if (info?.visibility === "private") {
    return cn(baseClassName, "border-[var(--accent-ring)] bg-[var(--accent-soft)] text-[var(--accent-strong)]")
  }

  return cn(baseClassName, "border-[var(--oo-frame-border)] bg-muted/40 text-muted-foreground")
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

interface SkillListRowProps {
  icon: React.ReactNode
  kindLine?: string
  meta?: string
  onClick: () => void
  packageLine?: string
  ooRelated?: boolean
  selected: boolean
  statusTone: ObjectStatusTone
  title: string
  visibilityInfo?: SkillShareInfo
  visibilityLoading?: boolean
  updateAvailable?: boolean
}

const SkillListRow = React.forwardRef<HTMLDivElement, SkillListRowProps>(function SkillListRow(
  {
    icon,
    kindLine,
    meta,
    onClick,
    packageLine,
    ooRelated = false,
    selected,
    statusTone,
    title,
    updateAvailable = false,
    visibilityInfo,
    visibilityLoading,
  },
  ref,
) {
  const { t } = useAppI18n()
  const visibilityLabel = getSkillVisibilityLabel(visibilityInfo, t, visibilityLoading)
  const updateLabel = updateAvailable ? t("skills.updateAvailable") : undefined
  const ooRelatedLabel = ooRelated ? t("skills.ooRelatedTag") : undefined
  const shouldShowStatusIcon = statusTone !== "ready"
  const detailLine = joinSkillMeta([packageLine, kindLine, ooRelatedLabel, visibilityLabel])
  const shouldShowUpdateBadge = Boolean(updateLabel && (!meta || statusTone === "ready"))
  const statusLabel = shouldShowUpdateBadge ? updateLabel : meta

  return (
    <div
      ref={ref}
      className={cn(
        "group grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-stretch rounded-md border-0 text-left transition-colors hover:bg-[var(--oo-row-hover)]",
        selected && "bg-[var(--oo-row-selected)] text-foreground hover:bg-[var(--oo-row-selected)]",
      )}
    >
      <button
        type="button"
        className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-3 rounded-l-md px-3 py-2 text-left outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        onClick={onClick}
      >
        <span className="flex shrink-0 items-start gap-2 pt-0.5">
          {shouldShowStatusIcon ? (
            <span className={objectRowLeadingClassName}>
              <ObjectStatusIcon tone={statusTone} />
            </span>
          ) : null}
          <span className={objectRowLeadingClassName}>{icon}</span>
        </span>

        <span className="grid min-w-0 gap-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 truncate text-sm leading-5 font-medium">{title}</span>
            {statusLabel ? (
              shouldShowUpdateBadge ? (
                <SkillUpdateBadge label={statusLabel} />
              ) : (
                <SkillRowStatusBadge label={statusLabel} tone={statusTone} />
              )
            ) : null}
          </span>
          {detailLine ? (
            <span className="oo-text-caption oo-text-muted min-w-0 truncate" title={detailLine}>
              {detailLine}
            </span>
          ) : null}
        </span>
      </button>

      <span
        className="oo-icon-muted flex size-10 shrink-0 items-center justify-center self-center pr-3"
        aria-hidden="true"
      >
        <span className="oo-icon-muted flex size-6 shrink-0 items-center justify-center" aria-hidden="true">
          <AppIcons.status.navigate className="size-4" />
        </span>
      </span>
    </div>
  )
})

function SkillRowStatusBadge({ label, tone }: { label: string; tone: ObjectStatusTone }) {
  return (
    <Badge className={getSkillRowStatusBadgeClassName(tone)} variant={tone === "danger" ? "destructive" : "outline"}>
      {label}
    </Badge>
  )
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

function OoRelatedBadge({ label }: { label: string }) {
  return (
    <Badge
      className="h-5 shrink-0 border-[var(--accent-ring)] bg-[var(--accent-soft)] px-1.5 text-[11px] leading-none font-medium text-[var(--accent-strong)]"
      variant="outline"
    >
      {label}
    </Badge>
  )
}

function SkillVisibilityBadge({
  info,
  isLoading = false,
  label,
}: {
  info: SkillShareInfo | undefined
  isLoading?: boolean
  label: string
}) {
  return (
    <Badge className={getSkillVisibilityBadgeClassName(info, isLoading)} variant="outline">
      {isLoading ? <AppIcons.status.loading className="size-3 animate-spin" /> : null}
      {label}
    </Badge>
  )
}

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

function getSkillPlanSignature(group: ManagedSkillGroup | undefined): string | null {
  if (!group) {
    return null
  }

  const hostSignature = group.hosts
    .map((host) => {
      return [
        host.agentId,
        host.status,
        host.controlState ?? "",
        host.path ?? "",
        host.sourcePath ?? "",
        host.version ?? "",
      ].join(":")
    })
    .join("|")

  return [group.id, group.kind, group.packageName ?? "", group.version ?? "", hostSignature].join("::")
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

function getBuiltInSubtitle(groups: ManagedSkillGroup[], t: TFunction): string {
  const names = groups.map((group) => group.name).join(", ")
  return names || t("skills.builtIn")
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
  const authStateResource = useAuthStateResource()
  const inventoryResource = useSkillInventoryResource()
  const myPublishedSkillsResource = useMyPublishedSkillsResource()
  const versionResource = useSkillVersionReportResource()
  const homeSummaryResource = useHomeSummaryResource()
  const inventory = inventoryResource.data
  const myPublishedSkills = myPublishedSkillsResource.data?.items ?? []
  const currentAccountName = authStateResource.data?.account?.name
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
  const [discoveryQuery, setDiscoveryQuery] = React.useState("")
  const [scopeFilter, setScopeFilter] = React.useState<SkillListScope>("all")
  const [publishFilter, setPublishFilter] = React.useState<SkillPublishFilter>("all")
  const error = inventoryResource.error
  const [publicPackageCatalog, dispatchPublicPackageCatalog] = React.useReducer(
    publicPackageCatalogReducer,
    initialPublicPackageCatalogState,
  )
  const [installingRegistryResultId, setInstallingRegistryResultId] = React.useState<string | null>(null)
  const [resetPlan, setResetPlan] = React.useState<SkillRepairPlan | null>(null)
  const [sourcePlan, setSourcePlan] = React.useState<SkillRepairPlan | null>(null)
  const [planSkillId, setPlanSkillId] = React.useState<string | null>(null)
  const [planError, setPlanError] = React.useState<string | null>(null)
  const [isPlanLoading, setIsPlanLoading] = React.useState(false)
  const [isResetting, setIsResetting] = React.useState(false)
  const [installingBuiltInSkillId, setInstallingBuiltInSkillId] = React.useState<BuiltInSkillId | null>(null)
  const [updatingRegistrySkillId, setUpdatingRegistrySkillId] = React.useState<string | null>(null)
  const [enablingAllAgentsSkillId, setEnablingAllAgentsSkillId] = React.useState<string | null>(null)
  const [isCheckingVersions, setIsCheckingVersions] = React.useState(false)
  const [isExecutingCliUpdate, setIsExecutingCliUpdate] = React.useState(false)
  const [syncingDirection, setSyncingDirection] = React.useState<SkillSyncDirection | null>(null)
  const [adoptingLocalProjectId, setAdoptingLocalProjectId] = React.useState<string | null>(null)
  const [isResetDialogOpen, setIsResetDialogOpen] = React.useState(false)
  const [activeResetPlan, setActiveResetPlan] = React.useState<SkillRepairPlan | null>(null)
  const [isEnablePlanDialogOpen, setIsEnablePlanDialogOpen] = React.useState(false)
  const [activeEnablePlan, setActiveEnablePlan] = React.useState<SkillEnablePlan | null>(null)
  const [replaceConflictTarget, setReplaceConflictTarget] = React.useState<MyPublishedSkill | null>(null)
  const [replacingRegistryResultId, setReplacingRegistryResultId] = React.useState<string | null>(null)
  const [routeSelectionScrollVersion, setRouteSelectionScrollVersion] = React.useState(0)
  const [narrowPane, setNarrowPane] = React.useState<"detail" | "list">("list")
  const resetInFlightRef = React.useRef(false)
  const installBuiltInInFlightRef = React.useRef(false)
  const updateRegistryInFlightRef = React.useRef(false)
  const enableAllAgentsInFlightRef = React.useRef(false)
  const cliUpdateInFlightRef = React.useRef(false)
  const syncInFlightRef = React.useRef(false)
  const adoptLocalProjectInFlightRef = React.useRef(false)
  const installRegistryInFlightRef = React.useRef(false)
  const replaceRegistryInFlightRef = React.useRef(false)
  const requestedVersionCheckRef = React.useRef(false)
  const pendingRouteSelectionScrollRef = React.useRef(false)
  const publicPackageRequestIdRef = React.useRef(0)
  const selectedSkillRowRef = React.useRef<HTMLDivElement | null>(null)
  const narrowBackButtonRef = React.useRef<HTMLButtonElement | null>(null)
  const handleSkillDeleted = React.useCallback((nextInventory: SkillInventory) => {
    setSelectedSkillId(nextInventory.groups.find((group) => !group.isBuiltIn)?.id ?? builtInSelectionKey)
  }, [])
  const {
    actingSkillKey,
    copySharePrompt,
    copySkillPath,
    isRemovingSkill,
    openSkillFolder,
    openSkillInEditor,
    publishSkill,
    publishSkillPath,
    removeSkill,
    removeTarget,
    setRemoveTarget,
    shareSkill,
    skillEditors,
  } = useSkillObjectActions({ onDeleted: handleSkillDeleted })

  React.useEffect(() => {
    if (!selectedSkillId && (inventory?.groups[0] || inventory?.localProjects[0])) {
      const firstManagedGroup = inventory.groups.find((group) => !group.isBuiltIn)
      const firstRemoteSkill = myPublishedSkills.find((skill) => skill.installState !== "installed")
      const firstLocalProject = inventory.localProjects[0]
      setSelectedSkillId(
        firstManagedGroup?.id ??
          (firstLocalProject ? getLocalProjectSelectionKey(firstLocalProject) : undefined) ??
          (firstRemoteSkill ? getRemotePublishedSkillSelectionKey(firstRemoteSkill) : builtInSelectionKey),
      )
    }
  }, [inventory?.groups, inventory?.localProjects, myPublishedSkills, selectedSkillId])

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

  const searchedLocalProjects = React.useMemo(() => {
    const projects = inventory?.localProjects ?? []
    const normalizedQuery = query.trim().toLowerCase()

    if (!normalizedQuery) {
      return projects
    }

    return projects.filter((project) => {
      return (
        project.name.toLowerCase().includes(normalizedQuery) ||
        project.description.toLowerCase().includes(normalizedQuery) ||
        project.agentName.toLowerCase().includes(normalizedQuery) ||
        Boolean(project.packageName?.toLowerCase().includes(normalizedQuery))
      )
    })
  }, [inventory?.localProjects, query])
  const searchedRemotePublishedSkills = React.useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return myPublishedSkills.filter((skill) => matchesRemotePublishedSkillSearch(skill, normalizedQuery))
  }, [myPublishedSkills, query])

  const visiblePackageNames = React.useMemo(() => {
    return Array.from(
      new Set(
        searchedGroups
          .map((group) => group.packageName?.trim())
          .filter((packageName): packageName is string => Boolean(packageName)),
      ),
    ).sort()
  }, [searchedGroups])
  const skillShareInfoStore = useSkillShareInfoStore()
  const hasPendingVisibility = React.useMemo(() => {
    return visiblePackageNames.some((packageName) => {
      const entry = skillShareInfoStore.snapshot[packageName]
      return !entry?.info
    })
  }, [skillShareInfoStore.snapshot, visiblePackageNames])
  const filteredGroups = React.useMemo(() => {
    return searchedGroups.filter((group) => {
      const packageName = group.packageName?.trim()
      const visibilityEntry = packageName ? skillShareInfoStore.snapshot[packageName] : undefined
      const publishState = getGroupPublishState(group, visibilityEntry)

      return (
        matchesScopeFilter(group, scopeFilter, currentAccountName) && matchesPublishFilter(publishState, publishFilter)
      )
    })
  }, [currentAccountName, publishFilter, scopeFilter, searchedGroups, skillShareInfoStore.snapshot])
  const filteredLocalProjects = React.useMemo(() => {
    if (!matchesPublishFilter(getLocalProjectPublishState(), publishFilter)) {
      return []
    }

    return searchedLocalProjects.filter((project) =>
      matchesLocalProjectScopeFilter(project, scopeFilter, currentAccountName),
    )
  }, [currentAccountName, publishFilter, scopeFilter, searchedLocalProjects])
  const filteredRemotePublishedSkills = React.useMemo(() => {
    return searchedRemotePublishedSkills.filter((skill) => {
      return (
        matchesRemotePublishedSkillScopeFilter(skill, scopeFilter) &&
        matchesPublishFilter(getRemotePublishedSkillPublishState(skill), publishFilter)
      )
    })
  }, [publishFilter, scopeFilter, searchedRemotePublishedSkills])
  const filteredBuiltInGroups = React.useMemo(() => {
    if ((scopeFilter !== "all" && scopeFilter !== "oo") || publishFilter !== "all") {
      return []
    }

    return searchedBuiltInGroups
  }, [publishFilter, scopeFilter, searchedBuiltInGroups])
  const skillSections = React.useMemo<SkillSection[]>(() => {
    const sections = getSectionOrder(scopeFilter).map((kind): SkillSection => {
      return { kind, titleKey: getSectionTitleKey(kind), groups: [], localProjects: [], remoteSkills: [] }
    })
    const sectionByKind = new Map(sections.map((section) => [section.kind, section]))

    for (const group of filteredGroups) {
      const sectionKind = getGroupSectionKind(group, currentAccountName)
      sectionByKind.get(sectionKind)?.groups.push(group)
    }

    for (const project of filteredLocalProjects) {
      const sectionKind = getLocalProjectSectionKind(project, currentAccountName)
      const section = sectionByKind.get(sectionKind)
      if (section) {
        section.localProjects = [...(section.localProjects ?? []), project]
      }
    }

    const mineSection = sectionByKind.get("mine")
    if (mineSection) {
      mineSection.remoteSkills = filteredRemotePublishedSkills
    }

    return sections.filter(
      (section) =>
        section.groups.length > 0 ||
        (section.localProjects?.length ?? 0) > 0 ||
        (section.remoteSkills?.length ?? 0) > 0,
    )
  }, [currentAccountName, filteredGroups, filteredLocalProjects, filteredRemotePublishedSkills, scopeFilter])
  const selectedRemoteSkillId = getRemotePublishedSkillId(selectedSkillId)
  const selectedRemoteSkill = selectedRemoteSkillId
    ? filteredRemotePublishedSkills.find((skill) => skill.id === selectedRemoteSkillId)
    : undefined
  const selectedRemoteFallbackSkill =
    selectedRemoteSkillId && !selectedRemoteSkill
      ? filteredGroups.find((group) => group.id === getRemotePublishedSkillBaseId(selectedRemoteSkillId))
      : undefined
  const selectedLocalProjectId = getLocalProjectId(selectedSkillId)
  const selectedLocalProject = selectedLocalProjectId
    ? filteredLocalProjects.find((project) => project.id === selectedLocalProjectId)
    : undefined
  const selectedSkill =
    selectedSkillId === builtInSelectionKey || selectedRemoteSkill || selectedLocalProject
      ? undefined
      : selectedRemoteFallbackSkill || filteredGroups.find((group) => group.id === selectedSkillId) || filteredGroups[0]
  const isBuiltInSelected =
    selectedSkillId === builtInSelectionKey ||
    (!selectedSkill && !selectedRemoteSkill && !selectedLocalProject && filteredBuiltInGroups.length > 0)
  const builtInStatus = React.useMemo(() => getBuiltInStatus(filteredBuiltInGroups, t), [filteredBuiltInGroups, t])
  const selectedSkillIdForPlan = selectedSkill?.id ?? null
  const selectedSkillPlanSignature = React.useMemo(() => getSkillPlanSignature(selectedSkill), [selectedSkill])
  const selectedStatus = selectedSkill ? getGroupStatus(selectedSkill, t) : null
  const selectedVersionCheck = getSkillVersionCheck(versionCheckByKey, selectedSkill)
  const selectedInstalledHostCount = selectedSkill ? getInstalledHostCount(selectedSkill) : 0
  const selectedResetPlan = planSkillId === selectedSkill?.id ? resetPlan : null
  const selectedSourcePlan = planSkillId === selectedSkill?.id ? sourcePlan : null
  const selectedPlanError = planSkillId === selectedSkill?.id ? planError : null
  const selectedPackageName = selectedSkill?.packageName?.trim()
  const selectedVisibilityEntry = selectedPackageName ? skillShareInfoStore.snapshot[selectedPackageName] : undefined
  const selectedPublishState = selectedSkill ? getGroupPublishState(selectedSkill, selectedVisibilityEntry) : undefined
  const selectedFallbackVisibilityInfo = getFallbackVisibilityInfo(selectedPublishState)
  const selectedVisibilityInfo = selectedVisibilityEntry?.info ?? selectedFallbackVisibilityInfo
  const selectedVisibilityLoading = Boolean(
    selectedPackageName && !selectedVisibilityEntry?.info && !selectedFallbackVisibilityInfo,
  )

  React.useEffect(() => {
    if (!pendingRouteSelectionScrollRef.current || routeSelectionScrollVersion === 0) {
      return
    }

    const frame = window.requestAnimationFrame(() => {
      selectedSkillRowRef.current?.scrollIntoView({ block: "center", inline: "nearest" })
      pendingRouteSelectionScrollRef.current = false
    })

    return () => window.cancelAnimationFrame(frame)
  }, [
    isBuiltInSelected,
    routeSelectionScrollVersion,
    selectedLocalProject?.id,
    selectedRemoteSkill?.id,
    selectedSkill?.id,
  ])

  React.useEffect(() => {
    skillShareInfoStore.ensure(visiblePackageNames)
  }, [skillShareInfoStore, visiblePackageNames])

  React.useEffect(() => {
    if (requestedVersionCheckRef.current) {
      return
    }

    requestedVersionCheckRef.current = true
    void versionResource.refresh({ silent: true }).catch(() => {})
  }, [versionResource])

  React.useEffect(() => {
    if (narrowPane !== "detail") {
      return
    }

    const mediaQuery = window.matchMedia("(max-width: 959px)")
    if (!mediaQuery.matches) {
      return
    }

    window.requestAnimationFrame(() => {
      narrowBackButtonRef.current?.focus()
    })
  }, [narrowPane, selectedSkillId])

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
    setActiveTab("manage")
    setQuery("")
    setScopeFilter("all")
    setPublishFilter("all")
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
        void myPublishedSkillsResource.refresh({ forceRefresh: true, silent: true }).catch(() => undefined)
        toast.success(t("skills.registryInstallDone", { name: targetSkillName }))
      } catch (cause) {
        toast.error(
          t("skills.registryInstallFailed", { error: cause instanceof Error ? cause.message : String(cause) }),
        )
      } finally {
        installRegistryInFlightRef.current = false
        setInstallingRegistryResultId(null)
      }
    },
    [homeSummaryResource, inventoryResource, myPublishedSkillsResource, skillService, t, versionResource],
  )

  React.useEffect(() => {
    if (!selectedSkillIdForPlan) {
      setPlanSkillId(null)
      setResetPlan(null)
      setSourcePlan(null)
      setActiveResetPlan(null)
      setActiveEnablePlan(null)
      setPlanError(null)
      setIsPlanLoading(false)
      return
    }

    let isMounted = true
    const skillId = selectedSkillIdForPlan
    setIsPlanLoading(true)
    setPlanError(null)

    Promise.all([
      skillService.invoke("getSkillRepairPlan", { kind: "reset", skillId }),
      skillService.invoke("getSkillRepairPlan", { kind: "restore-source", skillId }),
    ])
      .then(([nextResetPlan, nextSourcePlan]) => {
        if (!isMounted) {
          return
        }

        setPlanSkillId(skillId)
        setResetPlan(nextResetPlan)
        setSourcePlan(nextSourcePlan)
      })
      .catch((cause) => {
        if (!isMounted) {
          return
        }

        setPlanSkillId(skillId)
        setResetPlan(null)
        setSourcePlan(null)
        setPlanError(cause instanceof Error ? cause.message : String(cause))
      })
      .finally(() => {
        if (isMounted) {
          setIsPlanLoading(false)
        }
      })

    return () => {
      isMounted = false
    }
  }, [selectedSkillIdForPlan, selectedSkillPlanSignature, skillService])

  const executeResetPlan = React.useCallback(async () => {
    if (resetInFlightRef.current || !selectedSkill || !activeResetPlan || activeResetPlan.status !== "ready") {
      return
    }

    resetInFlightRef.current = true
    setIsResetting(true)
    setPlanError(null)

    try {
      await skillService.invoke("executeSkillRepairPlan", {
        agentId: activeResetPlan.targets.length === 1 ? activeResetPlan.targets[0]?.agentId : undefined,
        confirmedPlanId: activeResetPlan.id,
        kind: "reset",
        skillId: selectedSkill.id,
      })
      setIsResetDialogOpen(false)
      setActiveResetPlan(null)
      await inventoryResource.refresh({ forceRefresh: true })
      homeSummaryResource.invalidate()
    } catch (cause) {
      setPlanError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      resetInFlightRef.current = false
      setIsResetting(false)
    }
  }, [activeResetPlan, homeSummaryResource, inventoryResource, selectedSkill, skillService])

  const openResetDialog = React.useCallback(
    async (agentId?: string) => {
      if (!selectedSkill) {
        return
      }

      if (!agentId && selectedResetPlan?.status === "ready") {
        setActiveResetPlan(selectedResetPlan)
        setIsResetDialogOpen(true)
        return
      }

      setPlanError(null)
      setIsPlanLoading(true)

      try {
        const nextPlan = await skillService.invoke("getSkillRepairPlan", {
          agentId,
          kind: "reset",
          skillId: selectedSkill.id,
        })
        setActiveResetPlan(nextPlan)
        setIsResetDialogOpen(true)
      } catch (cause) {
        setPlanError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        setIsPlanLoading(false)
      }
    },
    [selectedResetPlan, selectedSkill, skillService],
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
        const nextInventory = await skillService.invoke(
          skill.kind === "local" ? "installRegistrySkill" : "updateRegistrySkill",
          {
            packageName,
            skillId: skill.id,
          },
        )
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

  const executeEnableSkillForAllAgents = React.useCallback(
    async (skill: ManagedSkillGroup, plan?: SkillEnablePlan) => {
      if (enableAllAgentsInFlightRef.current) {
        return
      }

      const missingHostCount = plan?.targets.length ?? getMissingHostCount(skill)
      if (missingHostCount === 0) {
        toast.success(t("skills.allAgentsEnabled"))
        return
      }

      enableAllAgentsInFlightRef.current = true
      setEnablingAllAgentsSkillId(skill.id)
      setPlanError(null)

      try {
        const nextInventory = await skillService.invoke("enableSkillForAllAgents", {
          confirmedPlanId: plan?.id,
          skillId: skill.id,
          sourceAgentId: plan?.sourceAgentId,
        })
        inventoryResource.setData(nextInventory)
        homeSummaryResource.invalidate()
        setActiveEnablePlan(null)
        setIsEnablePlanDialogOpen(false)
        toast.success(t("skills.enableAllAgentsDone", { count: missingHostCount }))
      } catch (cause) {
        toast.error(
          t("skills.enableAllAgentsFailed", { error: cause instanceof Error ? cause.message : String(cause) }),
        )
      } finally {
        enableAllAgentsInFlightRef.current = false
        setEnablingAllAgentsSkillId(null)
      }
    },
    [homeSummaryResource, inventoryResource, skillService, t],
  )

  const enableSkillForAllAgents = React.useCallback(
    async (skill: ManagedSkillGroup) => {
      if (skill.kind !== "local") {
        await executeEnableSkillForAllAgents(skill)
        return
      }

      if (enableAllAgentsInFlightRef.current) {
        return
      }

      const missingHostCount = getMissingHostCount(skill)
      if (missingHostCount === 0) {
        toast.success(t("skills.allAgentsEnabled"))
        return
      }

      enableAllAgentsInFlightRef.current = true
      setEnablingAllAgentsSkillId(skill.id)
      setPlanError(null)

      try {
        const plan = await skillService.invoke("getSkillEnablePlan", { skillId: skill.id })
        if (plan.status === "not-needed" || plan.targets.length === 0) {
          toast.success(t("skills.allAgentsEnabled"))
          return
        }

        if (plan.status !== "ready") {
          toast.error(t("skills.enableAllAgentsFailed", { error: t("skills.enableAllAgentsUnknownUnavailable") }))
          return
        }

        if (plan.requiresConfirmation) {
          setActiveEnablePlan(plan)
          setIsEnablePlanDialogOpen(true)
          return
        }

        enableAllAgentsInFlightRef.current = false
        setEnablingAllAgentsSkillId(null)
        await executeEnableSkillForAllAgents(skill, plan)
      } catch (cause) {
        toast.error(
          t("skills.enableAllAgentsFailed", { error: cause instanceof Error ? cause.message : String(cause) }),
        )
      } finally {
        enableAllAgentsInFlightRef.current = false
        setEnablingAllAgentsSkillId(null)
      }
    },
    [executeEnableSkillForAllAgents, skillService, t],
  )

  const executeActiveEnablePlan = React.useCallback(async () => {
    if (!activeEnablePlan) {
      return
    }

    const skill = inventoryResource.data?.groups.find((group) => group.id === activeEnablePlan.skillId)
    if (!skill) {
      toast.error(t("skills.enableAllAgentsFailed", { error: t("skills.enableAllAgentsSkillMissing") }))
      return
    }

    await executeEnableSkillForAllAgents(skill, activeEnablePlan)
  }, [activeEnablePlan, executeEnableSkillForAllAgents, inventoryResource.data?.groups, t])

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

  const syncRegistrySkills = React.useCallback(
    async (direction: SkillSyncDirection) => {
      if (syncInFlightRef.current) {
        return
      }

      syncInFlightRef.current = true
      setSyncingDirection(direction)
      setPlanError(null)

      try {
        const result = await skillService.invoke("syncRegistrySkills", { direction })
        inventoryResource.setData(result.inventory)
        homeSummaryResource.invalidate()
        toast.success(t(direction === "apply" ? "skills.syncApplyDone" : "skills.syncUploadDone"))
      } catch (cause) {
        toast.error(t("skills.syncFailed", { error: cause instanceof Error ? cause.message : String(cause) }))
      } finally {
        syncInFlightRef.current = false
        setSyncingDirection(null)
      }
    },
    [homeSummaryResource, inventoryResource, skillService, t],
  )

  const installMyPublishedSkill = React.useCallback(
    async (skill: MyPublishedSkill) => {
      if (installRegistryInFlightRef.current) {
        return
      }

      if (!isRemotePublishedSkillInstallable(skill)) {
        return
      }

      installRegistryInFlightRef.current = true
      setInstallingRegistryResultId(skill.id)

      try {
        const nextInventory = await skillService.invoke("installRegistrySkill", {
          packageName: skill.packageName,
          skillId: skill.skillId,
        })
        inventoryResource.setData(nextInventory)
        setSelectedSkillId(skill.skillId)
        toast.success(t("skills.registryInstallDone", { name: skill.displayName }))
        homeSummaryResource.invalidate()
        void myPublishedSkillsResource.refresh({ forceRefresh: true, silent: true }).catch(() => undefined)
      } catch (cause) {
        toast.error(
          t("skills.registryInstallFailed", { error: cause instanceof Error ? cause.message : String(cause) }),
        )
      } finally {
        installRegistryInFlightRef.current = false
        setInstallingRegistryResultId(null)
      }
    },
    [homeSummaryResource, inventoryResource, myPublishedSkillsResource, skillService, t],
  )

  const openConflictingLocalSkill = React.useCallback(
    (skill: MyPublishedSkill) => {
      const conflictId = skill.conflictingSkill?.id
      const target = conflictId ? inventory?.groups.find((group) => group.id === conflictId) : undefined
      if (!target) {
        toast.error(t("skills.remoteConflictLocalMissing"))
        return
      }

      pendingRouteSelectionScrollRef.current = true
      setRouteSelectionScrollVersion((version) => version + 1)
      setQuery("")
      setScopeFilter("all")
      setPublishFilter("all")
      setSelectedSkillId(target.id)
      setNarrowPane("detail")
    },
    [inventory?.groups, t],
  )

  const replaceConflictingSkill = React.useCallback(
    async (skill: MyPublishedSkill) => {
      if (replaceRegistryInFlightRef.current || skill.installState !== "name-conflict") {
        return
      }

      replaceRegistryInFlightRef.current = true
      setReplacingRegistryResultId(skill.id)

      try {
        const nextInventory = await skillService.invoke("replaceConflictingRegistrySkill", {
          confirmed: true,
          packageName: skill.packageName,
          skillId: skill.skillId,
        })
        inventoryResource.setData(nextInventory)
        setReplaceConflictTarget(null)
        setSelectedSkillId(skill.skillId)
        toast.success(t("skills.remoteReplaceDone", { name: skill.displayName }))
        homeSummaryResource.invalidate()
        void myPublishedSkillsResource.refresh({ forceRefresh: true, silent: true }).catch(() => undefined)
      } catch (cause) {
        toast.error(t("skills.remoteReplaceFailed", { error: cause instanceof Error ? cause.message : String(cause) }))
      } finally {
        replaceRegistryInFlightRef.current = false
        setReplacingRegistryResultId(null)
      }
    },
    [homeSummaryResource, inventoryResource, myPublishedSkillsResource, skillService, t],
  )

  const publishLocalProject = React.useCallback(
    async (project: LocalSkillProject, visibility: "private" | "public") => {
      await publishSkillPath({
        key: `publish-local:${project.id}`,
        path: project.path,
        visibility,
      })
    },
    [publishSkillPath],
  )
  const adoptLocalProject = React.useCallback(
    async (project: LocalSkillProject) => {
      if (adoptLocalProjectInFlightRef.current) {
        return
      }

      adoptLocalProjectInFlightRef.current = true
      setAdoptingLocalProjectId(project.id)

      try {
        const result = await skillService.invoke("adoptLocalSkillProject", {
          agentId: project.agentId,
          path: project.path,
        })
        inventoryResource.setData(result.inventory)
        versionResource.invalidate()
        homeSummaryResource.invalidate()
        setSelectedSkillId(result.skillId)
        toast.success(t("skills.adoptDone", { name: project.name }))
      } catch (cause) {
        toast.error(t("skills.adoptFailed", { error: cause instanceof Error ? cause.message : String(cause) }))
      } finally {
        adoptLocalProjectInFlightRef.current = false
        setAdoptingLocalProjectId(null)
      }
    },
    [homeSummaryResource, inventoryResource, skillService, t, versionResource],
  )
  const isMyPublishedSkillsLoading = myPublishedSkillsResource.isInitialLoading
  const isPublicPackageBusy =
    publicPackageCatalog.status === "loading" ||
    publicPackageCatalog.status === "loading-more" ||
    publicPackageCatalog.status === "refreshing"
  const isPublicPackageLoadingMore = publicPackageCatalog.status === "loading-more"
  const isPublicPackageReplacing =
    publicPackageCatalog.status === "loading" || publicPackageCatalog.status === "refreshing"
  const shouldShowEmptyState =
    !hasPendingVisibility &&
    !isMyPublishedSkillsLoading &&
    skillSections.length === 0 &&
    filteredBuiltInGroups.length === 0
  const detailContentProps: SkillDetailContentProps = {
    actingSkillKey,
    adoptingLocalProjectId,
    adoptLocalProject,
    builtInStatus,
    copySharePrompt,
    copySkillPath,
    enableSkillForAllAgents,
    enablingAllAgentsSkillId,
    filteredBuiltInGroups,
    installBuiltInSkill,
    installingBuiltInSkillId,
    installingRegistryResultId,
    installMyPublishedSkill,
    inventoryInitialLoading: inventoryResource.isInitialLoading,
    isBuiltInSelected,
    isPlanLoading,
    isResetting,
    openConflictingLocalSkill,
    openResetDialog,
    openSkillFolder,
    openSkillInEditor,
    publishLocalProject,
    publishSkill,
    replacingRegistryResultId,
    selectedInstalledHostCount,
    selectedLocalProject,
    selectedPlanError,
    selectedRemoteSkill,
    selectedResetPlan,
    selectedSkill,
    selectedSourcePlan,
    selectedStatus,
    selectedVersionCheck,
    selectedVisibilityInfo,
    selectedVisibilityLoading,
    setRemoveTarget,
    setReplaceConflictTarget,
    shareSkill,
    skillEditors,
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
          isExecutingCliUpdate={isExecutingCliUpdate}
          isDiscoveryLoading={isPublicPackageBusy}
          manageQuery={query}
          onDiscoveryQueryChange={setDiscoveryQuery}
          onDiscoveryRefresh={() => void loadPublicSkillPackages({ forceRefresh: true })}
          onManageQueryChange={setQuery}
          onSync={syncRegistrySkills}
          onTabChange={setActiveTab}
          syncingDirection={syncingDirection}
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
          <SplitViewRoot narrowPane={narrowPane} className="grid-rows-[minmax(0,1fr)]">
            <SplitViewBody desktopLayout="narrow-list">
              <SplitViewListPane narrowPane={narrowPane}>
                <SkillListToolbar
                  publishFilter={publishFilter}
                  scopeFilter={scopeFilter}
                  onPublishFilterChange={setPublishFilter}
                  onScopeFilterChange={setScopeFilter}
                />
                {inventoryResource.isInitialLoading ? (
                  <SkillListSkeleton />
                ) : error && !inventory ? (
                  <div className="oo-error">{error}</div>
                ) : (
                  <div className="grid gap-3">
                    {error && <div className="oo-error">{error}</div>}
                    {myPublishedSkillsResource.error ? (
                      <div className="oo-error">{myPublishedSkillsResource.error}</div>
                    ) : null}
                    {isMyPublishedSkillsLoading ? (
                      <RemotePublishedSkillPendingRow />
                    ) : hasPendingVisibility ? (
                      <SkillStatusPendingRow />
                    ) : shouldShowEmptyState ? (
                      <div className="oo-text-body oo-text-muted">{t("skills.empty")}</div>
                    ) : null}
                    {skillSections.map((section, index) => (
                      <ItemGroup key={section.kind} className={cn("gap-0.5", index > 0 && "border-t pt-3")}>
                        <SectionHeading level="h3">{t(section.titleKey)}</SectionHeading>
                        {section.groups.map((group) => {
                          const groupStatus = getGroupStatus(group, t)
                          const isSelected = group.id === selectedSkill?.id
                          const packageName = group.packageName?.trim()
                          const visibilityEntry = packageName ? skillShareInfoStore.snapshot[packageName] : undefined
                          const publishState = getGroupPublishState(group, visibilityEntry)
                          const fallbackVisibilityInfo = getFallbackVisibilityInfo(publishState)
                          const visibilityInfo = visibilityEntry?.info ?? fallbackVisibilityInfo
                          const visibilityLoading = Boolean(
                            packageName && !visibilityEntry?.info && !fallbackVisibilityInfo,
                          )
                          const versionCheck = getSkillVersionCheck(versionCheckByKey, group)
                          const hasUpdate = hasSkillUpdateAvailable(versionCheck)

                          return (
                            <SkillListRow
                              ref={isSelected ? selectedSkillRowRef : undefined}
                              key={group.id}
                              icon={<SkillIcon icon={group.icon} />}
                              kindLine={getGroupRowKindLine(group, t)}
                              meta={getGroupRowMeta(group, t)}
                              ooRelated={isOoRelatedSkillGroup(group)}
                              packageLine={getGroupRowPackageLine(group)}
                              selected={isSelected}
                              statusTone={groupStatus.tone}
                              title={group.name}
                              updateAvailable={hasUpdate}
                              visibilityInfo={visibilityInfo}
                              visibilityLoading={visibilityLoading}
                              onClick={() => selectSkill(group.id)}
                            />
                          )
                        })}
                        {section.remoteSkills?.map((skill) => {
                          const selectionKey = getRemotePublishedSkillSelectionKey(skill)
                          const isSelected = selectionKey === selectedSkillId
                          const visibilityInfo = getRemotePublishedSkillVisibilityInfo(skill)

                          return (
                            <RemotePublishedSkillRow
                              ref={isSelected ? selectedSkillRowRef : undefined}
                              key={skill.id}
                              selected={isSelected}
                              skill={skill}
                              visibilityInfo={visibilityInfo}
                              onClick={() => selectSkill(selectionKey)}
                            />
                          )
                        })}
                        {section.localProjects?.map((project) => {
                          const selectionKey = getLocalProjectSelectionKey(project)
                          const isSelected = selectionKey === selectedSkillId

                          return (
                            <LocalProjectRow
                              ref={isSelected ? selectedSkillRowRef : undefined}
                              key={project.id}
                              project={project}
                              selected={isSelected}
                              onClick={() => selectSkill(selectionKey)}
                            />
                          )
                        })}
                      </ItemGroup>
                    ))}
                    {filteredBuiltInGroups.length > 0 ? (
                      <ItemGroup className={cn("gap-0.5", skillSections.length > 0 && "border-t pt-3")}>
                        <SectionHeading level="h3">{t("skills.sectionBuiltIn")}</SectionHeading>
                        {filteredBuiltInGroups.length > 0 ? (
                          <>
                            <SkillListRow
                              ref={isBuiltInSelected ? selectedSkillRowRef : undefined}
                              icon={<SkillIcon />}
                              meta={builtInStatus.meta}
                              ooRelated
                              packageLine={getBuiltInSubtitle(filteredBuiltInGroups, t)}
                              selected={isBuiltInSelected}
                              statusTone={builtInStatus.tone}
                              title={t("skills.builtInGroupTitle")}
                              onClick={() => selectSkill(builtInSelectionKey)}
                            />
                          </>
                        ) : null}
                      </ItemGroup>
                    ) : null}
                  </div>
                )}
              </SplitViewListPane>

              <SplitViewMobileDetailPane narrowPane={narrowPane}>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <Button
                    ref={narrowBackButtonRef}
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setNarrowPane("list")}
                  >
                    <AppIcons.action.back />
                    {t("skills.backToSkills")}
                  </Button>
                </div>
                <SkillDetailContent {...detailContentProps} />
              </SplitViewMobileDetailPane>

              <SplitViewDesktopDetailPane>
                <SkillDetailContent {...detailContentProps} />
              </SplitViewDesktopDetailPane>
            </SplitViewBody>
          </SplitViewRoot>
        )}
      </section>
      <ResetConfirmDialog
        executeResetPlan={executeResetPlan}
        isOpen={isResetDialogOpen}
        isResetting={isResetting}
        plan={activeResetPlan}
        setIsOpen={(isOpen) => {
          setIsResetDialogOpen(isOpen)
          if (!isOpen) {
            setActiveResetPlan(null)
          }
        }}
      />
      <EnableSkillPlanConfirmDialog
        executeEnablePlan={executeActiveEnablePlan}
        isExecuting={Boolean(enablingAllAgentsSkillId)}
        isOpen={isEnablePlanDialogOpen}
        plan={activeEnablePlan}
        setIsOpen={(isOpen) => {
          setIsEnablePlanDialogOpen(isOpen)
          if (!isOpen && !enablingAllAgentsSkillId) {
            setActiveEnablePlan(null)
          }
        }}
      />
      <DeleteSkillConfirmDialog
        isRemoving={isRemovingSkill}
        target={removeTarget}
        onConfirm={removeSkill}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            setRemoveTarget(null)
          }
        }}
      />
      <ReplaceRemoteSkillConfirmDialog
        isReplacing={Boolean(replacingRegistryResultId)}
        skill={replaceConflictTarget}
        onConfirm={replaceConflictingSkill}
        onOpenChange={(isOpen) => {
          if (!isOpen && !replacingRegistryResultId) {
            setReplaceConflictTarget(null)
          }
        }}
      />
    </>
  )
}

interface RepairPlanCardProps {
  actionLabel?: string
  emptyText: string
  isExecuting?: boolean
  onExecute?: () => void
  plan: SkillRepairPlan | null
  title: string
}

interface SkillsSyncMenuProps {
  checkVersions: () => void
  disabled: boolean
  executeCliUpdate: () => void
  isExecutingCliUpdate: boolean
  onSync: (direction: SkillSyncDirection) => void
  syncingDirection: SkillSyncDirection | null
  versionReport: SkillVersionReport | null
  versionsRefreshing: boolean
}

interface SkillListToolbarProps {
  onPublishFilterChange: (value: SkillPublishFilter) => void
  onScopeFilterChange: (value: SkillListScope) => void
  publishFilter: SkillPublishFilter
  scopeFilter: SkillListScope
}

interface SkillPublishFilterMenuProps {
  onChange: (value: SkillPublishFilter) => void
  value: SkillPublishFilter
}

function SkillListSkeleton() {
  return (
    <div className="grid gap-3">
      <div className="px-1 py-1">
        <SkeletonText className="h-3.5 w-24" />
      </div>
      <ObjectRowSkeletonGroup count={4} rows={2} />
    </div>
  )
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
  actingSkillKey: string | null
  adoptingLocalProjectId: string | null
  adoptLocalProject: (project: LocalSkillProject) => void
  builtInStatus: ReturnType<typeof getBuiltInStatus>
  copySharePrompt: (prompt: string) => Promise<boolean>
  copySkillPath: (pathname: string) => void
  enableSkillForAllAgents: (skill: ManagedSkillGroup) => Promise<void>
  enablingAllAgentsSkillId: string | null
  filteredBuiltInGroups: ManagedSkillGroup[]
  installBuiltInSkill: (skillId: BuiltInSkillId) => Promise<void>
  installingBuiltInSkillId: BuiltInSkillId | null
  installingRegistryResultId: string | null
  installMyPublishedSkill: (skill: MyPublishedSkill) => Promise<void>
  inventoryInitialLoading: boolean
  isBuiltInSelected: boolean
  isPlanLoading: boolean
  isResetting: boolean
  openConflictingLocalSkill: (skill: MyPublishedSkill) => void
  openResetDialog: (agentId?: string) => void
  openSkillFolder: (pathname: string) => void
  openSkillInEditor: (pathname: string, editorId?: SkillEditorAppId) => void
  publishLocalProject: (project: LocalSkillProject, visibility: "private" | "public") => void
  publishSkill: (skill: ManagedSkillGroup, visibility: "private" | "public") => void
  replacingRegistryResultId: string | null
  selectedInstalledHostCount: number
  selectedLocalProject: LocalSkillProject | undefined
  selectedPlanError: string | null
  selectedRemoteSkill: MyPublishedSkill | undefined
  selectedResetPlan: SkillRepairPlan | null
  selectedSkill: ManagedSkillGroup | undefined
  selectedSourcePlan: SkillRepairPlan | null
  selectedStatus: ReturnType<typeof getGroupStatus> | null
  selectedVersionCheck?: SkillVersionReport["skills"][number]
  selectedVisibilityInfo?: SkillShareInfo
  selectedVisibilityLoading: boolean
  setRemoveTarget: (target: SkillRemoveTarget) => void
  setReplaceConflictTarget: (skill: MyPublishedSkill) => void
  shareSkill: (
    skill: ManagedSkillGroup,
    options?: Omit<ShareSkillRequest, "language" | "skillId">,
  ) => Promise<SkillShareResult | undefined>
  skillEditors: SkillEditorApp[]
  updateRegistrySkill: (skill: Pick<ManagedSkillGroup, "id" | "kind" | "packageName">) => void
  updatingRegistrySkillId: string | null
}

function SkillDetailContent({
  actingSkillKey,
  adoptingLocalProjectId,
  adoptLocalProject,
  builtInStatus,
  copySharePrompt,
  copySkillPath,
  enableSkillForAllAgents,
  enablingAllAgentsSkillId,
  filteredBuiltInGroups,
  installBuiltInSkill,
  installingBuiltInSkillId,
  installingRegistryResultId,
  installMyPublishedSkill,
  inventoryInitialLoading,
  isBuiltInSelected,
  isPlanLoading,
  isResetting,
  openConflictingLocalSkill,
  openResetDialog,
  openSkillFolder,
  openSkillInEditor,
  publishLocalProject,
  publishSkill,
  replacingRegistryResultId,
  selectedInstalledHostCount,
  selectedLocalProject,
  selectedPlanError,
  selectedRemoteSkill,
  selectedResetPlan,
  selectedSkill,
  selectedSourcePlan,
  selectedStatus,
  selectedVersionCheck,
  selectedVisibilityInfo,
  selectedVisibilityLoading,
  setRemoveTarget,
  setReplaceConflictTarget,
  shareSkill,
  skillEditors,
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

  if (selectedRemoteSkill) {
    return (
      <RemotePublishedSkillPeek
        isInstalling={installingRegistryResultId === selectedRemoteSkill.id}
        isReplacing={replacingRegistryResultId === selectedRemoteSkill.id}
        skill={selectedRemoteSkill}
        onInstall={() => installMyPublishedSkill(selectedRemoteSkill)}
        onOpenConflict={() => openConflictingLocalSkill(selectedRemoteSkill)}
        onReplaceConflict={() => setReplaceConflictTarget(selectedRemoteSkill)}
      />
    )
  }

  if (selectedLocalProject) {
    return (
      <LocalProjectPeek
        actingSkillKey={actingSkillKey}
        adoptingLocalProjectId={adoptingLocalProjectId}
        copySkillPath={copySkillPath}
        openSkillFolder={openSkillFolder}
        openSkillInEditor={openSkillInEditor}
        project={selectedLocalProject}
        publishLocalProject={publishLocalProject}
        onAdopt={adoptLocalProject}
      />
    )
  }

  if (selectedSkill && selectedStatus) {
    return (
      <SkillPeek
        installBuiltInSkill={installBuiltInSkill}
        installingBuiltInSkillId={installingBuiltInSkillId}
        actingSkillKey={actingSkillKey}
        copySharePrompt={copySharePrompt}
        copySkillPath={copySkillPath}
        enableSkillForAllAgents={enableSkillForAllAgents}
        enablingAllAgentsSkillId={enablingAllAgentsSkillId}
        isPlanLoading={isPlanLoading}
        isResetting={isResetting}
        openSkillFolder={openSkillFolder}
        openSkillInEditor={openSkillInEditor}
        openResetDialog={openResetDialog}
        planError={selectedPlanError}
        publishSkill={publishSkill}
        resetPlan={selectedResetPlan}
        selectedInstalledHostCount={selectedInstalledHostCount}
        selectedSkill={selectedSkill}
        selectedStatus={selectedStatus}
        selectedVisibilityInfo={selectedVisibilityInfo}
        selectedVisibilityLoading={selectedVisibilityLoading}
        selectedVersionCheck={selectedVersionCheck}
        setRemoveTarget={setRemoveTarget}
        shareSkill={shareSkill}
        skillEditors={skillEditors}
        sourcePlan={selectedSourcePlan}
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
  isDiscoveryLoading: boolean
  manageQuery: string
  onDiscoveryQueryChange: (value: string) => void
  onDiscoveryRefresh: () => void
  onManageQueryChange: (value: string) => void
  onTabChange: (tab: SkillPageTab) => void
}

function SkillPageHeader({
  activeTab,
  checkVersions,
  disabled,
  discoveryQuery,
  executeCliUpdate,
  isExecutingCliUpdate,
  isDiscoveryLoading,
  manageQuery,
  onDiscoveryQueryChange,
  onDiscoveryRefresh,
  onManageQueryChange,
  onSync,
  onTabChange,
  syncingDirection,
  versionReport,
  versionsRefreshing,
}: SkillPageHeaderProps) {
  const { t } = useAppI18n()
  const isDiscoverTab = activeTab === "discover"

  return (
    <header className="oo-border-divider flex min-h-12 items-center gap-3 border-b px-3 py-2">
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        className="shrink-0"
        value={activeTab}
        onValueChange={(value) => {
          if (value === "discover" || value === "manage") {
            onTabChange(value)
          }
        }}
      >
        <ToggleGroupItem value="discover">{t("skills.tab.discover")}</ToggleGroupItem>
        <ToggleGroupItem value="manage">{t("skills.tab.manage")}</ToggleGroupItem>
      </ToggleGroup>
      <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
        <SearchField
          placeholder={t(isDiscoverTab ? "skills.discoverSearch" : "skills.installedSearch")}
          value={isDiscoverTab ? discoveryQuery : manageQuery}
          onChange={(event) => {
            const value = event.currentTarget.value
            if (isDiscoverTab) {
              onDiscoveryQueryChange(value)
            } else {
              onManageQueryChange(value)
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
            syncingDirection={syncingDirection}
            versionReport={versionReport}
            versionsRefreshing={versionsRefreshing}
            onSync={onSync}
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

  return (
    <div className="min-h-0 overflow-auto px-3 py-3">
      <div className="grid gap-3 pr-1">
        {error ? <div className="oo-error">{error}</div> : null}
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
            <Button type="button" variant="outline" size="sm" disabled={isLoadingMore} onClick={onLoadMore}>
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

  return (
    <aside className={cn("grid min-w-0 content-start gap-3", className)}>
      <InspectorCard>
        <CardHeader className="flex-row items-start gap-3 px-3 py-0">
          <PublicSkillIcon icon={pkg.icon} />
          <div className="grid min-w-0 flex-1 gap-1">
            <CardTitle className="min-w-0 truncate text-sm">{pkg.displayName}</CardTitle>
            <CardDescription className="min-w-0 truncate">{pkg.name}</CardDescription>
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

      <InspectorInsetCard className="gap-2 px-3 py-2">
        <div className="text-xs font-medium">{t("skills.discoverIncludedSkills")}</div>
        <ItemGroup className="min-w-0 gap-1">
          {pkg.skills.map((skill) => {
            const state = getPublicSkillInstallState(groupById, pkg, skill.name)
            const installKey = getPublicSkillInstallKey(pkg, skill.name)
            const isInstalling = installingKey === installKey

            return (
              <Item key={skill.name} size="sm" className="gap-3 rounded-md border-0 px-2 py-1.5">
                <ItemMedia className="size-auto">
                  <SkillIcon icon={pkg.icon} />
                </ItemMedia>
                <ItemContent className="min-w-0 gap-0.5">
                  <ItemTitle className="max-w-full truncate text-xs">{skill.title}</ItemTitle>
                  <ItemDescription className="max-w-full truncate text-xs">{skill.name}</ItemDescription>
                  {skill.description ? (
                    <ItemDescription className="line-clamp-2 text-xs">{skill.description}</ItemDescription>
                  ) : null}
                </ItemContent>
                <ItemActions className="min-w-0 justify-end">
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
                </ItemActions>
              </Item>
            )
          })}
        </ItemGroup>
      </InspectorInsetCard>

      <InspectorInsetCard className="gap-2 px-3 py-2">
        <div className="text-xs font-medium">{t("skills.discoverPackageInfo")}</div>
        <div className="grid gap-1 text-xs">
          <div className="flex min-w-0 justify-between gap-3">
            <span className="oo-text-muted">{t("skills.package")}</span>
            <span className="min-w-0 truncate text-right">{pkg.name}</span>
          </div>
          <div className="flex min-w-0 justify-between gap-3">
            <span className="oo-text-muted">{t("skills.discoverMaintainer")}</span>
            <span className="min-w-0 truncate text-right">{getPublicPackageMaintainerLine(pkg, t)}</span>
          </div>
          {updateTime ? (
            <div className="flex min-w-0 justify-between gap-3">
              <span className="oo-text-muted">{t("skills.discoverUpdated")}</span>
              <span className="min-w-0 truncate text-right">{updateTime}</span>
            </div>
          ) : null}
        </div>
      </InspectorInsetCard>
    </aside>
  )
}

function SkillStatusPendingRow() {
  const { t } = useAppI18n()

  return (
    <ItemGroup className="gap-0.5">
      <Item size="sm" className="gap-3 rounded-md border-0 px-3 py-2.5">
        <ItemMedia className="size-auto">
          <AppIcons.status.loading className="oo-icon-muted size-4 animate-spin" />
        </ItemMedia>
        <ItemContent className="min-w-0 gap-0.5">
          <ItemTitle className="max-w-full truncate">{t("skills.visibilityCheckingTitle")}</ItemTitle>
          <ItemDescription className="max-w-full truncate">{t("skills.visibilityCheckingDescription")}</ItemDescription>
        </ItemContent>
      </Item>
    </ItemGroup>
  )
}

function RemotePublishedSkillPendingRow() {
  const { t } = useAppI18n()

  return (
    <ItemGroup className="gap-0.5">
      <Item size="sm" className="gap-3 rounded-md border-0 px-3 py-2.5">
        <ItemMedia className="size-auto">
          <AppIcons.status.loading className="oo-icon-muted size-4 animate-spin" />
        </ItemMedia>
        <ItemContent className="min-w-0 gap-0.5">
          <ItemTitle className="max-w-full truncate">{t("skills.remoteLoadingTitle")}</ItemTitle>
          <ItemDescription className="max-w-full truncate">{t("skills.remoteLoadingDescription")}</ItemDescription>
        </ItemContent>
      </Item>
    </ItemGroup>
  )
}

function SkillListToolbar({
  onPublishFilterChange,
  onScopeFilterChange,
  publishFilter,
  scopeFilter,
}: SkillListToolbarProps) {
  const { t } = useAppI18n()

  return (
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 pt-3 pb-2">
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        className="max-w-full flex-wrap"
        value={scopeFilter}
        onValueChange={(value) => {
          if (value) {
            onScopeFilterChange(value as SkillListScope)
          }
        }}
      >
        <ToggleGroupItem value="all">{t("skills.scope.all")}</ToggleGroupItem>
        <ToggleGroupItem value="mine">{t("skills.scope.mine")}</ToggleGroupItem>
        <ToggleGroupItem value="oo">{t("skills.scope.oo")}</ToggleGroupItem>
        <ToggleGroupItem value="local">{t("skills.scope.local")}</ToggleGroupItem>
      </ToggleGroup>
      <SkillPublishFilterMenu value={publishFilter} onChange={onPublishFilterChange} />
    </div>
  )
}

function SkillPublishFilterMenu({ onChange, value }: SkillPublishFilterMenuProps) {
  const { t } = useAppI18n()

  return (
    <Select value={value} onValueChange={(nextValue) => onChange(nextValue as SkillPublishFilter)}>
      <SelectTrigger size="sm">
        <AppIcons.action.settings />
        <SelectValue>{getPublishFilterButtonLabel(value, t)}</SelectValue>
      </SelectTrigger>
      <SelectContent align="end" className="min-w-40">
        <SelectGroup>
          <SelectLabel>{t("skills.publishFilterLabel")}</SelectLabel>
          <SelectItem value="all">{t("skills.publishFilter.all")}</SelectItem>
          <SelectItem value="public">{t("skills.publishFilter.public")}</SelectItem>
          <SelectItem value="private">{t("skills.publishFilter.private")}</SelectItem>
          <SelectItem value="unpublished">{t("skills.publishFilter.unpublished")}</SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

interface RemotePublishedSkillRowProps {
  onClick: () => void
  selected: boolean
  skill: MyPublishedSkill
  visibilityInfo?: SkillShareInfo
}

const RemotePublishedSkillRow = React.forwardRef<HTMLDivElement, RemotePublishedSkillRowProps>(
  function RemotePublishedSkillRow({ onClick, selected, skill, visibilityInfo }, ref) {
    const { t } = useAppI18n()
    const versionLabel = skill.packageVersion === "latest" ? undefined : skill.packageVersion
    const statusLabel = getRemotePublishedSkillStatusLabel(skill, t)
    const statusTone: ObjectStatusTone = skill.installState === "name-conflict" ? "attention" : "pending"
    const visibilityLabel = visibilityInfo ? getSkillVisibilityLabel(visibilityInfo, t) : undefined
    const packageLine = joinSkillMeta([skill.packageName, versionLabel])
    const detailLine = joinSkillMeta([
      packageLine,
      t("skills.remotePublished"),
      t("skills.ooRelatedTag"),
      visibilityLabel,
    ])

    return (
      <div
        ref={ref}
        className={cn(
          "group grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-stretch rounded-md border-0 text-left transition-colors hover:bg-[var(--oo-row-hover)]",
          selected && "bg-[var(--oo-row-selected)] text-foreground hover:bg-[var(--oo-row-selected)]",
        )}
      >
        <button
          type="button"
          className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-3 rounded-l-md px-3 py-2 text-left outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          onClick={onClick}
        >
          <span className="flex shrink-0 items-start gap-2 pt-0.5">
            <span className={objectRowLeadingClassName}>
              <ObjectStatusIcon tone={statusTone} />
            </span>
            <span className={objectRowLeadingClassName}>
              <SkillIcon icon={skill.icon} />
            </span>
          </span>
          <span className="grid min-w-0 gap-1">
            <span className="flex min-w-0 items-center gap-2">
              <span className="min-w-0 truncate text-sm leading-5 font-medium">{skill.displayName}</span>
              <SkillRowStatusBadge label={statusLabel} tone={statusTone} />
            </span>
            {detailLine ? (
              <span className="oo-text-caption oo-text-muted min-w-0 truncate" title={detailLine}>
                {detailLine}
              </span>
            ) : null}
          </span>
        </button>
        <span
          className="oo-icon-muted flex size-10 shrink-0 items-center justify-center self-center pr-3"
          aria-hidden="true"
        >
          <AppIcons.status.navigate className="size-4" />
        </span>
      </div>
    )
  },
)

function SkillsSyncMenu({
  checkVersions,
  disabled,
  executeCliUpdate,
  isExecutingCliUpdate,
  onSync,
  syncingDirection,
  versionReport,
  versionsRefreshing,
}: SkillsSyncMenuProps) {
  const { t } = useAppI18n()
  const isSyncing = syncingDirection !== null
  const hasCliUpdate = versionReport?.cli.status === "update-available"
  const isBusy = versionsRefreshing || isExecutingCliUpdate || isSyncing

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
        <DropdownMenuItem
          disabled={disabled || isBusy}
          onSelect={(event) => {
            event.preventDefault()
            onSync("apply")
          }}
        >
          {syncingDirection === "apply" ? (
            <AppIcons.status.loading className="animate-spin" />
          ) : (
            <AppIcons.action.syncFromCloud />
          )}
          <span>{syncingDirection === "apply" ? t("skills.syncing") : t("skills.syncApply")}</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={disabled || isBusy}
          onSelect={(event) => {
            event.preventDefault()
            onSync("upload")
          }}
        >
          {syncingDirection === "upload" ? (
            <AppIcons.status.loading className="animate-spin" />
          ) : (
            <AppIcons.action.syncToCloud />
          )}
          <span>{syncingDirection === "upload" ? t("skills.syncing") : t("skills.syncUpload")}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

interface LocalProjectRowProps {
  onClick: () => void
  project: LocalSkillProject
  selected: boolean
}

const LocalProjectRow = React.forwardRef<HTMLDivElement, LocalProjectRowProps>(function LocalProjectRow(
  { onClick, project, selected },
  ref,
) {
  const { t } = useAppI18n()
  const kindLabel = t("skills.kind.local")
  const ooRelatedLabel = isOoRelatedLocalProject(project) ? t("skills.ooRelatedTag") : undefined
  const detailLine = joinSkillMeta([project.agentName, kindLabel, ooRelatedLabel, t("skills.visibility.unpublished")])

  return (
    <div
      ref={ref}
      className={cn(
        "group grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-stretch rounded-md border-0 text-left transition-colors hover:bg-[var(--oo-row-hover)]",
        selected && "bg-[var(--oo-row-selected)] text-foreground hover:bg-[var(--oo-row-selected)]",
      )}
    >
      <button
        type="button"
        className="grid min-w-0 flex-1 grid-cols-[auto_minmax(0,1fr)] items-start gap-3 rounded-l-md px-3 py-2 text-left outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        onClick={onClick}
      >
        <span className={objectRowLeadingClassName}>
          <SkillIcon fallback={AppIcons.object.localProject} icon={project.icon} />
        </span>
        <span className="grid min-w-0 gap-1">
          <span className="min-w-0 truncate text-sm leading-5 font-medium">{project.name}</span>
          <span className="oo-text-caption oo-text-muted line-clamp-1">{project.description}</span>
          {detailLine ? (
            <span className="oo-text-caption oo-text-muted max-w-full min-w-0 truncate" title={detailLine}>
              {detailLine}
            </span>
          ) : null}
        </span>
      </button>
      <span
        className="oo-icon-muted flex size-10 shrink-0 items-center justify-center self-center pr-3"
        aria-hidden="true"
      >
        <AppIcons.status.navigate className="size-4" />
      </span>
    </div>
  )
})

interface SkillPeekProps {
  actingSkillKey: string | null
  copySharePrompt: (prompt: string) => Promise<boolean>
  copySkillPath: (pathname: string) => void
  enableSkillForAllAgents: (skill: ManagedSkillGroup) => Promise<void>
  enablingAllAgentsSkillId: string | null
  installBuiltInSkill: (skillId: BuiltInSkillId) => Promise<void>
  installingBuiltInSkillId: BuiltInSkillId | null
  isPlanLoading: boolean
  isResetting: boolean
  openSkillFolder: (pathname: string) => void
  openSkillInEditor: (pathname: string, editorId?: SkillEditorAppId) => void
  openResetDialog: (agentId?: string) => void
  planError: string | null
  publishSkill: (skill: ManagedSkillGroup, visibility: "private" | "public") => void
  resetPlan: SkillRepairPlan | null
  selectedInstalledHostCount: number
  selectedSkill: ManagedSkillGroup
  selectedStatus: ReturnType<typeof getGroupStatus>
  selectedVisibilityInfo?: SkillShareInfo
  selectedVisibilityLoading: boolean
  selectedVersionCheck?: SkillVersionReport["skills"][number]
  setRemoveTarget: (target: SkillRemoveTarget) => void
  shareSkill: (
    skill: ManagedSkillGroup,
    options?: Omit<ShareSkillRequest, "language" | "skillId">,
  ) => Promise<SkillShareResult | undefined>
  skillEditors: SkillEditorApp[]
  sourcePlan: SkillRepairPlan | null
  updateRegistrySkill: (skill: Pick<ManagedSkillGroup, "id" | "kind" | "packageName">) => void
  updatingRegistrySkillId: string | null
}

interface BuiltInSkillsPeekProps {
  groups: ManagedSkillGroup[]
  installBuiltInSkill: (skillId: BuiltInSkillId) => Promise<void>
  installingBuiltInSkillId: BuiltInSkillId | null
  status: ReturnType<typeof getBuiltInStatus>
}

interface RemotePublishedSkillPeekProps {
  isInstalling: boolean
  isReplacing: boolean
  onInstall: () => void
  onOpenConflict: () => void
  onReplaceConflict: () => void
  skill: MyPublishedSkill
}

interface LocalProjectPeekProps {
  actingSkillKey: string | null
  adoptingLocalProjectId: string | null
  copySkillPath: (pathname: string) => void
  onAdopt: (project: LocalSkillProject) => void
  openSkillFolder: (pathname: string) => void
  openSkillInEditor: (pathname: string) => void
  project: LocalSkillProject
  publishLocalProject: (project: LocalSkillProject, visibility: "private" | "public") => void
}

function LocalProjectPeek({
  actingSkillKey,
  adoptingLocalProjectId,
  copySkillPath,
  onAdopt,
  openSkillFolder,
  openSkillInEditor,
  project,
  publishLocalProject,
}: LocalProjectPeekProps) {
  const { t } = useAppI18n()
  const headingRef = useDesktopDetailHeadingFocus<HTMLHeadingElement>(project.id)
  const isAdopting = adoptingLocalProjectId === project.id
  const isPublishing = actingSkillKey === `publish-local:${project.id}`
  const ooRelatedLabel = isOoRelatedLocalProject(project) ? t("skills.ooRelatedTag") : undefined

  return (
    <div className="grid min-w-0 gap-3 overflow-hidden">
      <InspectorCard>
        <CardHeader className="flex-row items-center gap-2 px-3 py-0">
          <CardTitle ref={headingRef} className="min-w-0 truncate text-sm outline-none" tabIndex={-1}>
            {project.name}
          </CardTitle>
          <Badge variant="outline">{t("skills.localProjectUnmanaged")}</Badge>
        </CardHeader>
        <CardContent className="grid gap-2 px-3">
          <CardDescription className="min-w-0 truncate">{project.agentName}</CardDescription>
          <div className="flex min-w-0 flex-wrap items-center gap-1">
            {ooRelatedLabel ? <OoRelatedBadge label={ooRelatedLabel} /> : null}
            <Badge variant="secondary">{t("skills.kind.local")}</Badge>
            <Badge variant="outline">{t("skills.visibility.unpublished")}</Badge>
          </div>
          <CardDescription className="min-w-0 break-words text-foreground/80">{project.description}</CardDescription>
          <div className="flex min-w-0 flex-wrap items-center gap-1">
            <Button type="button" variant="outline" size="sm" disabled={isAdopting} onClick={() => onAdopt(project)}>
              {isAdopting ? <AppIcons.status.loading className="animate-spin" /> : <AppIcons.action.installPackage />}
              {isAdopting ? t("skills.adopting") : t("skills.adopt")}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => openSkillInEditor(project.path)}>
              <AppIcons.action.openExternal />
              {t("skills.openEditor")}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="ghost" size="icon" aria-label={t("skills.actions")}>
                  <AppIcons.action.more />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-48">
                <DropdownMenuItem onSelect={() => openSkillFolder(project.path)}>
                  <AppIcons.action.openFolder />
                  <span>{t("skills.openFolder")}</span>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => copySkillPath(project.path)}>
                  <AppIcons.action.copy />
                  <span>{t("skills.copyPath")}</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={isPublishing}
                  onSelect={(event) => {
                    event.preventDefault()
                    publishLocalProject(project, "private")
                  }}
                >
                  {isPublishing ? <AppIcons.status.loading className="animate-spin" /> : <AppIcons.action.publish />}
                  <span>{t("skills.publishPrivate")}</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={isPublishing}
                  onSelect={(event) => {
                    event.preventDefault()
                    publishLocalProject(project, "public")
                  }}
                >
                  {isPublishing ? <AppIcons.status.loading className="animate-spin" /> : <AppIcons.action.publish />}
                  <span>{t("skills.publishPublic")}</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </CardContent>
      </InspectorCard>

      <InspectorInsetCard className="gap-1 px-3 py-2">
        <div className="text-xs font-medium">{t("skills.adoptTitle")}</div>
        <CardDescription className="text-xs">{t("skills.adoptDescription")}</CardDescription>
        <ItemGroup className="mt-2 gap-1">
          <Item size="sm" className="grid gap-1 rounded-sm border-0 bg-[var(--oo-surface-raised)] px-2 py-1.5">
            <ItemTitle className="text-xs">{t("skills.shareAgent")}</ItemTitle>
            <ItemDescription className="min-w-0 truncate text-xs">{project.agentName}</ItemDescription>
          </Item>
          <Item size="sm" className="grid gap-1 rounded-sm border-0 bg-[var(--oo-surface-raised)] px-2 py-1.5">
            <ItemTitle className="text-xs">{t("skills.path")}</ItemTitle>
            <ItemDescription className="min-w-0 truncate text-xs">{project.path}</ItemDescription>
          </Item>
        </ItemGroup>
      </InspectorInsetCard>
    </div>
  )
}

function RemotePublishedSkillPeek({
  isInstalling,
  isReplacing,
  onInstall,
  onOpenConflict,
  onReplaceConflict,
  skill,
}: RemotePublishedSkillPeekProps) {
  const { t } = useAppI18n()
  const visibilityInfo = getRemotePublishedSkillVisibilityInfo(skill)
  const headingRef = useDesktopDetailHeadingFocus<HTMLHeadingElement>(skill.id)
  const canInstall = isRemotePublishedSkillInstallable(skill)
  const statusLabel = getRemotePublishedSkillStatusLabel(skill, t)
  const conflict = skill.conflictingSkill
  const conflictCoverageLabel = conflict
    ? t("skills.availableCoverage", { installed: conflict.installedHosts, total: conflict.totalHosts })
    : undefined

  return (
    <div className="grid min-w-0 gap-3 overflow-hidden">
      <InspectorCard>
        <CardHeader className="flex-row items-center gap-2 px-3 py-0">
          <CardTitle ref={headingRef} className="min-w-0 truncate text-sm outline-none" tabIndex={-1}>
            {skill.displayName}
          </CardTitle>
          <Badge variant="outline">{statusLabel}</Badge>
        </CardHeader>
        <CardContent className="grid gap-2 px-3">
          <CardDescription className="min-w-0 truncate">
            {skill.packageName}
            {skill.packageVersion ? ` · ${skill.packageVersion}` : ""}
          </CardDescription>
          <div className="flex min-w-0 flex-wrap items-center gap-1">
            <OoRelatedBadge label={t("skills.ooRelatedTag")} />
            <Badge variant="secondary">{t("skills.remotePublished")}</Badge>
            {visibilityInfo ? (
              <SkillVisibilityBadge info={visibilityInfo} label={getSkillVisibilityLabel(visibilityInfo, t) ?? ""} />
            ) : null}
            {skill.installedVersion ? <Badge variant="outline">{skill.installedVersion}</Badge> : null}
          </div>
          {skill.description ? (
            <CardDescription className="min-w-0 break-words text-foreground/80">{skill.description}</CardDescription>
          ) : null}
          {canInstall ? (
            <div>
              <Button type="button" variant="outline" size="sm" disabled={isInstalling} onClick={onInstall}>
                {isInstalling ? (
                  <AppIcons.status.loading className="animate-spin" />
                ) : (
                  <AppIcons.action.installPackage />
                )}
                {isInstalling ? t("skills.registryInstalling") : t("skills.registryInstall")}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </InspectorCard>

      <InspectorInsetCard className="gap-1 px-3 py-2">
        <div className="text-xs font-medium">
          {canInstall ? t("skills.remoteInstallTitle") : t("skills.remoteNameConflictTitle")}
        </div>
        <CardDescription className="text-xs">
          {canInstall ? t("skills.remoteInstallDescription") : getRemotePublishedSkillConflictDescription(skill, t)}
        </CardDescription>
        {skill.installState === "name-conflict" ? (
          <>
            <ItemGroup className="mt-2 gap-1">
              <Item size="sm" className="grid gap-1 rounded-sm border-0 bg-[var(--oo-surface-raised)] px-2 py-1.5">
                <ItemTitle className="text-xs">{t("skills.remoteConflictLocal")}</ItemTitle>
                <ItemDescription className="text-xs">
                  {conflict?.name ?? skill.skillId}
                  {conflictCoverageLabel ? ` · ${conflictCoverageLabel}` : ""}
                </ItemDescription>
              </Item>
              <Item size="sm" className="grid gap-1 rounded-sm border-0 bg-[var(--oo-surface-raised)] px-2 py-1.5">
                <ItemTitle className="text-xs">{t("skills.remoteConflictCloud")}</ItemTitle>
                <ItemDescription className="text-xs">
                  {skill.packageName}
                  {skill.packageVersion ? ` · ${skill.packageVersion}` : ""}
                </ItemDescription>
              </Item>
            </ItemGroup>
            <div className="mt-2 flex min-w-0 flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={onOpenConflict}>
                <AppIcons.action.openExternal />
                {t("skills.remoteOpenLocalSkill")}
              </Button>
              <Button type="button" variant="destructive" size="sm" disabled={isReplacing} onClick={onReplaceConflict}>
                {isReplacing ? (
                  <AppIcons.status.loading className="animate-spin" />
                ) : (
                  <AppIcons.action.installPackage />
                )}
                {isReplacing ? t("skills.remoteReplacing") : t("skills.remoteReplaceWithCloud")}
              </Button>
            </div>
          </>
        ) : null}
      </InspectorInsetCard>
    </div>
  )
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
  actingSkillKey,
  copySharePrompt,
  copySkillPath,
  enableSkillForAllAgents,
  enablingAllAgentsSkillId,
  installBuiltInSkill,
  installingBuiltInSkillId,
  isPlanLoading,
  isResetting,
  openSkillFolder,
  openSkillInEditor,
  openResetDialog,
  planError,
  publishSkill,
  resetPlan,
  selectedInstalledHostCount,
  selectedSkill,
  selectedStatus,
  selectedVisibilityInfo,
  selectedVisibilityLoading,
  selectedVersionCheck,
  setRemoveTarget,
  shareSkill,
  skillEditors,
  sourcePlan,
  updateRegistrySkill,
  updatingRegistrySkillId,
}: SkillPeekProps) {
  const { t } = useAppI18n()
  const allHosts = selectedSkill.hosts
  const hasReadyRepairPlan = resetPlan?.status === "ready" || sourcePlan?.status === "ready"
  const canInstallBuiltInSkill = shouldInstallBuiltInSkill(selectedSkill)
  const isInstallingBuiltInSkill = canInstallBuiltInSkill && installingBuiltInSkillId === selectedSkill.id
  const isEnablingAllAgents = enablingAllAgentsSkillId === selectedSkill.id
  const missingHostCount = getMissingHostCount(selectedSkill)
  const canEnableAllAgents = canEnableSkillForAllAgents(selectedSkill)
  const enableAllAgentsUnavailableReason = getEnableAllAgentsUnavailableReason(selectedSkill, t)
  const hasPublishedUpdate = hasSkillUpdateAvailable(selectedVersionCheck)
  const canRestorePublishedSkill =
    shouldUpdatePublishedSkill(selectedSkill) && (!selectedVersionCheck || hasPublishedUpdate)
  const canUpdatePublishedSkill = hasPublishedUpdate && shouldUpdatePublishedSkill(selectedSkill)
  const isUpdatingRegistrySkill = updatingRegistrySkillId === selectedSkill.id
  const canExecuteSourcePlan = sourcePlan?.status === "ready" && (canInstallBuiltInSkill || canRestorePublishedSkill)
  const isExecutingSourcePlan = isInstallingBuiltInSkill || isUpdatingRegistrySkill
  const executeSourcePlan = canInstallBuiltInSkill
    ? () => installBuiltInSkill(selectedSkill.id)
    : canRestorePublishedSkill
      ? () => updateRegistrySkill(selectedSkill)
      : undefined
  const primaryPath = getPrimarySkillPath(selectedSkill)
  const canDeleteSkill = !selectedSkill.isBuiltIn && selectedInstalledHostCount > 0
  const canPublishSkill = selectedSkill.kind === "local" && selectedInstalledHostCount > 0 && !selectedVisibilityLoading
  const canShareSkill = !selectedSkill.isBuiltIn && selectedInstalledHostCount > 0
  const hostAttentionCount = allHosts.filter(
    (host) => host.controlState === "modified" || host.controlState === "source-missing",
  ).length
  const selectedCoverageLabel = getHostCoverageLabel(selectedSkill, t)
  const ooRelatedLabel = isOoRelatedSkillGroup(selectedSkill) ? t("skills.ooRelatedTag") : undefined
  const headingRef = useDesktopDetailHeadingFocus<HTMLHeadingElement>(selectedSkill.id)
  const [isHostDetailsOpen, setIsHostDetailsOpen] = React.useState(false)
  const hasSourceMissingHost = allHosts.some((host) => host.controlState === "source-missing")
  const hostAttentionTone: ObjectStatusTone = hasSourceMissingHost ? "danger" : "attention"
  const hostAttentionBadgeVariant = hasSourceMissingHost ? ("destructive" as const) : ("outline" as const)
  const hostScopeDescription =
    allHosts.length === 0
      ? t("skills.agentScopeEmpty")
      : missingHostCount === 0
        ? t("skills.allAgentsEnabled")
        : t("skills.agentScopeSummary", {
            installed: selectedInstalledHostCount,
            total: allHosts.length,
          })

  React.useEffect(() => {
    setIsHostDetailsOpen(false)
  }, [selectedSkill.id])

  return (
    <div className="grid min-w-0 gap-3 overflow-hidden">
      <InspectorCard>
        <CardHeader className="flex-row items-center gap-2 px-3 py-0">
          <CardTitle ref={headingRef} className="min-w-0 truncate text-sm outline-none" tabIndex={-1}>
            {selectedSkill.name}
          </CardTitle>
          {shouldShowStatusBadge(selectedStatus.tone) && selectedStatus.label ? (
            <Badge
              className={cn("shrink-0", getStatusBadgeClassName(selectedStatus.tone))}
              variant={selectedStatus.badge}
            >
              {selectedStatus.label}
            </Badge>
          ) : null}
        </CardHeader>
        <CardContent className="grid gap-2 px-3">
          <CardDescription className="min-w-0 truncate">
            {hasPublishedUpdate
              ? t("skills.versionUpdateAvailable", {
                  current: selectedVersionCheck?.currentVersion ?? "",
                  latest: selectedVersionCheck?.latestVersion ?? "",
                })
              : (selectedSkill.packageName ?? getSkillKindLabel(selectedSkill.kind, t))}
          </CardDescription>
          <div className="flex min-w-0 flex-wrap items-center gap-1">
            {ooRelatedLabel ? <OoRelatedBadge label={ooRelatedLabel} /> : null}
            <Badge variant="secondary">{getSkillKindLabel(selectedSkill.kind, t)}</Badge>
            {getSkillVisibilityLabel(selectedVisibilityInfo, t, selectedVisibilityLoading) ? (
              <SkillVisibilityBadge
                info={selectedVisibilityInfo}
                isLoading={selectedVisibilityLoading}
                label={getSkillVisibilityLabel(selectedVisibilityInfo, t, selectedVisibilityLoading) ?? ""}
              />
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
            {selectedSkill.version ? <Badge variant="outline">{selectedSkill.version}</Badge> : null}
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
            <SkillActionsMenu
              actingSkillKey={actingSkillKey}
              canDeleteSkill={canDeleteSkill}
              canPublishSkill={canPublishSkill}
              canShareSkill={canShareSkill}
              copySharePrompt={copySharePrompt}
              copySkillPath={copySkillPath}
              openSkillFolder={openSkillFolder}
              openSkillInEditor={openSkillInEditor}
              primaryPath={primaryPath}
              publishSkill={publishSkill}
              selectedSkill={selectedSkill}
              skillEditors={skillEditors}
              skillVisibilityInfo={selectedVisibilityInfo}
              setRemoveTarget={setRemoveTarget}
              shareSkill={shareSkill}
            />
          </div>
        </CardContent>
      </InspectorCard>

      {allHosts.length > 0 && (
        <InspectorInsetCard className="gap-3 px-3 py-3">
          <div className="flex min-w-0 items-start justify-between gap-3">
            <div className="grid min-w-0 gap-1">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <div className="truncate text-sm font-medium">{t("skills.agentScopeTitle")}</div>
                {selectedCoverageLabel ? <Badge variant="outline">{selectedCoverageLabel}</Badge> : null}
                {hostAttentionCount > 0 ? (
                  <Badge
                    className={cn("shrink-0", getStatusBadgeClassName(hostAttentionTone))}
                    variant={hostAttentionBadgeVariant}
                  >
                    {t("skills.agentScopeAttention", { count: hostAttentionCount })}
                  </Badge>
                ) : null}
              </div>
              <CardDescription className="text-xs">{hostScopeDescription}</CardDescription>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="shrink-0"
              onClick={() => setIsHostDetailsOpen((isOpen) => !isOpen)}
            >
              {isHostDetailsOpen ? t("skills.agentScopeHide") : t("skills.agentScopeChange")}
            </Button>
          </div>

          {hostAttentionCount > 0 ? (
            <div
              className={cn(
                "grid gap-2 rounded-md border px-3 py-2",
                hasSourceMissingHost
                  ? "border-[var(--oo-danger-border)] bg-[var(--oo-danger-surface)]"
                  : "border-[var(--oo-warning-border)] bg-[var(--oo-warning-surface)]",
              )}
            >
              <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-2">
                <ObjectStatusIcon tone={hostAttentionTone} />
                <div className="grid min-w-0 gap-1">
                  <div className="text-xs font-medium">{t("skills.groupStatus.attention")}</div>
                  <CardDescription className="text-xs">{selectedStatus.description}</CardDescription>
                </div>
              </div>
              {resetPlan?.status === "ready" ? (
                <div className="flex justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isResetting}
                    onClick={() => openResetDialog()}
                  >
                    {isResetting ? <AppIcons.status.loading className="animate-spin" /> : null}
                    {isResetting ? t("skills.planExecuting") : t("skills.resetPlan")}
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
            <p className="oo-text-caption oo-text-muted min-w-0">{t("skills.availableAgentsDescription")}</p>
            {canEnableAllAgents ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isEnablingAllAgents}
                onClick={() => void enableSkillForAllAgents(selectedSkill)}
              >
                {isEnablingAllAgents ? <AppIcons.status.loading className="animate-spin" /> : null}
                {isEnablingAllAgents
                  ? t("skills.enablingAllAgents")
                  : t(missingHostCount > 1 ? "skills.enableMissingAgents" : "skills.enableAllAgents", {
                      count: missingHostCount,
                    })}
              </Button>
            ) : enableAllAgentsUnavailableReason ? (
              <span className="oo-text-caption oo-text-muted max-w-full truncate">
                {enableAllAgentsUnavailableReason}
              </span>
            ) : null}
          </div>

          {isHostDetailsOpen ? (
            <ItemGroup className="min-w-0 gap-1">
              {allHosts.map((host) => {
                const hostStatus = getHostStatus(host, t)
                const hostPath = host.path
                const isInstalledHost = host.status === "installed"
                const canResetHost = isInstalledHost && host.controlState === "modified"
                const hasHostUtilityActions = canResetHost || Boolean(hostPath)
                const hasHostActions = hasHostUtilityActions || (isInstalledHost && !selectedSkill.isBuiltIn)

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
                      {hasHostActions ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button type="button" variant="ghost" size="icon" aria-label={t("skills.actions")}>
                              <AppIcons.action.more />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="min-w-48">
                            {canResetHost ? (
                              <DropdownMenuItem
                                disabled={isResetting || isPlanLoading}
                                onSelect={(event) => {
                                  event.preventDefault()
                                  openResetDialog(host.agentId)
                                }}
                              >
                                {isResetting ? (
                                  <AppIcons.status.loading className="animate-spin" />
                                ) : (
                                  <AppIcons.action.refresh />
                                )}
                                <span>{t("skills.resetHost")}</span>
                              </DropdownMenuItem>
                            ) : null}
                            {hostPath ? (
                              <>
                                <DropdownMenuItem onSelect={() => openSkillFolder(hostPath)}>
                                  <AppIcons.action.openFolder />
                                  <span>{t("skills.openFolder")}</span>
                                </DropdownMenuItem>
                                <DropdownMenuItem onSelect={() => copySkillPath(hostPath)}>
                                  <AppIcons.action.copy />
                                  <span>{t("skills.copyPath")}</span>
                                </DropdownMenuItem>
                              </>
                            ) : null}
                            {!selectedSkill.isBuiltIn ? (
                              <>
                                {hasHostUtilityActions ? <DropdownMenuSeparator /> : null}
                                <DropdownMenuItem
                                  variant="destructive"
                                  onSelect={() => setRemoveTarget({ scope: "agent", skill: selectedSkill, host })}
                                >
                                  <AppIcons.action.delete />
                                  <span>{t("skills.removeFromAgent")}</span>
                                </DropdownMenuItem>
                              </>
                            ) : null}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : null}
                    </ItemActions>
                  </Item>
                )
              })}
            </ItemGroup>
          ) : null}
        </InspectorInsetCard>
      )}

      {(planError || hasReadyRepairPlan) && (
        <Accordion type="single" collapsible>
          <InspectorAccordionItem value="repair-plan">
            <AccordionTrigger className="py-2 text-sm hover:no-underline">
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate">{t("skills.repairPlan")}</span>
                {isPlanLoading && <AppIcons.status.loading className="oo-icon-muted size-3.5 shrink-0 animate-spin" />}
              </span>
            </AccordionTrigger>
            <AccordionContent className="grid min-w-0 gap-2 pb-3">
              {planError ? (
                <div className="oo-error text-xs">{planError}</div>
              ) : (
                <>
                  {resetPlan?.status === "ready" && (
                    <RepairPlanCard
                      plan={resetPlan}
                      title={t("skills.resetPlan")}
                      emptyText={t("skills.resetPlanEmpty")}
                      isExecuting={isResetting}
                      onExecute={() => openResetDialog()}
                    />
                  )}
                  {sourcePlan?.status === "ready" && (
                    <RepairPlanCard
                      plan={sourcePlan}
                      title={t("skills.sourcePlan")}
                      emptyText={t("skills.sourcePlanEmpty")}
                      actionLabel={canExecuteSourcePlan ? t("skills.sourcePlanExecute") : undefined}
                      isExecuting={isExecutingSourcePlan}
                      onExecute={executeSourcePlan}
                    />
                  )}
                </>
              )}
            </AccordionContent>
          </InspectorAccordionItem>
        </Accordion>
      )}
    </div>
  )
}

function RepairPlanCard({ actionLabel, emptyText, isExecuting = false, onExecute, plan, title }: RepairPlanCardProps) {
  const { t } = useAppI18n()

  if (!plan || plan.status !== "ready") {
    return (
      <InspectorInsetCard className="gap-1 px-3 py-2">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="min-w-0 truncate text-xs font-medium">{title}</div>
          <Badge variant="secondary">{t("skills.planNotNeeded")}</Badge>
        </div>
        <CardDescription className="line-clamp-2 text-xs">{emptyText}</CardDescription>
      </InspectorInsetCard>
    )
  }

  return (
    <Card className="min-w-0 gap-2 rounded-md border-[var(--oo-danger-border)] bg-[var(--oo-danger-surface)] px-3 py-2 shadow-none">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="min-w-0 truncate text-xs font-medium">{title}</div>
        <Badge className="shrink-0" variant={plan.isDestructive ? "destructive" : onExecute ? "outline" : "secondary"}>
          {plan.isDestructive
            ? t("skills.planDestructive")
            : onExecute
              ? t("skills.planRestorable")
              : t("skills.planManual")}
        </Badge>
      </div>
      <p className="oo-text-caption mt-1">{t("skills.planTargetCount", { count: plan.targets.length })}</p>
      <ItemGroup className="mt-2 min-w-0 gap-1">
        {plan.targets.slice(0, 2).map((target) => (
          <Item
            key={target.agentId}
            size="sm"
            className="grid min-w-0 gap-1 rounded-sm border-0 bg-[var(--oo-surface-raised)] px-2 py-1.5"
          >
            <ItemTitle className="max-w-full truncate text-xs">{target.agentName}</ItemTitle>
            <ItemDescription data-selectable="true" className="text-xs break-all">
              {target.currentPath}
            </ItemDescription>
          </Item>
        ))}
        {plan.targets.length > 2 && (
          <div className="oo-text-caption">{t("skills.planMoreTargets", { count: plan.targets.length - 2 })}</div>
        )}
      </ItemGroup>
      {onExecute ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-2 w-full"
          disabled={isExecuting}
          onClick={onExecute}
        >
          {isExecuting ? <AppIcons.status.loading className="animate-spin" /> : null}
          {isExecuting ? t("skills.planExecuting") : (actionLabel ?? t("skills.planExecute"))}
        </Button>
      ) : null}
    </Card>
  )
}

interface ResetConfirmDialogProps {
  executeResetPlan: () => void
  isOpen: boolean
  isResetting: boolean
  plan: SkillRepairPlan | null
  setIsOpen: (isOpen: boolean) => void
}

interface EnableSkillPlanConfirmDialogProps {
  executeEnablePlan: () => void
  isExecuting: boolean
  isOpen: boolean
  plan: SkillEnablePlan | null
  setIsOpen: (isOpen: boolean) => void
}

function EnableSkillPlanConfirmDialog({
  executeEnablePlan,
  isExecuting,
  isOpen,
  plan,
  setIsOpen,
}: EnableSkillPlanConfirmDialogProps) {
  const { t } = useAppI18n()
  const overwriteCount = plan?.targets.filter((target) => target.action === "overwrite").length ?? 0
  const createCount = plan?.targets.filter((target) => target.action === "create").length ?? 0
  const targetPreview = plan?.targets.slice(0, 4) ?? []
  const hiddenTargetCount = Math.max(0, (plan?.targets.length ?? 0) - targetPreview.length)

  return (
    <ConfirmDialog open={isOpen} onOpenChange={setIsOpen}>
      <ConfirmDialogContent>
        <ConfirmDialogHeader>
          <ConfirmDialogTitle>{t("skills.enableLocalConfirmTitle")}</ConfirmDialogTitle>
          <ConfirmDialogDescription>
            {plan
              ? t("skills.enableLocalConfirmDescription", {
                  count: plan.targets.length,
                  name: plan.skillName,
                  source: plan.sourceAgentName ?? t("skills.none"),
                })
              : t("skills.enableLocalConfirmUnavailable")}
          </ConfirmDialogDescription>
        </ConfirmDialogHeader>
        {plan ? (
          <div className="grid gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-1">
              {createCount > 0 ? (
                <Badge variant="outline">{t("skills.enableLocalCreateCount", { count: createCount })}</Badge>
              ) : null}
              {overwriteCount > 0 ? (
                <Badge variant="destructive">{t("skills.enableLocalOverwriteCount", { count: overwriteCount })}</Badge>
              ) : null}
            </div>
            <ItemGroup className="min-w-0 gap-1">
              {targetPreview.map((target) => (
                <Item key={target.agentId} size="sm" className="gap-2 rounded-md border-0 px-2 py-1.5">
                  <ItemMedia className="size-auto gap-2">
                    <AgentIcon host={target.agentName} />
                  </ItemMedia>
                  <ItemContent className="min-w-0">
                    <ItemTitle className="max-w-full truncate">{target.agentName}</ItemTitle>
                  </ItemContent>
                  <ItemActions>
                    <Badge variant={target.action === "overwrite" ? "destructive" : "outline"}>
                      {t(
                        target.action === "overwrite"
                          ? "skills.enableLocalActionOverwrite"
                          : "skills.enableLocalActionCreate",
                      )}
                    </Badge>
                  </ItemActions>
                </Item>
              ))}
            </ItemGroup>
            {hiddenTargetCount > 0 ? (
              <p className="oo-text-caption oo-text-muted px-2">
                {t("skills.planMoreTargets", { count: hiddenTargetCount })}
              </p>
            ) : null}
          </div>
        ) : null}
        <ConfirmDialogFooter>
          <ConfirmDialogCancel disabled={isExecuting}>{t("skills.deleteConfirmCancel")}</ConfirmDialogCancel>
          <ConfirmDialogAction
            disabled={isExecuting || !plan}
            onClick={(event) => {
              event.preventDefault()
              void executeEnablePlan()
            }}
          >
            {isExecuting ? <AppIcons.status.loading className="animate-spin" /> : null}
            {isExecuting ? t("skills.enablingAllAgents") : t("skills.enableLocalConfirmAction")}
          </ConfirmDialogAction>
        </ConfirmDialogFooter>
      </ConfirmDialogContent>
    </ConfirmDialog>
  )
}

function ResetConfirmDialog({ executeResetPlan, isOpen, isResetting, plan, setIsOpen }: ResetConfirmDialogProps) {
  const { t } = useAppI18n()

  return (
    <ConfirmDialog open={isOpen} onOpenChange={setIsOpen}>
      <ConfirmDialogContent>
        <ConfirmDialogHeader>
          <ConfirmDialogTitle>{t("skills.resetConfirmTitle")}</ConfirmDialogTitle>
          <ConfirmDialogDescription>
            {plan?.status === "ready"
              ? t("skills.resetConfirmDescription", {
                  count: plan.targets.length,
                  name: plan.skillName,
                })
              : t("skills.resetConfirmUnavailable")}
          </ConfirmDialogDescription>
        </ConfirmDialogHeader>

        {plan?.status === "ready" && (
          <ItemGroup className="max-h-56 gap-2 overflow-auto rounded-md border bg-muted/50 p-2">
            {plan.targets.map((target) => (
              <Item key={target.agentId} size="sm" className="grid gap-1 rounded-sm border-0 bg-background px-2 py-1.5">
                <ItemTitle>{target.agentName}</ItemTitle>
                <ItemDescription data-selectable="true" className="text-xs break-all">
                  {target.currentPath}
                </ItemDescription>
              </Item>
            ))}
          </ItemGroup>
        )}

        <ConfirmDialogFooter>
          <ConfirmDialogCancel>{t("skills.resetConfirmCancel")}</ConfirmDialogCancel>
          <ConfirmDialogAction
            disabled={isResetting || plan?.status !== "ready"}
            onClick={(event) => {
              event.preventDefault()
              void executeResetPlan()
              setIsOpen(false)
            }}
          >
            {isResetting ? <AppIcons.status.loading className="animate-spin" /> : null}
            {isResetting ? t("skills.planExecuting") : t("skills.resetConfirmAction")}
          </ConfirmDialogAction>
        </ConfirmDialogFooter>
      </ConfirmDialogContent>
    </ConfirmDialog>
  )
}

interface ReplaceRemoteSkillConfirmDialogProps {
  isReplacing: boolean
  onConfirm: (skill: MyPublishedSkill) => void
  onOpenChange: (isOpen: boolean) => void
  skill: MyPublishedSkill | null
}

function ReplaceRemoteSkillConfirmDialog({
  isReplacing,
  onConfirm,
  onOpenChange,
  skill,
}: ReplaceRemoteSkillConfirmDialogProps) {
  const { t } = useAppI18n()

  return (
    <ConfirmDialog open={Boolean(skill)} onOpenChange={onOpenChange}>
      <ConfirmDialogContent>
        <ConfirmDialogHeader>
          <ConfirmDialogTitle>{t("skills.remoteReplaceConfirmTitle")}</ConfirmDialogTitle>
          <ConfirmDialogDescription>
            {skill
              ? t("skills.remoteReplaceConfirmDescription", {
                  local: skill.conflictingSkill?.name ?? skill.skillId,
                  remote: `${skill.packageName}${skill.packageVersion ? ` · ${skill.packageVersion}` : ""}`,
                })
              : ""}
          </ConfirmDialogDescription>
        </ConfirmDialogHeader>
        <ConfirmDialogFooter>
          <ConfirmDialogCancel disabled={isReplacing}>{t("skills.deleteConfirmCancel")}</ConfirmDialogCancel>
          <ConfirmDialogAction
            disabled={isReplacing || !skill}
            onClick={(event) => {
              event.preventDefault()
              if (skill) {
                onConfirm(skill)
              }
            }}
          >
            {isReplacing ? <AppIcons.status.loading className="animate-spin" /> : <AppIcons.action.installPackage />}
            {isReplacing ? t("skills.remoteReplacing") : t("skills.remoteReplaceConfirmAction")}
          </ConfirmDialogAction>
        </ConfirmDialogFooter>
      </ConfirmDialogContent>
    </ConfirmDialog>
  )
}
