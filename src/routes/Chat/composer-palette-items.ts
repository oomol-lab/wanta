import type { ChatOrganizationSkillContext } from "../../../electron/chat/common.ts"
import type { LocalArtifactItem, LocalArtifactPack } from "../../../electron/chat/common.ts"
import type { ConnectionAppSummary } from "../../../electron/connections/common.ts"
import type { ConnectionProvider } from "../../../electron/connections/common.ts"
import type { ManagedSkillGroup } from "../../../electron/skills/common.ts"
import type { ComposerPaletteItem } from "./ComposerPalette.tsx"
import type { TranslateFn } from "@/i18n/i18n"
import type { ArtifactSelection } from "@/routes/Chat/GeneratedArtifacts"

import { File, FileImage, Folder, Package, Plug, SlidersHorizontal } from "lucide-react"
import * as React from "react"
import { connectionAppDisplayLabel as connectionAppUiDisplayLabel } from "../../../electron/connections/summary.ts"
import { normalizeSkillIconSource } from "@/components/skill-icon-source"
import { SkillIcon } from "@/components/SkillIcon"
import { ProviderIcon } from "@/routes/Connections/ProviderIcon"
import { isEmojiIcon, isImageIcon } from "@/routes/Skills/skill-route-model"

export const creatorSkillId = "oo-create-skill"
const builtInSkillIds = new Set([creatorSkillId, "oo", "oo-find-skills", "oo-publish-skill"])

export type SlashCommandAction =
  | "attach-file-or-folder"
  | "attach-file"
  | "attach-folder"
  | "billing"
  | "connections"
  | "creator-skill"
  | "skills"

export interface SlashCommandPaletteItem extends ComposerPaletteItem {
  action: SlashCommandAction
  kind: "slash"
}

export interface ConnectionPaletteItem extends ComposerPaletteItem {
  appId?: string
  accountLabel?: string
  connectionAction: "attention" | "connect" | "unsupported" | "use"
  displayName: string
  kind: "connection-account" | "connection-provider"
  service: string
}

export interface ConnectionProviderPaletteItem extends ConnectionPaletteItem {
  accountCount: number
  canOpenAccounts: boolean
  copy: ConnectionPaletteCopy
  kind: "connection-provider"
  provider: ConnectionProvider
}

export interface ConnectionAccountPaletteItem extends ConnectionPaletteItem {
  appId: string
  isDefault: boolean
  kind: "connection-account"
  status: ConnectionAppSummary["status"]
}

export interface SkillPaletteItem extends ComposerPaletteItem {
  descriptionText: string
  iconSource?: string
  kind: "skill"
  skillId: string
  skillName: string
}

export type AttachmentPaletteItem = ComposerPaletteItem & {
  action: AttachmentPaletteAction
  kind: "attachment"
}

export type AttachmentPaletteAction = "attach-file" | "attach-folder" | "attach-file-or-folder"

export interface ArtifactPaletteItem extends ComposerPaletteItem {
  artifact: LocalArtifactItem
  kind: "artifact"
}

export type ChatComposerPaletteItem =
  | ArtifactPaletteItem
  | AttachmentPaletteItem
  | ConnectionAccountPaletteItem
  | ConnectionProviderPaletteItem
  | SkillPaletteItem
  | SlashCommandPaletteItem

export interface CreatorSkillPaletteCopy {
  description: string
  title: string
}

function supportsCombinedAttachmentPicker(platform: NodeJS.Platform | undefined): boolean {
  return platform === "darwin"
}

function normalizedSearchText(value: string): string {
  return value.trim().toLowerCase()
}

function normalizedSearchCandidates(item: ComposerPaletteItem): Array<{ priority: number; value: string }> {
  return [
    { priority: 0, value: item.id },
    { priority: 0, value: item.title },
    ...(item.keywords ?? []).map((value) => ({ priority: 1, value })),
    { priority: 2, value: item.meta ?? "" },
    { priority: 3, value: item.description },
  ].map((candidate) => ({ ...candidate, value: normalizedSearchText(candidate.value) }))
}

