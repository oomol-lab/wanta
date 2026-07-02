import type { PublicSkillPackage } from "../../../electron/skills/common.ts"
import type { ManagedSkillGroupById } from "./skill-route-model.ts"

import * as React from "react"
import { getFocusableElements } from "./skill-focus.ts"
import {
  canInstallPublicSkill,
  formatPublicPackageUpdateTime,
  getPublicPackageInstallState,
  getPublicPackageMaintainerLine,
  getPublicPackagePrimaryInstallSkill,
  getPublicPackagePrimarySkill,
  getPublicSkillInstallKey,
} from "./skill-route-model.ts"
import { SkillIconFrame } from "./SkillUiParts.tsx"
import { AppIcons } from "@/components/AppIcons"
import { InspectorCard, InspectorInsetCard } from "@/components/InspectorPanel"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useAppI18n } from "@/i18n"
import { cn } from "@/lib/utils"

interface PublicSkillPackageSheetProps {
  groupById: ManagedSkillGroupById
  installingKey: string | null
  locale: string
  onClose: () => void
  onInstall: (pkg: PublicSkillPackage, skillName?: string) => void
  onOpenManagedSkill: (skillName: string) => void
  pkg: PublicSkillPackage
}

export function PublicSkillPackageSheet({
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
      className="oo-modal-backdrop fixed inset-0 z-[120]"
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
          <div className="oo-text-label min-w-0 truncate">{pkg.displayName}</div>
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
                  onClick={() => onInstall(pkg, primaryInstallSkill?.name)}
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
            </div>
          ) : null}
        </CardContent>
      </InspectorCard>

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
