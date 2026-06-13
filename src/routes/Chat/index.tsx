import type {
  AuthorizationInfo,
  ChatAttachment,
  ChatMessage,
  ChatMessagePart,
  ToolStatus,
} from "../../../electron/chat/common"
import type { ConnectionProvider } from "../../../electron/connections/common"
import type {
  CustomModelProvider,
  ModelCatalog,
  ModelChoice,
  SaveCustomModelRequest,
} from "../../../electron/models/common"
import type { PromptInputMessage } from "@/components/ai-elements/prompt-input"
import type { TranslateFn } from "@/i18n/i18n"
import type { ChatStatus } from "ai"

import {
  AlertTriangle,
  Bot,
  Brain,
  CheckCircle2,
  ChevronDown,
  Circle,
  Clock3,
  ExternalLink,
  File as FileIcon,
  FileArchive,
  FileCode,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideoCamera,
  Eye,
  Loader2,
  Mic,
  Plug,
  Plus,
  RotateCcw,
  Settings2,
  Sparkles,
  Square,
  Terminal,
  Trash2,
  Wrench,
  X,
} from "lucide-react"
import * as React from "react"
import { createPortal } from "react-dom"
import { visibleUserText } from "./message-text.ts"
import { isRenderablePart, renderBlocks } from "./render-blocks.ts"
import { useVoiceRecorder } from "./useVoiceRecorder.ts"
import { Conversation, ConversationContent, ConversationScrollButton } from "@/components/ai-elements/conversation"
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message"
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
import { useChatService, useModelsService } from "@/components/AppContext"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Dialog } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useT } from "@/i18n/i18n"
import { cn } from "@/lib/utils"
import { ProviderIcon } from "@/routes/Connections/ProviderIcon"

interface ChatAreaProps {
  messages: ChatMessage[]
  status: ChatStatus
  showEmptyState: boolean
  error: string | null
  disabled: boolean
  initialSendPending: boolean
  providers: ConnectionProvider[]
  placeholder: string
  onSend: (text: string, attachments: ChatAttachment[], model?: ModelChoice) => void
  onStop: () => void
  onAuthorize: (auth: AuthorizationInfo) => void
}

type DraftAttachment = ChatAttachment & {
  previewUrl?: string
}

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

function attachmentTypeLabel(attachment: ChatAttachment): string {
  const extension = attachmentExtension(attachment.name)
  if (extension) {
    return extension.toUpperCase()
  }
  const [type] = attachment.mime.split("/")
  return type ? type.toUpperCase() : "FILE"
}

function attachmentSummary(attachment: ChatAttachment): string {
  const size = fileSizeLabel(attachment.size)
  return size ? `${attachmentTypeLabel(attachment)} ${size}` : attachmentTypeLabel(attachment)
}

