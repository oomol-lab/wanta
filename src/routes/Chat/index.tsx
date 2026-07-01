import type {
  AuthorizationInfo,
  AssistantActivityEvent,
  AgentMode,
  ChatAttachment,
  ChatContextMention,
  ChatMessage,
  ChatMessagePart,
  ChatOrganizationSkillContext,
  ReasoningLevel,
} from "../../../electron/chat/common.ts"
import type { ConnectionProvider } from "../../../electron/connections/common.ts"
import type { ModelChoice } from "../../../electron/models/common.ts"
import type { AssistantTimelineBlock } from "./assistant-timeline.ts"
import type { ChatTurn, ChatTurnRetrySource } from "./chat-turns.ts"
import type { ComposerState } from "./composer-state.ts"
import type { QueuedChatMessage, QueuedMessageMovePlacement } from "@/components/app-shell/chat-queue"
import type { TranslateFn } from "@/i18n/i18n"
import type { UserFacingError } from "@/lib/user-facing-error"
import type { ArtifactSelection } from "@/routes/Chat/GeneratedArtifacts"
import type { TurnOutputSelection } from "@/routes/Chat/TurnOutputs"
import type { ChatStatus } from "ai"
import type { StickToBottomContext } from "use-stick-to-bottom"

import {
  Building2,
  CheckIcon,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CopyIcon,
  PlugZap,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react"
import * as React from "react"
import { collectVisibleGeneratedArtifactSources } from "./artifact-sources.ts"
import { splitAssistantTimelineBlocks, textFromTimelineBlocks } from "./assistant-timeline.ts"
import { attachmentWithPreview } from "./chat-attachment-utils.ts"
import {
  activityForChatTurn,
  groupChatTurns,
  latestAssistantMessage,
  retrySourceFromTurn,
  reuseStableChatTurns,
  shouldShowPlainTurnActivity,
  shouldShowSuggestedAuthorization,
  shouldShowTurnProcess,
  summarizeTurnProcess,
} from "./chat-turns.ts"
import { AttachmentList } from "./ChatAttachments.tsx"
import { ChatComposer } from "./ChatComposer.tsx"
import { ChatErrorNotice } from "./ChatErrorNotice.tsx"
import { ContextMentionChips } from "./ContextMentionChips.tsx"
import { LoadingShimmerText } from "./LoadingShimmerText.tsx"
import {
  assistantResponseActionTextByMessageId,
  copyableMessageText,
  reuseStableTextMap,
  shouldCollapseUserMessageText,
  visibleUserText,
} from "./message-text.ts"
import { renderBlocks } from "./render-blocks.ts"
import { formatToolActivityDuration, formatWholeSecondDuration } from "./tool-activity.ts"
import { normalizeServiceSlug, toolActionSummary, toolServiceSlug } from "./tool-display.ts"
import { hasStoppedTool, isActiveToolPart } from "./tool-state.ts"
import { ToolActivityStep } from "./ToolActivityStep.tsx"
import { Conversation, ConversationContent, ConversationScrollButton } from "@/components/ai-elements/conversation"
import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message"
import { Task, TaskContent, TaskTrigger } from "@/components/ai-elements/task"
import { ErrorNotice } from "@/components/ErrorNotice"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useT } from "@/i18n/i18n"
import { cn } from "@/lib/utils"
import { ProviderIcon } from "@/routes/Connections/ProviderIcon"

const GeneratedArtifacts = React.lazy(() =>
  import("@/routes/Chat/GeneratedArtifacts").then((module) => ({ default: module.GeneratedArtifacts })),
)
const GeneratedTurnOutputs = React.lazy(() =>
  import("@/routes/Chat/TurnOutputs").then((module) => ({ default: module.GeneratedTurnOutputs })),
)

