import type { ManagedSkillGroup, SkillVersionReport } from "../../../electron/skills/common.ts"
import type { SkillVersionCheckByKey } from "./skill-route-model.ts"
import type { ObjectStatusTone } from "@/components/ObjectRow"

import * as React from "react"
import {
  getGroupRowPackageLine,
  getGroupStatus,
  getInstalledPlatformHosts,
  getRuntimeHosts,
  getSkillCreatorLine,
  getSkillKindLabel,
  getSkillPlatformLine,
  getSkillVersionCheck,
  getSkillRowStatusBadgeClassName,
  hasExternalInstalledHost,
  hasRuntimeInstalledHost,
  hasSkillUpdateAvailable,
  isPublishableLocalSkill,
  shouldUpdatePublishedSkill,
} from "./skill-route-model.ts"
import { SkillErrorNotice } from "./SkillErrorNotice.tsx"
import { SkillListRow } from "./SkillListRow.tsx"
import { SkillIconFrame, SkillManagementSheet } from "./SkillUiParts.tsx"
import { AgentIcon } from "@/components/AgentIcon"
import { AppIcons } from "@/components/AppIcons"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardDescription } from "@/components/ui/card"
import { useAppI18n } from "@/i18n"

const publishableSkillBadgeClassName = "oo-badge-info oo-text-micro h-5 shrink-0 px-1.5 font-medium"

interface InstalledSkillsPaneProps {
  cliUpdateError: string | null
  cliVersionCheck: SkillVersionReport["cli"] | undefined
  detailContent: React.ReactNode
  groups: ManagedSkillGroup[]
  isExecutingCliUpdate: boolean
  isDetailOpen: boolean
  onCloseDetail: () => void
  onSelectSkill: (skillId: string) => void
  onUpdateCli: () => void
  selectedSkill: ManagedSkillGroup | undefined
  updateRegistrySkill: (skill: Pick<ManagedSkillGroup, "id" | "kind" | "packageName">) => void
  updatingRegistrySkillId: string | null
  versionCheckByKey: SkillVersionCheckByKey
}

