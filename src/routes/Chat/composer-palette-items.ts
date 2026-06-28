import type { ChatOrganizationSkillContext } from "../../../electron/chat/common.ts"
import type { LocalArtifactItem, LocalArtifactPack } from "../../../electron/chat/common.ts"
import type { ConnectionProvider } from "../../../electron/connections/common.ts"
import type { ManagedSkillGroup } from "../../../electron/skills/common.ts"
import type { ComposerPaletteItem } from "./ComposerPalette.tsx"
import type { TranslateFn } from "@/i18n/i18n"
import type { ArtifactSelection } from "@/routes/Chat/GeneratedArtifacts"

import { File, FileImage, Folder, Package, Plug, SlidersHorizontal } from "lucide-react"
import * as React from "react"
import { ProviderIcon } from "@/routes/Connections/ProviderIcon"

export const creatorSkillId = "oo-create-skill"

export type SlashCommandAction =
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
  displayName: string
  kind: "connection"
  service: string
}

export interface SkillPaletteItem extends ComposerPaletteItem {
  descriptionText: string
  kind: "skill"
  skillId: string
  skillName: string
}

export type AttachmentPaletteItem = ComposerPaletteItem & {
  action: "attach-file" | "attach-folder"
  kind: "attachment"
}

export interface ArtifactPaletteItem extends ComposerPaletteItem {
  artifact: LocalArtifactItem
  kind: "artifact"
}

export type ChatComposerPaletteItem =
  | ArtifactPaletteItem
  | AttachmentPaletteItem
  | ConnectionPaletteItem
  | SkillPaletteItem
  | SlashCommandPaletteItem

export interface CreatorSkillPaletteCopy {
  description: string
  title: string
}

function normalizedSearchText(value: string): string {
  return value.trim().toLowerCase()
}

export function matchesComposerQuery(item: ComposerPaletteItem, query: string): boolean {
  const normalized = normalizedSearchText(query)
  if (!normalized) {
    return true
  }
  return [item.id, item.title, item.description, item.meta ?? ""].some((value) =>
    normalizedSearchText(value).includes(normalized),
  )
}

function installedSkillHostCount(group: ManagedSkillGroup): number {
  return group.runtimeHosts.filter((host) => host.status === "installed").length
}

function skillKindMeta(group: ManagedSkillGroup): string {
  if (group.kind === "registry") {
    return "registry"
  }
  if (group.kind === "local") {
    return "local"
  }
  return ""
}

function buildCreatorSkillPaletteItem(copy: CreatorSkillPaletteCopy): SkillPaletteItem {
  return {
    description: copy.description,
    descriptionText: copy.description,
    icon: React.createElement(Package, { className: "size-4" }),
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
  const creatorSkillItem = buildCreatorSkillPaletteItem(creatorSkillCopy)
  const validatedOrganizationSkills = organizationSkills.filter((skill) => skill.id.trim() && skill.name.trim())
  const organizationSkillNames = new Set(validatedOrganizationSkills.map((skill) => skill.name.trim().toLowerCase()))
  const organizationItems = validatedOrganizationSkills
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name))
    .map(
      (skill): SkillPaletteItem => ({
        description: skill.description || fallbackDescription,
        descriptionText: skill.description || fallbackDescription,
        icon: React.createElement(Package, { className: "size-4" }),
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
    .filter((group) => !organizationSkillNames.has((group.name || group.id).trim().toLowerCase()))
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name))
    .map(
      (group): SkillPaletteItem => ({
        description: group.description || fallbackDescription,
        descriptionText: group.description || fallbackDescription,
        icon: React.createElement(Package, { className: "size-4" }),
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

export function buildConnectionPaletteItems(
  providers: ConnectionProvider[],
  fallbackDescription: (service: string) => string,
): ConnectionPaletteItem[] {
  return providers
    .filter((provider) => provider.status === "connected" && provider.appStatus === "active")
    .slice()
    .sort((left, right) => left.displayName.localeCompare(right.displayName))
    .map((provider) => ({
      accountLabel: provider.accountLabel,
      appId: provider.appId,
      description: provider.accountLabel || fallbackDescription(provider.service),
      displayName: provider.displayName,
      icon: React.createElement(ProviderIcon, {
        displayName: provider.displayName,
        iconUrl: provider.iconUrl,
        size: "compact",
      }),
      id: `connection:${provider.service}:${provider.appId ?? "default"}`,
      kind: "connection",
      meta: provider.service,
      service: provider.service,
      title: provider.displayName,
    }))
}

export function buildContextPaletteItems({
  artifactItems = [],
  connectionItems,
  t,
}: {
  artifactItems?: ArtifactPaletteItem[]
  connectionItems: ConnectionPaletteItem[]
  t: TranslateFn
}): Array<ArtifactPaletteItem | AttachmentPaletteItem | ConnectionPaletteItem> {
  return [
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
    ...artifactItems,
    ...connectionItems,
  ]
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
  t,
}: {
  canViewBilling: boolean
  t: TranslateFn
}): SlashCommandPaletteItem[] {
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
