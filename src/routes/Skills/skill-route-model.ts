import type {
  ManagedSkillGroup,
  ManagedSkillHostCoverage,
  ManagedSkillKind,
  PublicSkillPackage,
  PublicSkillPackageCatalog,
  SkillVersionReport,
} from "../../../electron/skills/common.ts"
import type { ObjectStatusTone } from "@/components/ObjectRow"
import type { TranslateFn as TFunction } from "@/i18n"

import { cn } from "@/lib/utils"

export const discoverAutoLoadThresholdPx = 160

export type SkillSelectionKey = string
export type SkillPageTab = "discover" | "installed" | "organization"
export type DiscoverSkillFilter = "all" | "mine"
export type InstalledSkillFilter = "all" | "wanta" | "codex" | "claude-code" | "updates" | "local"
export type SkillDocumentViewMode = "preview" | "raw"
export type PublicSkillInstallState =
  | "external-installed"
  | "installed"
  | "partially-installed"
  | "installable"
  | "name-conflict"
  | "unavailable"
export type PublicPackageCatalogStatus = "idle" | "load-error" | "loading" | "loading-more" | "refreshing"
export type ManagedSkillGroupById = ReadonlyMap<string, ManagedSkillGroup>
export type SkillVersionCheckByKey = ReadonlyMap<string, SkillVersionReport["skills"][number]>
export type OrganizationSkillRuntimeState =
  | "external-only"
  | "installed-modified"
  | "installed-same"
  | "installed-version-mismatch"
  | "local-conflict"
  | "missing"
  | "same-id-different-package"
  | "unknown-conflict"

export interface PublicPackageCatalogState {
  error: string | null
  items: PublicSkillPackage[]
  next: string | null
  requestId: number
  selectedId: string | null
  status: PublicPackageCatalogStatus
}

export interface OrganizationSkillRuntimeStatusInput {
  packageName: string
  skillName: string
  version?: string
}

export interface OrganizationSkillRuntimeStatus {
  host?: ManagedSkillHostCoverage
  state: OrganizationSkillRuntimeState
}

export interface RuntimeSkillRemoveTarget {
  displayName: string
  groupId: string
  packageName?: string
  skillName: string
}

export interface RuntimeSkillRemoveTargetInput {
  displayName?: string
  packageName?: string
  skillName: string
}

export interface RuntimeSkillRemoveTargetOptions {
  requirePackageMatch?: boolean
}

export type PublicPackageCatalogAction =
  | { append: boolean; clearItems?: boolean; requestId: number; type: "load-start" }
  | { append: boolean; catalog: PublicSkillPackageCatalog; requestId: number; type: "load-success" }
  | { error: string; requestId: number; type: "load-error" }
  | { id: string | null; type: "select" }

export const initialPublicPackageCatalogState: PublicPackageCatalogState = {
  error: null,
  items: [],
  next: null,
  requestId: 0,
  selectedId: null,
  status: "idle",
}

export function isInstalledSkillFilter(value: string): value is InstalledSkillFilter {
  return (
    value === "all" ||
    value === "wanta" ||
    value === "codex" ||
    value === "claude-code" ||
    value === "updates" ||
    value === "local"
  )
}

export function isDiscoverSkillFilter(value: string): value is DiscoverSkillFilter {
  return value === "all" || value === "mine"
}

