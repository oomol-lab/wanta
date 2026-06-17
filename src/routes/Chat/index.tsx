import type {
  AuthorizationInfo,
  AssistantActivityEvent,
  ChatAttachment,
  ChatContextMention,
  ChatMessage,
  ChatMessagePart,
  ToolStatus,
} from "../../../electron/chat/common.ts"
import type { ConnectionProvider } from "../../../electron/connections/common.ts"
import type { ModelCatalog, ModelChoice } from "../../../electron/models/common.ts"
import type { ManagedSkillGroup } from "../../../electron/skills/common.ts"
import type { AssistantTimelineBlock } from "./assistant-timeline.ts"
import type { ChatTurn } from "./chat-turns.ts"
import type { DraftAttachment } from "./composer-state.ts"
import type { ComposerTrigger } from "./composer-triggers.ts"
import type { ComposerPaletteItem } from "./ComposerPalette.tsx"
import type { PromptInputMessage } from "@/components/ai-elements/prompt-input"
import type { QueuedChatMessage } from "@/components/app-shell/chat-queue"
import type { TranslateFn } from "@/i18n/i18n"
import type { ArtifactSelection } from "@/routes/Chat/GeneratedArtifacts"
import type { ChatStatus } from "ai"
import type { StickToBottomContext } from "use-stick-to-bottom"