interface ChatAreaProps {
  activeSessionId: string | null
  billingCacheScope: string
  composerDraftKey: string
  composerFocusRequest: number
  messages: ChatMessage[]
  status: ChatStatus
  activity: AssistantActivityEvent | null
  showEmptyState: boolean
  bootstrapping: boolean
  startupError?: UserFacingError | null
  error: string | null
  emptyTitle?: string
  generatedArtifacts?: ArtifactSelection | null
  submitDisabled: boolean
  initialComposerState?: ComposerState
  initialSendPending: boolean
  providers: ConnectionProvider[]
  queueHeld: boolean
  queuedMessages: QueuedChatMessage[]
  placeholder: string
  contextBar?: React.ReactNode
  organizationSkills?: ChatOrganizationSkillContext[]
  onSend: (
    text: string,
    attachments: ChatAttachment[],
    contextMentions: ChatContextMention[],
    model?: ModelChoice,
    reasoningLevel?: ReasoningLevel,
    mode?: AgentMode,
  ) => Promise<boolean>
  onStop: () => void
  onComposerStateChange?: (state: ComposerState) => void
  onQueuedMessageMove: (messageId: string, targetId: string, placement: QueuedMessageMovePlacement) => void
  onQueuedMessageRemove: (id: string) => void
  onQueuedMessageResume: () => void
  onAuthorize: (auth: AuthorizationInfo, source?: ChatTurnRetrySource) => void
  onArtifactsReset: () => void
  onArtifactsOpen: (selection: ArtifactSelection) => void
  onArtifactsAvailable: (selection: ArtifactSelection) => void
  onTurnOutputOpen: (selection: TurnOutputSelection) => void
  onTurnOutputAvailable: (selection: TurnOutputSelection) => void
  onOpenConnections?: () => void
  onOpenOrganizations?: () => void
  onViewBilling?: () => void
}

const CHAT_CONTENT_MAX_WIDTH_CLASS = "min-w-0 max-w-[50rem]"
const EMPTY_COMPOSER_MAX_WIDTH_CLASS = "min-w-0 max-w-[47.5rem]"
const ASSISTANT_TEXT_SMOOTH_WINDOW_MS = 45_000
const CONNECTOR_SHOWCASE_PROVIDERS = [
  { names: ["gmail"], label: "Gmail" },
  { names: ["slack"], label: "Slack" },
  { names: ["notion"], label: "Notion" },
  { names: ["github"], label: "GitHub" },
  { names: ["google drive", "googledrive", "google_drive", "gdrive", "drive"], label: "Google Drive" },
] as const

type TurnProcessStatus =
  | "running"
  | "completed"
  | "completedWithIssues"
  | "retrying"
  | "needsAction"
  | "error"
  | "stopped"

function isLiveProcess(process: ReturnType<typeof summarizeTurnProcess>, live = false): boolean {
  return process.hasActiveTool || Boolean(process.activity) || live
}

function processStatus(process: ReturnType<typeof summarizeTurnProcess>, live = false): TurnProcessStatus {
  if (process.activity?.phase === "retrying") {
    return "retrying"
  }
  if (isLiveProcess(process, live)) {
    return "running"
  }
  if (process.hasAuthorization) {
    return "needsAction"
  }
  if (process.hasBlockingError) {
    return "error"
  }
  if (process.hasToolError) {
    return "completedWithIssues"
  }
  if (process.hasStoppedTool) {
    return "stopped"
  }
  return "completed"
}

function normalizeProviderLookupText(value: string): string {
  return value.toLowerCase().replace(/[\s_-]+/g, "")
}

function connectorShowcaseProviders(providers: ConnectionProvider[]): ConnectionProvider[] {
  return CONNECTOR_SHOWCASE_PROVIDERS.map((target) => {
    const provider = providers.find((item) => {
      const service = normalizeProviderLookupText(item.service)
      const displayName = normalizeProviderLookupText(item.displayName)
      return target.names.some((name) => {
        const normalizedName = normalizeProviderLookupText(name)
        return service === normalizedName || displayName === normalizedName
      })
    })
    return (
      provider ?? {
        actionKind: "unavailable",
        appCount: 0,
        apps: [],
        authTypes: [],
        canDisconnect: false,
        categoryLabels: [],
        displayName: target.label,
        service: normalizeProviderLookupText(target.label),
        status: "available",
      }
    )
  })
}

function formatProcessDuration(
  process: ReturnType<typeof summarizeTurnProcess>,
  now: number,
  live = false,
): string | null {
  const isLive = isLiveProcess(process, live)
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
    case "completedWithIssues":
      return t("chat.processCompletedWithIssues")
  }
}