export function composerQueryScore(item: ComposerPaletteItem, query: string): number {
  const normalized = normalizedSearchText(query)
  if (!normalized) {
    return 0
  }

  let bestScore = Number.POSITIVE_INFINITY
  for (const candidate of normalizedSearchCandidates(item)) {
    if (!candidate.value) {
      continue
    }
    const titleOrIdBoost = candidate.priority === 0 ? 0 : 10 + candidate.priority * 10
    let score = Number.POSITIVE_INFINITY
    if (candidate.value === normalized) {
      score = titleOrIdBoost
    } else if (candidate.value.startsWith(normalized)) {
      score = titleOrIdBoost + 1
    } else if (candidate.value.split(/[\s:_./-]+/).some((part) => part.startsWith(normalized))) {
      score = titleOrIdBoost + 2
    } else {
      const index = candidate.value.indexOf(normalized)
      if (index >= 0) {
        score = titleOrIdBoost + 3 + Math.min(index, 20) / 100
      }
    }
    bestScore = Math.min(bestScore, score)
  }

  return bestScore
}

export function matchesComposerQuery(item: ComposerPaletteItem, query: string): boolean {
  return Number.isFinite(composerQueryScore(item, query))
}

export function filterComposerPaletteItems<TItem extends ComposerPaletteItem>(
  items: TItem[],
  query: string,
  limit = 8,
): TItem[] {
  return items
    .map((item, index) => ({ index, item, score: composerQueryScore(item, query) }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort((left, right) => left.score - right.score || left.index - right.index)
    .slice(0, limit)
    .map((entry) => entry.item)
}

function installedSkillHostCount(group: ManagedSkillGroup): number {
  return group.runtimeHosts.filter((host) => host.status === "installed").length
}

function normalizedSkillIdentityPart(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase()
}

function skillIdentityKey(packageName: string | undefined, skillName: string | undefined): string | null {
  const normalizedPackageName = normalizedSkillIdentityPart(packageName)
  const normalizedSkillName = normalizedSkillIdentityPart(skillName)

  if (!normalizedPackageName || !normalizedSkillName) {
    return null
  }
  return `${normalizedPackageName}\u0000${normalizedSkillName}`
}

function organizationSkillIdentityKeys(skill: ChatOrganizationSkillContext): string[] {
  const keys = [
    skillIdentityKey(skill.packageName, skill.skillName),
    skillIdentityKey(
      skill.packageName,
      skill.id
        .replace(/^organization:/, "")
        .split(":")
        .at(-1),
    ),
  ]

  return keys.filter((key): key is string => Boolean(key))
}

function managedSkillIdentityKeys(group: ManagedSkillGroup): string[] {
  const keys = [skillIdentityKey(group.packageName, group.id), skillIdentityKey(group.packageName, group.name)]
  return keys.filter((key): key is string => Boolean(key))
}

function skillKindMeta(group: ManagedSkillGroup): string {
  if (builtInSkillIds.has(group.id)) {
    return "built-in"
  }
  if (group.kind === "registry") {
    return "registry"
  }
  if (group.kind === "local") {
    return "local"
  }
  return ""
}

function skillPaletteIcon(icon: string | undefined): React.ReactNode {
  const normalizedIcon = normalizeSkillIconSource(icon)

  if (isImageIcon(normalizedIcon)) {
    return React.createElement("img", {
      alt: "",
      className: "size-5 rounded-sm object-contain",
      src: normalizedIcon,
    })
  }

  if (isEmojiIcon(normalizedIcon)) {
    return React.createElement("span", { className: "text-base leading-none" }, normalizedIcon)
  }

  return React.createElement(SkillIcon, { className: "size-4", icon: normalizedIcon })
}

function buildCreatorSkillPaletteItem(copy: CreatorSkillPaletteCopy, icon: string | undefined): SkillPaletteItem {
  return {
    description: copy.description,
    descriptionText: copy.description,
    icon: skillPaletteIcon(icon),
    ...(icon ? { iconSource: icon } : {}),
    id: `skill:${creatorSkillId}`,
    kind: "skill",
    meta: "built-in",
    skillId: creatorSkillId,
    skillName: copy.title,
    title: copy.title,
  }
}

export function buildSkillPaletteItems(
  groups: ManagedSkillGroup[],
  fallbackDescription: string,
  creatorSkillCopy: CreatorSkillPaletteCopy,
  organizationSkills: ChatOrganizationSkillContext[] = [],
): SkillPaletteItem[] {
  const creatorSkillGroup = groups.find((group) => group.id === creatorSkillId)
  const creatorSkillItem = buildCreatorSkillPaletteItem(creatorSkillCopy, creatorSkillGroup?.icon)
  const validatedOrganizationSkills = organizationSkills.filter((skill) => skill.id.trim() && skill.name.trim())
  const organizationSkillKeys = new Set(validatedOrganizationSkills.flatMap(organizationSkillIdentityKeys))
  const organizationSkillNames = new Set(validatedOrganizationSkills.map((skill) => normalizedSearchText(skill.name)))
  const organizationItems = validatedOrganizationSkills
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name))
    .map(
      (skill): SkillPaletteItem => ({
        description: skill.description || fallbackDescription,
        descriptionText: skill.description || fallbackDescription,
        icon: skillPaletteIcon(skill.icon),
        ...(skill.icon ? { iconSource: skill.icon } : {}),
        id: `skill:${skill.id}`,
        kind: "skill",
        meta: "organization",
        skillId: skill.id,
        skillName: skill.name,
        title: skill.name,
      }),
    )
  const inventoryItems = groups
    .filter((group) => installedSkillHostCount(group) > 0)
    .filter((group) => group.id !== creatorSkillId)
    .filter((group) => {
      if (managedSkillIdentityKeys(group).some((key) => organizationSkillKeys.has(key))) {
        return false
      }
      return !organizationSkillNames.has(normalizedSearchText(group.name || group.id))
    })
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name))
    .map(
      (group): SkillPaletteItem => ({
        description: group.description || fallbackDescription,
        descriptionText: group.description || fallbackDescription,
        icon: skillPaletteIcon(group.icon),
        ...(group.icon ? { iconSource: group.icon } : {}),
        id: `skill:${group.id}`,
        kind: "skill",
        meta: skillKindMeta(group),
        skillId: group.id,
        skillName: group.name || group.id,
        title: group.name || group.id,
      }),
    )

  return [creatorSkillItem, ...organizationItems, ...inventoryItems]
}

