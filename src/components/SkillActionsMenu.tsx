import type {
  ManagedSkillGroup,
  ShareSkillRequest,
  SkillEditorApp,
  SkillEditorAppId,
  SkillShareInfo,
  SkillShareResult,
} from "../../electron/skills/common"
import type { SkillRemoveTarget } from "@/components/useSkillObjectActions"

import * as React from "react"
import { AgentIcon } from "@/components/AgentIcon"
import { useSkillShareInfoStore } from "@/components/AppDataHooks"
import { AppIcons } from "@/components/AppIcons"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
  ConfirmDialog,
  ConfirmDialogAction,
  ConfirmDialogCancel,
  ConfirmDialogContent,
  ConfirmDialogDescription,
  ConfirmDialogFooter,
  ConfirmDialogHeader,
  ConfirmDialogTitle,
} from "@/components/ui/confirm-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useAppI18n } from "@/i18n"
import { cn } from "@/lib/utils"

interface SkillActionsMenuProps {
  actingSkillKey: string | null
  canDeleteSkill: boolean
  canPublishSkill: boolean
  canShareSkill: boolean
  className?: string
  copySharePrompt: (prompt: string) => Promise<boolean>
  density?: "compact" | "default"
  copySkillPath: (pathname: string) => void
  openSkillFolder: (pathname: string) => void
  openSkillInEditor: (pathname: string, editorId?: SkillEditorAppId) => void
  primaryPath: string | undefined
  publishSkill: (skill: ManagedSkillGroup, visibility: "private" | "public") => void
  selectedSkill: ManagedSkillGroup
  skillEditors: SkillEditorApp[]
  skillVisibilityInfo?: SkillShareInfo
  setRemoveTarget: (target: SkillRemoveTarget) => void
  shareSkill: (
    skill: ManagedSkillGroup,
    options?: Omit<ShareSkillRequest, "language" | "skillId">,
  ) => Promise<SkillShareResult | undefined>
}

type ShareableSkillHost = ManagedSkillGroup["hosts"][number] & {
  agentId: string
  agentName: string
  path: string
  status: "installed"
}

type PublishMenuActionKind = "publish-private" | "publish-public" | "change-private" | "change-public" | "republish"

interface PublishMenuAction {
  kind: PublishMenuActionKind
  labelKey: string
  requiresConfirmation: boolean
  visibility: "private" | "public"
}

interface PublishActionState {
  menuActions: PublishMenuAction[]
  primaryAction?: PublishMenuAction
}

const inlineShareAgentLimit = 6
const visibleShareAgentLimitWithMore = 5
const preferredSkillEditorStorageKey = "oo-desktop.preferredSkillEditor"

function getShareableHosts(skill: ManagedSkillGroup): ShareableSkillHost[] {
  return skill.hosts.filter((host): host is ShareableSkillHost => {
    return host.status === "installed" && Boolean(host.agentId) && Boolean(host.path?.trim())
  })
}

