import type { AuthorizationInfo, ChatMessage, ChatMessagePart, ToolStatus } from "../../../electron/chat/common"
import type { PromptInputMessage } from "@/components/ai-elements/prompt-input"
import type { TranslateFn } from "@/i18n/i18n"
import type { ChatStatus } from "ai"

import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Circle,
  Clock3,
  Loader2,
  Plug,
  Sparkles,
  Terminal,
  Wrench,
} from "lucide-react"
import * as React from "react"
import { Conversation, ConversationContent, ConversationScrollButton } from "@/components/ai-elements/conversation"
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message"
import {
  PromptInput,
  PromptInputBody,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputToolbar,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input"
import { Shimmer } from "@/components/ai-elements/shimmer"
import { Task, TaskContent, TaskTrigger } from "@/components/ai-elements/task"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { useT } from "@/i18n/i18n"
import { cn } from "@/lib/utils"

interface ChatAreaProps {
  messages: ChatMessage[]
  status: ChatStatus
  showEmptyState: boolean
  error: string | null
  disabled: boolean
  initialSendPending: boolean
  placeholder: string
  onSend: (text: string) => void
  onStop: () => void
  onAuthorize: (auth: AuthorizationInfo) => void
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

function hasKeys(value: Record<string, unknown> | undefined): boolean {
  return Boolean(value && Object.keys(value).length > 0)
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
  onAuthorize,
}: {
  part: ChatMessagePart
  onAuthorize: (auth: AuthorizationInfo) => void
}) {
  const t = useT()
  const auth = part.tool === "call_action" && part.status === "completed" ? parseAuthorization(part.output) : null
  const details = hasToolDetails(part, auth)
  const duration = formatDuration(part)
  const statusText = toolStatusLabel(t, part.status)
  const row = (
    <div className="flex min-w-0 flex-1 items-start gap-2">
      <span className="mt-0.5 shrink-0" title={statusText}>
        <ToolStatusIcon status={part.status} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="min-w-0 truncate text-sm text-foreground">{toolSummary(t, part)}</span>
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <ToolGlyph tool={part.tool} />
            {part.tool}
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
  onAuthorize,
}: {
  parts: ChatMessagePart[]
  onAuthorize: (auth: AuthorizationInfo) => void
}) {
  const t = useT()
  const hasActive = parts.some((part) => part.status === "pending" || part.status === "running")
  const hasError = parts.some((part) => part.status === "error")
  const hasAuth = parts.some(
    (part) => part.tool === "call_action" && part.status === "completed" && Boolean(parseAuthorization(part.output)),
  )
  const title = hasError
    ? t("chat.toolActivityError", { count: parts.length })
    : hasActive
      ? t("chat.toolActivityRunning", { count: parts.length })
      : t("chat.toolActivityCompleted", { count: parts.length })

  return (
    <Task defaultOpen={hasActive || hasError || hasAuth} className="not-prose my-1 w-full">
      <TaskTrigger title={title}>
        <button
          type="button"
          className="group flex w-fit max-w-full items-center gap-2 rounded-md py-1 pr-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          {hasActive ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : hasError ? (
            <AlertTriangle className="size-3.5 text-destructive" />
          ) : (
            <CheckCircle2 className="size-3.5 text-green-600" />
          )}
          <span className="truncate">{title}</span>
          <ChevronDown className="size-3.5 shrink-0 transition-transform group-data-[state=open]:rotate-180" />
        </button>
      </TaskTrigger>
      <TaskContent className="[&>div]:mt-2 [&>div]:space-y-1.5 [&>div]:border-l [&>div]:pl-3">
        {parts.map((part) => (
          <ToolActivityStep key={part.partId} part={part} onAuthorize={onAuthorize} />
        ))}
      </TaskContent>
    </Task>
  )
}

function isRenderablePart(part: ChatMessagePart): boolean {
  return part.kind === "tool" || Boolean(part.text)
}

type RenderBlock = { kind: "text"; part: ChatMessagePart } | { kind: "tools"; key: string; parts: ChatMessagePart[] }