export interface ConnectionPaletteCopy {
  accountCount: (count: number) => string
  accountActiveHint: string
  accountFallbackLabel: (authLabel: string, index: number) => string
  authLabel: (authType: ConnectionAppSummary["authType"]) => string
  connectProvider: string
  defaultAccountDescription: (account: string) => string
  defaultLabel: string
  needsAttention: string
  setDefault: string
  unsupportedProvider: string
}

function connectionAppDisplayLabel(app: ConnectionAppSummary, index: number, copy: ConnectionPaletteCopy): string {
  return connectionAppUiDisplayLabel(app) ?? copy.accountFallbackLabel(copy.authLabel(app.authType), index + 1)
}

function connectionAppSearchText(app: ConnectionAppSummary): string[] {
  return [app.displayName, app.alias, app.accountLabel, app.providerAccountId, app.id].filter(
    (value): value is string => Boolean(value),
  )
}

function usableConnectionApps(provider: ConnectionProvider): ConnectionAppSummary[] {
  return provider.apps.filter((app) => app.status !== "disconnected")
}

function activeConnectionApps(provider: ConnectionProvider): ConnectionAppSummary[] {
  return usableConnectionApps(provider).filter((app) => app.status === "active")
}

function defaultConnectionApp(provider: ConnectionProvider): ConnectionAppSummary | undefined {
  const activeApps = activeConnectionApps(provider)
  return activeApps.find((app) => app.isDefault) ?? activeApps.find((app) => app.id === provider.appId) ?? activeApps[0]
}

