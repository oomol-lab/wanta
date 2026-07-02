import type { ManagedSkillGroup, SkillVersionReport } from "../../../electron/skills/common.ts"
import type { SkillVersionCheckByKey } from "./skill-route-model.ts"
import type { ObjectStatusTone } from "@/components/ObjectRow"

import * as React from "react"
import {
  getGroupRowPackageLine,
  getGroupStatus,
  getRuntimeHosts,
  getSkillKindLabel,
  getSkillVersionCheck,
  getSkillRowStatusBadgeClassName,
  hasSkillUpdateAvailable,
  isPublishableLocalSkill,
  shouldUpdatePublishedSkill,
} from "./skill-route-model.ts"
import { SkillErrorNotice } from "./SkillErrorNotice.tsx"
import { SkillIconFrame, SkillManagementSheet } from "./SkillUiParts.tsx"
import { AppIcons } from "@/components/AppIcons"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardDescription } from "@/components/ui/card"
import { useAppI18n } from "@/i18n"
import { cn } from "@/lib/utils"

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
  const status = getGroupStatus(group, t, getRuntimeHosts(group))
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
          <SkillIconFrame icon={group.icon} />
          <div className="grid min-w-0 gap-1">
            <div className="oo-text-label min-w-0 truncate">{group.name}</div>
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