export function InstalledSkillsPane({
  cliUpdateError,
  cliVersionCheck,
  detailContent,
  groups,
  isExecutingCliUpdate,
  isDetailOpen,
  onCloseDetail,
  onSelectSkill,
  onUpdateCli,
  selectedSkill,
  updateRegistrySkill,
  updatingRegistrySkillId,
  versionCheckByKey,
}: InstalledSkillsPaneProps) {
  const { t } = useAppI18n()

  return (
    <div className="min-h-0 overflow-auto px-3 py-3">
      <div className="grid gap-3 pr-1">
        <CliUpdateNotice
          cli={cliVersionCheck}
          error={cliUpdateError}
          isUpdating={isExecutingCliUpdate}
          onUpdate={onUpdateCli}
        />
        {groups.length === 0 ? (
          <div className="oo-text-body oo-text-muted px-1 py-3">{t("skills.installedEmpty")}</div>
        ) : (
          <div className="overflow-hidden rounded-md border bg-background">
            {groups.map((group) => (
              <InstalledSkillRow
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

      {isDetailOpen && selectedSkill ? (
        <SkillManagementSheet title={selectedSkill.name} onClose={onCloseDetail}>
          {detailContent}
        </SkillManagementSheet>
      ) : null}
    </div>
  )
}

function CliUpdateNotice({
  cli,
  error,
  isUpdating,
  onUpdate,
}: {
  cli: SkillVersionReport["cli"] | undefined
  error: string | null
  isUpdating: boolean
  onUpdate: () => void
}) {
  const { t } = useAppI18n()

  if (cli?.status !== "update-available") {
    return null
  }

  return (
    <Card className="grid gap-2 rounded-md border-[var(--oo-warning-border)] bg-[var(--oo-warning-surface)] px-3 py-2 shadow-none">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="grid min-w-0 gap-1">
          <div className="oo-text-label">{t("skills.cliUpdateAvailableTitle")}</div>
          <CardDescription className="oo-text-caption-compact">
            {t("skills.cliUpdateAvailableDescription", {
              current: cli.currentVersion ?? t("skills.none"),
              latest: cli.latestVersion ?? t("skills.none"),
            })}
          </CardDescription>
        </div>
        <Button type="button" variant="outline" size="sm" disabled={isUpdating} onClick={onUpdate}>
          {isUpdating ? <AppIcons.status.loading className="animate-spin" /> : <AppIcons.action.download />}
          {isUpdating ? t("skills.updatingCli") : t("skills.updateCli")}
        </Button>
      </div>
      <SkillErrorNotice error={error} />
    </Card>
  )
}

interface InstalledSkillRowProps {
  group: ManagedSkillGroup
  onOpen: () => void
  selected: boolean
  updateRegistrySkill: (skill: Pick<ManagedSkillGroup, "id" | "kind" | "packageName">) => void
  updatingRegistrySkillId: string | null
  versionCheck: SkillVersionReport["skills"][number] | undefined
}

function InstalledSkillRow({
  group,
  onOpen,
  selected,
  updateRegistrySkill,
  updatingRegistrySkillId,
  versionCheck,
}: InstalledSkillRowProps) {
  const { t } = useAppI18n()
  const status = getGroupStatus(group, t, getRuntimeHosts(group))
  const hasUpdate = hasSkillUpdateAvailable(versionCheck)
  const canUpdate = hasUpdate && shouldUpdatePublishedSkill(group)
  const isPublishable = isPublishableLocalSkill(group)
  const hasAttention = status.tone === "attention" || status.tone === "danger"
  const hasRuntimeHost = hasRuntimeInstalledHost(group)
  const hasExternalHost = hasExternalInstalledHost(group)
  const statusLabel = hasUpdate
    ? t("skills.updateAvailable")
    : hasAttention
      ? (status.label ?? t("skills.groupStatus.modified"))
      : !hasRuntimeHost && hasExternalHost
        ? t("skills.externalInstalled")
        : isPublishable
          ? t("skills.publishable")
          : t("skills.installed")
  const badgeTone: ObjectStatusTone = hasUpdate
    ? "attention"
    : hasAttention
      ? status.tone
      : !hasRuntimeHost && hasExternalHost
        ? "pending"
        : "ready"
  const badgeClassName =
    isPublishable && !hasUpdate && !hasAttention && (hasRuntimeHost || !hasExternalHost)
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
        : !hasRuntimeHost && hasExternalHost
          ? t("skills.externalInstalledDescription", { platforms: getSkillPlatformLine(group, t) })
          : isPublishable
            ? t("skills.publishableDescription")
            : t("skills.installedDescription")
  const isUpdating = updatingRegistrySkillId === group.id

  return (
    <SkillListRow
      icon={<SkillIconFrame icon={group.icon} className="size-9" iconClassName="size-4.5" />}
      selected={selected}
      title={group.name}
      subtitle={
        <span className="min-w-0 truncate" title={packageLine}>
          {packageLine}
        </span>
      }
      description={group.description}
      badges={
        <Badge className={badgeClassName} variant={badgeTone === "danger" ? "destructive" : "outline"}>
          {statusLabel}
        </Badge>
      }
      meta={
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <InstalledSkillPlatformBadges group={group} />
          <span className="min-w-0 truncate" title={getSkillCreatorLine(group, t)}>
            {getSkillCreatorLine(group, t)}
          </span>
          <span className="min-w-0 truncate" title={runtimeLabel}>
            {runtimeLabel}
          </span>
        </div>
      }
      actions={
        canUpdate ? (
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
        )
      }
      onSelect={onOpen}
    />
  )
}

function InstalledSkillPlatformBadges({ group }: { group: ManagedSkillGroup }) {
  const hosts = getInstalledPlatformHosts(group)

  if (hosts.length === 0) {
    return null
  }

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1">
      {hosts.map((host) => (
        <span
          key={`${host.agentId}:${host.path ?? host.agentName}`}
          className="inline-flex min-w-0 items-center gap-1 rounded-md border bg-background px-1.5 py-0.5"
          title={host.path ? `${host.agentName}: ${host.path}` : host.agentName}
        >
          <AgentIcon host={host.agentName} className="oo-entity-icon-compact size-5 border-0" />
          <span className="oo-text-micro max-w-24 truncate text-muted-foreground">{host.agentName}</span>
        </span>
      ))}
    </div>
  )
}