function providerKeywords(provider: ConnectionProvider, apps: ConnectionAppSummary[]): string[] {
  return [provider.service, provider.displayName, ...apps.flatMap((app) => connectionAppSearchText(app))].filter(
    (value): value is string => Boolean(value),
  )
}

export function buildConnectionPaletteItems(
  providers: ConnectionProvider[],
  fallbackDescription: (service: string) => string,
  copy: ConnectionPaletteCopy,
): ConnectionProviderPaletteItem[] {
  return providers.map((provider): ConnectionProviderPaletteItem => {
    const apps = usableConnectionApps(provider)
    const defaultApp = defaultConnectionApp(provider)
    const defaultAppIndex = defaultApp ? apps.findIndex((app) => app.id === defaultApp.id) : -1
    const accountLabel =
      defaultApp && defaultAppIndex !== -1 ? connectionAppDisplayLabel(defaultApp, defaultAppIndex, copy) : undefined
    const needsAttention = provider.status === "needs_attention"
    const connectionAction = defaultApp
      ? "use"
      : needsAttention
        ? "attention"
        : provider.actionKind === "unavailable"
          ? "unsupported"
          : "connect"
    const hasMultipleAccounts = connectionAction === "use" && apps.length > 1
    const accountCountLabel = hasMultipleAccounts ? copy.accountCount(apps.length) : undefined
    const description = (() => {
      switch (connectionAction) {
        case "use":
          return accountLabel ? copy.defaultAccountDescription(accountLabel) : fallbackDescription(provider.service)
        case "connect":
          return copy.connectProvider
        case "attention":
          return copy.needsAttention
        case "unsupported":
          return copy.unsupportedProvider
      }
    })()
    return {
      accountCount: apps.length,
      ...(accountLabel ? { accountLabel } : {}),
      appId: defaultApp?.id,
      canOpenAccounts: hasMultipleAccounts,
      connectionAction,
      copy,
      description,
      disabled: connectionAction === "unsupported",
      displayName: provider.displayName,
      icon: React.createElement(ProviderIcon, {
        displayName: provider.displayName,
        iconUrl: provider.iconUrl,
        size: "showcase",
      }),
      id: `connection-provider:${provider.service}`,
      keywords: providerKeywords(provider, apps),
      kind: "connection-provider",
      meta:
        connectionAction === "use" && !hasMultipleAccounts
          ? needsAttention
            ? copy.needsAttention
            : undefined
          : connectionAction === "attention"
            ? copy.needsAttention
            : undefined,
      secondaryActionActiveLabel: hasMultipleAccounts ? copy.accountActiveHint : undefined,
      secondaryActionLabel: accountCountLabel,
      secondaryActionTitle:
        hasMultipleAccounts && accountCountLabel ? `${accountCountLabel} · ${copy.accountActiveHint}` : undefined,
      provider,
      service: provider.service,
      title: provider.displayName,
    }
  })
}