export function SkillActionsMenu({
  actingSkillKey,
  canDeleteSkill,
  canPublishSkill,
  canShareSkill,
  className,
  copySharePrompt,
  density = "default",
  copySkillPath,
  openSkillFolder,
  openSkillInEditor,
  primaryPath,
  publishSkill,
  selectedSkill,
  skillEditors,
  skillVisibilityInfo,
  setRemoveTarget,
  shareSkill,
}: SkillActionsMenuProps) {
  const { t } = useAppI18n()
  const [isShareOptionsOpen, setIsShareOptionsOpen] = React.useState(false)
  const [shareAutoGenerateKey, setShareAutoGenerateKey] = React.useState(0)
  const [confirmPublishAction, setConfirmPublishAction] = React.useState<PublishMenuAction | null>(null)
  const [preferredEditorId, setPreferredEditorId] = React.useState<SkillEditorAppId | "">(() => {
    return readPreferredSkillEditorId()
  })
  const isPublishing = actingSkillKey === `publish:${selectedSkill.id}`
  const isSharing = actingSkillKey === `share:${selectedSkill.id}`
  const isActing = isPublishing || isSharing
  const isCompact = density === "compact"
  const publishActionState = React.useMemo(
    () => getPublishActionState(selectedSkill, canPublishSkill, skillVisibilityInfo),
    [canPublishSkill, selectedSkill, skillVisibilityInfo],
  )
  const primaryPublishAction = !isCompact ? publishActionState.primaryAction : undefined
  const menuPublishActions = primaryPublishAction
    ? publishActionState.menuActions.filter((action) => action.kind !== primaryPublishAction.kind)
    : publishActionState.menuActions
  const isPrimaryPublish = Boolean(primaryPublishAction)
  const isPrimaryEditor = !isCompact && !isPrimaryPublish && Boolean(primaryPath)
  const isPrimaryShare = !isCompact && !isPrimaryPublish && !isPrimaryEditor && canShareSkill
  const showQuickEditor = !isCompact && Boolean(primaryPath) && !isPrimaryEditor
  const showQuickShare = !isCompact && !isPrimaryShare && canShareSkill
  const hasPublishActions = menuPublishActions.length > 0 || canShareSkill
  const hasDestructiveActions = canDeleteSkill
  const hasPrimaryAction = isPrimaryPublish || isPrimaryShare || isPrimaryEditor
  const hasMoreMenu = Boolean(primaryPath) || menuPublishActions.length > 0 || canShareSkill || canDeleteSkill
  const selectedEditor = getPreferredSkillEditor(skillEditors, preferredEditorId)
  const shareSourceHosts = selectedSkill.kind === "local" ? getShareableHosts(selectedSkill) : []
  const defaultShareAgentId = shareSourceHosts.length === 1 ? shareSourceHosts[0]?.agentId : undefined
  const needsShareAgentChoice = shareSourceHosts.length > 1
  const executePublishAction = React.useCallback(
    (action: PublishMenuAction) => {
      if (action.requiresConfirmation) {
        setConfirmPublishAction(action)
        return
      }

      publishSkill(selectedSkill, action.visibility)
    },
    [publishSkill, selectedSkill],
  )
  const openShareOptions = React.useCallback(() => {
    setShareAutoGenerateKey(0)
    setIsShareOptionsOpen(true)
  }, [])
  const openShareDialog = React.useCallback(() => {
    if (needsShareAgentChoice) {
      openShareOptions()
      return
    }

    setShareAutoGenerateKey((key) => key + 1)
    setIsShareOptionsOpen(true)
  }, [needsShareAgentChoice, openShareOptions])

  if (!hasPrimaryAction && !hasMoreMenu) {
    return null
  }

  return (
    <>
      <div className={cn("flex min-w-0 flex-wrap items-center gap-1", className)}>
        {isPrimaryPublish ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isActing}
            onClick={() => primaryPublishAction && executePublishAction(primaryPublishAction)}
          >
            {isPublishing ? <AppIcons.status.loading className="animate-spin" /> : <AppIcons.action.publish />}
            {isPublishing ? t("skills.publishing") : t(primaryPublishAction?.labelKey ?? "skills.publish")}
          </Button>
        ) : isPrimaryEditor && primaryPath ? (
          <SkillEditorButton
            editor={selectedEditor}
            editors={skillEditors}
            isPrimary
            onOpen={(editor) => openSkillInEditor(primaryPath, editor?.id)}
            onSelectEditor={(editor) => {
              rememberPreferredSkillEditorId(editor.id)
              setPreferredEditorId(editor.id)
              openSkillInEditor(primaryPath, editor.id)
            }}
          />
        ) : isPrimaryShare ? (
          <Button type="button" variant="outline" size="sm" disabled={isActing} onClick={openShareDialog}>
            {isSharing ? <AppIcons.status.loading className="animate-spin" /> : <AppIcons.action.share />}
            {isSharing ? t("skills.shareGenerating") : t("skills.share")}
          </Button>
        ) : null}

        {showQuickEditor && primaryPath ? (
          <SkillEditorButton
            editor={selectedEditor}
            editors={skillEditors}
            onOpen={(editor) => openSkillInEditor(primaryPath, editor?.id)}
            onSelectEditor={(editor) => {
              rememberPreferredSkillEditorId(editor.id)
              setPreferredEditorId(editor.id)
              openSkillInEditor(primaryPath, editor.id)
            }}
          />
        ) : null}
        {showQuickShare ? (
          <SkillActionIconButton
            disabled={isActing}
            icon={isSharing ? <AppIcons.status.loading className="animate-spin" /> : <AppIcons.action.share />}
            label={isSharing ? t("skills.shareGenerating") : t("skills.share")}
            onClick={openShareDialog}
          />
        ) : null}
        {hasMoreMenu ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="icon" aria-label={t("skills.actions")}>
                <AppIcons.action.more />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-48">
              {primaryPath ? (
                <>
                  <DropdownMenuItem onSelect={() => openSkillFolder(primaryPath)}>
                    <AppIcons.action.openFolder />
                    <span>{t("skills.openFolder")}</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => copySkillPath(primaryPath)}>
                    <AppIcons.action.copy />
                    <span>{t("skills.copyPath")}</span>
                  </DropdownMenuItem>
                </>
              ) : null}
              {primaryPath && hasPublishActions ? <DropdownMenuSeparator /> : null}
              {menuPublishActions.map((action) => (
                <DropdownMenuItem
                  key={action.kind}
                  disabled={isActing}
                  onSelect={(event) => {
                    event.preventDefault()
                    executePublishAction(action)
                  }}
                >
                  {isPublishing ? <AppIcons.status.loading className="animate-spin" /> : <AppIcons.action.publish />}
                  <span>{t(action.labelKey)}</span>
                </DropdownMenuItem>
              ))}
              {canShareSkill ? (
                <DropdownMenuItem disabled={isActing} onSelect={openShareOptions}>
                  <AppIcons.action.settings />
                  <span>{t("skills.shareOptions")}</span>
                </DropdownMenuItem>
              ) : null}
              {(Boolean(primaryPath) || hasPublishActions) && hasDestructiveActions ? <DropdownMenuSeparator /> : null}
              {canDeleteSkill ? (
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => setRemoveTarget({ scope: "all", skill: selectedSkill })}
                >
                  <AppIcons.action.delete />
                  <span>{t("skills.removeFromAllAgents")}</span>
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
      <SkillShareDialog
        autoGenerateKey={shareAutoGenerateKey}
        copySharePrompt={copySharePrompt}
        defaultAgentId={defaultShareAgentId}
        isGenerating={isSharing}
        isOpen={isShareOptionsOpen}
        onGenerate={(options) => shareSkill(selectedSkill, options)}
        onOpenChange={setIsShareOptionsOpen}
        shareSourceHosts={shareSourceHosts}
        skill={selectedSkill}
      />
      <ConfirmPublishDialog
        action={confirmPublishAction}
        isPublishing={isPublishing}
        onCancel={() => setConfirmPublishAction(null)}
        onConfirm={(action) => {
          setConfirmPublishAction(null)
          publishSkill(selectedSkill, action.visibility)
        }}
        skill={selectedSkill}
      />
    </>
  )
}