function processTitle(t: TranslateFn, status: TurnProcessStatus, duration: string | null): string {
  const title = processStatusText(t, status)
  return duration ? `${title} ${duration}` : title
}

function TurnProcessActivity({
  blocks,
  process,
  live = false,
  billingCacheScope,
  providerByService,
  onAuthorize,
  onViewBilling,
}: {
  blocks: AssistantTimelineBlock[]
  process: ReturnType<typeof summarizeTurnProcess>
  live?: boolean
  billingCacheScope: string
  providerByService: Map<string, ConnectionProvider>
  onAuthorize: (auth: AuthorizationInfo, source?: ChatTurnRetrySource) => void
  onViewBilling?: () => void
}) {
  const t = useT()
  const status = processStatus(process, live)
  const shouldOpen =
    status === "running" ||
    status === "retrying" ||
    status === "needsAction" ||
    status === "error" ||
    !process.hasFinalAnswer
  const statusKey = [
    status,
    live ? "live" : "",
    process.activity?.phase,
    process.tools.map((part) => `${part.partId}:${part.status}`).join("|"),
    process.errors.map((part) => part.partId).join("|"),
  ].join(":")
  const [open, setOpen] = React.useState(shouldOpen)
  const [now, setNow] = React.useState(() => Date.now())
  const duration = formatProcessDuration(process, now, live)
  const title = processTitle(t, status, duration)
  const renderBlocks = blocks.map((item) => item.block)
  const showLiveStatus = renderBlocks.length === 0 && shouldShowLiveStatus(process, status)
  const titleText = processStatusText(t, status)
  const activeTool = latestActiveTool(process)
  const shimmerToolPartId =
    !activeTool && status === "running" && process.activity && process.tools.length > 0
      ? process.tools.at(-1)?.partId
      : undefined
  const forceOpen = status === "needsAction" || (status === "error" && !process.hasFinalAnswer)
  const userChangedOpenRef = React.useRef(false)

  React.useEffect(() => {
    if (forceOpen) {
      userChangedOpenRef.current = false
      setOpen(true)
      return
    }
    if (userChangedOpenRef.current) {
      return
    }
    setOpen(shouldOpen)
  }, [forceOpen, shouldOpen, statusKey])

  React.useEffect(() => {
    if (status !== "running" && status !== "retrying") {
      return
    }
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [status])

  const handleOpenChange = React.useCallback((nextOpen: boolean) => {
    userChangedOpenRef.current = true
    setOpen(nextOpen)
  }, [])

  return (
    <Task open={open} onOpenChange={handleOpenChange} className="not-prose my-0 w-full">
      <div className="border-b border-border/60 py-1.5 pr-1.5">
        <TaskTrigger title={title}>
          <button
            type="button"
            className="group inline-flex max-w-full items-center gap-1.5 text-left font-medium text-[var(--oo-section-heading-foreground)] transition-colors select-none"
          >
            <span className="flex min-w-0 items-center gap-1">
              <span className="min-w-0 truncate">{titleText}</span>
              {duration ? <span className="shrink-0 tabular-nums">{duration}</span> : null}
            </span>
            <ChevronRight className="size-3.5 shrink-0 transition-transform group-data-[state=open]:rotate-90" />
          </button>
        </TaskTrigger>
      </div>
      <TaskContent className="[&>div]:mt-0">
        <div className="space-y-2 pt-2">
          {blocks.map(({ message, block }, index) => (
            <AssistantBlock
              key={`${message.id}:${block.kind === "tools" ? block.key : block.part.partId}`}
              block={block}
              blockClassName={assistantBlockClassName(renderBlocks, index)}
              billingCacheScope={billingCacheScope}
              smoothText={false}
              providerByService={providerByService}
              shimmerToolPartId={shimmerToolPartId}
              showAuthorizationPrompt={!live}
              onAuthorize={onAuthorize}
              onViewBilling={onViewBilling}
            />
          ))}
          {showLiveStatus ? <LiveStatusBar process={process} live={live} /> : null}
        </div>
      </TaskContent>
    </Task>
  )
}

function latestActiveTool(process: ReturnType<typeof summarizeTurnProcess>): ChatMessagePart | null {
  for (let index = process.tools.length - 1; index >= 0; index -= 1) {
    const part = process.tools[index]
    if (part && isActiveToolPart(part)) {
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

function LiveStatusBar({
  process,
  live = false,
}: {
  process: ReturnType<typeof summarizeTurnProcess> | null
  live?: boolean
}) {
  const t = useT()

  if (!process) {
    return null
  }

  const status = processStatus(process, live)
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
  // TODO(wanta-feedback-api): 接入反馈 API 后，将这里的本地状态同步为服务端的消息反馈结果。
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

function ConnectionSuggestionAction({
  authorization,
  provider,
  onAuthorize,
}: {
  authorization: AuthorizationInfo
  provider?: ConnectionProvider
  onAuthorize: (auth: AuthorizationInfo) => void
}) {
  const t = useT()
  if (provider?.status === "connected" && provider.appStatus === "active") {
    return null
  }
  const displayName = provider?.displayName ?? authorization.displayName
  return (
    <div className="not-prose mt-3 flex flex-wrap items-center gap-2">
      <span className="oo-text-caption text-muted-foreground">{t("chat.authNeeded", { name: displayName })}</span>
      <Button size="sm" variant="outline" className="h-8 gap-1.5 px-2.5" onClick={() => onAuthorize(authorization)}>
        <PlugZap className="size-3.5" />
        {t("chat.authorizeConnection")}
      </Button>
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
  shimmerToolPartId,
  showAuthorizationPrompt = true,
  onAuthorize,
  onViewBilling,
}: {
  block: AssistantBlockType
  blockClassName?: string
  billingCacheScope: string
  smoothText: boolean
  providerByService: Map<string, ConnectionProvider>
  shimmerToolPartId?: string
  showAuthorizationPrompt?: boolean
  onAuthorize: (auth: AuthorizationInfo, source?: ChatTurnRetrySource) => void
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
                shimmer={part.partId === shimmerToolPartId}
                showAuthorizationPrompt={showAuthorizationPrompt}
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
  suggestedAuthorization,
}: {
  billingCacheScope: string
  message: ChatMessage
  smoothText: boolean
  onViewBilling?: () => void
  assistantActionsText: string | null
  providerByService: Map<string, ConnectionProvider>
  onAuthorize: (auth: AuthorizationInfo) => void
  suggestedAuthorization?: AuthorizationInfo
}) {
  const copyText = copyableMessageText(message)
  const assistantCancelled = message.role === "assistant" && hasStoppedTool(message.parts)
  const t = useT()
  const [userMessageExpanded, setUserMessageExpanded] = React.useState(false)
  React.useEffect(() => {
    setUserMessageExpanded(false)
  }, [message.id])

  if (message.role === "user") {
    const text = message.parts
      .filter((p) => p.kind === "text")
      .map((p) => p.text)
      .join("")
    const visibleText = visibleUserText(text)
    const attachments = message.parts
      .filter((p) => p.kind === "attachment" && p.attachment)
      .map((p) => attachmentWithPreview(p.attachment as ChatAttachment))
    const contextMentions = message.contextMentions ?? []
    const collapsible = shouldCollapseUserMessageText(visibleText)
    if (!visibleText && attachments.length === 0 && contextMentions.length === 0) {
      return null
    }
    return (
      <Message from="user" className={cn("items-end", copyText && "pb-7")}>
        {contextMentions.length > 0 ? (
          <ContextMentionChips mentions={contextMentions} className="max-w-[min(34rem,85%)] justify-end" />
        ) : null}
        {attachments.length > 0 ? <AttachmentList attachments={attachments} className="justify-end" /> : null}
        {visibleText ? (
          <MessageContent className={cn(collapsible && "pb-2")}>
            <div className="relative min-w-0">
              <div
                className={cn(
                  "break-words whitespace-pre-wrap",
                  collapsible && !userMessageExpanded && "max-h-72 overflow-hidden",
                )}
              >
                {visibleText}
              </div>
              {collapsible && !userMessageExpanded ? (
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-b from-transparent to-secondary" />
              ) : null}
            </div>
            {collapsible ? (
              <button
                type="button"
                aria-expanded={userMessageExpanded}
                className="oo-text-caption-compact mt-1 -ml-1 flex h-7 w-fit items-center gap-1 rounded-md px-1.5 text-muted-foreground hover:bg-background/60 hover:text-foreground focus-visible:bg-background/60 focus-visible:text-foreground focus-visible:outline-none"
                onClick={() => setUserMessageExpanded((open) => !open)}
              >
                {userMessageExpanded ? t("chat.userMessageShowLess") : t("chat.userMessageShowMore")}
                {userMessageExpanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
              </button>
            ) : null}
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
        {suggestedAuthorization ? (
          <ConnectionSuggestionAction
            authorization={suggestedAuthorization}
            provider={providerByService.get(normalizeServiceSlug(suggestedAuthorization.service))}
            onAuthorize={onAuthorize}
          />
        ) : null}
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
  suggestedAuthorization,
  onViewBilling,
}: {
  blocks: AssistantTimelineBlock[]
  billingCacheScope: string
  smoothAssistantMessageId?: string
  assistantActionsText: string | null
  assistantCancelled: boolean
  providerByService: Map<string, ConnectionProvider>
  onAuthorize: (auth: AuthorizationInfo) => void
  suggestedAuthorization?: AuthorizationInfo
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
        {suggestedAuthorization ? (
          <ConnectionSuggestionAction
            authorization={suggestedAuthorization}
            provider={providerByService.get(normalizeServiceSlug(suggestedAuthorization.service))}
            onAuthorize={onAuthorize}
          />
        ) : null}
      </MessageContent>
      {assistantActionsText || assistantCancelled ? (
        <AssistantMessageActions text={assistantActionsText ?? ""} cancelled={assistantCancelled} />
      ) : null}
    </Message>
  )
}

function PlainAssistantActivity() {
  const t = useT()

  return (
    <Message from="assistant">
      <MessageContent className="w-full">
        <div className="flex min-h-6 min-w-0 items-center text-muted-foreground">
          <LoadingShimmerText className="min-w-0 truncate">{t("chat.thinking")}</LoadingShimmerText>
        </div>
      </MessageContent>
    </Message>
  )
}

interface ChatTurnViewProps {
  billingCacheScope: string
  turn: ChatTurn
  activity: AssistantActivityEvent | null
  activeAssistantMessageId?: string
  smoothAssistantMessageId?: string
  providerByService: Map<string, ConnectionProvider>
  onAuthorize: (auth: AuthorizationInfo, source?: ChatTurnRetrySource) => void
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
  const shouldShowProcess = shouldShowTurnProcess(process)
  const shouldShowPlainActivity = shouldShowPlainTurnActivity(process)
  const turnIsActive = Boolean(activeAssistantMessageId)
  const processSeenRef = React.useRef(shouldShowProcess)
  if (shouldShowProcess) {
    processSeenRef.current = true
  } else if (!turnIsActive) {
    processSeenRef.current = false
  }
  const showTurnProcess = shouldShowProcess || (turnIsActive && processSeenRef.current)
  const processRenderBlocks = showTurnProcess && processBlocks.length === 0 ? responseBlocks : processBlocks
  const responseRenderBlocks = showTurnProcess && processBlocks.length === 0 ? [] : responseBlocks
  const processLive = showTurnProcess && turnIsActive
  const lastAssistant = turn.assistants.at(-1)
  const assistantActionsText = lastAssistant ? assistantActionTextByMessageId.get(lastAssistant.id) : null
  const assistantCancelled = turn.assistants.some((message) => hasStoppedTool(message.parts))
  const responseActionsText =
    lastAssistant?.id === activeAssistantMessageId ? null : textFromTimelineBlocks(responseRenderBlocks) || null
  const processActionsText = responseRenderBlocks.length > 0 ? null : assistantActionsText
  const showSuggestedAuthorization = shouldShowSuggestedAuthorization(process, turnIsActive)
  const responseSuggestedAuthorization =
    showSuggestedAuthorization && responseRenderBlocks.length > 0 ? process.suggestedAuthorization : undefined
  const processSuggestedAuthorization =
    showSuggestedAuthorization && responseRenderBlocks.length === 0 ? process.suggestedAuthorization : undefined
  const retrySource = React.useMemo(() => retrySourceFromTurn(turn), [turn])
  const handleAuthorize = React.useCallback(
    (auth: AuthorizationInfo) => {
      onAuthorize(auth, retrySource ?? undefined)
    },
    [onAuthorize, retrySource],
  )

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
          onAuthorize={handleAuthorize}
        />
      ) : null}
      {showTurnProcess ? (
        <>
          <Message from="assistant">
            <MessageContent className="w-full">
              <TurnProcessActivity
                blocks={processRenderBlocks}
                process={process}
                live={processLive}
                billingCacheScope={billingCacheScope}
                providerByService={providerByService}
                onAuthorize={handleAuthorize}
                onViewBilling={onViewBilling}
              />
              {processSuggestedAuthorization ? (
                <ConnectionSuggestionAction
                  authorization={processSuggestedAuthorization}
                  provider={providerByService.get(normalizeServiceSlug(processSuggestedAuthorization.service))}
                  onAuthorize={handleAuthorize}
                />
              ) : null}
            </MessageContent>
            {processActionsText || (assistantCancelled && responseRenderBlocks.length === 0) ? (
              <AssistantMessageActions text={processActionsText ?? ""} cancelled={assistantCancelled} />
            ) : null}
          </Message>
          {responseRenderBlocks.length > 0 ? (
            <AssistantTimelineMessage
              blocks={responseRenderBlocks}
              billingCacheScope={billingCacheScope}
              smoothAssistantMessageId={smoothAssistantMessageId}
              assistantActionsText={responseActionsText}
              assistantCancelled={assistantCancelled}
              providerByService={providerByService}
              onAuthorize={handleAuthorize}
              suggestedAuthorization={responseSuggestedAuthorization}
              onViewBilling={onViewBilling}
            />
          ) : null}
        </>
      ) : (
        <>
          {shouldShowPlainActivity ? <PlainAssistantActivity /> : null}
          {turn.assistants.map((message) => (
            <MessageBubble
              key={message.clientId ?? message.id}
              message={message}
              billingCacheScope={billingCacheScope}
              smoothText={message.id === smoothAssistantMessageId}
              onViewBilling={onViewBilling}
              assistantActionsText={assistantActionTextByMessageId.get(message.id) ?? null}
              providerByService={providerByService}
              onAuthorize={handleAuthorize}
              suggestedAuthorization={message.id === lastAssistant?.id ? process.suggestedAuthorization : undefined}
            />
          ))}
        </>
      )}
    </React.Fragment>
  )
}, chatTurnViewPropsEqual)

function chatTurnHasAssistantMessage(turn: ChatTurn, messageId: string | undefined): boolean {
  return Boolean(messageId && turn.assistants.some((message) => message.id === messageId))
}

interface ChatTimelineProps {
  activeSessionId: string | null
  billingCacheScope: string
  messages: ChatMessage[]
  status: ChatStatus
  activity: AssistantActivityEvent | null
  isGenerating: boolean
  providers: ConnectionProvider[]
  onAuthorize: (auth: AuthorizationInfo, source?: ChatTurnRetrySource) => void
  onArtifactsOpen: (selection: ArtifactSelection) => void
  onArtifactsAvailable: (selection: ArtifactSelection) => void
  onTurnOutputOpen: (selection: TurnOutputSelection) => void
  onTurnOutputAvailable: (selection: TurnOutputSelection) => void
  onViewBilling?: () => void
}

const ChatTimeline = React.memo(function ChatTimeline({
  activeSessionId,
  billingCacheScope,
  messages,
  status,
  activity,
  isGenerating,
  providers,
  onAuthorize,
  onArtifactsOpen,
  onArtifactsAvailable,
  onTurnOutputOpen,
  onTurnOutputAvailable,
  onViewBilling,
}: ChatTimelineProps) {
  const conversationRef = React.useRef<StickToBottomContext | null>(null)
  const lastAutoScrolledUserMessageIdRef = React.useRef<string | null>(null)
  const stableTurnsRef = React.useRef<ChatTurn[]>([])
  const assistantActionTextByMessageIdRef = React.useRef<Map<string, string>>(new Map())
  const latestAssistant = React.useMemo(() => latestAssistantMessage(messages), [messages])
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
    const next = assistantResponseActionTextByMessageId(messages, activeAssistantMessageId)
    const stable = reuseStableTextMap(assistantActionTextByMessageIdRef.current, next)
    assistantActionTextByMessageIdRef.current = stable
    return stable
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
              activity={activityForChatTurn(turn, activity, activeAssistantMessageId, index === turns.length - 1)}
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
          <React.Suspense fallback={null}>
            <GeneratedArtifacts
              sources={visibleArtifactSources}
              onOpen={onArtifactsOpen}
              onAvailable={onArtifactsAvailable}
            />
          </React.Suspense>
        ) : null}
        <React.Suspense fallback={null}>
          <GeneratedTurnOutputs
            sessionId={activeSessionId}
            messages={messages}
            isGenerating={isGenerating}
            onOpen={onTurnOutputOpen}
            onAvailable={onTurnOutputAvailable}
          />
        </React.Suspense>
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  )
})

function EmptyStateActions({
  providers,
  onOpenConnections,
  onOpenOrganizations,
}: {
  providers: ConnectionProvider[]
  onOpenConnections?: () => void
  onOpenOrganizations?: () => void
}) {
  const t = useT()
  const showcaseProviders = React.useMemo(() => connectorShowcaseProviders(providers), [providers])

  return (
    <div className="w-full pl-2 text-muted-foreground">
      <div className="grid min-w-0 justify-start gap-1 overflow-hidden">
        <button
          type="button"
          className="group flex min-h-8 max-w-full min-w-0 items-center gap-2 text-left transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          aria-label={t("chat.emptyConnectorsAria")}
          onClick={onOpenConnections}
        >
          <span
            className="inline-flex size-6 shrink-0 items-center justify-center text-muted-foreground group-hover:text-foreground"
            aria-hidden="true"
          >
            <PlugZap className="size-4" />
          </span>
          <span className="oo-text-control min-w-0 truncate font-medium">{t("chat.emptyConnectorsAction")}</span>
          <span className="flex min-w-0 shrink-0 items-center gap-1" aria-hidden="true">
            {showcaseProviders.map((provider) => (
              <ProviderIcon
                key={provider.service}
                iconUrl={provider.iconUrl}
                displayName={provider.displayName}
                size="showcase"
              />
            ))}
          </span>
          <ChevronRight className="size-3.5 shrink-0 opacity-55 transition-opacity group-hover:opacity-90" />
        </button>

        <button
          type="button"
          className="group flex min-h-8 max-w-full min-w-0 items-center gap-2 text-left transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          aria-label={t("chat.emptyOrganizationsAria")}
          onClick={onOpenOrganizations}
        >
          <span
            className="inline-flex size-6 shrink-0 items-center justify-center text-muted-foreground group-hover:text-foreground"
            aria-hidden="true"
          >
            <Building2 className="size-4" />
          </span>
          <span className="oo-text-control min-w-0 truncate font-medium">{t("chat.emptyOrganizationsAction")}</span>
          <ChevronRight className="size-3.5 shrink-0 opacity-55 transition-opacity group-hover:opacity-90" />
        </button>
      </div>
    </div>
  )
}

export const ChatArea = React.memo(function ChatArea({
  activeSessionId,
  billingCacheScope,
  composerDraftKey,
  composerFocusRequest,
  messages,
  status,
  activity,
  showEmptyState,
  bootstrapping,
  startupError,
  error,
  emptyTitle,
  generatedArtifacts,
  submitDisabled,
  initialComposerState,
  initialSendPending,
  providers,
  queueHeld,
  queuedMessages,
  placeholder,
  contextBar,
  organizationSkills,
  onComposerStateChange,
  onSend,
  onStop,
  onQueuedMessageMove,
  onQueuedMessageRemove,
  onQueuedMessageResume,
  onAuthorize,
  onArtifactsReset,
  onArtifactsOpen,
  onArtifactsAvailable,
  onTurnOutputOpen,
  onTurnOutputAvailable,
  onOpenConnections,
  onOpenOrganizations,
  onViewBilling,
}: ChatAreaProps) {
  const t = useT()
  const hasMessages = messages.length > 0
  const isGenerating = status === "submitted" || status === "streaming"
  React.useEffect(() => {
    onArtifactsReset()
  }, [messages[0]?.id, onArtifactsReset])

  React.useEffect(() => {
    if (isGenerating) {
      onArtifactsReset()
    }
  }, [isGenerating, onArtifactsReset])

  const showCenteredEmptyState = showEmptyState && !hasMessages && !isGenerating
  const composer = (
    <ChatComposer
      key={composerDraftKey}
      error={error}
      focusRequest={composerFocusRequest}
      generatedArtifacts={generatedArtifacts}
      hasMessages={hasMessages}
      initialComposerState={initialComposerState}
      initialSendPending={initialSendPending}
      messages={messages}
      placeholder={placeholder}
      contextBar={showCenteredEmptyState ? contextBar : undefined}
      organizationSkills={organizationSkills}
      providers={providers}
      queueHeld={queueHeld}
      queuedMessages={queuedMessages}
      status={status}
      submitDisabled={submitDisabled}
      onComposerStateChange={onComposerStateChange}
      onQueuedMessageMove={onQueuedMessageMove}
      onQueuedMessageRemove={onQueuedMessageRemove}
      onQueuedMessageResume={onQueuedMessageResume}
      onSend={onSend}
      onStop={onStop}
      onViewBilling={onViewBilling}
    />
  )

  const content = startupError ? (
    <div
      className={cn("mx-auto grid min-h-full w-full place-items-center px-4 pt-7 pb-9", CHAT_CONTENT_MAX_WIDTH_CLASS)}
    >
      <ErrorNotice error={startupError} />
    </div>
  ) : bootstrapping ? (
    <div className={cn("mx-auto min-h-full w-full px-4 pt-7 pb-9", CHAT_CONTENT_MAX_WIDTH_CLASS)} aria-busy="true">
      <div className="space-y-3">
        <Skeleton className="h-3.5 w-28 rounded-sm motion-safe:animate-none" />
        <Skeleton className="h-3.5 w-72 max-w-[68%] rounded-sm motion-safe:animate-none" />
        <Skeleton className="h-3.5 w-48 max-w-[52%] rounded-sm motion-safe:animate-none" />
      </div>
    </div>
  ) : showCenteredEmptyState ? (
    <div className="grid min-h-full w-full place-items-center px-4 py-6 sm:px-5 lg:px-8">
      <div
        className={cn(
          "flex w-full translate-y-[3vh] flex-col gap-5 transition-transform duration-300 ease-out",
          EMPTY_COMPOSER_MAX_WIDTH_CLASS,
        )}
      >
        <div className="px-4 pb-1 text-center">
          <h2 className="oo-text-empty-title mx-auto max-w-2xl">{emptyTitle ?? t("chat.emptyTitle")}</h2>
        </div>
        <div className="flex flex-col gap-3">
          {composer}
          <EmptyStateActions
            providers={providers}
            onOpenConnections={onOpenConnections}
            onOpenOrganizations={onOpenOrganizations}
          />
        </div>
      </div>
    </div>
  ) : (
    <ChatTimeline
      activeSessionId={activeSessionId}
      billingCacheScope={billingCacheScope}
      messages={messages}
      status={status}
      activity={activity}
      isGenerating={isGenerating}
      providers={providers}
      onAuthorize={onAuthorize}
      onArtifactsOpen={onArtifactsOpen}
      onArtifactsAvailable={onArtifactsAvailable}
      onTurnOutputOpen={onTurnOutputOpen}
      onTurnOutputAvailable={onTurnOutputAvailable}
      onViewBilling={onViewBilling}
    />
  )

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 overflow-hidden">
      <div className="flex min-w-0 flex-1 flex-col pb-4">
        <div className="flex min-h-0 flex-1 overflow-hidden">{content}</div>

        {showCenteredEmptyState ? null : (
          <div className={cn("mx-auto flex w-full flex-col gap-2 px-4", CHAT_CONTENT_MAX_WIDTH_CLASS)}>{composer}</div>
        )}
      </div>
    </div>
  )
})
