import type {
  ManagedSkillGroup,
  ManagedSkillHostCoverage,
  SkillVersionReport,
} from "../../../electron/skills/common.ts"
import type { SkillDocumentViewMode } from "./skill-route-model.ts"
import type { ObjectStatusTone } from "@/components/ObjectRow"

import * as React from "react"
import { toast } from "sonner"
import { skillErrorMessage } from "./skill-errors.ts"
import {
  getGroupRowPackageLine,
  getGroupStatus,
  getHostStatus,
  getLocalSkillPublishPath,
  getRuntimeHosts,
  getSkillDocumentRootPath,
  getSkillKindLabel,
  getStatusBadgeClassName,
  hasSkillUpdateAvailable,
  isPublishableLocalSkill,
  shouldShowStatusBadge,
  shouldUpdatePublishedSkill,
  skillDocumentPreviewSource,
} from "./skill-route-model.ts"
import { SkillErrorNotice } from "./SkillErrorNotice.tsx"
import { AgentIcon } from "@/components/AgentIcon"
import { MessageResponse } from "@/components/ai-elements/message"
import { useSkillService } from "@/components/AppContext"
import { AppIcons } from "@/components/AppIcons"
import { ErrorNotice } from "@/components/ErrorNotice"
import { InspectorCard, InspectorInsetCard } from "@/components/InspectorPanel"
import { ObjectRowSkeletonGroup, SkeletonText } from "@/components/LoadingSkeletons"
import { ObjectStatusIcon } from "@/components/ObjectRow"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useAppI18n } from "@/i18n"
import { resolveUserFacingError } from "@/lib/user-facing-error"
import { cn } from "@/lib/utils"

const publishableSkillBadgeClassName = "oo-badge-info oo-text-micro h-5 shrink-0 px-1.5 font-medium"

const skillUpdateBadgeBaseClassName =
  "oo-text-micro h-5 shrink-0 border-[var(--oo-warning-border)] bg-[var(--oo-warning-surface)] px-1.5 font-medium text-[var(--oo-warning-foreground)]"