function getPublishActionState(
  skill: ManagedSkillGroup,
  canPublishSkill: boolean,
  visibilityInfo?: SkillShareInfo,
): PublishActionState {
  if (!canPublishSkill) {
    return { menuActions: [] }
  }

  const packageName = skill.packageName?.trim()
  const publishedVisibility = packageName ? visibilityInfo?.visibility : undefined

  if (!packageName || publishedVisibility === "unpublished" || !publishedVisibility) {
    const publishPrivate = createPublishAction("publish-private", "skills.publishPrivate", "private", false)
    const publishPublic = createPublishAction("publish-public", "skills.publishPublic", "public", false)

    return {
      primaryAction: packageName ? undefined : publishPrivate,
      menuActions: [publishPrivate, publishPublic],
    }
  }

  const installedHosts = skill.hosts.filter((host) => host.status === "installed")
  const hasLocalChanges = installedHosts.some((host) => host.controlState === "modified")
  const isKnownCurrent = installedHosts.length > 0 && installedHosts.every((host) => host.controlState === "controlled")
  const updateAction = createPublishAction("republish", "skills.publishUpdate", publishedVisibility, false)
  const oppositeVisibility = publishedVisibility === "private" ? "public" : "private"
  const changeAction = createPublishAction(
    publishedVisibility === "private" ? "change-public" : "change-private",
    publishedVisibility === "private" ? "skills.changeToPublicAndPublish" : "skills.changeToPrivateAndPublish",
    oppositeVisibility,
    true,
  )

  if (hasLocalChanges) {
    return {
      primaryAction: updateAction,
      menuActions: [changeAction],
    }
  }

  if (isKnownCurrent) {
    return {
      menuActions: [createPublishAction("republish", "skills.republish", publishedVisibility, true), changeAction],
    }
  }

  return {
    menuActions: [createPublishAction("republish", "skills.publishUpdate", publishedVisibility, true), changeAction],
  }
}

function createPublishAction(
  kind: PublishMenuActionKind,
  labelKey: string,
  visibility: "private" | "public",
  requiresConfirmation: boolean,
): PublishMenuAction {
  return {
    kind,
    labelKey,
    requiresConfirmation,
    visibility,
  }
}

interface ConfirmPublishDialogProps {
  action: PublishMenuAction | null
  isPublishing: boolean
  onCancel: () => void
  onConfirm: (action: PublishMenuAction) => void
  skill: ManagedSkillGroup
}

