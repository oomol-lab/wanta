import type { ConnectionProvider } from "../../../electron/connections/common.ts"
import type { ManagedSkillGroup } from "../../../electron/skills/common.ts"
import type { ComposerPaletteItem } from "./ComposerPalette.tsx"
import type { TranslateFn } from "@/i18n/i18n"

import { Package, Plug, SlidersHorizontal } from "lucide-react"
import * as React from "react"
import { ProviderIcon } from "@/routes/Connections/ProviderIcon"

export const creatorSkillId = "oo-create-skill"

export type SlashCommandAction = "billing" | "connections" | "creator-skill" | "skills"

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

export type ChatComposerPaletteItem = ConnectionPaletteItem | SkillPaletteItem | SlashCommandPaletteItem

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
): SkillPaletteItem[] {
  const creatorSkillItem = buildCreatorSkillPaletteItem(creatorSkillCopy)
  const inventoryItems = groups
    .filter((group) => installedSkillHostCount(group) > 0)
    .filter((group) => group.id !== creatorSkillId)
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

  return [creatorSkillItem, ...inventoryItems]
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
