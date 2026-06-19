import type { ConnectionProvider } from "../../../electron/connections/common.ts"
import type { ManagedSkillGroup } from "../../../electron/skills/common.ts"
import type { ComposerPaletteItem } from "./ComposerPalette.tsx"
import type { TranslateFn } from "@/i18n/i18n"

import { Circle, FileSearch, FileText, Package, Plug, SlidersHorizontal } from "lucide-react"
import * as React from "react"
import { ProviderIcon } from "@/routes/Connections/ProviderIcon"

export type SlashCommandAction = "billing" | "connections" | "insert" | "skills"

export interface SlashCommandPaletteItem extends ComposerPaletteItem {
  action: SlashCommandAction
  kind: "slash"
  prompt?: string
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
  if (group.kind === "bundled") {
    return "bundled"
  }
  if (group.kind === "registry") {
    return "registry"
  }
  if (group.kind === "local") {
    return "local"
  }
  return ""
}

export function buildSkillPaletteItems(groups: ManagedSkillGroup[], fallbackDescription: string): SkillPaletteItem[] {
  return groups
    .filter((group) => installedSkillHostCount(group) > 0)
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((group) => ({
      description: group.description || fallbackDescription,
      descriptionText: group.description || fallbackDescription,
      icon: React.createElement(Package, { className: "size-4" }),
      id: `skill:${group.id}`,
      kind: "skill",
      meta: skillKindMeta(group),
      skillId: group.id,
      skillName: group.name || group.id,
      title: group.name || group.id,
    }))
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
    {
      action: "insert",
      description: t("chat.commandReviewDescription"),
      icon: React.createElement(FileSearch, { className: "size-4" }),
      id: "review",
      kind: "slash",
      meta: "prompt",
      prompt: t("chat.commandReviewPrompt"),
      title: t("chat.commandReview"),
    },
    {
      action: "insert",
      description: t("chat.commandSummarizeDescription"),
      icon: React.createElement(FileText, { className: "size-4" }),
      id: "summarize",
      kind: "slash",
      meta: "prompt",
      prompt: t("chat.commandSummarizePrompt"),
      title: t("chat.commandSummarize"),
    },
    {
      action: "insert",
      description: t("chat.commandStatusDescription"),
      icon: React.createElement(Circle, { className: "size-4" }),
      id: "status",
      kind: "slash",
      meta: "prompt",
      prompt: t("chat.commandStatusPrompt"),
      title: t("chat.commandStatus"),
    },
  ]
}