function ConfirmPublishDialog({ action, isPublishing, onCancel, onConfirm, skill }: ConfirmPublishDialogProps) {
  const { t } = useAppI18n()
  const isVisibilityChange = action?.kind === "change-private" || action?.kind === "change-public"

  return (
    <ConfirmDialog
      open={Boolean(action)}
      onOpenChange={(isOpen) => (!isOpen && !isPublishing ? onCancel() : undefined)}
    >
      <ConfirmDialogContent>
        <ConfirmDialogHeader>
          <ConfirmDialogTitle>
            {isVisibilityChange ? t("skills.visibilityChangeConfirmTitle") : t("skills.republishConfirmTitle")}
          </ConfirmDialogTitle>
          <ConfirmDialogDescription>
            {isVisibilityChange
              ? t(
                  action?.visibility === "private"
                    ? "skills.visibilityChangeConfirmPrivate"
                    : "skills.visibilityChangeConfirmPublic",
                  {
                    name: skill.name,
                  },
                )
              : t("skills.republishConfirmDescription", { name: skill.name })}
          </ConfirmDialogDescription>
        </ConfirmDialogHeader>
        <ConfirmDialogFooter>
          <ConfirmDialogCancel disabled={isPublishing}>{t("skills.deleteConfirmCancel")}</ConfirmDialogCancel>
          <ConfirmDialogAction
            disabled={isPublishing || !action}
            onClick={(event) => {
              event.preventDefault()
              if (action) {
                onConfirm(action)
              }
            }}
          >
            {isPublishing ? <AppIcons.status.loading className="animate-spin" /> : <AppIcons.action.publish />}
            {isPublishing
              ? t("skills.publishing")
              : t(isVisibilityChange ? "skills.visibilityChangeConfirmAction" : "skills.republishConfirmAction")}
          </ConfirmDialogAction>
        </ConfirmDialogFooter>
      </ConfirmDialogContent>
    </ConfirmDialog>
  )
}

interface SkillEditorButtonProps {
  editor?: SkillEditorApp
  editors: SkillEditorApp[]
  isPrimary?: boolean
  onOpen: (editor?: SkillEditorApp) => void
  onSelectEditor: (editor: SkillEditorApp) => void
}