const skillUpdateBadgeClassName = skillUpdateBadgeBaseClassName
const skillUpdateActionBadgeClassName = cn(
  "oo-text-caption-compact h-7 shrink-0 border-[var(--oo-warning-border)] bg-[var(--oo-warning-surface)] px-2 font-medium text-[var(--oo-warning-foreground)]",
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

export interface SkillDetailContentProps {
  copySkillPath: (pathname: string) => void
  inventoryInitialLoading: boolean
  isRemovingSkill: boolean
  openSkillFolder: (pathname: string) => void
  publishSkill: (skill: ManagedSkillGroup) => Promise<void>
  publishingSkillId: string | null
  requestRemoveSkill: (skill: ManagedSkillGroup) => void
  selectedPlanError: unknown
  selectedSkill: ManagedSkillGroup | undefined
  selectedStatus: ReturnType<typeof getGroupStatus> | null
  selectedVersionCheck?: SkillVersionReport["skills"][number]
  updateRegistrySkill: (skill: Pick<ManagedSkillGroup, "id" | "kind" | "packageName">) => void
  updatingRegistrySkillId: string | null
}

export function SkillDetailContent({
  copySkillPath,
  inventoryInitialLoading,
  isRemovingSkill,
  openSkillFolder,
  publishSkill,
  publishingSkillId,
  requestRemoveSkill,
  selectedPlanError,
  selectedSkill,
  selectedStatus,
  selectedVersionCheck,
  updateRegistrySkill,
  updatingRegistrySkillId,
}: SkillDetailContentProps) {
  const { t } = useAppI18n()

  if (inventoryInitialLoading) {
    return <SkillDetailSkeleton />
  }

  if (selectedSkill && selectedStatus) {
    return (
      <SkillPeek
        openSkillFolder={openSkillFolder}
        copySkillPath={copySkillPath}
        planError={selectedPlanError}
        publishSkill={publishSkill}
        publishingSkillId={publishingSkillId}
        isRemovingSkill={isRemovingSkill}
        requestRemoveSkill={requestRemoveSkill}
        selectedSkill={selectedSkill}
        selectedStatus={selectedStatus}
        selectedVersionCheck={selectedVersionCheck}
        updateRegistrySkill={updateRegistrySkill}
        updatingRegistrySkillId={updatingRegistrySkillId}
      />
    )
  }

  return <div className="oo-text-body oo-text-muted p-4">{t("skills.detailPlaceholder")}</div>
}

interface SkillPeekProps {
  copySkillPath: (pathname: string) => void
  isRemovingSkill: boolean
  openSkillFolder: (pathname: string) => void
  planError: unknown
  publishSkill: (skill: ManagedSkillGroup) => Promise<void>
  publishingSkillId: string | null
  requestRemoveSkill: (skill: ManagedSkillGroup) => void
  selectedSkill: ManagedSkillGroup
  selectedStatus: ReturnType<typeof getGroupStatus>
  selectedVersionCheck?: SkillVersionReport["skills"][number]
  updateRegistrySkill: (skill: Pick<ManagedSkillGroup, "id" | "kind" | "packageName">) => void
  updatingRegistrySkillId: string | null
}

function SkillPeek({
  copySkillPath,
  isRemovingSkill,
  openSkillFolder,
  planError,
  publishSkill,
  publishingSkillId,
  requestRemoveSkill,
  selectedSkill,
  selectedStatus,
  selectedVersionCheck,
  updateRegistrySkill,
  updatingRegistrySkillId,
}: SkillPeekProps) {
  const { t } = useAppI18n()
  const skillService = useSkillService()
  const runtimeHosts = getRuntimeHosts(selectedSkill)
  const installedHosts = selectedSkill.hosts.filter((host) => host.status === "installed")
  const skillDocumentRootPath = getSkillDocumentRootPath(selectedSkill)
  const hasPublishedUpdate = hasSkillUpdateAvailable(selectedVersionCheck)
  const canUpdatePublishedSkill = hasPublishedUpdate && shouldUpdatePublishedSkill(selectedSkill)
  const canRestoreRegistrySkill = selectedSkill.kind === "registry" && Boolean(selectedSkill.packageName?.trim())
  const isUpdatingRegistrySkill = updatingRegistrySkillId === selectedSkill.id
  const localPublishPath = getLocalSkillPublishPath(selectedSkill)
  const canPublishLocalSkill = Boolean(localPublishPath)
  const isPublishingSkill = publishingSkillId === selectedSkill.id
  const attentionHosts = runtimeHosts.filter(
    (host) => host.controlState === "modified" || host.controlState === "source-missing",
  )
  const hostAttentionCount = attentionHosts.length
  const canOpenLocalSkillFiles = Boolean(skillDocumentRootPath)
  const headingRef = useDesktopDetailHeadingFocus<HTMLHeadingElement>(selectedSkill.id)
  const [skillDocument, setSkillDocument] = React.useState<{ content: string; path: string } | null>(null)
  const [skillDocumentError, setSkillDocumentError] = React.useState<string | null>(null)
  const [isSkillDocumentLoading, setIsSkillDocumentLoading] = React.useState(false)
  const [skillDocumentViewMode, setSkillDocumentViewMode] = React.useState<SkillDocumentViewMode>("preview")
  const hasSourceMissingHost = attentionHosts.some((host) => host.controlState === "source-missing")
  const hostAttentionTone: ObjectStatusTone = hasSourceMissingHost ? "danger" : "attention"
  const packageLine = getGroupRowPackageLine(selectedSkill)
  const statusDescription = hasPublishedUpdate
    ? t("skills.versionUpdateAvailable", {
        current: selectedVersionCheck?.currentVersion ?? "",
        latest: selectedVersionCheck?.latestVersion ?? "",
      })
    : packageLine
  const previewDocumentContent = skillDocument ? skillDocumentPreviewSource(skillDocument.content) : ""

  React.useEffect(() => {
    setSkillDocumentViewMode("preview")
  }, [selectedSkill.id])

  React.useEffect(() => {
    let cancelled = false

    setSkillDocument(null)
    setSkillDocumentError(null)

    if (!skillDocumentRootPath) {
      setIsSkillDocumentLoading(false)
      return () => {
        cancelled = true
      }
    }

    setIsSkillDocumentLoading(true)
    void skillService
      .invoke("readSkillDocument", { path: skillDocumentRootPath })
      .then((document) => {
        if (!cancelled) {
          setSkillDocument(document)
        }
      })
      .catch((cause) => {
        if (!cancelled) {
          setSkillDocumentError(skillErrorMessage(cause, t))
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsSkillDocumentLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [skillDocumentRootPath, skillService, t])

  const openSkillDocument = React.useCallback(async () => {
    if (!skillDocumentRootPath) {
      return
    }

    try {
      await skillService.invoke("openSkillDocument", { path: skillDocumentRootPath })
    } catch (cause) {
      toast.error(t("skills.openDocumentFailed", { error: skillErrorMessage(cause, t) }))
    }
  }, [skillDocumentRootPath, skillService, t])

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <InspectorCard className="shrink-0">
        <CardHeader className="grid gap-1 px-3 py-0">
          <CardTitle ref={headingRef} className="oo-text-label min-w-0 truncate outline-none" tabIndex={-1}>
            {selectedSkill.name}
          </CardTitle>
          {statusDescription ? (
            <CardDescription className="min-w-0 truncate">{statusDescription}</CardDescription>
          ) : null}
        </CardHeader>
        <CardContent className="grid gap-2 px-3">
          <div className="flex min-w-0 flex-wrap items-center gap-1">
            <Badge variant="secondary">{getSkillKindLabel(selectedSkill.kind, t)}</Badge>
            {shouldShowStatusBadge(selectedStatus.tone) && selectedStatus.label ? (
              <Badge
                className={cn("shrink-0", getStatusBadgeClassName(selectedStatus.tone))}
                variant={selectedStatus.badge}
              >
                {selectedStatus.label}
              </Badge>
            ) : null}
            {isPublishableLocalSkill(selectedSkill) ? (
              <Badge className={publishableSkillBadgeClassName} variant="outline">
                {t("skills.publishable")}
              </Badge>
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
            {!packageLine && selectedSkill.version ? <Badge variant="outline">{selectedSkill.version}</Badge> : null}
          </div>
          {selectedSkill.description ? (
            <CardDescription className="line-clamp-6 min-w-0 break-words text-foreground/80">
              {selectedSkill.description}
            </CardDescription>
          ) : null}
          {hostAttentionCount > 0 ? (
            <div
              className={cn(
                "grid gap-2 rounded-md border px-2.5 py-2",
                hasSourceMissingHost
                  ? "border-[var(--oo-danger-border)] bg-[var(--oo-danger-surface)]"
                  : "border-[var(--oo-warning-border)] bg-[var(--oo-warning-surface)]",
              )}
            >
              <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-2">
                <ObjectStatusIcon tone={hostAttentionTone} />
                <div className="grid min-w-0 gap-1">
                  <div className="oo-text-caption-compact font-medium">{t("skills.localChangeActionTitle")}</div>
                  <CardDescription className="oo-text-caption-compact">
                    {hasSourceMissingHost && canRestoreRegistrySkill
                      ? t("skills.localChangeSourceMissingDescription")
                      : canRestoreRegistrySkill
                        ? t("skills.localChangeRegistryDescription")
                        : t("skills.localChangeLocalDescription")}
                  </CardDescription>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 pl-6">
                {canRestoreRegistrySkill ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isUpdatingRegistrySkill}
                    onClick={() => updateRegistrySkill(selectedSkill)}
                  >
                    {isUpdatingRegistrySkill ? <AppIcons.status.loading className="animate-spin" /> : null}
                    {isUpdatingRegistrySkill ? t("skills.updatingRegistry") : t("skills.restoreRegistryVersion")}
                  </Button>
                ) : null}
                {localPublishPath ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isPublishingSkill}
                    onClick={() => void publishSkill(selectedSkill)}
                  >
                    {isPublishingSkill ? <AppIcons.status.loading className="animate-spin" /> : null}
                    {isPublishingSkill ? t("skills.publishing") : t("skills.publishToMarket")}
                  </Button>
                ) : null}
                {canOpenLocalSkillFiles ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (skillDocumentRootPath) {
                        openSkillFolder(skillDocumentRootPath)
                      }
                    }}
                  >
                    {t("skills.openLocalFiles")}
                  </Button>
                ) : null}
              </div>
              <CardDescription className="oo-text-caption-compact pl-6">
                {t("skills.localChangeSkipDescription")}
              </CardDescription>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-1">
            {canPublishLocalSkill && hostAttentionCount === 0 ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isPublishingSkill}
                onClick={() => void publishSkill(selectedSkill)}
              >
                {isPublishingSkill ? <AppIcons.status.loading className="animate-spin" /> : <AppIcons.action.publish />}
                {isPublishingSkill
                  ? t("skills.publishing")
                  : selectedSkill.packageName?.trim()
                    ? t("skills.republishToMarket")
                    : t("skills.publishToMarket")}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="border-[var(--oo-danger-border)] text-destructive hover:bg-[var(--oo-danger-surface)] hover:text-destructive"
              disabled={isRemovingSkill}
              onClick={() => requestRemoveSkill(selectedSkill)}
            >
              {isRemovingSkill ? <AppIcons.status.loading className="animate-spin" /> : <AppIcons.action.delete />}
              {isRemovingSkill ? t("skills.removing") : t("skills.removeConfirmAction")}
            </Button>
          </div>
          <SkillErrorNotice error={planError} />
        </CardContent>
      </InspectorCard>

      {installedHosts.length > 0 ? (
        <InspectorInsetCard className="shrink-0 gap-2 px-3 py-3">
          <div className="grid min-w-0 gap-1">
            <div className="oo-text-label min-w-0 truncate">{t("skills.installedLocationsTitle")}</div>
            <CardDescription className="oo-text-caption-compact">
              {t("skills.installedLocationsHelper")}
            </CardDescription>
          </div>
          <div className="grid max-h-56 gap-1.5 overflow-auto pr-1">
            {installedHosts.map((host) => (
              <SkillInstallLocationRow
                key={`${host.agentId}:${host.scope}:${host.path ?? host.sourcePath ?? host.agentName}`}
                host={host}
                copySkillPath={copySkillPath}
                openSkillFolder={openSkillFolder}
              />
            ))}
          </div>
        </InspectorInsetCard>
      ) : null}

      <InspectorInsetCard className="flex flex-col gap-2 px-3 py-3">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <div className="oo-text-label min-w-0 truncate">{t("skills.documentTitle")}</div>
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              className="shrink-0"
              value={skillDocumentViewMode}
              onValueChange={(value) => {
                if (value === "preview" || value === "raw") {
                  setSkillDocumentViewMode(value)
                }
              }}
            >
              <ToggleGroupItem value="preview">{t("skills.documentPreview")}</ToggleGroupItem>
              <ToggleGroupItem value="raw">{t("skills.documentRaw")}</ToggleGroupItem>
            </ToggleGroup>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!skillDocumentRootPath || Boolean(skillDocumentError)}
              onClick={() => void openSkillDocument()}
            >
              <AppIcons.action.openExternal />
              {t("skills.openDocument")}
            </Button>
          </div>
        </div>
        <div className="min-h-0">
          {isSkillDocumentLoading ? (
            <div className="grid min-h-32 content-start gap-2 rounded-md border bg-background p-2.5">
              <SkeletonText className="w-5/6" />
              <SkeletonText className="w-4/6" />
              <SkeletonText className="w-3/4" />
            </div>
          ) : skillDocumentError ? (
            <ErrorNotice
              error={resolveUserFacingError(skillDocumentError, { area: "skills", preserveMessage: true })}
              compact
            />
          ) : skillDocument ? (
            <div className="max-h-96 min-h-32 overflow-auto rounded-md border bg-background p-3">
              {skillDocumentViewMode === "preview" ? (
                <MessageResponse className="max-w-none text-foreground/85">{previewDocumentContent}</MessageResponse>
              ) : (
                <pre className="font-mono text-xs leading-relaxed break-words whitespace-pre-wrap text-foreground/80">
                  {skillDocument.content}
                </pre>
              )}
            </div>
          ) : (
            <CardDescription className="oo-text-caption-compact">{t("skills.documentUnavailable")}</CardDescription>
          )}
        </div>
      </InspectorInsetCard>

      {hasPublishedUpdate && canUpdatePublishedSkill ? (
        <InspectorInsetCard className="shrink-0 gap-2 border-[var(--oo-warning-border)] bg-[var(--oo-warning-surface)] px-3 py-2">
          <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-2">
            <ObjectStatusIcon tone="attention" />
            <div className="grid min-w-0 gap-1">
              <div className="oo-text-caption-compact font-medium">{t("skills.installedSuggestedActionTitle")}</div>
              <CardDescription className="oo-text-caption-compact">
                {t("skills.installedSuggestedUpdateDescription", {
                  latest: selectedVersionCheck?.latestVersion ?? "",
                })}
              </CardDescription>
            </div>
          </div>
          <div className="flex justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isUpdatingRegistrySkill}
              onClick={() => updateRegistrySkill(selectedSkill)}
            >
              {isUpdatingRegistrySkill ? <AppIcons.status.loading className="animate-spin" /> : null}
              {isUpdatingRegistrySkill ? t("skills.updatingRegistry") : t("skills.updateRegistry")}
            </Button>
          </div>
        </InspectorInsetCard>
      ) : null}
    </div>
  )
}