function renderBlocks(parts: ChatMessagePart[]): RenderBlock[] {
  const blocks: RenderBlock[] = []
  let pendingTools: ChatMessagePart[] = []
  const flushTools = () => {
    if (pendingTools.length === 0) {
      return
    }
    blocks.push({ kind: "tools", key: pendingTools.map((part) => part.partId).join(":"), parts: pendingTools })
    pendingTools = []
  }
  for (const part of parts) {
    if (!isRenderablePart(part)) {
      continue
    }
    if (part.kind === "tool") {
      pendingTools.push(part)
      continue
    }
    flushTools()
    blocks.push({ kind: "text", part })
  }
  flushTools()
  return blocks
}

function MessageBubble({
  message,
  onAuthorize,
}: {
  message: ChatMessage
  onAuthorize: (auth: AuthorizationInfo) => void
}) {
  if (message.role === "user") {
    const text = message.parts
      .filter((p) => p.kind === "text")
      .map((p) => p.text)
      .join("")
    if (!text) {
      return null
    }
    return (
      <Message from="user">
        <MessageContent>
          <div className="break-words whitespace-pre-wrap">{text}</div>
        </MessageContent>
      </Message>
    )
  }
  const blocks = renderBlocks(message.parts)
  if (blocks.length === 0) {
    return null
  }
  return (
    <Message from="assistant">
      <MessageContent>
        {blocks.map((block) =>
          block.kind === "text" ? (
            block.part.text ? (
              <MessageResponse key={block.part.partId}>{block.part.text}</MessageResponse>
            ) : null
          ) : (
            <ToolActivity key={block.key} parts={block.parts} onAuthorize={onAuthorize} />
          ),
        )}
      </MessageContent>
    </Message>
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

export function ChatArea({
  messages,
  status,
  showEmptyState,
  error,
  disabled,
  initialSendPending,
  placeholder,
  onSend,
  onStop,
  onAuthorize,
}: ChatAreaProps) {
  const t = useT()
  const [draft, setDraft] = React.useState("")
  const hasMessages = messages.length > 0
  const isSubmitted = status === "submitted"
  const isGenerating = status === "submitted" || status === "streaming"
  const latestAssistant = [...messages].reverse().find((message) => message.role === "assistant")
  const showPendingMessage =
    hasMessages &&
    (isSubmitted || (status === "streaming" && latestAssistant ? !latestAssistant.parts.some(isRenderablePart) : false))

  // 表单提交（含回车）始终走"发送"路径；"停止"只通过按钮的显式点击触发（见 PromptInputSubmit
  // 的 onClick），避免生成中按回车误中止流。
  const handleSubmit = (message: PromptInputMessage): void => {
    const text = message.text
    if (!text || disabled || initialSendPending) {
      return
    }
    onSend(text)
    setDraft("")
  }

  const errorBanner = error ? (
    <div className="oo-error flex items-center gap-2">
      <AlertTriangle className="size-4" />
      {error}
    </div>
  ) : null

  const promptInput = (
    <PromptInput onSubmit={handleSubmit} className={cn(hasMessages && "shrink-0")}>
      <PromptInputBody>
        <PromptInputTextarea
          value={draft}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
        />
      </PromptInputBody>
      <PromptInputToolbar>
        <PromptInputTools />
        <PromptInputSubmit
          status={isGenerating ? status : undefined}
          visualStatus={initialSendPending ? "streaming" : undefined}
          disabled={
            initialSendPending
              ? false
              : isSubmitted
                ? true
                : status === "streaming"
                  ? false
                  : disabled || draft.trim().length === 0
          }
          aria-label={initialSendPending ? t("aria.sending") : status === "streaming" ? t("aria.stop") : t("aria.send")}
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
      </PromptInputToolbar>
    </PromptInput>
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
            <MessageBubble key={message.id} message={message} onAuthorize={onAuthorize} />
          ))}
          {showPendingMessage && <AssistantPendingMessage />}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="mx-auto flex w-full max-w-[50rem] flex-col gap-2 px-4 transition-transform duration-300 ease-out">
        {errorBanner}
        {promptInput}
      </div>
    </div>
  )
}