import {
  AlertTriangle,
  CheckIcon,
  ChevronRight,
  Circle,
  CopyIcon,
  File as FileIcon,
  FileArchive,
  FileCode,
  FileImage,
  FilePenLine,
  FilePlus2,
  FileSearch,
  FileSpreadsheet,
  FileText,
  FileVideoCamera,
  Folder,
  FolderOpen,
  Globe,
  ListChecks,
  Loader2,
  Mic,
  Package,
  Plug,
  Plus,
  PlayCircle,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Square,
  SquareTerminal,
  ThumbsDown,
  ThumbsUp,
  Wrench,
  X,
} from "lucide-react"
import * as React from "react"
import { toast } from "sonner"
import { collectVisibleGeneratedArtifactSources } from "./artifact-sources.ts"
import { splitAssistantTimelineBlocks, textFromTimelineBlocks } from "./assistant-timeline.ts"
import { groupChatTurns, summarizeTurnProcess } from "./chat-turns.ts"
import { ChatErrorNotice } from "./ChatErrorNotice.tsx"
import { composerReducer, contextMentionKey, initialComposerState } from "./composer-state.ts"
import { detectComposerTrigger } from "./composer-triggers.ts"
import { ComposerPalette } from "./ComposerPalette.tsx"
import { assistantResponseActionTextByMessageId, copyableMessageText, visibleUserText } from "./message-text.ts"
import { AddCustomModelDialog, ModelPicker } from "./ModelControls.tsx"
import { renderBlocks } from "./render-blocks.ts"
import {
  compactPathDetail,
  compactToolDetail,
  formatToolActivityDuration,
  shouldShowRunningNoOutput,
} from "./tool-activity.ts"
import { hasStoppedTool, isToolCancellation } from "./tool-state.ts"
import { useModelCatalog } from "./useModelCatalog.ts"
import { useVoiceRecorder } from "./useVoiceRecorder.ts"
import { Conversation, ConversationContent, ConversationScrollButton } from "@/components/ai-elements/conversation"
import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message"
import {
  PromptInput,
  PromptInputAttachments,
  PromptInputBody,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputToolbar,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input"
import { Shimmer } from "@/components/ai-elements/shimmer"
import { Task, TaskContent, TaskTrigger } from "@/components/ai-elements/task"
import { useChatService } from "@/components/AppContext"
import { useSkillInventoryResource } from "@/components/AppDataHooks"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { useT } from "@/i18n/i18n"
import { cn } from "@/lib/utils"
import { GeneratedArtifacts } from "@/routes/Chat/GeneratedArtifacts"
import { ProviderIcon } from "@/routes/Connections/ProviderIcon"

interface ChatAreaProps {
  billingCacheScope: string
  messages: ChatMessage[]
  status: ChatStatus
  activity: AssistantActivityEvent | null
  showEmptyState: boolean
  error: string | null
  disabled: boolean
  initialSendPending: boolean
  providers: ConnectionProvider[]
  queuedMessages: QueuedChatMessage[]
  placeholder: string
  onSend: (
    text: string,
    attachments: ChatAttachment[],
    contextMentions: ChatContextMention[],
    model?: ModelChoice,
  ) => Promise<boolean>
  onStop: () => void
  onQueuedMessageRemove: (id: string) => void
  onAuthorize: (auth: AuthorizationInfo) => void
  onArtifactsReset: () => void
  onArtifactsOpen: (selection: ArtifactSelection) => void
  onArtifactsAvailable: (selection: ArtifactSelection) => void
  onViewBilling?: () => void
}

function stripDraftAttachment(attachment: DraftAttachment): ChatAttachment {
  const { previewUrl: _previewUrl, ...chatAttachment } = attachment
  return chatAttachment
}

interface AttachmentInput {
  name: string
  mime: string
  size: number
  path: string
  kind?: "file" | "directory"
  file?: File
}

const CHAT_CONTENT_MAX_WIDTH_CLASS = "min-w-0 max-w-[50rem]"
const ASSISTANT_TEXT_SMOOTH_WINDOW_MS = 45_000
const ATTACHMENT_PREVIEW_CACHE_LIMIT = 80

const attachmentPreviewUrlByPath = new Map<string, string>()

function revokePreviewUrl(url: string | undefined): void {
  if (url?.startsWith("blob:")) {
    URL.revokeObjectURL(url)
  }
}

function setAttachmentPreviewUrl(path: string, url: string): void {
  const current = attachmentPreviewUrlByPath.get(path)
  if (current && current !== url) {
    revokePreviewUrl(current)
  }
  if (!current && attachmentPreviewUrlByPath.size >= ATTACHMENT_PREVIEW_CACHE_LIMIT) {
    const oldestPath = attachmentPreviewUrlByPath.keys().next().value as string | undefined
    if (oldestPath) {
      revokePreviewUrl(attachmentPreviewUrlByPath.get(oldestPath))
      attachmentPreviewUrlByPath.delete(oldestPath)
    }
  }
  attachmentPreviewUrlByPath.set(path, url)
}

function parseAuthorization(output: string | undefined): AuthorizationInfo | null {
  if (!output) {
    return null
  }
  try {
    const parsed = JSON.parse(output) as Record<string, unknown>
    if (
      parsed.status === "authorization_required" &&
      typeof parsed.service === "string" &&
      typeof parsed.authUrl === "string"
    ) {
      return {
        service: parsed.service,
        displayName: typeof parsed.displayName === "string" ? parsed.displayName : parsed.service,
        authUrl: parsed.authUrl,
        message: typeof parsed.message === "string" ? parsed.message : undefined,
      }
    }
  } catch {
    return null
  }
  return null
}

function str(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function fileSizeLabel(size: number): string {
  if (!Number.isFinite(size) || size <= 0) {
    return ""
  }
  if (size < 1024) {
    return `${size} B`
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`
  }
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

function attachmentExtension(name: string): string {
  const lastSegment = name.split(/[\\/]/).pop() ?? name
  const index = lastSegment.lastIndexOf(".")
  return index > -1 ? lastSegment.slice(index + 1).toLowerCase() : ""
}

function isDirectoryAttachment(attachment: ChatAttachment): boolean {
  return attachment.kind === "directory" || attachment.mime.toLowerCase() === "inode/directory"
}

function attachmentTypeLabel(t: TranslateFn, attachment: ChatAttachment): string {
  if (isDirectoryAttachment(attachment)) {
    return t("chat.attachmentFolder")
  }
  const extension = attachmentExtension(attachment.name)
  if (extension) {
    return extension.toUpperCase()
  }
  const [type] = attachment.mime.split("/")
  return type ? type.toUpperCase() : "FILE"
}

function attachmentSummary(t: TranslateFn, attachment: ChatAttachment): string {
  if (isDirectoryAttachment(attachment)) {
    return attachmentTypeLabel(t, attachment)
  }
  const size = fileSizeLabel(attachment.size)
  return size ? `${attachmentTypeLabel(t, attachment)} ${size}` : attachmentTypeLabel(t, attachment)
}

function isImageAttachment(attachment: ChatAttachment): boolean {
  if (isDirectoryAttachment(attachment)) {
    return false
  }
  if (attachment.mime.toLowerCase().startsWith("image/")) {
    return true
  }
  return ["avif", "bmp", "gif", "jpeg", "jpg", "png", "svg", "webp"].includes(attachmentExtension(attachment.name))
}

function revokeAttachmentPreviewUrls(attachments: DraftAttachment[]): void {
  for (const attachment of attachments) {
    const cached = attachmentPreviewUrlByPath.get(attachment.path)
    if (cached && (!attachment.previewUrl || cached === attachment.previewUrl)) {
      revokePreviewUrl(cached)
      attachmentPreviewUrlByPath.delete(attachment.path)
    } else {
      revokePreviewUrl(attachment.previewUrl)
    }
  }
}

function attachmentWithPreview(attachment: ChatAttachment): DraftAttachment {
  if (!isImageAttachment(attachment)) {
    return attachment
  }
  return {
    ...attachment,
    previewUrl: attachmentPreviewUrlByPath.get(attachment.path),
  }
}

function filesFromDataTransfer(dataTransfer: DataTransfer): File[] {
  const files = Array.from(dataTransfer.files)
  if (files.length > 0) {
    return files
  }
  return Array.from(dataTransfer.items)
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file))
}

function voiceDurationLabel(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, "0")}`
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  const chunkSize = 0x8000
  let binary = ""
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }
  return btoa(binary)
}

function hasKeys(value: Record<string, unknown> | undefined): boolean {
  return Boolean(value && Object.keys(value).length > 0)
}

function normalizeServiceSlug(value: string): string {
  return value.trim().replace(/^oo-/, "").toLowerCase()
}

function parseServiceFromCommand(command: string): string {
  const serviceArg = String.raw`(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_-]+))`
  const connectorMatch = command.match(
    new RegExp(String.raw`(?:^|\s)(?:oo\s+)?connector\s+(?:schema|run)\s+` + serviceArg),
  )
  if (connectorMatch) {
    return connectorMatch[1] ?? connectorMatch[2] ?? connectorMatch[3] ?? ""
  }
  const providerFlagMatch = command.match(new RegExp(String.raw`(?:--provider|--service)\s+` + serviceArg))
  return providerFlagMatch ? (providerFlagMatch[1] ?? providerFlagMatch[2] ?? providerFlagMatch[3] ?? "") : ""
}

function toolServiceSlug(part: ChatMessagePart): string {
  const input = part.input ?? {}
  const fromInput = str(input.service)
  if (fromInput) {
    return normalizeServiceSlug(fromInput)
  }
  const auth = part.tool === "call_action" && part.status === "completed" ? parseAuthorization(part.output) : null
  if (auth?.service) {
    return normalizeServiceSlug(auth.service)
  }
  const skillTitle = part.title?.match(/^Loaded skill:\s*([A-Za-z0-9_-]+)/i)
  if (skillTitle?.[1]) {
    return normalizeServiceSlug(skillTitle[1])
  }
  const command = str(input.command)
  if (command) {
    const fromCommand = parseServiceFromCommand(command)
    if (fromCommand) {
      return normalizeServiceSlug(fromCommand)
    }
  }
  return ""
}

function bashActionSummary(t: TranslateFn, command: string): string {
  const normalized = command.replace(/\s+/g, " ").trim()
  if (/^(ls|stat|file|du)\b/.test(normalized)) {
    return t("chat.toolBashCheckFile")
  }
  if (/(^|[;&|]\s*)(which|command -v)\b|--version\b/.test(normalized)) {
    return t("chat.toolBashCheckTools")
  }
  if (/^(sips|magick|convert|qlmanage)\b/.test(normalized)) {
    return t("chat.toolBashConvertImage")
  }
  if (/^python3?\s+-c\s+["']import\b/.test(normalized)) {
    return t("chat.toolBashCheckPythonModule")
  }
  if (/\bpip3?\s+install\b/.test(normalized)) {
    return t("chat.toolBashInstallPythonPackage")
  }
  if (/^python3?\s+<<\s*['"]?EOF\b/.test(normalized) || /^python3?\s+\S+\.py\b/.test(normalized)) {
    return t("chat.toolBashRunPythonScript")
  }
  if (/^(cat|sed|head|tail)\b/.test(normalized)) {
    return t("chat.toolBashReadContent")
  }
  if (/^find\b/.test(normalized)) {
    return t("chat.toolBashFindFiles")
  }
  return t("chat.toolRunGeneric")
}

/** 工具调用的一行人话动作摘要；原始命令只放在详情里。 */
function toolActionSummary(t: TranslateFn, part: ChatMessagePart): string {
  const input = part.input ?? {}
  const service = str(input.service)
  const action = str(input.action)
  const target = service && action ? `${service} · ${action}` : service || action
  const fallbackDetail = part.title || part.tool || "tool"
  switch (part.tool) {
    case "search_actions": {
      const query = str(input.query)
      return query ? t("chat.toolSearch", { detail: compactToolDetail(query) }) : t("chat.toolSearchGeneric")
    }
    case "inspect_action":
      return target ? t("chat.toolInspect", { detail: target }) : t("chat.toolInspectGeneric")
    case "call_action":
      return target ? t("chat.toolCall", { detail: target }) : t("chat.toolCallGeneric")
    case "bash": {
      const command = str(input.command).split("\n")[0]
      return command ? bashActionSummary(t, command) : t("chat.toolRunGeneric")
    }
    case "read": {
      const filePath = str(input.filePath) || str(input.path)
      return filePath ? t("chat.toolRead", { detail: compactPathDetail(filePath) }) : t("chat.toolReadGeneric")
    }
    case "write": {
      const filePath = str(input.filePath) || str(input.path)
      return filePath ? t("chat.toolWrite", { detail: compactPathDetail(filePath) }) : t("chat.toolWriteGeneric")
    }
    case "edit": {
      const filePath = str(input.filePath) || str(input.path)
      return filePath ? t("chat.toolEdit", { detail: compactPathDetail(filePath) }) : t("chat.toolEditGeneric")
    }
    case "list": {
      const filePath = str(input.path) || str(input.filePath)
      return filePath ? t("chat.toolList", { detail: compactPathDetail(filePath) }) : t("chat.toolListGeneric")
    }
    case "grep": {
      const pattern = str(input.pattern)
      return pattern ? t("chat.toolGrep", { detail: compactToolDetail(pattern) }) : t("chat.toolGrepGeneric")
    }
    case "glob": {
      const pattern = str(input.pattern)
      return pattern ? t("chat.toolGlob", { detail: compactToolDetail(pattern) }) : t("chat.toolGlobGeneric")
    }
    case "webfetch": {
      const url = str(input.url)
      return url ? t("chat.toolWebFetch", { detail: compactPathDetail(url) }) : t("chat.toolWebFetchGeneric")
    }
    case "task": {
      return t("chat.toolTask", { detail: compactToolDetail(fallbackDetail) })
    }
    default:
      return t("chat.toolGeneric", { detail: compactToolDetail(fallbackDetail) })
  }
}

function toolStatusLabel(t: TranslateFn, status: ToolStatus | undefined): string {
  switch (status) {
    case "pending":
      return t("chat.toolStatusPending")
    case "running":
      return t("chat.toolStatusRunning")
    case "completed":
      return t("chat.toolStatusCompleted")
    case "error":
      return t("chat.toolStatusError")
    default:
      return t("chat.toolStatusPending")
  }
}

function toolPartStatusLabel(t: TranslateFn, part: ChatMessagePart): string {
  return isToolCancellation(part) ? t("chat.toolStatusStopped") : toolStatusLabel(t, part.status)
}

function toolInlineDetail(part: ChatMessagePart): string {
  if (part.tool !== "bash") {
    return ""
  }
  const command = str(part.input?.command).split("\n")[0]
  return command ? compactToolDetail(command, 96) : ""
}

function formatToolOutput(output: string | undefined): string {
  if (!output) {
    return ""
  }
  try {
    return JSON.stringify(JSON.parse(output), null, 2)
  } catch {
    return output
  }
}

function formatJson(value: Record<string, unknown>): string {
  return JSON.stringify(value, null, 2)
}

function ToolStatusIcon({ status, stopped = false }: { status: ToolStatus | undefined; stopped?: boolean }) {
  if (stopped) {
    return <Square className="size-3.5 text-muted-foreground" />
  }
  switch (status) {
    case "running":
      return <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
    case "completed":
      return <Circle className="size-3.5 text-muted-foreground" />
    case "error":
      return <AlertTriangle className="size-3.5 text-destructive" />
    case "pending":
    default:
      return <Circle className="size-3.5 text-muted-foreground" />
  }
}

function ToolActionIcon({ part }: { part: ChatMessagePart }) {
  const className = "size-3.5 text-muted-foreground"
  switch (part.tool) {
    case "search_actions":
      return <Search className={className} />
    case "inspect_action":
      return <SlidersHorizontal className={className} />
    case "call_action":
      return <PlayCircle className={className} />
    case "bash":
      return <SquareTerminal className={className} />
    case "read":
      return <FileText className={className} />
    case "write":
      return <FilePlus2 className={className} />
    case "edit":
      return <FilePenLine className={className} />
    case "list":
      return <FolderOpen className={className} />
    case "grep":
    case "glob":
      return <FileSearch className={className} />
    case "webfetch":
      return <Globe className={className} />
    case "task":
      return <ListChecks className={className} />
    default:
      if (part.tool?.startsWith("todo")) {
        return <ListChecks className={className} />
      }
      if (part.title?.match(/^Loaded skill:/i)) {
        return <Package className={className} />
      }
      return <Wrench className={className} />
  }
}

function ToolStepIcon({ part, provider }: { part: ChatMessagePart; provider?: ConnectionProvider }) {
  const stopped = isToolCancellation(part)
  if (provider && part.status !== "error" && !stopped) {
    return <ProviderIcon iconUrl={provider.iconUrl} displayName={provider.displayName} size="compact" />
  }
  if (part.status === "error" || stopped) {
    return <ToolStatusIcon status={part.status} stopped={stopped} />
  }
  return <ToolActionIcon part={part} />
}

function LoadingShimmerText({ children, className }: { children: string; className?: string }) {
  return (
    <Shimmer as="span" className={className} duration={2.4} spread={2.4}>
      {children}
    </Shimmer>
  )
}

function ToolDetailSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="oo-text-micro font-medium text-muted-foreground uppercase">{label}</div>
      {children}
    </div>
  )
}

function ToolPre({ children, tone = "default" }: { children: string; tone?: "default" | "error" }) {
  return (
    <pre
      className={cn(
        "oo-text-micro max-h-56 overflow-auto rounded-md border bg-background p-2.5 whitespace-pre-wrap",
        tone === "error" && "border-destructive/25 bg-destructive/5 text-destructive",
      )}
    >
      {children}
    </pre>
  )
}

function hasToolDetails(part: ChatMessagePart, auth: AuthorizationInfo | null): boolean {
  const stopped = isToolCancellation(part)
  return (
    hasKeys(part.input) ||
    hasKeys(part.metadata) ||
    Boolean(part.output && !auth) ||
    Boolean(part.error && !stopped) ||
    Boolean(auth?.message) ||
    shouldShowRunningNoOutput(part) ||
    Boolean(part.attachmentsCount)
  )
}

function ToolActivityStep({
  part,
  provider,
  onAuthorize,
}: {
  part: ChatMessagePart
  provider?: ConnectionProvider
  onAuthorize: (auth: AuthorizationInfo) => void
}) {
  const t = useT()
  const auth = part.tool === "call_action" && part.status === "completed" ? parseAuthorization(part.output) : null
  const stopped = isToolCancellation(part)
  const details = hasToolDetails(part, auth)
  const statusText = toolPartStatusLabel(t, part)
  const inlineDetail = toolInlineDetail(part)
  const active = part.status === "pending" || part.status === "running"
  const metaItems = [provider?.displayName, statusText].filter(Boolean)
  const actionText = toolActionSummary(t, part)
  const activeText = [actionText, inlineDetail, ...metaItems].filter(Boolean).join("  ")
  const row = (
    <div className="flex min-h-6 min-w-0 flex-1 items-center gap-2">
      <span
        className="flex size-5 shrink-0 items-center justify-center"
        title={provider ? `${provider.displayName} · ${statusText}` : statusText}
      >
        <ToolStepIcon part={part} provider={provider} />
      </span>
      <div className="min-w-0 flex-1 overflow-hidden">
        {active ? (
          <div className="flex min-w-0 items-center">
            <LoadingShimmerText className="min-w-0 truncate">{activeText}</LoadingShimmerText>
          </div>
        ) : (
          <div className="flex min-w-0 items-center gap-2">
            <span className={cn("min-w-0 truncate text-foreground", inlineDetail ? "shrink-0" : "flex-1")}>
              {actionText}
            </span>
            {inlineDetail && (
              <code className="min-w-0 flex-1 truncate rounded bg-muted px-1.5 py-0.5 font-mono text-[0.875em] text-muted-foreground">
                {inlineDetail}
              </code>
            )}
            <span className="flex min-w-0 shrink-0 items-center gap-1 text-muted-foreground">
              {metaItems.map((item, index) => (
                <React.Fragment key={`${index}:${item}`}>
                  {index > 0 ? <span className="text-muted-foreground/70">·</span> : null}
                  <span>{item}</span>
                </React.Fragment>
              ))}
            </span>
          </div>
        )}
        {auth && (
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span>{t("chat.authNeeded", { name: auth.displayName })}</span>
            <Button size="sm" variant="outline" className="h-7 gap-1 px-2" onClick={() => onAuthorize(auth)}>
              <Plug className="size-3.5" />
              {t("chat.authorize")}
            </Button>
          </div>
        )}
      </div>
    </div>
  )

  return (
    <Collapsible defaultOpen={(part.status === "error" && !stopped) || Boolean(auth)}>
      <div className="rounded-md">
        {details ? (
          <CollapsibleTrigger className="group/tool-step flex w-full items-center justify-between gap-2 text-left">
            {row}
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-[opacity,transform] group-hover/tool-step:opacity-100 group-focus-visible/tool-step:opacity-100 group-data-[state=open]/tool-step:rotate-90 group-data-[state=open]/tool-step:opacity-100" />
          </CollapsibleTrigger>
        ) : (
          row
        )}
      </div>
      {details && (
        <CollapsibleContent className="data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0">
          <div className="ml-6 space-y-2.5 pt-1.5 pb-1">
            {hasKeys(part.input) && (
              <ToolDetailSection label={t("chat.toolParams")}>
                <ToolPre>{formatJson(part.input ?? {})}</ToolPre>
              </ToolDetailSection>
            )}
            {shouldShowRunningNoOutput(part) && (
              <div className="oo-text-caption text-muted-foreground">{t("chat.toolRunningNoOutput")}</div>
            )}
            {part.output && !auth && (
              <ToolDetailSection label={t("chat.toolResult")}>
                <ToolPre>{formatToolOutput(part.output)}</ToolPre>
              </ToolDetailSection>
            )}
            {part.error && !stopped && (
              <ToolDetailSection label={t("chat.toolError")}>
                <ToolPre tone="error">{part.error}</ToolPre>
              </ToolDetailSection>
            )}
            {auth?.message && (
              <ToolDetailSection label={t("chat.toolError")}>
                <ToolPre tone="error">{auth.message}</ToolPre>
              </ToolDetailSection>
            )}
            {hasKeys(part.metadata) && (
              <ToolDetailSection label={t("chat.toolMetadata")}>
                <ToolPre>{formatJson(part.metadata ?? {})}</ToolPre>
              </ToolDetailSection>
            )}
            {part.attachmentsCount ? (
              <div className="oo-text-caption text-muted-foreground">
                {t("chat.toolAttachments", { count: part.attachmentsCount })}
              </div>
            ) : null}
          </div>
        </CollapsibleContent>
      )}
    </Collapsible>
  )
}

type TurnProcessStatus = "running" | "completed" | "retrying" | "needsAction" | "error" | "stopped"

function processStatus(process: ReturnType<typeof summarizeTurnProcess>): TurnProcessStatus {
  if (process.hasAuthorization) {
    return "needsAction"
  }
  if (process.activity?.phase === "retrying") {
    return "retrying"
  }
  if (process.hasBlockingError) {
    return "error"
  }
  if (process.hasActiveTool || process.activity) {
    return "running"
  }
  if (process.hasStoppedTool) {
    return "stopped"
  }
  return "completed"
}

function formatProcessDuration(process: ReturnType<typeof summarizeTurnProcess>, now: number): string | null {
  const isLive = process.hasActiveTool || Boolean(process.activity)
  const toolDuration = !isLive && process.tools.length > 0 ? formatToolActivityDuration(process.tools, now) : null
  if (!isLive && toolDuration) {
    return toolDuration
  }
  const start = process.startedAt
  const end = isLive ? now : process.endedAt
  if (typeof start !== "number" || typeof end !== "number" || end < start) {
    return null
  }
  return formatWholeSecondDuration(end - start)
}

function formatWholeSecondDuration(ms: number): string {
  return `${Math.max(1, Math.round(ms / 1000))}s`
}

function processStatusText(t: TranslateFn, status: TurnProcessStatus): string {
  switch (status) {
    case "running":
      return t("chat.processRunning")
    case "retrying":
      return t("chat.processRetrying")
    case "needsAction":
      return t("chat.processNeedsAction")
    case "error":
      return t("chat.processError")
    case "stopped":
      return t("chat.processStopped")
    case "completed":
      return t("chat.processCompleted")
  }
}

function processTitle(t: TranslateFn, status: TurnProcessStatus, duration: string | null): string {
  const title = processStatusText(t, status)
  return duration ? `${title} ${duration}` : title
}

function TurnProcessActivity({
  blocks,
  process,
  billingCacheScope,
  smoothAssistantMessageId,
  providerByService,
  onAuthorize,
  onViewBilling,
}: {
  blocks: AssistantTimelineBlock[]
  process: ReturnType<typeof summarizeTurnProcess>
  billingCacheScope: string
  smoothAssistantMessageId?: string
  providerByService: Map<string, ConnectionProvider>
  onAuthorize: (auth: AuthorizationInfo) => void
  onViewBilling?: () => void
}) {
  const t = useT()
  const status = processStatus(process)
  const shouldOpen =
    status === "running" ||
    status === "retrying" ||
    status === "needsAction" ||
    status === "error" ||
    !process.hasFinalAnswer
  const statusKey = [
    status,
    process.activity?.phase,
    process.tools.map((part) => `${part.partId}:${part.status}`).join("|"),
    process.errors.map((part) => part.partId).join("|"),
  ].join(":")
  const [open, setOpen] = React.useState(shouldOpen)
  const [now, setNow] = React.useState(() => Date.now())
  const duration = formatProcessDuration(process, now)
  const title = processTitle(t, status, duration)
  const titleText = processStatusText(t, status)
  const activeTitle = (status === "running" || status === "retrying") && !hasNestedLoadingIndicator(process, status)
  const renderBlocks = blocks.map((item) => item.block)
  const showLiveStatus = renderBlocks.length === 0

  React.useEffect(() => {
    setOpen(shouldOpen)
  }, [shouldOpen, statusKey])

  React.useEffect(() => {
    if (status !== "running" && status !== "retrying") {
      return
    }
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [status])

  return (
    <Task open={open} onOpenChange={setOpen} className="not-prose my-0 w-full">
      <TaskTrigger title={title}>
        <button
          type="button"
          className="group flex w-full max-w-full items-center gap-1.5 border-b border-border/60 py-1.5 pr-1.5 text-left text-muted-foreground transition-colors hover:text-foreground"
        >
          <span className="flex min-w-0 items-center gap-1">
            {activeTitle ? (
              <LoadingShimmerText className="min-w-0 truncate">{titleText}</LoadingShimmerText>
            ) : (
              titleText
            )}
            {duration ? <span className="shrink-0 text-muted-foreground/75 tabular-nums">{duration}</span> : null}
          </span>
          <ChevronRight className="size-3.5 shrink-0 transition-transform group-data-[state=open]:rotate-90" />
        </button>
      </TaskTrigger>
      <TaskContent className="[&>div]:mt-0">
        <div className="space-y-2 pt-2">
          {blocks.map(({ message, block }, index) => (
            <AssistantBlock
              key={`${message.id}:${block.kind === "tools" ? block.key : block.part.partId}`}
              block={block}
              blockClassName={assistantBlockClassName(renderBlocks, index)}
              billingCacheScope={billingCacheScope}
              smoothText={message.id === smoothAssistantMessageId}
              providerByService={providerByService}
              onAuthorize={onAuthorize}
              onViewBilling={onViewBilling}
            />
          ))}
          {showLiveStatus ? <LiveStatusBar process={process} /> : null}
        </div>
      </TaskContent>
    </Task>
  )
}

function latestActiveTool(process: ReturnType<typeof summarizeTurnProcess>): ChatMessagePart | null {
  for (let index = process.tools.length - 1; index >= 0; index -= 1) {
    const part = process.tools[index]
    if (part?.status === "running" || part?.status === "pending") {
      return part
    }
  }
  return null
}

function shouldShowLiveStatus(
  process: ReturnType<typeof summarizeTurnProcess>,
  status = processStatus(process),
): boolean {
  const activeTool = latestActiveTool(process)
  return (
    (status === "running" && !activeTool) ||
    status === "retrying" ||
    Boolean(process.activity && status !== "completed" && status !== "stopped")
  )
}

function hasNestedLoadingIndicator(
  process: ReturnType<typeof summarizeTurnProcess>,
  status = processStatus(process),
): boolean {
  return process.hasActiveTool || shouldShowLiveStatus(process, status)
}

function LiveStatusBar({ process }: { process: ReturnType<typeof summarizeTurnProcess> | null }) {
  const t = useT()

  if (!process) {
    return null
  }

  const status = processStatus(process)
  const activeTool = latestActiveTool(process)
  if (!shouldShowLiveStatus(process, status)) {
    return null
  }

  const text = (() => {
    if (status === "retrying" && process.activity) {
      return activityText(t, process.activity)
    }
    if (activeTool) {
      return t("chat.liveStatusTool", { action: toolActionSummary(t, activeTool) })
    }
    if (process.activity) {
      return activityText(t, process.activity)
    }
    return processTitle(t, status, null)
  })()

  return (
    <div className="rounded-md text-muted-foreground">
      <div className="flex min-h-6 min-w-0 items-center">
        <LoadingShimmerText className="min-w-0 truncate">{text}</LoadingShimmerText>
      </div>
    </div>
  )
}

function formatMessageTime(createdAt: number): string {
  if (!Number.isFinite(createdAt)) {
    return ""
  }
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(new Date(createdAt))
}

function MessageTimestamp({ createdAt }: { createdAt: number }) {
  const label = formatMessageTime(createdAt)
  if (!label) {
    return null
  }
  return <span className="oo-text-caption text-muted-foreground/80 tabular-nums">{label}</span>
}

function CopyMessageAction({ text }: { text: string }) {
  const t = useT()
  const [copied, setCopied] = React.useState(false)
  const timeoutRef = React.useRef<number | undefined>(undefined)

  React.useEffect(
    () => () => {
      if (timeoutRef.current !== undefined) {
        window.clearTimeout(timeoutRef.current)
      }
    },
    [],
  )

  if (!text) {
    return null
  }

  const writeClipboard = async (): Promise<boolean> => {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text)
        return true
      } catch {
        // 继续走 DOM fallback。
      }
    }

    const textarea = document.createElement("textarea")
    textarea.value = text
    textarea.setAttribute("readonly", "")
    textarea.style.position = "fixed"
    textarea.style.top = "-9999px"
    textarea.style.left = "-9999px"
    document.body.append(textarea)
    textarea.select()
    try {
      return document.execCommand("copy")
    } finally {
      textarea.remove()
    }
  }

  const copyToClipboard = async (): Promise<void> => {
    const didCopy = await writeClipboard()
    if (!didCopy) {
      setCopied(false)
      return
    }
    setCopied(true)
    if (timeoutRef.current !== undefined) {
      window.clearTimeout(timeoutRef.current)
    }
    timeoutRef.current = window.setTimeout(() => setCopied(false), 3000)
  }

  const Icon = copied ? CheckIcon : CopyIcon
  const label = copied ? t("chat.copiedMessage") : t("chat.copyMessage")

  return (
    <MessageAction
      label={label}
      tooltip={label}
      className={cn(copied && "bg-accent text-foreground hover:bg-accent hover:text-foreground")}
      onClick={() => void copyToClipboard()}
    >
      <Icon className="size-3.5" />
    </MessageAction>
  )
}