export function buildConnectionAccountPaletteItems(
  provider: ConnectionProvider | undefined,
  copy: ConnectionPaletteCopy | undefined,
): ConnectionAccountPaletteItem[] {
  if (!provider || !copy) {
    return []
  }
  return usableConnectionApps(provider)
    .slice()
    .sort((left, right) => {
      if (left.isDefault !== right.isDefault) {
        return left.isDefault ? -1 : 1
      }
      if (left.status === "active" && right.status !== "active") {
        return -1
      }
      if (left.status !== "active" && right.status === "active") {
        return 1
      }
      return left.id.localeCompare(right.id)
    })
    .map((app, index): ConnectionAccountPaletteItem => {
      const accountLabel = connectionAppUiDisplayLabel(app)
      const title = accountLabel ?? connectionAppDisplayLabel(app, index, copy)
      const description = app.status === "active" ? copy.authLabel(app.authType) : copy.needsAttention
      const canSetDefault = Boolean(copy.setDefault) && !app.isDefault && app.status === "active"
      return {
        accountLabel: title,
        appId: app.id,
        connectionAction: "use",
        description,
        disabled: app.status !== "active",
        displayName: provider.displayName,
        icon: React.createElement(ProviderIcon, {
          displayName: provider.displayName,
          iconUrl: provider.iconUrl,
          size: "showcase",
        }),
        id: `connection-account:${provider.service}:${app.id}`,
        isDefault: app.isDefault,
        keywords: [provider.service, provider.displayName, ...connectionAppSearchText(app)],
        kind: "connection-account",
        meta: app.isDefault ? copy.defaultLabel : undefined,
        secondaryActionDisabled: app.status !== "active",
        secondaryActionIconVisibility: canSetDefault ? "active" : undefined,
        secondaryActionLabel: canSetDefault ? copy.setDefault : undefined,
        secondaryActionTitle: canSetDefault ? copy.setDefault : undefined,
        service: provider.service,
        status: app.status,
        title,
      }
    })
}

export function buildContextPaletteItems({
  artifactItems = [],
  connectionItems,
  platform,
  t,
}: {
  artifactItems?: ArtifactPaletteItem[]
  connectionItems: ConnectionProviderPaletteItem[]
  platform?: NodeJS.Platform
  t: TranslateFn
}): Array<ArtifactPaletteItem | AttachmentPaletteItem | ConnectionProviderPaletteItem> {
  const attachmentItems: AttachmentPaletteItem[] = supportsCombinedAttachmentPicker(platform)
    ? [
        {
          action: "attach-file-or-folder",
          description: t("chat.contextAttachFileOrFolderDescription"),
          icon: React.createElement(File, { className: "size-4" }),
          id: "context:attach-file-or-folder",
          kind: "attachment",
          meta: "file/folder",
          title: t("chat.attachFileOrFolderAction"),
        },
      ]
    : [
        {
          action: "attach-file",
          description: t("chat.contextAttachFileDescription"),
          icon: React.createElement(File, { className: "size-4" }),
          id: "context:attach-file",
          kind: "attachment",
          meta: "file",
          title: t("chat.attachFileAction"),
        },
        {
          action: "attach-folder",
          description: t("chat.contextAttachFolderDescription"),
          icon: React.createElement(Folder, { className: "size-4" }),
          id: "context:attach-folder",
          kind: "attachment",
          meta: "folder",
          title: t("chat.attachFolderAction"),
        },
      ]
  return [...attachmentItems, ...artifactItems, ...connectionItems]
}

function packDisplayItems(pack: LocalArtifactPack): LocalArtifactItem[] {
  if (pack.display === "gallery") {
    return pack.items
  }
  const supporting = pack.supporting.filter((item) => item.role !== "metadata")
  return pack.items.length > 0 ? [...pack.items, ...supporting] : supporting
}

function artifactSelectionItems(selection: ArtifactSelection | null): LocalArtifactItem[] {
  if (!selection) {
    return []
  }
  const groups =
    selection.groups && selection.groups.length > 0
      ? selection.groups
      : [
          {
            group: selection.group,
            messageId: selection.messageId,
            ...(selection.pack ? { pack: selection.pack } : {}),
          },
        ]
  const items = groups.flatMap(({ group, pack }) => (pack ? packDisplayItems(pack) : group.items))
  const byPath = new Map<string, LocalArtifactItem>()
  for (const item of items) {
    if (!byPath.has(item.path)) {
      byPath.set(item.path, item)
    }
  }
  const uniqueItems = Array.from(byPath.values())
  const selectedPath = selection.selectedPath
  return uniqueItems.sort((left, right) => {
    if (selectedPath) {
      if (left.path === selectedPath) {
        return -1
      }
      if (right.path === selectedPath) {
        return 1
      }
    }
    const leftImage = left.mime.toLowerCase().startsWith("image/")
    const rightImage = right.mime.toLowerCase().startsWith("image/")
    if (leftImage !== rightImage) {
      return leftImage ? -1 : 1
    }
    return left.name.localeCompare(right.name)
  })
}