export function skillDocumentPreviewSource(content: string): string {
  const normalized = content.replace(/^\uFEFF/, "")
  if (!normalized.startsWith("---")) {
    return normalized
  }

  const lines = normalized.split(/\r?\n/)
  if (lines[0]?.trim() !== "---") {
    return normalized
  }

  const closingIndex = lines.findIndex((line, index) => index > 0 && line.trim() === "---")
  if (closingIndex < 0) {
    return normalized
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

export function publicPackageCatalogReducer(
  state: PublicPackageCatalogState,
  action: PublicPackageCatalogAction,
): PublicPackageCatalogState {
  switch (action.type) {
    case "load-start": {
      const items = action.clearItems ? [] : state.items
      return {
        ...state,
        error: null,
        items,
        next: action.clearItems ? null : state.next,
        requestId: action.requestId,
        selectedId: action.clearItems ? null : state.selectedId,
        status: action.append ? "loading-more" : items.length > 0 ? "refreshing" : "loading",
      }
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

export function isNearScrollBottom(element: HTMLElement): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= discoverAutoLoadThresholdPx
}

export function getRuntimeHosts(group: ManagedSkillGroup): ManagedSkillHostCoverage[] {
  return group.runtimeHosts
}

export function getInstalledPlatformHosts(group: ManagedSkillGroup): ManagedSkillHostCoverage[] {
  return getInstalledSkillHosts(group)
}

export function hasInstalledHostForAgent(group: ManagedSkillGroup, agentId: string): boolean {
  return getInstalledPlatformHosts(group).some((host) => host.agentId === agentId)
}

export function hasRuntimeInstalledHost(group: ManagedSkillGroup): boolean {
  return getInstalledPlatformHosts(group).some((host) => host.scope === "runtime")
}

export function hasExternalInstalledHost(group: ManagedSkillGroup): boolean {
  return getInstalledPlatformHosts(group).some((host) => host.scope === "external")
}

export function getInstalledSkillHosts(group: ManagedSkillGroup): ManagedSkillHostCoverage[] {
  return group.hosts.filter((host) => host.status === "installed")
}

export function getInstalledHostCount(group: ManagedSkillGroup, hosts = group.hosts): number {
  return hosts.filter((host) => host.status === "installed").length
}

export function getAttentionHostCount(group: ManagedSkillGroup, hosts = group.hosts): number {
  return hosts.filter((host) => host.controlState === "modified" || host.controlState === "source-missing").length
}

export function isInstalledSkillGroup(group: ManagedSkillGroup): boolean {
  return getInstalledSkillHosts(group).length > 0
}

export function getSelectedManagedSkillGroup(
  groups: readonly ManagedSkillGroup[],
  selectedId: SkillSelectionKey | null,
): ManagedSkillGroup | undefined {
  if (!selectedId) {
    return undefined
  }

  return groups.find((group) => group.id === selectedId)
}

export function shouldUpdatePublishedSkill(group: ManagedSkillGroup): boolean {
  return (
    group.kind === "registry" &&
    Boolean(group.packageName?.trim()) &&
    getInstalledHostCount(group, getRuntimeHosts(group)) > 0
  )
}

export function getLocalSkillPublishPath(group: ManagedSkillGroup): string | undefined {
  if (group.kind !== "local") {
    return undefined
  }

  const publishHost = group.hosts.find((host) => host.status === "installed" && (host.sourcePath || host.path))
  return publishHost?.sourcePath ?? publishHost?.path
}

export function getSkillDocumentRootPath(group: ManagedSkillGroup): string | undefined {
  const installedHost = getInstalledSkillHosts(group).find((host) => host.path || host.sourcePath)
  return installedHost?.path ?? installedHost?.sourcePath
}

export function isPublishableLocalSkill(group: ManagedSkillGroup): boolean {
  return Boolean(getLocalSkillPublishPath(group)) && !group.packageName?.trim()
}

export function matchesInstalledSkillFilter(
  group: ManagedSkillGroup,
  filter: InstalledSkillFilter,
  versionCheck: SkillVersionReport["skills"][number] | undefined,
): boolean {
  switch (filter) {
    case "all":
      return true
    case "wanta":
      return hasRuntimeInstalledHost(group)
    case "codex":
      return hasInstalledHostForAgent(group, "codex")
    case "claude-code":
      return hasInstalledHostForAgent(group, "claude-code")
    case "updates":
      return hasSkillUpdateAvailable(versionCheck)
    case "local":
      return group.kind === "local"
  }
}

export function getSkillVersionCheckKey(skillId: string, packageName: string | undefined): string {
  return `${skillId}\0${packageName ?? ""}`
}

export function getSkillVersionCheck(
  versionCheckByKey: SkillVersionCheckByKey,
  group: ManagedSkillGroup | undefined,
): SkillVersionReport["skills"][number] | undefined {
  if (!group) {
    return undefined
  }

  return versionCheckByKey.get(getSkillVersionCheckKey(group.id, group.packageName))
}

export function hasSkillUpdateAvailable(versionCheck: SkillVersionReport["skills"][number] | undefined): boolean {
  return versionCheck?.status === "update-available"
}

export function getSkillKindLabel(kind: ManagedSkillKind, t: TFunction): string {
  switch (kind) {
    case "registry":
      return t("skills.kind.registry")
    case "local":
      return t("skills.kind.local")
    case "unknown":
      return t("skills.kind.unknown")
  }
}

export function getGroupStatus(group: ManagedSkillGroup, t: TFunction, hosts = group.hosts) {
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

export function getHostStatus(host: ManagedSkillHostCoverage, t: TFunction) {
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

export function shouldShowStatusBadge(statusTone: ObjectStatusTone): boolean {
  return statusTone !== "ready"
}

export function getStatusBadgeClassName(statusTone: ObjectStatusTone): string | undefined {
  if (statusTone !== "attention") {
    return undefined
  }

  return "border-[var(--oo-warning-border)] bg-[var(--oo-warning-surface)] text-[var(--oo-warning-foreground)]"
}

export function getGroupRowPackageLine(group: ManagedSkillGroup): string | undefined {
  const line = [group.packageName, group.version].filter(Boolean).join(" · ")

  return line || undefined
}

export function getSkillCreatorLine(group: ManagedSkillGroup, t: TFunction): string {
  const owner = getPackageOwner(group.packageName)
  if (owner) {
    return t("skills.createdByPackage", { owner })
  }

  if (group.kind === "local") {
    return t("skills.createdLocally")
  }

  return t("skills.createdUnknown")
}

export function getSkillPlatformLine(group: ManagedSkillGroup, t: TFunction): string {
  const installedHosts = getInstalledPlatformHosts(group)
  const hostNames = installedHosts.map((host) => host.agentName)

  if (hostNames.length === 0) {
    return t("skills.platform.none")
  }

  if (hostNames.length <= 2) {
    return t("skills.platform.list", { names: hostNames.join(", ") })
  }

  return t("skills.platform.count", { count: hostNames.length })
}

function getPackageOwner(packageName: string | undefined): string | undefined {
  const normalizedPackageName = packageName?.trim()
  if (!normalizedPackageName) {
    return undefined
  }

  if (normalizedPackageName.startsWith("@")) {
    return normalizedPackageName.slice(1).split("/")[0] || normalizedPackageName
  }

  return normalizedPackageName
}

export function joinSkillMeta(parts: Array<string | undefined>): string | undefined {
  const line = parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(" · ")

  return line || undefined
}

export function getPublicPackagePrimarySkill(
  pkg: PublicSkillPackage,
): PublicSkillPackage["skills"][number] | undefined {
  return pkg.skills[0]
}

export function getOrganizationSkillRuntimeStatus(
  groupById: ManagedSkillGroupById | undefined,
  skill: OrganizationSkillRuntimeStatusInput,
): OrganizationSkillRuntimeStatus {
  const normalizedSkillName = skill.skillName.trim()
  if (!normalizedSkillName) {
    return { state: "missing" }
  }

  const group = groupById?.get(normalizedSkillName)
  const runtimeHosts = group?.runtimeHosts.filter((host) => host.status === "installed") ?? []
  const runtimeHost = runtimeHosts[0]
  if (!runtimeHost) {
    return { state: group?.hosts.some((host) => host.status === "installed") ? "external-only" : "missing" }
  }

  const hostPackageName = runtimeHost.packageName ?? group?.packageName
  if (hostPackageName === skill.packageName) {
    const hostVersion = runtimeHost.version ?? group?.version
    if (skill.version && skill.version !== "latest" && hostVersion && hostVersion !== skill.version) {
      return { host: runtimeHost, state: "installed-version-mismatch" }
    }
    if (runtimeHost.controlState === "modified") {
      return { host: runtimeHost, state: "installed-modified" }
    }
    return { host: runtimeHost, state: "installed-same" }
  }

  if (runtimeHost.kind === "local" || group?.kind === "local") {
    return { host: runtimeHost, state: "local-conflict" }
  }
  if (runtimeHost.kind === "unknown" || group?.kind === "unknown" || !hostPackageName) {
    return { host: runtimeHost, state: "unknown-conflict" }
  }
  return { host: runtimeHost, state: "same-id-different-package" }
}

export function getInstallableOrganizationSkills<T extends OrganizationSkillRuntimeStatusInput>(
  groupById: ManagedSkillGroupById | undefined,
  skills: readonly T[],
): T[] {
  return skills.filter((skill) => {
    const status = getOrganizationSkillRuntimeStatus(groupById, skill).state
    return status === "missing" || status === "external-only"
  })
}

export function getRuntimeSkillRemoveTarget(
  groupById: ManagedSkillGroupById | undefined,
  input: RuntimeSkillRemoveTargetInput,
  options: RuntimeSkillRemoveTargetOptions = {},
): RuntimeSkillRemoveTarget | null {
  const skillName = input.skillName.trim()
  if (!skillName) {
    return null
  }

  const group = groupById?.get(skillName)
  const runtimeHost = group?.runtimeHosts.find((host) => host.status === "installed")
  if (!group || !runtimeHost) {
    return null
  }

  const packageName = input.packageName?.trim() || runtimeHost.packageName || group.packageName
  const installedPackageName = runtimeHost.packageName ?? group.packageName
  if (options.requirePackageMatch && packageName && installedPackageName && packageName !== installedPackageName) {
    return null
  }

  const displayName = input.displayName?.trim() || group.name || skillName
  return {
    displayName,
    groupId: group.id,
    ...(packageName ? { packageName } : {}),
    skillName,
  }
}

export function getPublicSkillInstallState(
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
  const matchingHosts = installedHosts.filter((host) => (host.packageName ?? group.packageName) === pkg.name)
  if (matchingHosts.some((host) => host.scope === "runtime")) {
    return "installed"
  }
  if (matchingHosts.length > 0) {
    return "external-installed"
  }

  return installedHosts.length > 0 ? "name-conflict" : "installable"
}

export function getPublicPackageInstallState(
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

  if (
    skillStates.some((state) => state === "installable") &&
    skillStates.some((state) => state === "installed" || state === "external-installed")
  ) {
    return "partially-installed"
  }

  if (skillStates.some((state) => state === "external-installed")) {
    return "external-installed"
  }

  return skillStates.some((state) => state === "installable") ? "installable" : "unavailable"
}

export function getPublicPackagePrimaryInstallSkill(
  groupById: ManagedSkillGroupById | undefined,
  pkg: PublicSkillPackage,
): PublicSkillPackage["skills"][number] | undefined {
  return pkg.skills.find((skill) => {
    const state = getPublicSkillInstallState(groupById, pkg, skill.name)
    return state === "installable" || state === "external-installed"
  })
}

export function matchesPublicPackageQuery(pkg: PublicSkillPackage, normalizedQuery: string): boolean {
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

export function getPublicPackageMaintainerLine(pkg: PublicSkillPackage, t: TFunction): string {
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

export function getPublicPackageMetaLine(pkg: PublicSkillPackage, t: TFunction): string {
  return (
    joinSkillMeta([
      getPublicPackageMaintainerLine(pkg, t),
      pkg.downloadCount === undefined ? undefined : t("skills.discoverDownloads", { count: pkg.downloadCount }),
    ]) ?? getPublicPackageMaintainerLine(pkg, t)
  )
}

export function formatPublicPackageUpdateTime(updateTime: number | undefined, locale: string): string | undefined {
  if (!updateTime) {
    return undefined
  }

  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(updateTime))
  } catch {
    return undefined
  }
}

export function getPublicSkillInstallStateLabel(state: PublicSkillInstallState, t: TFunction): string {
  switch (state) {
    case "installed":
      return t("skills.installed")
    case "external-installed":
      return t("skills.discoverExternalInstalled")
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

export function getPublicSkillInstallActionLabel(state: PublicSkillInstallState, t: TFunction): string {
  switch (state) {
    case "partially-installed":
      return t("skills.discoverInstallMissing")
    case "installable":
      return t("skills.registryInstall")
    case "external-installed":
      return t("skills.discoverInstallToWanta")
    case "installed":
      return t("skills.discoverOpenManage")
    case "name-conflict":
      return t("skills.remoteConflictAction")
    case "unavailable":
      return t("skills.discoverUnavailable")
  }
}

export function canInstallPublicSkill(state: PublicSkillInstallState): boolean {
  return state === "installable" || state === "partially-installed" || state === "external-installed"
}

export function getPublicSkillInstallKey(pkg: PublicSkillPackage, skillName: string | undefined): string {
  return `${pkg.id}:${skillName ?? ""}`
}

export function isImageIcon(icon: string | undefined): boolean {
  return Boolean(icon?.startsWith("https://"))
}

export function isEmojiIcon(icon: string | undefined): boolean {
  const normalized = icon?.trim()
  return Boolean(normalized && !/^\d+$/.test(normalized) && !normalized.includes(":") && /\p{Emoji}/u.test(normalized))
}

export function getSkillRowStatusBadgeClassName(tone: ObjectStatusTone): string {
  const baseClassName = "oo-text-micro h-5 max-w-28 shrink-0 px-1.5 font-medium"

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