type MessageRating = "up" | "down"

function MessageFeedbackAction({
  rating,
  activeRating,
  onRatingChange,
}: {
  rating: MessageRating
  activeRating: MessageRating | null
  onRatingChange: (rating: MessageRating | null) => void
}) {
  const t = useT()
  const active = activeRating === rating
  const Icon = rating === "up" ? ThumbsUp : ThumbsDown
  const label = rating === "up" ? t("chat.likeMessage") : t("chat.dislikeMessage")

  return (
    <MessageAction
      label={label}
      tooltip={label}
      aria-pressed={active}
      className={cn(active && "oo-message-feedback-action-active")}
      onClick={() => onRatingChange(active ? null : rating)}
    >
      <Icon className={cn("size-3.5", active && "fill-current")} />
    </MessageAction>
  )
}

function AssistantMessageActions({ text, cancelled }: { text: string; cancelled: boolean }) {
  const t = useT()
  // TODO(lumo-feedback-api): 接入反馈 API 后，将这里的本地状态同步为服务端的消息反馈结果。
  const [activeRating, setActiveRating] = React.useState<MessageRating | null>(null)

  if (!text && !cancelled) {
    return null
  }

  return (
    <div className="mt-1">
      {cancelled ? <div className="oo-text-caption mb-1 text-muted-foreground">{t("chat.userCancelled")}</div> : null}
      {text ? (
        <MessageActions className="pointer-events-auto static opacity-100">
          <CopyMessageAction text={text} />
          <MessageFeedbackAction rating="up" activeRating={activeRating} onRatingChange={setActiveRating} />
          <MessageFeedbackAction rating="down" activeRating={activeRating} onRatingChange={setActiveRating} />
        </MessageActions>
      ) : null}
    </div>
  )
}

function activityText(t: TranslateFn, activity: AssistantActivityEvent | null): string {
  switch (activity?.phase) {
    case "retrying":
      return activity.attempt
        ? t("chat.activityRetryingWithAttempt", { attempt: activity.attempt })
        : t("chat.activityRetrying")
    case "finalizing":
      return t("chat.activityFinalizing")
    case "thinking":
    default:
      return t("chat.activityThinking")
  }
}

type AssistantBlockType = ReturnType<typeof renderBlocks>[number]