function SkillEditorButton({ editor, editors, isPrimary = false, onOpen, onSelectEditor }: SkillEditorButtonProps) {
  const { t } = useAppI18n()
  const hasDetectedEditors = editors.length > 0
  const menuEditors = getSkillEditorMenuItems(editors)
  const activeEditor = editor ?? menuEditors.find((item) => item.isDefault) ?? menuEditors[0]
  const editorName = getSkillEditorName(activeEditor, t)
  const buttonLabel = activeEditor ? t("skills.openEditorWith", { name: editorName }) : t("skills.openEditor")

  return (
    <DropdownMenu>
      <div className="inline-flex min-w-0 items-center">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn("min-w-0 rounded-r-none pr-2", isPrimary ? "max-w-56" : "max-w-32")}
          onClick={() => onOpen(hasDetectedEditors ? activeEditor : undefined)}
        >
          <AppIcons.action.openExternal />
          <span className="truncate">{isPrimary ? buttonLabel : editorName}</span>
        </Button>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-8 rounded-l-none border-l-0 px-0"
            aria-label={t("skills.selectEditor")}
          >
            <AppIcons.status.disclosure className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
      </div>
      <DropdownMenuContent align="end" className="min-w-48">
        <DropdownMenuLabel>{t("skills.selectEditor")}</DropdownMenuLabel>
        {menuEditors.map((item) => {
          const isSelected = activeEditor?.id === item.id

          return (
            <DropdownMenuItem
              key={item.id}
              onSelect={(event) => {
                event.preventDefault()
                onSelectEditor(item)
              }}
            >
              {isSelected ? <AppIcons.action.check /> : <AppIcons.action.openExternal />}
              <span>{getSkillEditorName(item, t)}</span>
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function getPreferredSkillEditor(
  editors: SkillEditorApp[],
  preferredEditorId: SkillEditorAppId | "",
): SkillEditorApp | undefined {
  return (
    editors.find((editor) => editor.id === preferredEditorId) ??
    editors.find((editor) => editor.isDefault && editor.id !== "system") ??
    editors.find((editor) => editor.id !== "system") ??
    editors.find((editor) => editor.id === "system")
  )
}

function getSkillEditorName(editor: SkillEditorApp | undefined, t: ReturnType<typeof useAppI18n>["t"]): string {
  if (!editor) {
    return t("skills.defaultEditor")
  }

  return editor.id === "system" ? t("skills.systemDefaultEditor") : editor.name
}

function createSystemSkillEditor(isDefault: boolean): SkillEditorApp {
  return {
    available: true,
    id: "system",
    isDefault,
    name: "System default",
  }
}

function getSkillEditorMenuItems(editors: SkillEditorApp[]): SkillEditorApp[] {
  return editors.some((editor) => editor.id === "system") ? editors : [...editors, createSystemSkillEditor(true)]
}

function readPreferredSkillEditorId(): SkillEditorAppId | "" {
  const value = localStorage.getItem(preferredSkillEditorStorageKey)
  return isSkillEditorAppId(value) ? value : ""
}

function rememberPreferredSkillEditorId(editorId: SkillEditorAppId): void {
  localStorage.setItem(preferredSkillEditorStorageKey, editorId)
}

function isSkillEditorAppId(value: string | null): value is SkillEditorAppId {
  return (
    value === "vscode" ||
    value === "cursor" ||
    value === "windsurf" ||
    value === "trae" ||
    value === "qoder" ||
    value === "antigravity" ||
    value === "zed" ||
    value === "vscode-insiders" ||
    value === "codium" ||
    value === "sublime" ||
    value === "webstorm" ||
    value === "idea" ||
    value === "system"
  )
}

interface SkillActionIconButtonProps {
  disabled?: boolean
  icon: React.ReactNode
  label: string
  onClick: () => void
}

function SkillActionIconButton({ disabled, icon, label, onClick }: SkillActionIconButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" variant="ghost" size="icon" disabled={disabled} aria-label={label} onClick={onClick}>
          {icon}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

interface SkillShareDialogProps {
  autoGenerateKey: number
  copySharePrompt: (prompt: string) => Promise<boolean>
  defaultAgentId?: string
  isGenerating: boolean
  isOpen: boolean
  onGenerate: (options: Omit<ShareSkillRequest, "language" | "skillId">) => Promise<SkillShareResult | undefined>
  onOpenChange: (isOpen: boolean) => void
  shareSourceHosts: ShareableSkillHost[]
  skill: ManagedSkillGroup
}

function SkillShareDialog({
  autoGenerateKey,
  copySharePrompt,
  defaultAgentId,
  isGenerating,
  isOpen,
  onGenerate,
  onOpenChange,
  shareSourceHosts,
  skill,
}: SkillShareDialogProps) {
  const { t } = useAppI18n()
  const skillShareInfoStore = useSkillShareInfoStore()
  const firstShareSourceHost = shareSourceHosts[0]
  const [daysText, setDaysText] = React.useState("7")
  const [downloadsText, setDownloadsText] = React.useState("")
  const [selectedAgentId, setSelectedAgentId] = React.useState(defaultAgentId ?? firstShareSourceHost?.agentId ?? "")
  const [isCopied, setIsCopied] = React.useState(false)
  const [isShareInfoLoading, setIsShareInfoLoading] = React.useState(false)
  const [shareInfo, setShareInfo] = React.useState<SkillShareInfo>({
    limitsRequired: false,
    visibility: "unpublished",
  })
  const [validationError, setValidationError] = React.useState<string | null>(null)
  const [result, setResult] = React.useState<SkillShareResult | null>(null)
  const handledAutoGenerateKeyRef = React.useRef(0)
  const dialogRunIdRef = React.useRef(0)
  const isOpenRef = React.useRef(isOpen)
  const selectedHost = shareSourceHosts.find((host) => host.agentId === selectedAgentId)
  const sharePackageName = selectedHost?.packageName ?? skill.packageName

  React.useEffect(() => {
    isOpenRef.current = isOpen
  }, [isOpen])

  const setOpen = React.useCallback(
    (nextOpen: boolean) => {
      isOpenRef.current = nextOpen
      onOpenChange(nextOpen)
    },
    [onOpenChange],
  )

  const readShareInfo = React.useCallback(async () => {
    const packageName = sharePackageName?.trim()
    const dialogRunId = dialogRunIdRef.current

    if (!packageName) {
      return {
        limitsRequired: false,
        visibility: "unpublished",
      } satisfies SkillShareInfo
    }

    if (shareInfo.packageName === packageName) {
      return shareInfo
    }

    const cachedInfo = skillShareInfoStore.getEntry(packageName)?.info
    if (cachedInfo) {
      setShareInfo(cachedInfo)
      return cachedInfo
    }

    setIsShareInfoLoading(true)
    try {
      const nextInfo = await skillShareInfoStore.refreshPackage(packageName)
      if (isOpenRef.current && dialogRunIdRef.current === dialogRunId) {
        setShareInfo(nextInfo)
      }
      return nextInfo
    } catch {
      const fallbackInfo = {
        limitsRequired: false,
        packageName,
        visibility: "unpublished",
      } satisfies SkillShareInfo
      if (isOpenRef.current && dialogRunIdRef.current === dialogRunId) {
        setShareInfo(fallbackInfo)
      }
      return fallbackInfo
    } finally {
      if (isOpenRef.current && dialogRunIdRef.current === dialogRunId) {
        setIsShareInfoLoading(false)
      }
    }
  }, [shareInfo, sharePackageName, skillShareInfoStore])

  React.useEffect(() => {
    if (!isOpen) {
      dialogRunIdRef.current += 1
      setDaysText("7")
      setDownloadsText("")
      setSelectedAgentId(defaultAgentId ?? firstShareSourceHost?.agentId ?? "")
      setIsCopied(false)
      setIsShareInfoLoading(false)
      setShareInfo({
        limitsRequired: false,
        visibility: "unpublished",
      })
      setValidationError(null)
      setResult(null)
    }
  }, [defaultAgentId, firstShareSourceHost?.agentId, isOpen])

  React.useEffect(() => {
    if (!isOpen || result) {
      return
    }

    void readShareInfo()
  }, [isOpen, readShareInfo, result])

  const generateSharePrompt = React.useCallback(async () => {
    const dialogRunId = dialogRunIdRef.current
    const agentId = selectedAgentId.trim() || undefined
    const selectedHost = agentId ? shareSourceHosts.find((host) => host.agentId === agentId) : undefined
    const nextShareInfo = await readShareInfo()

    if (!isOpenRef.current || dialogRunIdRef.current !== dialogRunId) {
      return
    }

    const limitsRequired = nextShareInfo.limitsRequired
    const days = Number(daysText)
    const downloads = limitsRequired && downloadsText.trim() ? Number(downloadsText) : undefined

    if (limitsRequired && (!Number.isInteger(days) || days < 1 || days > 7)) {
      setValidationError(t("skills.shareValidationError"))
      return
    }

    if (limitsRequired && downloads !== undefined && (!Number.isInteger(downloads) || downloads < 1)) {
      setValidationError(t("skills.shareValidationError"))
      return
    }

    if (shareSourceHosts.length > 0 && !selectedHost) {
      setValidationError(t("skills.shareAgentValidationError"))
      return
    }

    setValidationError(null)
    const nextResult = await onGenerate({
      sourcePath: selectedHost?.path,
      ...(limitsRequired ? { days, downloads } : {}),
    })

    if (nextResult && isOpenRef.current && dialogRunIdRef.current === dialogRunId) {
      setResult(nextResult)
      setIsCopied(Boolean(nextResult.copied))
    }
  }, [daysText, downloadsText, onGenerate, readShareInfo, selectedAgentId, shareSourceHosts, t])

  React.useEffect(() => {
    if (!isOpen || autoGenerateKey === 0 || handledAutoGenerateKeyRef.current === autoGenerateKey) {
      return
    }

    handledAutoGenerateKeyRef.current = autoGenerateKey
    void generateSharePrompt()
  }, [autoGenerateKey, generateSharePrompt, isOpen])

  return (
    <ConfirmDialog open={isOpen} onOpenChange={setOpen}>
      <ConfirmDialogContent className="max-h-[min(720px,calc(100vh-2rem))] w-[min(calc(100vw-2rem),34rem)] overflow-y-auto">
        <ConfirmDialogHeader>
          <ConfirmDialogTitle>{t("skills.shareDialogTitle", { name: skill.name })}</ConfirmDialogTitle>
          <ConfirmDialogDescription>
            {result ? t("skills.shareResultDescription") : t("skills.shareDialogDescription")}
          </ConfirmDialogDescription>
        </ConfirmDialogHeader>
        <div className="grid gap-3">
          {shareSourceHosts.length > 1 && !result ? (
            <AgentSourcePicker
              disabled={isGenerating}
              hosts={shareSourceHosts}
              selectedAgentId={selectedAgentId}
              onSelect={setSelectedAgentId}
            />
          ) : null}
          {!isShareInfoLoading && shareInfo.limitsRequired ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="grid gap-1">
                <span className="oo-text-caption font-medium">{t("skills.shareDays")}</span>
                <Input
                  aria-invalid={Boolean(validationError)}
                  className="h-8"
                  disabled={isGenerating}
                  inputMode="numeric"
                  max={7}
                  min={1}
                  step={1}
                  type="number"
                  value={daysText}
                  onChange={(event) => setDaysText(event.currentTarget.value)}
                />
                <span className="oo-text-caption text-muted-foreground">{t("skills.shareDaysDescription")}</span>
              </label>
              <label className="grid gap-1">
                <span className="oo-text-caption font-medium">{t("skills.shareDownloads")}</span>
                <Input
                  aria-invalid={Boolean(validationError)}
                  className="h-8"
                  disabled={isGenerating}
                  inputMode="numeric"
                  min={1}
                  placeholder={t("skills.shareDownloadsPlaceholder")}
                  step={1}
                  type="number"
                  value={downloadsText}
                  onChange={(event) => setDownloadsText(event.currentTarget.value)}
                />
                <span className="oo-text-caption text-muted-foreground">{t("skills.shareDownloadsDescription")}</span>
              </label>
            </div>
          ) : null}
          {validationError ? <p className="oo-text-caption text-destructive">{validationError}</p> : null}
          {result ? (
            <div className="grid gap-2">
              <Card className="flex min-w-0 flex-row items-center justify-between gap-3 rounded-md border-[var(--oo-success-border)] bg-[var(--oo-success-surface)] px-3 py-2 text-[var(--oo-success-foreground)] shadow-none">
                <span className="flex min-w-0 items-center gap-2">
                  <AppIcons.status.ready className="oo-status-ready size-4 shrink-0" />
                  <span className="oo-text-label truncate">
                    {isCopied ? t("skills.shareCopiedInline") : t("skills.shareReadyInline")}
                  </span>
                </span>
                {isCopied ? <Badge variant="outline">{t("skills.shareResultBadge")}</Badge> : null}
              </Card>
              {result.installCommand ? (
                <div className="grid gap-1">
                  <div className="oo-text-caption font-medium">{t("skills.shareInstallCommand")}</div>
                  <code className="oo-text-caption truncate rounded-md border border-input bg-muted px-2 py-1 text-muted-foreground">
                    {result.installCommand}
                  </code>
                </div>
              ) : null}
              <label className="grid gap-1">
                <span className="oo-text-caption font-medium">{t("skills.sharePrompt")}</span>
                <Textarea className="min-h-36 resize-none" readOnly value={result.prompt} />
              </label>
            </div>
          ) : null}
        </div>
        <ConfirmDialogFooter>
          <ConfirmDialogCancel>{result ? t("skills.shareClose") : t("skills.deleteConfirmCancel")}</ConfirmDialogCancel>
          {result ? (
            <Button
              type="button"
              variant="outline"
              disabled={isGenerating}
              onClick={() => {
                void copySharePrompt(result.prompt).then((didCopy) => setIsCopied(didCopy))
              }}
            >
              <AppIcons.action.copy />
              {t("skills.shareCopyPrompt")}
            </Button>
          ) : null}
          <ConfirmDialogAction
            disabled={isGenerating || isShareInfoLoading}
            variant="default"
            onClick={(event) => {
              event.preventDefault()
              void generateSharePrompt()
            }}
          >
            {isGenerating ? <AppIcons.status.loading className="animate-spin" /> : <AppIcons.action.share />}
            {isGenerating
              ? t("skills.shareGenerating")
              : result
                ? t("skills.shareRegenerateAndCopy")
                : t("skills.shareGenerateAndCopy")}
          </ConfirmDialogAction>
        </ConfirmDialogFooter>
      </ConfirmDialogContent>
    </ConfirmDialog>
  )
}

interface AgentSourcePickerProps {
  disabled: boolean
  hosts: ShareableSkillHost[]
  selectedAgentId: string
  onSelect: (agentId: string) => void
}

function AgentSourcePicker({ disabled, hosts, selectedAgentId, onSelect }: AgentSourcePickerProps) {
  const { t } = useAppI18n()
  const selectedHost = hosts.find((host) => host.agentId === selectedAgentId) ?? hosts[0]
  const visibleHosts = getVisibleShareAgentHosts(hosts, selectedHost?.agentId)
  const visibleAgentIds = new Set(visibleHosts.map((host) => host.agentId))
  const overflowHosts = hosts.filter((host) => !visibleAgentIds.has(host.agentId))
  const selectedDescription = selectedHost?.path
    ? t("skills.shareSelectedAgentWithPath", { name: selectedHost.agentName, path: selectedHost.path })
    : selectedHost
      ? t("skills.shareSelectedAgent", { name: selectedHost.agentName })
      : t("skills.shareAgentDescription")

  return (
    <div className="grid gap-1.5">
      <div className="oo-text-caption font-medium">{t("skills.shareAgent")}</div>
      <div role="radiogroup" aria-label={t("skills.shareAgent")} className="flex min-w-0 flex-wrap gap-1.5">
        {visibleHosts.map((host) => (
          <AgentSourceButton
            key={host.agentId}
            disabled={disabled}
            host={host}
            isSelected={host.agentId === selectedAgentId}
            onSelect={onSelect}
          />
        ))}
        {overflowHosts.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                className="h-14 w-[4.625rem] flex-col gap-1 border-transparent bg-muted/40 px-2 text-muted-foreground hover:bg-[var(--oo-row-hover)] hover:text-foreground"
                disabled={disabled}
                aria-label={t("skills.shareMoreAgents")}
              >
                <AppIcons.action.more className="size-5" />
                <span className="max-w-full truncate text-xs font-medium">{t("skills.shareMoreAgents")}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64">
              <DropdownMenuLabel>{t("skills.shareMoreAgents")}</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={selectedAgentId} onValueChange={onSelect}>
                {overflowHosts.map((host) => (
                  <DropdownMenuRadioItem key={host.agentId} value={host.agentId} className="items-start py-2">
                    <AgentIcon
                      host={host.agentName}
                      className="oo-entity-icon-compact mt-0.5 border-transparent bg-transparent"
                    />
                    <span className="grid min-w-0 gap-0.5">
                      <span className="truncate">{host.agentName}</span>
                      {host.path ? <span className="truncate text-xs text-muted-foreground">{host.path}</span> : null}
                    </span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
      <span className="oo-text-caption truncate text-muted-foreground">{selectedDescription}</span>
    </div>
  )
}

interface AgentSourceButtonProps {
  disabled: boolean
  host: ShareableSkillHost
  isSelected: boolean
  onSelect: (agentId: string) => void
}

function AgentSourceButton({ disabled, host, isSelected, onSelect }: AgentSourceButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          role="radio"
          aria-label={host.agentName}
          aria-checked={isSelected}
          className={cn(
            "relative h-14 w-[4.625rem] min-w-0 flex-col items-center justify-center gap-1 border border-transparent bg-muted/40 px-2 text-center whitespace-normal text-muted-foreground hover:bg-[var(--oo-row-hover)] hover:text-foreground",
            isSelected &&
              "border-ring bg-[var(--oo-row-selected)] text-foreground ring-[3px] ring-ring/50 hover:bg-[var(--oo-row-selected)]",
          )}
          disabled={disabled}
          onClick={() => onSelect(host.agentId)}
        >
          <AgentIcon host={host.agentName} className="size-5 border-transparent bg-transparent" />
          {isSelected ? (
            <span className="absolute top-1 right-1 grid size-3.5 place-items-center rounded-full bg-primary text-primary-foreground">
              <AppIcons.action.check className="size-2.5" />
            </span>
          ) : null}
          <span className="max-w-full truncate text-xs font-medium">{getCompactAgentName(host.agentName)}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <span className="grid max-w-80 gap-0.5">
          <span className="truncate">{host.agentName}</span>
          {host.path ? <span className="truncate text-muted-foreground">{host.path}</span> : null}
        </span>
      </TooltipContent>
    </Tooltip>
  )
}

function getVisibleShareAgentHosts(
  hosts: ShareableSkillHost[],
  selectedAgentId: string | undefined,
): ShareableSkillHost[] {
  if (hosts.length <= inlineShareAgentLimit) {
    return hosts
  }

  const selectedHost = hosts.find((host) => host.agentId === selectedAgentId)
  const preferredHosts = selectedHost
    ? [selectedHost, ...hosts.filter((host) => host.agentId !== selectedHost.agentId)]
    : hosts
  return preferredHosts.slice(0, visibleShareAgentLimitWithMore)
}

function getCompactAgentName(agentName: string): string {
  const name = agentName.trim()
  return /^claude code$/i.test(name) ? "Claude" : name
}

interface DeleteSkillConfirmDialogProps {
  isRemoving: boolean
  onConfirm: () => void | Promise<void>
  onOpenChange: (isOpen: boolean) => void
  target: SkillRemoveTarget | null
}

export function DeleteSkillConfirmDialog({
  isRemoving,
  onConfirm,
  onOpenChange,
  target,
}: DeleteSkillConfirmDialogProps) {
  const { t } = useAppI18n()
  const title =
    target?.scope === "agent"
      ? t("skills.removeAgentConfirmTitle", { agent: target.host.agentName })
      : t("skills.removeAllConfirmTitle")
  const description =
    target?.scope === "agent"
      ? t("skills.removeAgentConfirmDescription", {
          agent: target.host.agentName,
          name: target.skill.name,
        })
      : target?.scope === "all"
        ? t("skills.removeAllConfirmDescription", { name: target.skill.name })
        : t("skills.deleteConfirmUnavailable")

  return (
    <ConfirmDialog
      open={Boolean(target)}
      onOpenChange={(isOpen) => {
        if (!isRemoving) {
          onOpenChange(isOpen)
        }
      }}
    >
      <ConfirmDialogContent>
        <ConfirmDialogHeader>
          <ConfirmDialogTitle>{title}</ConfirmDialogTitle>
          <ConfirmDialogDescription>{description}</ConfirmDialogDescription>
        </ConfirmDialogHeader>
        <ConfirmDialogFooter>
          <ConfirmDialogCancel disabled={isRemoving}>{t("skills.deleteConfirmCancel")}</ConfirmDialogCancel>
          <ConfirmDialogAction
            disabled={isRemoving || !target}
            onClick={(event) => {
              event.preventDefault()
              void onConfirm()
            }}
          >
            {isRemoving ? <AppIcons.status.loading className="animate-spin" /> : null}
            {isRemoving ? t("skills.planExecuting") : t("skills.removeConfirmAction")}
          </ConfirmDialogAction>
        </ConfirmDialogFooter>
      </ConfirmDialogContent>
    </ConfirmDialog>
  )
}