function SkillInstallLocationRow({
  copySkillPath,
  host,
  openSkillFolder,
}: {
  copySkillPath: (pathname: string) => void
  host: ManagedSkillHostCoverage
  openSkillFolder: (pathname: string) => void
}) {
  const { t } = useAppI18n()
  const status = getHostStatus(host, t)
  const pathname = host.path ?? host.sourcePath

  return (
    <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-md border bg-background px-2.5 py-2">
      <AgentIcon host={host.agentName} />
      <div className="grid min-w-0 gap-0.5">
        <div className="flex min-w-0 items-center gap-2">
          <div className="oo-text-caption-compact min-w-0 truncate font-medium">{host.agentName}</div>
          {status.label ? (
            <Badge
              className={cn("oo-text-micro h-5 px-1.5", getStatusBadgeClassName(status.tone))}
              variant={status.variant}
            >
              {status.label}
            </Badge>
          ) : null}
        </div>
        {pathname ? (
          <div className="oo-text-micro min-w-0 truncate text-muted-foreground" title={pathname}>
            {pathname}
          </div>
        ) : null}
      </div>
      {pathname ? (
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label={t("skills.copyPath")}
            onClick={() => copySkillPath(pathname)}
          >
            <AppIcons.action.copy className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label={t("skills.openFolder")}
            onClick={() => openSkillFolder(pathname)}
          >
            <AppIcons.action.openFolder className="size-3.5" />
          </Button>
        </div>
      ) : null}
    </div>
  )
}