function assistantBlockClassName(blocks: AssistantBlockType[], index: number): string | undefined {
  if (index === 0) {
    return undefined
  }
  const previous = blocks[index - 1]
  const current = blocks[index]
  if (!previous || !current) {
    return undefined
  }
  if (previous.kind === "tools" && current.kind === "tools") {
    return "mt-1"
  }
  if (previous.kind !== current.kind) {
    return "mt-3"
  }
  return "mt-2"
}

function AssistantBlock({
  block,
  blockClassName,
  billingCacheScope,
  smoothText,
  providerByService,
  onAuthorize,
  onViewBilling,
}: {
  block: AssistantBlockType
  blockClassName?: string
  billingCacheScope: string
  smoothText: boolean
  providerByService: Map<string, ConnectionProvider>
  onAuthorize: (auth: AuthorizationInfo) => void
  onViewBilling?: () => void
}) {
  const t = useT()
  return (
    <div className={blockClassName}>
      {block.kind === "text" ? (
        block.part.text ? (
          <MessageResponse smooth={smoothText}>{block.part.text}</MessageResponse>
        ) : null
      ) : block.kind === "error" ? (
        <ChatErrorNotice
          autoOpenKey={block.part.partId}
          billingCacheScope={billingCacheScope}
          errorCode={block.part.errorCode}
          errorKind={block.part.errorKind}
          message={block.part.errorText ?? block.part.error ?? t("chatError.failed.description")}
          onViewBilling={onViewBilling}
        />
      ) : (
        <div className="space-y-0.5">
          {block.parts.map((part) => {
            const service = toolServiceSlug(part)
            return (
              <ToolActivityStep
                key={part.partId}
                part={part}
                provider={service ? providerByService.get(service) : undefined}
                onAuthorize={onAuthorize}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

function MessageBubble({
  billingCacheScope,
  message,
  smoothText,
  onViewBilling,
  assistantActionsText,
  providerByService,
  onAuthorize,
}: {
  billingCacheScope: string
  message: ChatMessage
  smoothText: boolean
  onViewBilling?: () => void
  assistantActionsText: string | null
  providerByService: Map<string, ConnectionProvider>
  onAuthorize: (auth: AuthorizationInfo) => void
}) {
  const copyText = copyableMessageText(message)
  const assistantCancelled = message.role === "assistant" && hasStoppedTool(message.parts)

  if (message.role === "user") {
    const text = message.parts
      .filter((p) => p.kind === "text")
      .map((p) => p.text)
      .join("")
    const visibleText = visibleUserText(text)
    const attachments = message.parts
      .filter((p) => p.kind === "attachment" && p.attachment)
      .map((p) => attachmentWithPreview(p.attachment as ChatAttachment))
    if (!visibleText && attachments.length === 0) {
      return null
    }
    return (
      <Message from="user" className={cn("items-end", copyText && "pb-7")}>
        {attachments.length > 0 ? <AttachmentList attachments={attachments} className="justify-end" /> : null}
        {visibleText ? (
          <MessageContent>
            <div className="break-words whitespace-pre-wrap">{visibleText}</div>
          </MessageContent>
        ) : null}
        {copyText ? (
          <MessageActions className="top-auto bottom-0 mt-0">
            <MessageTimestamp createdAt={message.createdAt} />
            <CopyMessageAction text={copyText} />
          </MessageActions>
        ) : null}
      </Message>
    )
  }
  const blocks = renderBlocks(message.parts)
  if (blocks.length === 0) {
    return null
  }
  return (
    <Message from="assistant">
      <MessageContent className="gap-0">
        {blocks.map((block, index) => (
          <AssistantBlock
            key={block.kind === "tools" ? block.key : block.part.partId}
            block={block}
            blockClassName={assistantBlockClassName(blocks, index)}
            billingCacheScope={billingCacheScope}
            smoothText={smoothText}
            providerByService={providerByService}
            onAuthorize={onAuthorize}
            onViewBilling={onViewBilling}
          />
        ))}
      </MessageContent>
      {assistantActionsText || assistantCancelled ? (
        <AssistantMessageActions text={assistantActionsText ?? ""} cancelled={assistantCancelled} />
      ) : null}
    </Message>
  )
}

function AssistantTimelineMessage({
  blocks,
  billingCacheScope,
  smoothAssistantMessageId,
  assistantActionsText,
  assistantCancelled,
  providerByService,
  onAuthorize,
  onViewBilling,
}: {
  blocks: AssistantTimelineBlock[]
  billingCacheScope: string
  smoothAssistantMessageId?: string
  assistantActionsText: string | null
  assistantCancelled: boolean
  providerByService: Map<string, ConnectionProvider>
  onAuthorize: (auth: AuthorizationInfo) => void
  onViewBilling?: () => void
}) {
  const renderBlocks = blocks.map((item) => item.block)

  if (blocks.length === 0) {
    return null
  }

  return (
    <Message from="assistant">
      <MessageContent className="gap-0">
        {blocks.map(({ message, block }, index) => (
          <AssistantBlock
            key={`${message.id}:${block.kind === "tools" ? block.key : block.part.partId}`}
            block={block}
            blockClassName={assistantBlockClassName(renderBlocks, index)}
            billingCacheScope={billingCacheScope}
            smoothText={message.id === smoothAssistantMessageId}
            providerByService={providerByService}
            onAuthorize={onAuthorize}
            onViewBilling={onViewBilling}
          />
        ))}
      </MessageContent>
      {assistantActionsText || assistantCancelled ? (
        <AssistantMessageActions text={assistantActionsText ?? ""} cancelled={assistantCancelled} />
      ) : null}
    </Message>
  )
}

function shouldShowTurnProcess(process: ReturnType<typeof summarizeTurnProcess>): boolean {
  return process.tools.length > 0 || Boolean(process.activity && !process.hasFinalAnswer)
}

interface ChatTurnViewProps {
  billingCacheScope: string
  turn: ChatTurn
  activity: AssistantActivityEvent | null
  activeAssistantMessageId?: string
  smoothAssistantMessageId?: string
  providerByService: Map<string, ConnectionProvider>
  onAuthorize: (auth: AuthorizationInfo) => void
  onViewBilling?: () => void
  assistantActionTextByMessageId: Map<string, string>
}

function assistantActionTextsEqual(previous: ChatTurnViewProps, next: ChatTurnViewProps): boolean {
  const messageIds = new Set([
    ...previous.turn.assistants.map((message) => message.id),
    ...next.turn.assistants.map((message) => message.id),
  ])
  for (const messageId of messageIds) {
    if (previous.assistantActionTextByMessageId.get(messageId) !== next.assistantActionTextByMessageId.get(messageId)) {
      return false
    }
  }
  return true
}

function chatTurnViewPropsEqual(previous: ChatTurnViewProps, next: ChatTurnViewProps): boolean {
  return (
    previous.billingCacheScope === next.billingCacheScope &&
    previous.turn === next.turn &&
    previous.activity === next.activity &&
    previous.activeAssistantMessageId === next.activeAssistantMessageId &&
    previous.smoothAssistantMessageId === next.smoothAssistantMessageId &&
    previous.providerByService === next.providerByService &&
    previous.onAuthorize === next.onAuthorize &&
    previous.onViewBilling === next.onViewBilling &&
    assistantActionTextsEqual(previous, next)
  )
}

const ChatTurnView = React.memo(function ChatTurnView({
  billingCacheScope,
  turn,
  activity,
  activeAssistantMessageId,
  smoothAssistantMessageId,
  providerByService,
  onAuthorize,
  onViewBilling,
  assistantActionTextByMessageId,
}: ChatTurnViewProps) {
  const process = summarizeTurnProcess(turn, activity, activeAssistantMessageId)
  const { processBlocks, responseBlocks } = splitAssistantTimelineBlocks(turn.assistants)
  const lastAssistant = turn.assistants.at(-1)
  const assistantActionsText = lastAssistant ? assistantActionTextByMessageId.get(lastAssistant.id) : null
  const assistantCancelled = turn.assistants.some((message) => hasStoppedTool(message.parts))
  const responseActionsText =
    lastAssistant?.id === activeAssistantMessageId ? null : textFromTimelineBlocks(responseBlocks) || null
  const processActionsText = responseBlocks.length > 0 ? null : assistantActionsText

  return (
    <React.Fragment>
      {turn.user ? (
        <MessageBubble
          message={turn.user}
          billingCacheScope={billingCacheScope}
          smoothText={false}
          onViewBilling={onViewBilling}
          assistantActionsText={null}
          providerByService={providerByService}
          onAuthorize={onAuthorize}
        />
      ) : null}
      {shouldShowTurnProcess(process) ? (
        <>
          <Message from="assistant">
            <MessageContent className="w-full">
              <TurnProcessActivity
                blocks={processBlocks}
                process={process}
                billingCacheScope={billingCacheScope}
                smoothAssistantMessageId={smoothAssistantMessageId}
                providerByService={providerByService}
                onAuthorize={onAuthorize}
                onViewBilling={onViewBilling}
              />
            </MessageContent>
            {processActionsText || (assistantCancelled && responseBlocks.length === 0) ? (
              <AssistantMessageActions text={processActionsText ?? ""} cancelled={assistantCancelled} />
            ) : null}
          </Message>
          {responseBlocks.length > 0 ? (
            <AssistantTimelineMessage
              blocks={responseBlocks}
              billingCacheScope={billingCacheScope}
              smoothAssistantMessageId={smoothAssistantMessageId}
              assistantActionsText={responseActionsText}
              assistantCancelled={assistantCancelled}
              providerByService={providerByService}
              onAuthorize={onAuthorize}
              onViewBilling={onViewBilling}
            />
          ) : null}
        </>
      ) : (
        turn.assistants.map((message) => (
          <MessageBubble
            key={message.clientId ?? message.id}
            message={message}
            billingCacheScope={billingCacheScope}
            smoothText={message.id === smoothAssistantMessageId}
            onViewBilling={onViewBilling}
            assistantActionsText={assistantActionTextByMessageId.get(message.id) ?? null}
            providerByService={providerByService}
            onAuthorize={onAuthorize}
          />
        ))
      )}
    </React.Fragment>
  )
}, chatTurnViewPropsEqual)

function AttachmentPreviewTile({ attachment }: { attachment: DraftAttachment }) {
  if (isDirectoryAttachment(attachment)) {
    return (
      <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-cyan-500/12 text-cyan-700 dark:text-cyan-300">
        <Folder className="size-5" />
      </span>
    )
  }

  if (attachment.previewUrl && isImageAttachment(attachment)) {
    return (
      <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
        <img src={attachment.previewUrl} alt="" className="size-full object-cover" draggable={false} decoding="async" />
      </span>
    )
  }

  const mime = attachment.mime.toLowerCase()
  const extension = attachmentExtension(attachment.name)

  if (mime === "application/pdf" || extension === "pdf") {
    return (
      <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-red-500 text-[9px] font-semibold text-white">
        PDF
      </span>
    )
  }

  const iconClassName = "size-5"
  const tileClassName = "flex size-10 shrink-0 items-center justify-center rounded-md"

  if (mime.startsWith("image/")) {
    return (
      <span className={cn(tileClassName, "bg-sky-500/12 text-sky-700 dark:text-sky-300")}>
        <FileImage className={iconClassName} />
      </span>
    )
  }
  if (mime.startsWith("video/")) {
    return (
      <span className={cn(tileClassName, "bg-violet-500/12 text-violet-700 dark:text-violet-300")}>
        <FileVideoCamera className={iconClassName} />
      </span>
    )
  }
  if (["zip", "gz", "tgz", "rar", "7z"].includes(extension)) {
    return (
      <span className={cn(tileClassName, "bg-amber-500/14 text-amber-700 dark:text-amber-300")}>
        <FileArchive className={iconClassName} />
      </span>
    )
  }
  if (["csv", "tsv", "xls", "xlsx"].includes(extension)) {
    return (
      <span className={cn(tileClassName, "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300")}>
        <FileSpreadsheet className={iconClassName} />
      </span>
    )
  }
  if (["css", "html", "js", "json", "jsx", "md", "py", "ts", "tsx", "xml", "yaml", "yml"].includes(extension)) {
    return (
      <span className={cn(tileClassName, "bg-indigo-500/12 text-indigo-700 dark:text-indigo-300")}>
        <FileCode className={iconClassName} />
      </span>
    )
  }
  if (mime.startsWith("text/") || ["doc", "docx", "rtf", "txt"].includes(extension)) {
    return (
      <span className={cn(tileClassName, "bg-muted text-muted-foreground")}>
        <FileText className={iconClassName} />
      </span>
    )
  }

  return (
    <span className={cn(tileClassName, "bg-muted text-muted-foreground")}>
      <FileIcon className={iconClassName} />
    </span>
  )
}

function AttachmentImageCard({
  attachment,
  onOpen,
  onRemove,
}: {
  attachment: DraftAttachment
  onOpen: (attachment: DraftAttachment) => void
  onRemove?: (id: string) => void
}) {
  const chatService = useChatService()
  const [previewUrl, setPreviewUrl] = React.useState(attachment.previewUrl ?? null)
  const attachmentPath = attachment.path
  const attachmentMime = attachment.mime
  const initialPreviewUrl = attachment.previewUrl ?? null
  const imageAttachment = isImageAttachment(attachment)

  React.useEffect(() => {
    const cached = attachmentPreviewUrlByPath.get(attachmentPath) ?? initialPreviewUrl
    setPreviewUrl(cached)
    if (cached || !imageAttachment) {
      return
    }
    let cancelled = false
    void chatService
      .invoke("getAttachmentPreview", { path: attachmentPath, mime: attachmentMime })
      .then((result) => {
        if (cancelled || !result.dataUrl) {
          return
        }
        setAttachmentPreviewUrl(attachmentPath, result.dataUrl)
        setPreviewUrl(result.dataUrl)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [attachmentMime, attachmentPath, chatService, imageAttachment, initialPreviewUrl])

  return (
    <div className="group relative size-20 shrink-0">
      <button
        type="button"
        title={attachment.path}
        className="size-full overflow-hidden rounded-xl border border-border/60 bg-background text-left shadow-xs hover:border-border hover:bg-accent/40 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        onClick={() => onOpen(attachment)}
      >
        {previewUrl ? (
          <img
            src={previewUrl}
            alt=""
            className="size-full object-cover object-center"
            draggable={false}
            decoding="async"
          />
        ) : (
          <span className="flex size-full items-center justify-center text-muted-foreground/65">
            <FileImage className="size-6" />
          </span>
        )}
      </button>
      {onRemove ? (
        <button
          type="button"
          aria-label="Remove attachment"
          className="absolute top-1 right-1 flex size-5 items-center justify-center rounded-full bg-foreground text-background shadow-sm hover:bg-foreground/85"
          onClick={() => onRemove(attachment.id)}
        >
          <X className="size-3.5" />
        </button>
      ) : null}
    </div>
  )
}

function AttachmentList({
  attachments,
  className,
  onRemove,
}: {
  attachments: DraftAttachment[]
  className?: string
  onRemove?: (id: string) => void
}) {
  const t = useT()
  const chatService = useChatService()

  const openAttachment = React.useCallback(
    (attachment: DraftAttachment): void => {
      void chatService.invoke("openLocalPath", { path: attachment.path }).catch((cause: unknown) => {
        toast.error(t("chat.openAttachmentFailed", { error: cause instanceof Error ? cause.message : String(cause) }))
      })
    },
    [chatService, t],
  )

  return (
    <div className={cn("flex w-full flex-wrap justify-start gap-2", className)}>
      {attachments.map((attachment) =>
        isImageAttachment(attachment) ? (
          <AttachmentImageCard
            key={attachment.id}
            attachment={attachment}
            onOpen={openAttachment}
            onRemove={onRemove}
          />
        ) : (
          <div key={attachment.id} className="relative max-w-full min-w-0">
            <button
              type="button"
              title={attachment.path}
              className={cn(
                "oo-border-divider flex h-14 max-w-full min-w-0 items-center gap-3 rounded-lg border bg-background/70 py-2 pl-2 text-left shadow-xs hover:border-border hover:bg-accent/60 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
                onRemove ? "pr-8" : "pr-2",
              )}
              onClick={() => openAttachment(attachment)}
            >
              <AttachmentPreviewTile attachment={attachment} />
              <span className="min-w-0 flex-1">
                <span className="block max-w-56 truncate text-sm leading-5 font-medium text-foreground">
                  {attachment.name}
                </span>
                <span className="block truncate text-xs leading-4 font-normal text-muted-foreground">
                  {attachmentSummary(t, attachment)}
                </span>
              </span>
            </button>
            {onRemove ? (
              <button
                type="button"
                aria-label="Remove attachment"
                className="absolute top-1/2 right-2 -translate-y-1/2 rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={() => onRemove(attachment.id)}
              >
                <X className="size-3.5" />
              </button>
            ) : null}
          </div>
        ),
      )}
    </div>
  )
}

function contextMentionLabel(mention: ChatContextMention): string {
  return mention.kind === "skill" ? mention.name : mention.displayName
}

function ContextMentionChips({
  mentions,
  onRemove,
}: {
  mentions: ChatContextMention[]
  onRemove?: (mention: ChatContextMention) => void
}) {
  const t = useT()
  if (mentions.length === 0) {
    return null
  }
  return (
    <div className="flex w-full flex-wrap gap-2">
      {mentions.map((mention) => (
        <span
          key={contextMentionKey(mention)}
          className="oo-border-divider flex h-8 max-w-full items-center gap-2 rounded-lg border bg-background/70 px-2 text-sm shadow-xs"
          title={mention.kind === "skill" ? mention.description : mention.accountLabel}
        >
          <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
            {mention.kind === "skill" ? <Package className="size-3.5" /> : <Plug className="size-3.5" />}
          </span>
          <span className="min-w-0 truncate">
            <span className="text-muted-foreground">
              {mention.kind === "skill" ? t("chat.contextSkillPrefix") : t("chat.contextConnectionPrefix")}
            </span>
            <span className="ml-1 font-medium text-foreground">{contextMentionLabel(mention)}</span>
          </span>
          {onRemove ? (
            <button
              type="button"
              aria-label={t("chat.contextRemove", { name: contextMentionLabel(mention) })}
              className="-mr-1 flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={() => onRemove(mention)}
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </span>
      ))}
    </div>
  )
}

function queuedMessagePreview(message: QueuedChatMessage): string {
  const text = message.text.trim()
  if (text) {
    return text
  }
  return message.attachments.map((attachment) => attachment.name).join(", ")
}

function QueuedMessagePanel({ messages, onRemove }: { messages: QueuedChatMessage[]; onRemove: (id: string) => void }) {
  const t = useT()
  const [open, setOpen] = React.useState(true)
  if (messages.length === 0) {
    return null
  }

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="oo-border-divider overflow-hidden rounded-xl border bg-background/95 shadow-xs backdrop-blur supports-[backdrop-filter]:bg-background/85"
    >
      <div className={cn("flex h-9 items-center px-2", open && "border-b border-border/50")}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1.5 py-1 text-left hover:bg-accent/45 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
            aria-label={open ? t("chat.queueCollapse") : t("chat.queueExpand")}
          >
            <ListChecks className="size-4 shrink-0 text-muted-foreground" />
            <span className="oo-text-control min-w-0 flex-1 truncate text-muted-foreground">
              {t("chat.queueTitle", { count: messages.length })}
            </span>
            <ChevronRight
              className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")}
            />
          </button>
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent>
        <div className="max-h-40 overflow-auto">
          {messages.map((message) => {
            const preview = queuedMessagePreview(message)
            return (
              <div key={message.id} className="flex h-10 items-center gap-2 px-3">
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="oo-text-control min-w-0 truncate text-foreground/90">
                      {preview || t("chat.queueAttachmentOnly")}
                    </span>
                  </div>
                  {message.attachments.length > 0 ? (
                    <div className="oo-text-caption mt-0.5 truncate text-muted-foreground">
                      {t("chat.queueAttachments", { count: message.attachments.length })}
                    </div>
                  ) : null}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7 shrink-0 rounded-full text-muted-foreground hover:text-foreground"
                  title={t("chat.queueRemove")}
                  aria-label={t("chat.queueRemove")}
                  onClick={() => onRemove(message.id)}
                >
                  <X className="size-3.5" />
                </Button>
              </div>
            )
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

function sameChatTurn(previous: ChatTurn, next: ChatTurn): boolean {
  if (previous.id !== next.id || previous.user !== next.user || previous.assistants.length !== next.assistants.length) {
    return false
  }
  return previous.assistants.every((message, index) => message === next.assistants[index])
}

function reuseStableChatTurns(previousTurns: ChatTurn[], nextTurns: ChatTurn[]): ChatTurn[] {
  const previousById = new Map(previousTurns.map((turn) => [turn.id, turn]))
  let changed = previousTurns.length !== nextTurns.length
  const turns = nextTurns.map((turn) => {
    const previous = previousById.get(turn.id)
    if (previous && sameChatTurn(previous, turn)) {
      return previous
    }
    changed = true
    return turn
  })
  return changed ? turns : previousTurns
}

function chatTurnHasAssistantMessage(turn: ChatTurn, messageId: string | undefined): boolean {
  return Boolean(messageId && turn.assistants.some((message) => message.id === messageId))
}

function activityBelongsToTurn(
  activity: AssistantActivityEvent | null,
  turn: ChatTurn,
  fallbackToLastTurn: boolean,
): boolean {
  if (!activity) {
    return false
  }
  if (!activity.messageId) {
    return fallbackToLastTurn
  }
  return turn.assistants.some((message) => message.id === activity.messageId)
}

interface ChatTimelineProps {
  billingCacheScope: string
  messages: ChatMessage[]
  status: ChatStatus
  activity: AssistantActivityEvent | null
  isGenerating: boolean
  providers: ConnectionProvider[]
  onAuthorize: (auth: AuthorizationInfo) => void
  onArtifactsOpen: (selection: ArtifactSelection) => void
  onArtifactsAvailable: (selection: ArtifactSelection) => void
  onViewBilling?: () => void
}

const ChatTimeline = React.memo(function ChatTimeline({
  billingCacheScope,
  messages,
  status,
  activity,
  isGenerating,
  providers,
  onAuthorize,
  onArtifactsOpen,
  onArtifactsAvailable,
  onViewBilling,
}: ChatTimelineProps) {
  const conversationRef = React.useRef<StickToBottomContext | null>(null)
  const lastAutoScrolledUserMessageIdRef = React.useRef<string | null>(null)
  const stableTurnsRef = React.useRef<ChatTurn[]>([])
  const latestAssistant = React.useMemo(() => messages.findLast((message) => message.role === "assistant"), [messages])
  const groupedTurns = React.useMemo(() => groupChatTurns(messages), [messages])
  const turns = React.useMemo(() => {
    const stableTurns = reuseStableChatTurns(stableTurnsRef.current, groupedTurns)
    stableTurnsRef.current = stableTurns
    return stableTurns
  }, [groupedTurns])
  const providerByService = React.useMemo(
    () => new Map(providers.map((provider) => [normalizeServiceSlug(provider.service), provider])),
    [providers],
  )
  const activeAssistantMessageId =
    status === "streaming" && latestAssistant && !hasStoppedTool(latestAssistant.parts) ? latestAssistant.id : undefined
  const smoothAssistantMessageId = React.useMemo(() => {
    if (!latestAssistant || hasStoppedTool(latestAssistant.parts)) {
      return undefined
    }
    if (activeAssistantMessageId) {
      return activeAssistantMessageId
    }
    const ageMs = Date.now() - latestAssistant.createdAt
    return ageMs >= 0 && ageMs <= ASSISTANT_TEXT_SMOOTH_WINDOW_MS ? latestAssistant.id : undefined
  }, [activeAssistantMessageId, latestAssistant])
  const assistantActionTextByMessageId = React.useMemo(() => {
    return assistantResponseActionTextByMessageId(messages, activeAssistantMessageId)
  }, [activeAssistantMessageId, messages])
  const visibleArtifactSources = React.useMemo(() => {
    return collectVisibleGeneratedArtifactSources(messages, isGenerating)
  }, [isGenerating, messages])

  React.useEffect(() => {
    const lastMessage = messages.at(-1)
    if (
      !isGenerating ||
      !lastMessage ||
      lastMessage.role !== "user" ||
      lastMessage.id === lastAutoScrolledUserMessageIdRef.current
    ) {
      return
    }
    lastAutoScrolledUserMessageIdRef.current = lastMessage.id
    void conversationRef.current?.scrollToBottom({
      animation: "instant",
      ignoreEscapes: true,
    })
  }, [isGenerating, messages])

  return (
    <Conversation className="min-h-0 flex-1" contextRef={conversationRef}>
      <ConversationContent
        data-selectable="true"
        className={cn("mx-auto min-h-full w-full gap-4 px-4 pt-7 pb-9", CHAT_CONTENT_MAX_WIDTH_CLASS)}
      >
        {turns.map((turn, index) => {
          const fallbackActivity = index === turns.length - 1
          const shouldPassActivity = activityBelongsToTurn(activity, turn, fallbackActivity)
          const turnActiveAssistantMessageId = chatTurnHasAssistantMessage(turn, activeAssistantMessageId)
            ? activeAssistantMessageId
            : undefined
          const turnSmoothAssistantMessageId = chatTurnHasAssistantMessage(turn, smoothAssistantMessageId)
            ? smoothAssistantMessageId
            : undefined
          return (
            <ChatTurnView
              key={turn.id}
              turn={turn}
              billingCacheScope={billingCacheScope}
              activity={shouldPassActivity ? activity : null}
              activeAssistantMessageId={turnActiveAssistantMessageId}
              smoothAssistantMessageId={turnSmoothAssistantMessageId}
              providerByService={providerByService}
              onAuthorize={onAuthorize}
              onViewBilling={onViewBilling}
              assistantActionTextByMessageId={assistantActionTextByMessageId}
            />
          )
        })}
        {visibleArtifactSources.length > 0 ? (
          <GeneratedArtifacts
            sources={visibleArtifactSources}
            onOpen={onArtifactsOpen}
            onAvailable={onArtifactsAvailable}
          />
        ) : null}
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  )
})

function VoiceWaveCanvas({ bars, height = 32 }: { bars: readonly number[]; height?: number }) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null)
  const [sizeRevision, setSizeRevision] = React.useState(0)

  React.useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || typeof ResizeObserver === "undefined") {
      return
    }
    const observer = new ResizeObserver(() => {
      setSizeRevision((revision) => revision + 1)
    })
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [])

  React.useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }

    const rect = canvas.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    const width = Math.max(1, Math.floor(rect.width * dpr))
    const canvasHeight = Math.max(1, Math.floor(height * dpr))
    if (canvas.width !== width) {
      canvas.width = width
    }
    if (canvas.height !== canvasHeight) {
      canvas.height = canvasHeight
    }

    const context = canvas.getContext("2d")
    if (!context) {
      return
    }

    context.clearRect(0, 0, width, canvasHeight)
    context.fillStyle = getComputedStyle(canvas).color || "#18181b"

    const barWidth = 3 * dpr
    const gap = 3 * dpr
    const step = barWidth + gap
    const centerY = canvasHeight / 2
    const drawableHeight = canvasHeight - 8 * dpr
    const visibleCount = Math.max(1, Math.ceil(width / step))
    const recentBars = bars.slice(-visibleCount)
    const visibleBars =
      recentBars.length >= visibleCount
        ? recentBars
        : [...Array<number>(visibleCount - recentBars.length).fill(0), ...recentBars]

    visibleBars.forEach((bar, index) => {
      const normalized = Math.max(0, Math.min(1, bar))
      const barHeight = Math.max(3 * dpr, normalized * drawableHeight)
      const x = index * step
      const y = centerY - barHeight / 2
      context.globalAlpha = 0.35 + normalized * 0.65
      context.beginPath()
      context.roundRect(x, y, barWidth, barHeight, barWidth / 2)
      context.fill()
    })
    context.globalAlpha = 1
  }, [bars, height, sizeRevision])

  return (
    <canvas
      ref={canvasRef}
      height={height}
      className="h-8 w-full text-foreground/85"
      aria-hidden
      data-testid="voice-wave-canvas"
    />
  )
}

function VoiceRecorderPanel({ bars, durationMs }: { bars: readonly number[]; durationMs: number }) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <div className="flex h-8 min-w-0 flex-1 items-center justify-center overflow-hidden">
        <VoiceWaveCanvas bars={bars} height={32} />
      </div>
      <span className="min-w-9 shrink-0 text-right text-sm leading-none font-normal text-muted-foreground tabular-nums">
        {voiceDurationLabel(durationMs)}
      </span>
    </div>
  )
}

function ComposerTrailingControls({
  canSubmit,
  composerDisabled,
  initialSendPending,
  isGenerating,
  isSubmitted,
  modelCatalog,
  status,
  voiceActive,
  voiceBars,
  voiceDurationMs,
  voiceError,
  voiceProblem,
  voiceRecorderError,
  voiceRetryBlob,
  voiceTranscribing,
  onAddModel,
  onCancelVoice,
  onDeleteModel,
  onRetryVoice,
  onSelectModel,
  onStartVoice,
  onStop,
  onStopVoice,
}: {
  canSubmit: boolean
  composerDisabled: boolean
  initialSendPending: boolean
  isGenerating: boolean
  isSubmitted: boolean
  modelCatalog: ModelCatalog | null
  status: ChatStatus
  voiceActive: boolean
  voiceBars: readonly number[]
  voiceDurationMs: number
  voiceError: string | null
  voiceProblem: boolean
  voiceRecorderError?: string
  voiceRetryBlob: Blob | null
  voiceTranscribing: boolean
  onAddModel: () => void
  onCancelVoice: () => void
  onDeleteModel: (id: string) => void
  onRetryVoice: () => void
  onSelectModel: (choice: ModelChoice) => void
  onStartVoice: () => void
  onStop: () => void
  onStopVoice: () => void
}) {
  const t = useT()
  const visibleVoiceError = voiceError ?? voiceRecorderError

  return (
    <>
      {voiceActive ? <VoiceRecorderPanel bars={voiceBars} durationMs={voiceDurationMs} /> : null}
      <div className="flex min-w-0 shrink-0 items-center justify-end gap-1">
        {voiceActive ? (
          <>
            {visibleVoiceError ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                title={visibleVoiceError}
                aria-label={t("chat.voiceRetry")}
                className="size-8 rounded-full"
                disabled={!voiceRetryBlob || voiceTranscribing}
                onClick={onRetryVoice}
              >
                <RotateCcw className="size-4" />
              </Button>
            ) : voiceTranscribing ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t("chat.voiceCancel")}
                className="size-8 rounded-full bg-foreground/8 text-muted-foreground hover:bg-foreground/12 hover:text-foreground"
                onClick={onCancelVoice}
              >
                <Loader2 className="size-[18px] animate-spin" />
              </Button>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t("chat.voiceStop")}
                className="size-8 rounded-full bg-foreground/8 text-muted-foreground hover:bg-foreground/12 hover:text-foreground"
                onClick={onStopVoice}
              >
                <Square className="size-3.5" fill="currentColor" />
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t("chat.voiceCancel")}
              className="size-8 rounded-full bg-foreground text-background hover:bg-foreground/85 hover:text-background"
              onClick={onCancelVoice}
            >
              <X className="size-4" />
            </Button>
          </>
        ) : (
          <>
            {voiceProblem ? (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  title={visibleVoiceError}
                  aria-label={t("chat.voiceRetry")}
                  className="size-8 rounded-full"
                  disabled={!voiceRetryBlob || voiceTranscribing}
                  onClick={onRetryVoice}
                >
                  <RotateCcw className="size-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={t("chat.voiceCancel")}
                  className="size-8 rounded-full"
                  onClick={onCancelVoice}
                >
                  <X className="size-4" />
                </Button>
              </>
            ) : null}
            <ModelPicker
              catalog={modelCatalog}
              disabled={composerDisabled}
              onSelect={onSelectModel}
              onDelete={onDeleteModel}
              onAdd={onAddModel}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              title={t("chat.voiceInput")}
              aria-label={t("chat.voiceInput")}
              disabled={composerDisabled}
              className="size-8 rounded-full"
              onClick={onStartVoice}
            >
              <Mic className="size-4" />
            </Button>
            <PromptInputSubmit
              size="icon-xs"
              className="!size-7"
              status={isGenerating ? status : undefined}
              disabled={isSubmitted ? true : status === "streaming" ? false : !canSubmit}
              aria-label={
                initialSendPending ? t("aria.sending") : status === "streaming" ? t("aria.stop") : t("aria.send")
              }
              onClick={
                status === "streaming"
                  ? (event) => {
                      event.preventDefault()
                      onStop()
                    }
                  : undefined
              }
            />
          </>
        )}
      </div>
    </>
  )
}

type SlashCommandAction = "billing" | "connections" | "insert" | "skills"

interface SlashCommandPaletteItem extends ComposerPaletteItem {
  action: SlashCommandAction
  prompt?: string
}

interface ConnectionPaletteItem extends ComposerPaletteItem {
  appId?: string
  accountLabel?: string
  displayName: string
  service: string
}

interface SkillPaletteItem extends ComposerPaletteItem {
  descriptionText: string
  skillId: string
  skillName: string
}

function normalizedSearchText(value: string): string {
  return value.trim().toLowerCase()
}

function matchesComposerQuery(item: ComposerPaletteItem, query: string): boolean {
  const normalized = normalizedSearchText(query)
  if (!normalized) {
    return true
  }
  return [item.id, item.title, item.description, item.meta ?? ""].some((value) =>
    normalizedSearchText(value).includes(normalized),
  )
}

function installedSkillHostCount(group: ManagedSkillGroup): number {
  return group.hosts.filter((host) => host.status === "installed").length
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

function buildSkillPaletteItems(groups: ManagedSkillGroup[], fallbackDescription: string): SkillPaletteItem[] {
  return groups
    .filter((group) => installedSkillHostCount(group) > 0)
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((group) => ({
      description: group.description || fallbackDescription,
      descriptionText: group.description || fallbackDescription,
      icon: <Package className="size-4" />,
      id: `skill:${group.id}`,
      meta: skillKindMeta(group),
      skillId: group.id,
      skillName: group.name || group.id,
      title: group.name || group.id,
    }))
}

function buildConnectionPaletteItems(
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
      icon: <ProviderIcon iconUrl={provider.iconUrl} displayName={provider.displayName} size="compact" />,
      id: `connection:${provider.service}:${provider.appId ?? "default"}`,
      meta: provider.service,
      service: provider.service,
      title: provider.displayName,
    }))
}

function slashCommandItems({
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
      icon: <Package className="size-4" />,
      id: "skills",
      meta: "context",
      title: t("chat.commandSkills"),
    },
    {
      action: "connections",
      description: t("chat.commandConnectionsDescription"),
      icon: <Plug className="size-4" />,
      id: "connections",
      meta: "context",
      title: t("chat.commandConnections"),
    },
    {
      action: "billing",
      description: t("chat.commandBillingDescription"),
      disabled: !canViewBilling,
      icon: <SlidersHorizontal className="size-4" />,
      id: "billing",
      meta: "ui",
      title: t("chat.commandBilling"),
    },
    {
      action: "insert",
      description: t("chat.commandReviewDescription"),
      icon: <FileSearch className="size-4" />,
      id: "review",
      meta: "prompt",
      prompt: t("chat.commandReviewPrompt"),
      title: t("chat.commandReview"),
    },
    {
      action: "insert",
      description: t("chat.commandSummarizeDescription"),
      icon: <FileText className="size-4" />,
      id: "summarize",
      meta: "prompt",
      prompt: t("chat.commandSummarizePrompt"),
      title: t("chat.commandSummarize"),
    },
    {
      action: "insert",
      description: t("chat.commandStatusDescription"),
      icon: <Circle className="size-4" />,
      id: "status",
      meta: "prompt",
      prompt: t("chat.commandStatusPrompt"),
      title: t("chat.commandStatus"),
    },
  ]
}

export function ChatArea({
  billingCacheScope,
  messages,
  status,
  activity,
  showEmptyState,
  error,
  disabled,
  initialSendPending,
  providers,
  queuedMessages,
  placeholder,
  onSend,
  onStop,
  onQueuedMessageRemove,
  onAuthorize,
  onArtifactsReset,
  onArtifactsOpen,
  onArtifactsAvailable,
  onViewBilling,
}: ChatAreaProps) {
  const t = useT()
  const chatService = useChatService()
  const skillInventory = useSkillInventoryResource()
  const modelCatalogState = useModelCatalog()
  const [composer, dispatchComposer] = React.useReducer(composerReducer, undefined, initialComposerState)
  const [inputError, setInputError] = React.useState<string | null>(null)
  const [voiceTranscribing, setVoiceTranscribing] = React.useState(false)
  const [voiceError, setVoiceError] = React.useState<string | null>(null)
  const [voiceRetryBlob, setVoiceRetryBlob] = React.useState<Blob | null>(null)
  const fileInputRef = React.useRef<HTMLInputElement | null>(null)
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null)
  const attachmentsRef = React.useRef<DraftAttachment[]>([])
  const voiceRecorder = useVoiceRecorder()
  const { activePaletteIndex, attachments, contextMentions, dismissedTriggerKey, draft, draftSelection, paletteMode } =
    composer
  const hasMessages = messages.length > 0
  const isSubmitted = status === "submitted"
  const isGenerating = status === "submitted" || status === "streaming"
  const voiceBusy = voiceRecorder.isRecording || voiceTranscribing
  const voiceProblem = Boolean(voiceError || voiceRecorder.error)
  const voiceActive = voiceBusy
  const composerDisabled = disabled || voiceBusy || initialSendPending
  const modelCatalog = modelCatalogState.catalog
  const modelError = modelCatalogState.error
  const trigger = React.useMemo(
    () => (composerDisabled ? null : detectComposerTrigger(draft, draftSelection.start, draftSelection.end)),
    [composerDisabled, draft, draftSelection.end, draftSelection.start],
  )
  const triggerKey = trigger ? `${trigger.kind}:${trigger.start}:${trigger.query}` : null
  const activeTrigger = triggerKey && triggerKey !== dismissedTriggerKey ? trigger : null
  const slashItems = React.useMemo(
    () =>
      slashCommandItems({
        canViewBilling: Boolean(onViewBilling),
        t,
      }),
    [onViewBilling, t],
  )
  const skillItems = React.useMemo(
    () => buildSkillPaletteItems(skillInventory.data?.groups ?? [], t("chat.skillFallbackDescription")),
    [skillInventory.data?.groups, t],
  )
  const connectionItems = React.useMemo(
    () => buildConnectionPaletteItems(providers, (service) => t("chat.connectionFallbackDescription", { service })),
    [providers, t],
  )
  const paletteItems = React.useMemo<ComposerPaletteItem[]>(() => {
    if (!activeTrigger) {
      return []
    }
    const sourceItems =
      activeTrigger.kind === "skill" || paletteMode === "skills"
        ? skillItems
        : paletteMode === "connections"
          ? connectionItems
          : slashItems
    return sourceItems.filter((item) => matchesComposerQuery(item, activeTrigger.query)).slice(0, 8)
  }, [activeTrigger, connectionItems, paletteMode, skillItems, slashItems])
  const paletteOpen = Boolean(activeTrigger)
  const activePaletteItem = paletteItems[Math.min(activePaletteIndex, Math.max(0, paletteItems.length - 1))]
  React.useEffect(() => {
    attachmentsRef.current = attachments
  }, [attachments])

  React.useEffect(() => () => revokeAttachmentPreviewUrls(attachmentsRef.current), [])

  React.useEffect(() => {
    onArtifactsReset()
  }, [messages[0]?.id, onArtifactsReset])

  React.useEffect(() => {
    if (isGenerating) {
      onArtifactsReset()
    }
  }, [isGenerating, onArtifactsReset])

  React.useEffect(() => {
    dispatchComposer({ type: "set-active-palette-index", index: 0 })
  }, [activeTrigger?.kind, activeTrigger?.query, paletteMode])

  React.useEffect(() => {
    if (!activeTrigger) {
      dispatchComposer({ type: "set-palette-mode", mode: "root" })
      return
    }
    dispatchComposer({ type: "set-palette-mode", mode: activeTrigger.kind === "skill" ? "skills" : "root" })
  }, [activeTrigger?.kind, activeTrigger?.start])

  const updateDraftSelection = React.useCallback(() => {
    const textarea = textareaRef.current
    if (!textarea) {
      return
    }
    dispatchComposer({
      type: "set-draft-selection",
      selection: {
        end: textarea.selectionEnd,
        start: textarea.selectionStart,
      },
    })
  }, [])

  const focusDraftAt = React.useCallback((index: number) => {
    window.requestAnimationFrame(() => {
      const textarea = textareaRef.current
      if (!textarea) {
        return
      }
      textarea.focus()
      textarea.setSelectionRange(index, index)
      dispatchComposer({ type: "set-draft-selection", selection: { end: index, start: index } })
    })
  }, [])

  const addContextMention = React.useCallback((mention: ChatContextMention) => {
    dispatchComposer({ type: "add-context-mention", mention })
  }, [])

  const removeContextMention = React.useCallback((mention: ChatContextMention) => {
    dispatchComposer({ type: "remove-context-mention", mention })
  }, [])

  const returnToRootPalette = React.useCallback(() => {
    const parentId = paletteMode === "connections" ? "connections" : "skills"
    const parentIndex = slashItems.findIndex((item) => item.id === parentId)
    dispatchComposer({ type: "set-palette-mode", mode: "root" })
    dispatchComposer({ type: "set-active-palette-index", index: parentIndex >= 0 ? parentIndex : 0 })
  }, [paletteMode, slashItems])

  const applySlashCommand = React.useCallback(
    (item: SlashCommandPaletteItem, currentTrigger: ComposerTrigger) => {
      if (item.disabled) {
        return
      }
      if (item.action === "skills") {
        dispatchComposer({ type: "replace-trigger", trigger: currentTrigger, replacement: "/" })
        dispatchComposer({ type: "set-palette-mode", mode: "skills" })
        focusDraftAt(currentTrigger.start + 1)
        return
      }
      if (item.action === "connections") {
        dispatchComposer({ type: "replace-trigger", trigger: currentTrigger, replacement: "/" })
        dispatchComposer({ type: "set-palette-mode", mode: "connections" })
        focusDraftAt(currentTrigger.start + 1)
        return
      }
      if (item.action === "billing") {
        dispatchComposer({ type: "replace-trigger", trigger: currentTrigger, replacement: "" })
        onViewBilling?.()
        focusDraftAt(currentTrigger.start)
        return
      }

      const replacement = `${item.prompt ?? ""} `
      dispatchComposer({ type: "replace-trigger", trigger: currentTrigger, replacement })
      focusDraftAt(currentTrigger.start + replacement.length)
    },
    [focusDraftAt, onViewBilling],
  )

  const applySkillItem = React.useCallback(
    (item: SkillPaletteItem, currentTrigger: ComposerTrigger) => {
      addContextMention({
        description: item.descriptionText,
        id: item.skillId,
        kind: "skill",
        name: item.skillName,
      })
      dispatchComposer({ type: "replace-trigger", trigger: currentTrigger, replacement: "" })
      focusDraftAt(currentTrigger.start)
    },
    [addContextMention, focusDraftAt],
  )

  const applyConnectionItem = React.useCallback(
    (item: ConnectionPaletteItem, currentTrigger: ComposerTrigger) => {
      addContextMention({
        ...(item.accountLabel ? { accountLabel: item.accountLabel } : {}),
        ...(item.appId ? { appId: item.appId } : {}),
        displayName: item.displayName,
        kind: "connection",
        service: item.service,
      })
      dispatchComposer({ type: "replace-trigger", trigger: currentTrigger, replacement: "" })
      focusDraftAt(currentTrigger.start)
    },
    [addContextMention, focusDraftAt],
  )

  const applyPaletteItem = React.useCallback(
    (item: ComposerPaletteItem | undefined) => {
      if (!item || !activeTrigger) {
        return
      }
      if (activeTrigger.kind === "slash" && paletteMode === "root") {
        applySlashCommand(item as SlashCommandPaletteItem, activeTrigger)
      } else if (paletteMode === "connections") {
        applyConnectionItem(item as ConnectionPaletteItem, activeTrigger)
      } else {
        applySkillItem(item as SkillPaletteItem, activeTrigger)
      }
    },
    [activeTrigger, applyConnectionItem, applySkillItem, applySlashCommand, paletteMode],
  )

  const handleComposerKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.nativeEvent.isComposing) {
        return
      }
      if (!paletteOpen) {
        return
      }
      if (event.key === "ArrowDown") {
        event.preventDefault()
        dispatchComposer({
          type: "set-active-palette-index",
          index: paletteItems.length === 0 ? 0 : (activePaletteIndex + 1) % paletteItems.length,
        })
        return
      }
      if (event.key === "ArrowUp") {
        event.preventDefault()
        dispatchComposer({
          type: "set-active-palette-index",
          index: paletteItems.length === 0 ? 0 : (activePaletteIndex - 1 + paletteItems.length) % paletteItems.length,
        })
        return
      }
      if (event.key === "ArrowLeft") {
        if (activeTrigger?.kind === "slash" && paletteMode !== "root") {
          event.preventDefault()
          returnToRootPalette()
        }
        return
      }
      if (event.key === "ArrowRight") {
        if (activeTrigger?.kind === "slash" && paletteMode === "root" && activePaletteItem) {
          const item = activePaletteItem as SlashCommandPaletteItem
          if (item.action === "skills" || item.action === "connections") {
            event.preventDefault()
            applySlashCommand(item, activeTrigger)
          }
        }
        return
      }
      if (event.key === "Enter" || event.key === "Tab") {
        if (activePaletteItem) {
          event.preventDefault()
          applyPaletteItem(activePaletteItem)
        }
        return
      }
      if (event.key === "Escape") {
        event.preventDefault()
        dispatchComposer({ type: "set-dismissed-trigger-key", key: triggerKey })
      }
    },
    [
      activePaletteItem,
      activePaletteIndex,
      activeTrigger,
      applyPaletteItem,
      applySlashCommand,
      paletteItems.length,
      paletteMode,
      paletteOpen,
      returnToRootPalette,
      triggerKey,
    ],
  )

  // 表单提交（含回车）始终走"发送"路径；"停止"只通过按钮的显式点击触发（见 PromptInputSubmit
  // 的 onClick），避免生成中按回车误中止流。
  const handleSubmit = async (message: PromptInputMessage): Promise<void> => {
    const text = message.text
    if ((!text && attachments.length === 0) || disabled || initialSendPending || voiceBusy) {
      return
    }
    const accepted = await onSend(text, attachments.map(stripDraftAttachment), contextMentions, modelCatalog?.selected)
    if (!accepted) {
      setInputError(t("chat.sendNotAccepted"))
      return
    }
    revokeAttachmentPreviewUrls(attachments)
    dispatchComposer({ type: "reset-after-submit" })
    setInputError(null)
  }

  const addAttachments = React.useCallback((items: AttachmentInput[]) => {
    const next: DraftAttachment[] = []
    for (const item of items) {
      const attachment: DraftAttachment = {
        id: `${Date.now()}-${item.kind ?? "file"}-${item.name}-${item.size}-${Math.random().toString(36).slice(2)}`,
        name: item.name || item.path.split(/[\\/]/).pop() || "attachment",
        mime: item.mime || (item.kind === "directory" ? "inode/directory" : "application/octet-stream"),
        size: item.size,
        path: item.path,
        kind: item.kind ?? "file",
      }
      if (item.file && isImageAttachment(attachment)) {
        attachment.previewUrl = URL.createObjectURL(item.file)
      }
      next.push(attachment)
    }
    if (next.length > 0) {
      const existing = new Set(attachmentsRef.current.map((attachment) => attachment.path))
      const uniqueNext = next.filter((attachment) => !existing.has(attachment.path))
      revokeAttachmentPreviewUrls(next.filter((attachment) => existing.has(attachment.path)))
      for (const attachment of uniqueNext) {
        if (attachment.previewUrl) {
          setAttachmentPreviewUrl(attachment.path, attachment.previewUrl)
        }
      }
      dispatchComposer({ type: "add-attachments", attachments: uniqueNext })
    }
  }, [])

  const addFiles = React.useCallback(
    async (files: FileList | File[]) => {
      setInputError(null)
      const next: AttachmentInput[] = []
      for (const file of Array.from(files)) {
        const path = globalThis.lumo?.getPathForFile(file)
        if (!path) {
          const saver = globalThis.lumo?.saveClipboardAttachment
          if (!saver) {
            setInputError(t("chat.attachmentPathUnavailable"))
            continue
          }
          try {
            const saved = await saver({
              name: file.name,
              mime: file.type || "application/octet-stream",
              bytes: await file.arrayBuffer(),
            })
            next.push({
              name: saved.name,
              mime: saved.mime,
              size: saved.size,
              path: saved.path,
              kind: saved.kind,
              file,
            })
          } catch {
            setInputError(t("chat.attachmentSaveFailed"))
          }
          continue
        }
        next.push({
          name: file.name || path.split(/[\\/]/).pop() || "attachment",
          mime: file.type || "application/octet-stream",
          size: file.size,
          path,
          kind: "file",
          file,
        })
      }
      addAttachments(next)
    },
    [addAttachments, t],
  )

  const selectAttachments = React.useCallback(
    async (kind: "file" | "directory") => {
      setInputError(null)
      const picker = globalThis.lumo?.selectAttachmentPaths
      if (!picker) {
        if (kind === "file") {
          fileInputRef.current?.click()
        } else {
          setInputError(t("chat.attachmentFolderPickerUnavailable"))
        }
        return
      }
      try {
        addAttachments(await picker(kind))
      } catch (error) {
        setInputError(error instanceof Error ? error.message : String(error))
      }
    },
    [addAttachments, t],
  )

  const transcribeBlob = React.useCallback(
    async (blob: Blob) => {
      setVoiceTranscribing(true)
      setVoiceError(null)
      setVoiceRetryBlob(blob)
      try {
        const audioBase64 = arrayBufferToBase64(await blob.arrayBuffer())
        const result = await chatService.invoke("transcribeVoice", { audioBase64 })
        dispatchComposer({ type: "append-transcription", text: result.text })
        setVoiceRetryBlob(null)
        voiceRecorder.cancel()
      } catch (error) {
        setVoiceError(error instanceof Error ? error.message : String(error))
      } finally {
        setVoiceTranscribing(false)
      }
    },
    [chatService, voiceRecorder],
  )

  const handleStopVoice = React.useCallback(async () => {
    const recorded = await voiceRecorder.stop()
    if (recorded) {
      await transcribeBlob(recorded.blob)
    }
  }, [transcribeBlob, voiceRecorder])

  const handleCancelVoice = React.useCallback(() => {
    setVoiceTranscribing(false)
    setVoiceError(null)
    setVoiceRetryBlob(null)
    voiceRecorder.cancel()
  }, [voiceRecorder])

  const visibleError = error ?? inputError ?? modelError ?? voiceError ?? voiceRecorder.error
  const errorBanner = visibleError ? (
    <div className="oo-error flex items-center gap-2">
      <AlertTriangle className="size-4" />
      {visibleError}
    </div>
  ) : null
  const canSubmit = !composerDisabled && (draft.trim().length > 0 || attachments.length > 0)

  const promptInput = (
    <PromptInput
      onSubmit={handleSubmit}
      className={cn(hasMessages && "shrink-0")}
      onDragOver={(event) => {
        if (!composerDisabled && event.dataTransfer.types.includes("Files")) {
          event.preventDefault()
        }
      }}
      onDrop={(event) => {
        const files = filesFromDataTransfer(event.dataTransfer)
        if (composerDisabled || files.length === 0) {
          return
        }
        event.preventDefault()
        void addFiles(files)
      }}
    >
      {attachments.length > 0 || contextMentions.length > 0 ? (
        <PromptInputAttachments>
          <div className="flex w-full flex-col gap-2">
            <ContextMentionChips
              mentions={contextMentions}
              onRemove={composerDisabled ? undefined : removeContextMention}
            />
            {attachments.length > 0 ? (
              <AttachmentList
                attachments={attachments}
                onRemove={
                  composerDisabled
                    ? undefined
                    : (id) => {
                        revokeAttachmentPreviewUrls(attachmentsRef.current.filter((attachment) => attachment.id === id))
                        dispatchComposer({ type: "remove-attachment", id })
                      }
                }
              />
            ) : null}
          </div>
        </PromptInputAttachments>
      ) : null}
      <PromptInputBody>
        <PromptInputTextarea
          ref={textareaRef}
          className={cn((attachments.length > 0 || contextMentions.length > 0) && "pt-2")}
          value={draft}
          disabled={composerDisabled}
          placeholder={placeholder}
          onChange={(e) => {
            dispatchComposer({
              type: "set-draft",
              draft: e.target.value,
              selection: {
                end: e.target.selectionEnd,
                start: e.target.selectionStart,
              },
            })
          }}
          onClick={updateDraftSelection}
          onKeyDown={handleComposerKeyDown}
          onKeyUp={updateDraftSelection}
          onSelect={updateDraftSelection}
          onPaste={(event) => {
            const files = filesFromDataTransfer(event.clipboardData)
            if (composerDisabled || files.length === 0) {
              return
            }
            event.preventDefault()
            void addFiles(files)
          }}
        />
      </PromptInputBody>
      <PromptInputToolbar>
        <PromptInputTools className="shrink-0 justify-start">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(event) => {
              if (composerDisabled) {
                event.currentTarget.value = ""
                return
              }
              if (event.currentTarget.files) {
                void addFiles(event.currentTarget.files)
              }
              event.currentTarget.value = ""
            }}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                title={t("chat.attachFile")}
                aria-label={t("chat.attachFile")}
                disabled={composerDisabled}
                className="size-8 rounded-full"
              >
                <Plus className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-40">
              <DropdownMenuItem onSelect={() => void selectAttachments("file")}>
                <FileIcon className="size-4" />
                {t("chat.attachFileAction")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void selectAttachments("directory")}>
                <Folder className="size-4" />
                {t("chat.attachFolderAction")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </PromptInputTools>
        <ComposerTrailingControls
          canSubmit={canSubmit}
          composerDisabled={composerDisabled}
          initialSendPending={initialSendPending}
          isGenerating={isGenerating}
          isSubmitted={isSubmitted}
          modelCatalog={modelCatalog}
          status={status}
          voiceActive={voiceActive}
          voiceBars={voiceRecorder.bars}
          voiceDurationMs={voiceRecorder.durationMs}
          voiceError={voiceError}
          voiceProblem={voiceProblem}
          voiceRecorderError={voiceRecorder.error}
          voiceRetryBlob={voiceRetryBlob}
          voiceTranscribing={voiceTranscribing}
          onAddModel={modelCatalogState.openDialog}
          onCancelVoice={handleCancelVoice}
          onDeleteModel={modelCatalogState.deleteModel}
          onRetryVoice={() => voiceRetryBlob && void transcribeBlob(voiceRetryBlob)}
          onSelectModel={modelCatalogState.selectModel}
          onStartVoice={() => {
            setVoiceError(null)
            void voiceRecorder.start()
          }}
          onStop={onStop}
          onStopVoice={() => void handleStopVoice()}
        />
      </PromptInputToolbar>
    </PromptInput>
  )

  const modelDialog = (
    <AddCustomModelDialog
      open={modelCatalogState.dialogOpen}
      providers={modelCatalog?.providers ?? []}
      error={modelError}
      onClose={modelCatalogState.closeDialog}
      onSave={modelCatalogState.saveModel}
    />
  )
  const queuePanel = <QueuedMessagePanel messages={queuedMessages} onRemove={onQueuedMessageRemove} />
  const paletteEmptyLabel =
    paletteMode === "connections"
      ? t("chat.connectionPaletteEmpty")
      : paletteMode === "skills"
        ? skillInventory.isInitialLoading
          ? t("chat.skillPaletteLoading")
          : t("chat.skillPaletteEmpty")
        : t("chat.commandPaletteEmpty")
  const paletteHeaderLabel =
    paletteMode === "connections"
      ? t("chat.paletteConnectionsHeader")
      : paletteMode === "skills"
        ? t("chat.paletteSkillsHeader")
        : undefined
  const handlePaletteBack = activeTrigger?.kind === "slash" && paletteMode !== "root" ? returnToRootPalette : undefined
  const palette =
    paletteOpen && activeTrigger ? (
      <ComposerPalette
        activeId={activePaletteItem?.id}
        emptyLabel={paletteEmptyLabel}
        headerLabel={paletteHeaderLabel}
        items={paletteItems}
        onBack={handlePaletteBack}
        onSelect={applyPaletteItem}
      />
    ) : null
  const composerStack = (
    <div className="flex flex-col gap-2">
      {queuePanel}
      <div className="relative">
        {palette}
        {promptInput}
      </div>
    </div>
  )

  if (showEmptyState && !hasMessages && (!isGenerating || initialSendPending)) {
    return (
      <div className="grid h-full min-h-0 animate-in place-items-center px-4 py-6 duration-200 fade-in sm:px-5 lg:px-8">
        <div
          className={cn(
            "flex w-full -translate-y-[6vh] flex-col gap-10 transition-transform duration-300 ease-out",
            CHAT_CONTENT_MAX_WIDTH_CLASS,
          )}
        >
          <div className="px-4 pb-1 text-center">
            <h2 className="mx-auto max-w-2xl text-[1.625rem] leading-9 font-medium">{t("chat.emptyTitle")}</h2>
          </div>
          {errorBanner}
          {composerStack}
          {modelDialog}
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col pb-4">
        <ChatTimeline
          billingCacheScope={billingCacheScope}
          messages={messages}
          status={status}
          activity={activity}
          isGenerating={isGenerating}
          providers={providers}
          onAuthorize={onAuthorize}
          onArtifactsOpen={onArtifactsOpen}
          onArtifactsAvailable={onArtifactsAvailable}
          onViewBilling={onViewBilling}
        />

        <div
          className={cn(
            "mx-auto flex w-full flex-col gap-2 px-4 transition-transform duration-300 ease-out",
            CHAT_CONTENT_MAX_WIDTH_CLASS,
          )}
        >
          {errorBanner}
          {composerStack}
          {modelDialog}
        </div>
      </div>
    </div>
  )
}