function artifactKindMeta(item: LocalArtifactItem): string {
  if (item.kind === "directory") {
    return "folder"
  }
  const [type] = item.mime.split("/")
  return type || "file"
}

export function buildArtifactPaletteItems(selection: ArtifactSelection | null, t: TranslateFn): ArtifactPaletteItem[] {
  return artifactSelectionItems(selection).map((item) => {
    const isImage = item.mime.toLowerCase().startsWith("image/")
    return {
      artifact: item,
      description: t(isImage ? "chat.contextGeneratedImageDescription" : "chat.contextGeneratedArtifactDescription"),
      icon: React.createElement(isImage ? FileImage : File, { className: "size-4" }),
      id: `artifact:${item.path}`,
      kind: "artifact",
      meta: artifactKindMeta(item),
      title: item.name,
    }
  })
}

export function slashCommandItems({
  canViewBilling,
  platform,
  t,
}: {
  canViewBilling: boolean
  platform?: NodeJS.Platform
  t: TranslateFn
}): SlashCommandPaletteItem[] {
  const attachmentItems: SlashCommandPaletteItem[] = supportsCombinedAttachmentPicker(platform)
    ? [
        {
          action: "attach-file-or-folder",
          description: t("chat.commandAttachFileOrFolderDescription"),
          icon: React.createElement(File, { className: "size-4" }),
          id: "attach-file-or-folder",
          kind: "slash",
          meta: "file/folder",
          title: t("chat.commandAttachFileOrFolder"),
        },
      ]
    : [
        {
          action: "attach-file",
          description: t("chat.commandAttachFileDescription"),
          icon: React.createElement(File, { className: "size-4" }),
          id: "attach-file",
          kind: "slash",
          meta: "file",
          title: t("chat.commandAttachFile"),
        },
        {
          action: "attach-folder",
          description: t("chat.commandAttachFolderDescription"),
          icon: React.createElement(Folder, { className: "size-4" }),
          id: "attach-folder",
          kind: "slash",
          meta: "folder",
          title: t("chat.commandAttachFolder"),
        },
      ]
  return [
    {
      action: "creator-skill",
      description: t("chat.commandCreatorSkillDescription"),
      icon: React.createElement(Package, { className: "size-4" }),
      id: "creator-skill",
      kind: "slash",
      meta: "skill",
      title: t("chat.commandCreatorSkill"),
    },
    {
      action: "skills",
      description: t("chat.commandSkillsDescription"),
      icon: React.createElement(Package, { className: "size-4" }),
      id: "skills",
      kind: "slash",
      meta: "context",
      title: t("chat.commandSkills"),
    },
    {
      action: "connections",
      description: t("chat.commandConnectionsDescription"),
      icon: React.createElement(Plug, { className: "size-4" }),
      id: "connections",
      kind: "slash",
      meta: "context",
      title: t("chat.commandConnections"),
    },
    ...attachmentItems,
    {
      action: "billing",
      description: t("chat.commandBillingDescription"),
      disabled: !canViewBilling,
      icon: React.createElement(SlidersHorizontal, { className: "size-4" }),
      id: "billing",
      kind: "slash",
      meta: "ui",
      title: t("chat.commandBilling"),
    },
  ]
}

export function buildSlashRootPaletteItems({
  connectionItems,
  skillItems,
  slashItems,
}: {
  connectionItems: ConnectionProviderPaletteItem[]
  skillItems: SkillPaletteItem[]
  slashItems: SlashCommandPaletteItem[]
}): ChatComposerPaletteItem[] {
  return [...slashItems, ...skillItems.filter((item) => item.skillId !== creatorSkillId), ...connectionItems]
}
