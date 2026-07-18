import type { PublicSkillPackage } from "../../../electron/skills/common.ts"
import type { ManagedSkillGroupById } from "./skill-route-model.ts"

import * as React from "react"
import {
  canInstallPublicSkill,
  formatPublicPackageUpdateTime,
  getPublicPackageInstallState,
  getPublicPackageMaintainerLine,
  getPublicPackagePrimaryInstallSkill,
  getPublicPackagePrimarySkill,
  getPublicSkillInstallKey,
  getPublicSkillInstallState,
  getPublicSkillInstallStateLabel,
} from "./skill-route-model.ts"
import { SkillIconFrame, SkillManagementSheet } from "./SkillUiParts.tsx"
import { AppIcons } from "@/components/AppIcons"
import { InspectorCard, InspectorInsetCard } from "@/components/InspectorPanel"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useAppI18n } from "@/i18n"
import { cn } from "@/lib/utils"

interface PublicSkillPackageSheetProps {
  additionalActions?: React.ReactNode
  groupById: ManagedSkillGroupById
  installingKey: string | null
  locale: string
  onClose: () => void
  onInstall: (pkg: PublicSkillPackage, skillName?: string) => void
  onOpenManagedSkill: (skillName: string) => void
  pkg: PublicSkillPackage
}

export function PublicSkillPackageSheet({
  additionalActions,
  groupById,
  installingKey,
  locale,
  onClose,
  onInstall,
  onOpenManagedSkill,
  pkg,
}: PublicSkillPackageSheetProps) {
  return (
    <SkillManagementSheet
      ariaLabel={pkg.displayName}
      subjectName={pkg.displayName}
      title={pkg.displayName}
      onClose={onClose}
    >
      <PublicSkillPackageDetail
        additionalActions={additionalActions}
        groupById={groupById}
        installingKey={installingKey}
        locale={locale}
        pkg={pkg}
        onInstall={onInstall}
        onOpenManagedSkill={onOpenManagedSkill}
      />
    </SkillManagementSheet>
  )
}

interface PublicSkillPackageDetailProps {
  additionalActions?: React.ReactNode
  className?: string
  groupById: ManagedSkillGroupById
  installingKey: string | null
  locale: string
  onInstall: (pkg: PublicSkillPackage, skillName?: string) => void
  onOpenManagedSkill: (skillName: string) => void
  pkg: PublicSkillPackage
}

function PublicSkillPackageDetail({
  additionalActions,
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
          <SkillIconFrame icon={pkg.icon} />
          <div className="grid min-w-0 flex-1 gap-1">
            <CardTitle className="oo-text-label min-w-0 truncate">{pkg.displayName}</CardTitle>
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
                  onClick={() => onInstall(pkg)}
                >
                  {isInstallingPrimary ? (
                    <AppIcons.status.loading className="animate-spin" />
                  ) : (
                    <AppIcons.action.installPackage />
                  )}
                  {isInstallingPrimary
                    ? t("skills.registryInstalling")
                    : primaryState === "partially-installed"
                      ? t("skills.discoverInstallMissing")
                      : primaryState === "unavailable"
                        ? t("skills.discoverUnavailable")
                        : t("organizations.skillManageInstallRuntime")}
                </Button>
              )}
              {additionalActions}
            </div>
          ) : additionalActions ? (
            <div className="flex min-w-0 flex-wrap gap-1">{additionalActions}</div>
          ) : null}
        </CardContent>
      </InspectorCard>

      <InspectorInsetCard className="gap-2 px-3 py-2">
        <div className="oo-text-caption-compact font-medium">{t("skills.discoverIncludedSkills")}</div>
        <div className="grid gap-1.5">
          {pkg.skills.map((skill) => {
            const state = getPublicSkillInstallState(groupById, pkg, skill.name)
            return (
              <div key={skill.name} className="flex min-w-0 items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="oo-text-caption-compact truncate text-foreground">{skill.title || skill.name}</div>
                  <div className="oo-text-caption-compact truncate text-muted-foreground">{skill.name}</div>
                </div>
                <Badge variant="outline" className="shrink-0">
                  {getPublicSkillInstallStateLabel(state, t)}
                </Badge>
              </div>
            )
          })}
        </div>
      </InspectorInsetCard>

      <InspectorInsetCard className="gap-2 px-3 py-2">
        <div className="oo-text-caption-compact font-medium">{t("skills.discoverPackageInfo")}</div>
        <div className="oo-text-caption-compact grid gap-1">
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