function isImageAttachment(attachment: ChatAttachment): boolean {
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

/** 工具调用的一行人话摘要（折叠态显示）；缺少入参时退回原始工具名。 */
function toolSummary(t: TranslateFn, part: ChatMessagePart): string {
  if (part.title) {
    return part.title
  }
  const input = part.input ?? {}
  const service = str(input.service)
  const action = str(input.action)
  const target = service && action ? `${service} · ${action}` : service || action
  switch (part.tool) {
    case "search_actions": {
      const query = str(input.query)
      return query ? t("chat.toolSearch", { detail: query }) : (part.tool ?? "")
    }
    case "inspect_action":
      return target ? t("chat.toolInspect", { detail: target }) : (part.tool ?? "")
    case "call_action":
      return target ? t("chat.toolCall", { detail: target }) : (part.tool ?? "")
    case "bash": {
      const command = str(input.command).split("\n")[0]
      return command ? t("chat.toolRun", { detail: command }) : (part.tool ?? "")
    }
    case "read": {
      const filePath = str(input.filePath) || str(input.path)
      return filePath ? t("chat.toolRead", { detail: filePath }) : (part.tool ?? "")
    }
    default:
      return t("chat.toolGeneric", { detail: part.tool ?? "tool" })
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

function formatDuration(part: ChatMessagePart): string | null {
  const start = part.timing?.start
  const end = part.timing?.end
  if (typeof start !== "number" || typeof end !== "number" || end < start) {
    return null
  }
  const ms = end - start
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`
}

function ToolStatusIcon({ status }: { status: ToolStatus | undefined }) {
  switch (status) {
    case "running":
      return <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
    case "completed":
      return <CheckCircle2 className="size-3.5 text-green-600" />
    case "error":
      return <AlertTriangle className="size-3.5 text-destructive" />
    case "pending":
    default:
      return <Circle className="size-3.5 text-muted-foreground" />
  }
}

function ToolGlyph({ tool }: { tool: string | undefined }) {
  if (tool === "bash") {
    return <Terminal className="size-3.5" />
  }
  if (tool === "search_actions") {
    return <Clock3 className="size-3.5" />
  }
  return <Wrench className="size-3.5" />
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
  return (
    hasKeys(part.input) ||
    hasKeys(part.metadata) ||
    Boolean(part.output && !auth) ||
    Boolean(part.error) ||
    Boolean(auth?.message) ||
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
  const details = hasToolDetails(part, auth)
  const duration = formatDuration(part)
  const statusText = toolStatusLabel(t, part.status)
  const row = (
    <div className="flex min-w-0 flex-1 items-start gap-2">
      {provider ? (
        <span className="mt-0.5 shrink-0" title={`${provider.displayName} · ${statusText}`}>
          <ProviderIcon iconUrl={provider.iconUrl} displayName={provider.displayName} size="compact" />
        </span>
      ) : (
        <span className="mt-0.5 shrink-0" title={statusText}>
          <ToolStatusIcon status={part.status} />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="min-w-0 truncate text-sm text-foreground">{toolSummary(t, part)}</span>
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            {provider ? (
              <>
                <span>{provider.displayName}</span>
                <span>·</span>
              </>
            ) : (
              <ToolGlyph tool={part.tool} />
            )}
            <span>{part.tool}</span>
          </span>
          {duration && <span className="text-xs text-muted-foreground">{duration}</span>}
        </div>
        {auth && (
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="oo-text-caption">{t("chat.authNeeded", { name: auth.displayName })}</span>
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
    <Collapsible defaultOpen={part.status === "error" || Boolean(auth)}>
      <div className="rounded-md px-1 py-0.5">
        {details ? (
          <CollapsibleTrigger className="group flex w-full items-start justify-between gap-2 text-left">
            {row}
            <ChevronDown className="mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
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
            {part.output && !auth && (
              <ToolDetailSection label={t("chat.toolResult")}>
                <ToolPre>{formatToolOutput(part.output)}</ToolPre>
              </ToolDetailSection>
            )}
            {part.error && (
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

function ToolActivity({
  parts,
  providerByService,
  onAuthorize,
}: {
  parts: ChatMessagePart[]
  providerByService: Map<string, ConnectionProvider>
  onAuthorize: (auth: AuthorizationInfo) => void
}) {
  const t = useT()
  const hasActive = parts.some((part) => part.status === "pending" || part.status === "running")
  const hasError = parts.some((part) => part.status === "error")
  const hasAuth = parts.some(
    (part) => part.tool === "call_action" && part.status === "completed" && Boolean(parseAuthorization(part.output)),
  )
  const shouldOpen = hasActive || hasError || hasAuth
  const statusKey = parts.map((part) => `${part.partId}:${part.status}`).join("|")
  const [open, setOpen] = React.useState(shouldOpen)
  const title = hasError
    ? t("chat.toolActivityError", { count: parts.length })
    : hasActive
      ? t("chat.toolActivityRunning", { count: parts.length })
      : t("chat.toolActivityCompleted", { count: parts.length })

  React.useEffect(() => {
    setOpen(shouldOpen)
  }, [shouldOpen, statusKey])

  return (
    <Task open={open} onOpenChange={setOpen} className="not-prose my-0 w-full">
      <TaskTrigger title={title}>
        <button
          type="button"
          className="group flex w-fit max-w-full items-center gap-2 rounded-md py-0.5 pr-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          {hasActive ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : hasError ? (
            <AlertTriangle className="size-3.5 text-destructive" />
          ) : (
            <Eye className="size-3.5 text-muted-foreground" />
          )}
          <span className="truncate">{title}</span>
          <ChevronDown className="size-3.5 shrink-0 transition-transform group-data-[state=open]:rotate-180" />
        </button>
      </TaskTrigger>
      <TaskContent className="[&>div]:mt-1 [&>div]:space-y-1 [&>div]:border-l [&>div]:pl-2.5">
        {parts.map((part) => {
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
      </TaskContent>
    </Task>
  )
}

function MessageBubble({
  message,
  providerByService,
  onAuthorize,
}: {
  message: ChatMessage
  providerByService: Map<string, ConnectionProvider>
  onAuthorize: (auth: AuthorizationInfo) => void
}) {
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
      <Message from="user" className="items-end">
        {attachments.length > 0 ? <AttachmentList attachments={attachments} className="justify-end" /> : null}
        {visibleText ? (
          <MessageContent>
            <div className="break-words whitespace-pre-wrap">{visibleText}</div>
          </MessageContent>
        ) : null}
      </Message>
    )
  }
  const blocks = renderBlocks(message.parts)
  if (blocks.length === 0) {
    return null
  }
  const blockClassName = (index: number): string | undefined => {
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
  return (
    <Message from="assistant">
      <MessageContent className="gap-0">
        {blocks.map((block, index) => (
          <div key={block.kind === "text" ? block.part.partId : block.key} className={blockClassName(index)}>
            {block.kind === "text" ? (
              block.part.text ? (
                <MessageResponse>{block.part.text}</MessageResponse>
              ) : null
            ) : (
              <ToolActivity parts={block.parts} providerByService={providerByService} onAuthorize={onAuthorize} />
            )}
          </div>
        ))}
      </MessageContent>
    </Message>
  )
}

function AttachmentPreviewTile({ attachment }: { attachment: DraftAttachment }) {
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
  onRemove,
}: {
  attachment: DraftAttachment
  onRemove?: (id: string) => void
}) {
  const chatService = useChatService()
  const [previewUrl, setPreviewUrl] = React.useState(attachment.previewUrl ?? null)

  React.useEffect(() => {
    const cached = attachmentPreviewUrlByPath.get(attachment.path) ?? attachment.previewUrl ?? null
    setPreviewUrl(cached)
    if (cached || !isImageAttachment(attachment)) {
      return
    }
    let cancelled = false
    void chatService
      .invoke("getAttachmentPreview", { path: attachment.path, mime: attachment.mime })
      .then((result) => {
        if (cancelled || !result.dataUrl) {
          return
        }
        setAttachmentPreviewUrl(attachment.path, result.dataUrl)
        setPreviewUrl(result.dataUrl)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [attachment, chatService])

  return (
    <div
      title={attachment.path}
      className="group relative size-20 shrink-0 overflow-hidden rounded-xl border border-border/60 bg-background shadow-xs"
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
  return (
    <div className={cn("flex w-full flex-wrap justify-start gap-2", className)}>
      {attachments.map((attachment) =>
        isImageAttachment(attachment) ? (
          <AttachmentImageCard key={attachment.id} attachment={attachment} onRemove={onRemove} />
        ) : (
          <div
            key={attachment.id}
            title={attachment.path}
            className="oo-border-divider flex h-14 max-w-full min-w-0 items-center gap-3 rounded-lg border bg-background/70 py-2 pr-2 pl-2 text-left shadow-xs"
          >
            <AttachmentPreviewTile attachment={attachment} />
            <span className="min-w-0 flex-1">
              <span className="block max-w-56 truncate text-sm leading-5 font-medium text-foreground">
                {attachment.name}
              </span>
              <span className="block truncate text-xs leading-4 font-normal text-muted-foreground">
                {attachmentSummary(attachment)}
              </span>
            </span>
            {onRemove ? (
              <button
                type="button"
                aria-label="Remove attachment"
                className="rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
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
    const visibleCount = Math.ceil(width / step)
    const visibleBars = bars.slice(-visibleCount)
    const startX = width - visibleBars.length * step

    visibleBars.forEach((bar, index) => {
      const normalized = Math.max(0, Math.min(1, bar))
      const barHeight = Math.max(3 * dpr, normalized * drawableHeight)
      const x = startX + index * step
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

function AssistantPendingMessage() {
  const t = useT()
  return (
    <Message from="assistant">
      <MessageContent>
        <div className="py-0.5" role="status" aria-live="polite">
          <Shimmer as="span" className="oo-text-caption" duration={1}>
            {t("chat.thinking")}
          </Shimmer>
        </div>
      </MessageContent>
    </Message>
  )
}

function sameModelChoice(a: ModelChoice | undefined, b: ModelChoice | undefined): boolean {
  return Boolean(a && b && a.kind === b.kind && a.id === b.id)
}

function selectedModelSummary(catalog: ModelCatalog | null): { label: string; provider: string } {
  if (!catalog) {
    return { label: "Auto", provider: "OOMOL" }
  }
  const selected = catalog.selected
  if (selected.kind === "custom") {
    const custom = catalog.customModels.find((model) => model.id === selected.id)
    if (custom) {
      return { label: custom.modelName, provider: custom.providerName }
    }
  }
  const builtin = catalog.builtins.find((model) => model.id === "oomol-chat") ?? catalog.builtins[0]
  return { label: builtin?.displayName ?? "Auto", provider: builtin?.providerName ?? "OOMOL" }
}

function providerInitial(name: string): string {
  return (name.trim()[0] ?? "M").toUpperCase()
}

function ProviderMark({ name }: { name: string }) {
  return (
    <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-muted text-[11px] font-medium text-muted-foreground">
      {providerInitial(name)}
    </span>
  )
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function ModelRow({
  active,
  icon,
  title,
  subtitle,
  deleteLabel,
  onSelect,
  onDelete,
}: {
  active: boolean
  icon: React.ReactNode
  title: string
  subtitle: string
  deleteLabel?: string
  onSelect: () => void
  onDelete?: () => void
}) {
  return (
    <div className="group flex min-w-0 items-center gap-1">
      <button
        type="button"
        className={cn(
          "flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left hover:bg-accent hover:text-accent-foreground",
          active && "bg-accent text-accent-foreground",
        )}
        onClick={onSelect}
      >
        {icon}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm leading-5">{title}</span>
          <span className="block truncate text-xs leading-4 text-muted-foreground">{subtitle}</span>
        </span>
        {active ? <CheckCircle2 className="size-3.5 shrink-0 text-green-600" /> : null}
      </button>
      {onDelete ? (
        <button
          type="button"
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100"
          aria-label={deleteLabel}
          onClick={(event) => {
            event.stopPropagation()
            onDelete()
          }}
        >
          <Trash2 className="size-3.5" />
        </button>
      ) : null}
    </div>
  )
}

function ModelPicker({
  catalog,
  disabled,
  onSelect,
  onDelete,
  onAdd,
}: {
  catalog: ModelCatalog | null
  disabled: boolean
  onSelect: (choice: ModelChoice) => void
  onDelete: (id: string) => void
  onAdd: () => void
}) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const [menuStyle, setMenuStyle] = React.useState<React.CSSProperties>({})
  const rootRef = React.useRef<HTMLDivElement | null>(null)
  const menuRef = React.useRef<HTMLDivElement | null>(null)
  const selected = selectedModelSummary(catalog)

  const updateMenuPosition = React.useCallback(() => {
    const anchor = rootRef.current
    if (!anchor) {
      return
    }
    const rect = anchor.getBoundingClientRect()
    const margin = 16
    const gap = 8
    const width = Math.min(320, window.innerWidth - margin * 2)
    const left = clampNumber(rect.right - width, margin, window.innerWidth - width - margin)
    const bottom = Math.max(margin, window.innerHeight - rect.top + gap)
    const maxHeight = Math.max(180, rect.top - margin - gap)
    setMenuStyle({ left, bottom, width, maxHeight })
  }, [])

  React.useLayoutEffect(() => {
    if (open) {
      updateMenuPosition()
    }
  }, [open, updateMenuPosition])

  React.useEffect(() => {
    if (!open) {
      return
    }
    const onMouseDown = (event: MouseEvent): void => {
      const target = event.target as Node
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setOpen(false)
      }
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setOpen(false)
      }
    }
    const onReposition = (): void => updateMenuPosition()
    document.addEventListener("mousedown", onMouseDown)
    document.addEventListener("keydown", onKeyDown)
    window.addEventListener("resize", onReposition)
    window.addEventListener("scroll", onReposition, true)
    return () => {
      document.removeEventListener("mousedown", onMouseDown)
      document.removeEventListener("keydown", onKeyDown)
      window.removeEventListener("resize", onReposition)
      window.removeEventListener("scroll", onReposition, true)
    }
  }, [open, updateMenuPosition])

  const menu = open
    ? createPortal(
        <div
          ref={menuRef}
          style={menuStyle}
          className="oo-border-divider fixed z-50 overflow-y-auto rounded-lg border bg-popover p-1.5 text-popover-foreground shadow-xl"
        >
          <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">{t("chat.modelBuiltIn")}</div>
          {catalog?.builtins.map((model) => {
            const choice: ModelChoice = { kind: "builtin", id: model.id }
            return (
              <ModelRow
                key={model.id}
                active={sameModelChoice(catalog.selected, choice)}
                icon={<Bot className="size-4 shrink-0 text-muted-foreground" />}
                title={model.displayName}
                subtitle={model.providerName}
                onSelect={() => {
                  onSelect(choice)
                  setOpen(false)
                }}
              />
            )
          }) ?? (
            <ModelRow
              active
              icon={<Bot className="size-4 shrink-0 text-muted-foreground" />}
              title="Auto"
              subtitle="OOMOL"
              onSelect={() => setOpen(false)}
            />
          )}

          {catalog && catalog.customModels.length > 0 ? (
            <>
              <div className="mt-1 px-2 py-1.5 text-xs font-medium text-muted-foreground">{t("chat.modelCustom")}</div>
              {catalog.customModels.map((model) => {
                const choice: ModelChoice = { kind: "custom", id: model.id }
                return (
                  <ModelRow
                    key={model.id}
                    active={sameModelChoice(catalog.selected, choice)}
                    icon={<ProviderMark name={model.providerName} />}
                    title={model.modelName}
                    subtitle={model.providerName}
                    deleteLabel={t("chat.modelDelete")}
                    onSelect={() => {
                      onSelect(choice)
                      setOpen(false)
                    }}
                    onDelete={() => onDelete(model.id)}
                  />
                )
              })}
            </>
          ) : null}

          <div className="oo-border-divider mt-1 border-t pt-1">
            <button
              type="button"
              className="flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-accent hover:text-accent-foreground"
              onClick={() => {
                setOpen(false)
                onAdd()
              }}
            >
              <Settings2 className="size-4 text-muted-foreground" />
              <span>{t("chat.modelAdd")}</span>
            </button>
          </div>
        </div>,
        document.body,
      )
    : null

  return (
    <div ref={rootRef}>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        title={t("chat.modelPicker")}
        aria-label={t("chat.modelPicker")}
        aria-expanded={open}
        disabled={disabled}
        className="h-8 max-w-40 rounded-full px-2"
        onClick={() => setOpen((value) => !value)}
      >
        <Brain className="size-4" />
        <span className="min-w-0 truncate">{selected.label}</span>
        <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
      </Button>
      {menu}
    </div>
  )
}

function providerBaseUrl(provider: CustomModelProvider | undefined): string {
  return provider?.baseUrl ?? ""
}

function AddCustomModelDialog({
  open,
  providers,
  error,
  onClose,
  onSave,
}: {
  open: boolean
  providers: CustomModelProvider[]
  error: string | null
  onClose: () => void
  onSave: (req: SaveCustomModelRequest) => Promise<void>
}) {
  const t = useT()
  const firstProvider = providers[0]
  const [providerId, setProviderId] = React.useState(firstProvider?.id ?? "custom")
  const [baseUrl, setBaseUrl] = React.useState(providerBaseUrl(firstProvider))
  const [apiKey, setApiKey] = React.useState("")
  const [modelName, setModelName] = React.useState("")
  const [saving, setSaving] = React.useState(false)
  const provider = providers.find((item) => item.id === providerId)

  React.useEffect(() => {
    if (open) {
      const initial = providers[0]
      setProviderId(initial?.id ?? "custom")
      setBaseUrl(providerBaseUrl(initial))
      setApiKey("")
      setModelName("")
      setSaving(false)
    }
  }, [open, providers])

  const handleProviderChange = (nextId: string): void => {
    const next = providers.find((item) => item.id === nextId)
    setProviderId(nextId)
    setBaseUrl(providerBaseUrl(next))
  }

  const canSave = providerId && apiKey.trim() && modelName.trim() && baseUrl.trim()

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("chat.modelAddTitle")}
      description={t("chat.modelAddDescription")}
      closeLabel={t("common.cancel")}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            disabled={!canSave || saving}
            onClick={() => {
              setSaving(true)
              void onSave({
                providerId,
                providerName: provider?.displayName,
                baseUrl,
                apiKey,
                modelName,
              }).finally(() => setSaving(false))
            }}
          >
            {t("common.save")}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <div className="grid gap-1.5">
          <Label>{t("chat.modelProvider")}</Label>
          <Select value={providerId} onValueChange={handleProviderChange}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {providers.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.displayName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <Label>{t("chat.modelBaseUrl")}</Label>
            {provider?.documentationUrl ? (
              <a
                href={provider.documentationUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs font-normal text-primary hover:underline"
              >
                {t("chat.modelDocs")}
                <ExternalLink className="size-3" />
              </a>
            ) : null}
          </div>
          <Input
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder="https://api.example.com/v1"
            readOnly={!provider?.requiresBaseUrl}
          />
        </div>

        <div className="grid gap-1.5">
          <Label>{t("chat.modelApiKey")}</Label>
          <Input
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            type="password"
            placeholder="sk-..."
            autoComplete="off"
          />
        </div>

        <div className="grid gap-1.5">
          <Label>{t("chat.modelName")}</Label>
          <Input value={modelName} onChange={(event) => setModelName(event.target.value)} placeholder="deepseek-chat" />
        </div>

        {error ? <div className="oo-error flex items-center gap-2">{error}</div> : null}
      </div>
    </Dialog>
  )
}

export function ChatArea({
  messages,
  status,
  showEmptyState,
  error,
  disabled,
  initialSendPending,
  providers,
  placeholder,
  onSend,
  onStop,
  onAuthorize,
}: ChatAreaProps) {
  const t = useT()
  const chatService = useChatService()
  const modelsService = useModelsService()
  const [draft, setDraft] = React.useState("")
  const [attachments, setAttachments] = React.useState<DraftAttachment[]>([])
  const [inputError, setInputError] = React.useState<string | null>(null)
  const [modelCatalog, setModelCatalog] = React.useState<ModelCatalog | null>(null)
  const [modelDialogOpen, setModelDialogOpen] = React.useState(false)
  const [modelError, setModelError] = React.useState<string | null>(null)
  const [voiceTranscribing, setVoiceTranscribing] = React.useState(false)
  const [voiceError, setVoiceError] = React.useState<string | null>(null)
  const [voiceRetryBlob, setVoiceRetryBlob] = React.useState<Blob | null>(null)
  const fileInputRef = React.useRef<HTMLInputElement | null>(null)
  const attachmentsRef = React.useRef<DraftAttachment[]>([])
  const voiceRecorder = useVoiceRecorder()
  const hasMessages = messages.length > 0
  const isSubmitted = status === "submitted"
  const isGenerating = status === "submitted" || status === "streaming"
  const latestAssistant = [...messages].reverse().find((message) => message.role === "assistant")
  const providerByService = React.useMemo(
    () => new Map(providers.map((provider) => [normalizeServiceSlug(provider.service), provider])),
    [providers],
  )
  const voiceActive = voiceRecorder.isRecording || voiceTranscribing || Boolean(voiceError || voiceRecorder.error)
  const showPendingMessage =
    hasMessages &&
    (isSubmitted || (status === "streaming" && latestAssistant ? !latestAssistant.parts.some(isRenderablePart) : false))

  React.useEffect(() => {
    attachmentsRef.current = attachments
  }, [attachments])

  React.useEffect(() => () => revokeAttachmentPreviewUrls(attachmentsRef.current), [])

  React.useEffect(() => {
    let cancelled = false
    void modelsService
      .invoke("listModels")
      .then((catalog) => {
        if (!cancelled) {
          setModelCatalog(catalog)
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setModelError(error instanceof Error ? error.message : String(error))
        }
      })
    const off = modelsService.serverEvents.on("modelsChanged", (catalog) => setModelCatalog(catalog))
    return () => {
      cancelled = true
      off()
    }
  }, [modelsService])

  const handleSelectModel = React.useCallback(
    (choice: ModelChoice) => {
      setModelError(null)
      void modelsService
        .invoke("setSelectedModel", choice)
        .then(setModelCatalog)
        .catch((error) => setModelError(error instanceof Error ? error.message : String(error)))
    },
    [modelsService],
  )

  const handleDeleteModel = React.useCallback(
    (id: string) => {
      setModelError(null)
      void modelsService
        .invoke("deleteCustomModel", id)
        .then(setModelCatalog)
        .catch((error) => setModelError(error instanceof Error ? error.message : String(error)))
    },
    [modelsService],
  )

  const handleSaveModel = React.useCallback(
    async (req: SaveCustomModelRequest) => {
      setModelError(null)
      try {
        const catalog = await modelsService.invoke("saveCustomModel", req)
        setModelCatalog(catalog)
        setModelDialogOpen(false)
      } catch (error) {
        setModelError(error instanceof Error ? error.message : String(error))
        throw error
      }
    },
    [modelsService],
  )

  // 表单提交（含回车）始终走"发送"路径；"停止"只通过按钮的显式点击触发（见 PromptInputSubmit
  // 的 onClick），避免生成中按回车误中止流。
  const handleSubmit = (message: PromptInputMessage): void => {
    const text = message.text
    if ((!text && attachments.length === 0) || disabled || initialSendPending || voiceActive) {
      return
    }
    onSend(text, attachments, modelCatalog?.selected)
    revokeAttachmentPreviewUrls(attachments)
    setDraft("")
    setAttachments([])
    setInputError(null)
  }

  const addFiles = React.useCallback(
    (files: FileList | File[]) => {
      setInputError(null)
      const next: DraftAttachment[] = []
      for (const file of Array.from(files)) {
        const path = globalThis.lumo?.getPathForFile(file)
        if (!path) {
          setInputError(t("chat.attachmentPathUnavailable"))
          continue
        }
        const attachment: DraftAttachment = {
          id: `${Date.now()}-${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`,
          name: file.name || path.split(/[\\/]/).pop() || "attachment",
          mime: file.type || "application/octet-stream",
          size: file.size,
          path,
        }
        if (isImageAttachment(attachment)) {
          attachment.previewUrl = URL.createObjectURL(file)
        }
        next.push(attachment)
      }
      if (next.length > 0) {
        setAttachments((current) => {
          const existing = new Set(current.map((attachment) => attachment.path))
          const uniqueNext = next.filter((attachment) => !existing.has(attachment.path))
          revokeAttachmentPreviewUrls(next.filter((attachment) => existing.has(attachment.path)))
          for (const attachment of uniqueNext) {
            if (attachment.previewUrl) {
              setAttachmentPreviewUrl(attachment.path, attachment.previewUrl)
            }
          }
          return [...current, ...uniqueNext]
        })
      }
    },
    [t],
  )

  const transcribeBlob = React.useCallback(
    async (blob: Blob) => {
      setVoiceTranscribing(true)
      setVoiceError(null)
      setVoiceRetryBlob(blob)
      try {
        const audioBase64 = arrayBufferToBase64(await blob.arrayBuffer())
        const result = await chatService.invoke("transcribeVoice", { audioBase64 })
        setDraft((current) =>
          current.trim() ? `${current}${/\s$/.test(current) ? "" : " "}${result.text}` : result.text,
        )
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
  const canSubmit = !disabled && !voiceActive && (draft.trim().length > 0 || attachments.length > 0)

  const promptInput = (
    <PromptInput
      onSubmit={handleSubmit}
      className={cn(hasMessages && "shrink-0")}
      onDragOver={(event) => {
        if (!disabled && !voiceActive && event.dataTransfer.types.includes("Files")) {
          event.preventDefault()
        }
      }}
      onDrop={(event) => {
        const files = filesFromDataTransfer(event.dataTransfer)
        if (disabled || voiceActive || files.length === 0) {
          return
        }
        event.preventDefault()
        addFiles(files)
      }}
    >
      {attachments.length > 0 ? (
        <PromptInputAttachments>
          <AttachmentList
            attachments={attachments}
            onRemove={(id) =>
              setAttachments((current) => {
                revokeAttachmentPreviewUrls(current.filter((attachment) => attachment.id === id))
                return current.filter((attachment) => attachment.id !== id)
              })
            }
          />
        </PromptInputAttachments>
      ) : null}
      <PromptInputBody>
        <PromptInputTextarea
          className={cn(attachments.length > 0 && "pt-2")}
          value={draft}
          disabled={disabled || voiceActive}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onPaste={(event) => {
            const files = filesFromDataTransfer(event.clipboardData)
            if (disabled || voiceActive || files.length === 0) {
              return
            }
            event.preventDefault()
            addFiles(files)
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
              if (event.currentTarget.files) {
                addFiles(event.currentTarget.files)
              }
              event.currentTarget.value = ""
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            title={t("chat.attachFile")}
            aria-label={t("chat.attachFile")}
            disabled={disabled || voiceActive || initialSendPending}
            className="size-8 rounded-full"
            onClick={() => fileInputRef.current?.click()}
          >
            <Plus className="size-4" />
          </Button>
        </PromptInputTools>
        {voiceActive ? <VoiceRecorderPanel bars={voiceRecorder.bars} durationMs={voiceRecorder.durationMs} /> : null}
        <div className="flex min-w-0 shrink-0 items-center justify-end gap-1">
          {voiceActive ? (
            <>
              {voiceError || voiceRecorder.error ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  title={voiceError ?? voiceRecorder.error}
                  aria-label={t("chat.voiceRetry")}
                  className="size-8 rounded-full"
                  disabled={!voiceRetryBlob || voiceTranscribing}
                  onClick={() => voiceRetryBlob && void transcribeBlob(voiceRetryBlob)}
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
                  onClick={handleCancelVoice}
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
                  onClick={() => void handleStopVoice()}
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
                onClick={handleCancelVoice}
              >
                <X className="size-4" />
              </Button>
            </>
          ) : (
            <>
              <ModelPicker
                catalog={modelCatalog}
                disabled={disabled || initialSendPending}
                onSelect={handleSelectModel}
                onDelete={handleDeleteModel}
                onAdd={() => {
                  setModelError(null)
                  setModelDialogOpen(true)
                }}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                title={t("chat.voiceInput")}
                aria-label={t("chat.voiceInput")}
                disabled={disabled || initialSendPending}
                className="size-8 rounded-full"
                onClick={() => {
                  setVoiceError(null)
                  void voiceRecorder.start()
                }}
              >
                <Mic className="size-4" />
              </Button>
              <PromptInputSubmit
                size="icon-xs"
                className="!size-7"
                status={isGenerating ? status : undefined}
                visualStatus={initialSendPending ? "streaming" : undefined}
                disabled={initialSendPending ? false : isSubmitted ? true : status === "streaming" ? false : !canSubmit}
                aria-label={
                  initialSendPending ? t("aria.sending") : status === "streaming" ? t("aria.stop") : t("aria.send")
                }
                onClick={
                  status === "streaming"
                    ? (e) => {
                        e.preventDefault()
                        onStop()
                      }
                    : initialSendPending
                      ? (e) => {
                          e.preventDefault()
                        }
                      : undefined
                }
              />
            </>
          )}
        </div>
      </PromptInputToolbar>
    </PromptInput>
  )

  const modelDialog = (
    <AddCustomModelDialog
      open={modelDialogOpen}
      providers={modelCatalog?.providers ?? []}
      error={modelError}
      onClose={() => setModelDialogOpen(false)}
      onSave={handleSaveModel}
    />
  )

  if (showEmptyState && !hasMessages && (!isGenerating || initialSendPending)) {
    return (
      <div className="grid h-full min-h-0 animate-in place-items-center px-1 py-6 duration-200 fade-in">
        <div className="flex w-full max-w-[48rem] -translate-y-[6vh] flex-col gap-4 transition-transform duration-300 ease-out">
          <div className="flex flex-col items-center gap-3 px-4 text-center">
            <Sparkles className="size-8 text-muted-foreground" />
            <h2 className="oo-text-title max-w-2xl">{t("chat.emptyTitle")}</h2>
          </div>
          {errorBanner}
          {promptInput}
          {modelDialog}
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 animate-in flex-col pb-6 duration-300 fade-in slide-in-from-bottom-2">
      <Conversation className="min-h-0 flex-1">
        <ConversationContent
          data-selectable="true"
          className="mx-auto min-h-full w-full max-w-[50rem] gap-4 px-4 pt-7 pb-9"
        >
          {messages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              providerByService={providerByService}
              onAuthorize={onAuthorize}
            />
          ))}
          {showPendingMessage && <AssistantPendingMessage />}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="mx-auto flex w-full max-w-[50rem] flex-col gap-2 px-4 transition-transform duration-300 ease-out">
        {errorBanner}
        {promptInput}
        {modelDialog}
      </div>
    </div>
  )
}
