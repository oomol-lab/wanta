import type {
  AuthorizationInfo,
  AssistantActivityEvent,
  ChatAttachment,
  ChatContextMention,
  ChatMessage,
  ChatMessagePart,
} from "../../../electron/chat/common.ts"
import type { ConnectionProvider } from "../../../electron/connections/common.ts"
import type { ModelChoice } from "../../../electron/models/common.ts"
import type { AssistantTimelineBlock } from "./assistant-timeline.ts"
import type { ChatTurn, ChatTurnRetrySource } from "./chat-turns.ts"
import type { QueuedChatMessage } from "@/components/app-shell/chat-queue"
import type { TranslateFn } from "@/i18n/i18n"
import type { ArtifactSelection } from "@/routes/Chat/GeneratedArtifacts"
import type { ChatStatus } from "ai"
import type { StickToBottomContext } from "use-stick-to-bottom"

import { CheckIcon, ChevronRight, CopyIcon, ThumbsDown, ThumbsUp } from "lucide-react"
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
  summarizeTurnProcess,
} from "./chat-turns.ts"
import { AttachmentList } from "./ChatAttachments.tsx"
import { ChatComposer } from "./ChatComposer.tsx"
import { ChatErrorNotice } from "./ChatErrorNotice.tsx"
import { LoadingShimmerText } from "./LoadingShimmerText.tsx"
import {
  assistantResponseActionTextByMessageId,
  copyableMessageText,
  reuseStableTextMap,
  visibleUserText,
} from "./message-text.ts"
import { renderBlocks } from "./render-blocks.ts"
import { formatToolActivityDuration } from "./tool-activity.ts"
import { normalizeServiceSlug, toolActionSummary, toolServiceSlug } from "./tool-display.ts"
import { hasStoppedTool } from "./tool-state.ts"
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
import { useT } from "@/i18n/i18n"
import { cn } from "@/lib/utils"
import { GeneratedArtifacts } from "@/routes/Chat/GeneratedArtifacts"

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
  onAuthorize: (auth: AuthorizationInfo, source?: ChatTurnRetrySource) => void
  onArtifactsReset: () => void
  onArtifactsOpen: (selection: ArtifactSelection) => void
  onArtifactsAvailable: (selection: ArtifactSelection) => void
  onViewBilling?: () => void
}

const CHAT_CONTENT_MAX_WIDTH_CLASS = "min-w-0 max-w-[50rem]"
const ASSISTANT_TEXT_SMOOTH_WINDOW_MS = 45_000

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
  onAuthorize: (auth: AuthorizationInfo, source?: ChatTurnRetrySource) => void
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
  const lastAssistant = turn.assistants.at(-1)
  const assistantActionsText = lastAssistant ? assistantActionTextByMessageId.get(lastAssistant.id) : null
  const assistantCancelled = turn.assistants.some((message) => hasStoppedTool(message.parts))
  const responseActionsText =
    lastAssistant?.id === activeAssistantMessageId ? null : textFromTimelineBlocks(responseBlocks) || null
  const processActionsText = responseBlocks.length > 0 ? null : assistantActionsText
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
                onAuthorize={handleAuthorize}
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
              onAuthorize={handleAuthorize}
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
            onAuthorize={handleAuthorize}
          />
        ))
      )}
    </React.Fragment>
  )
}, chatTurnViewPropsEqual)

function chatTurnHasAssistantMessage(turn: ChatTurn, messageId: string | undefined): boolean {
  return Boolean(messageId && turn.assistants.some((message) => message.id === messageId))
}

interface ChatTimelineProps {
  billingCacheScope: string
  messages: ChatMessage[]
  status: ChatStatus
  activity: AssistantActivityEvent | null
  isGenerating: boolean
  providers: ConnectionProvider[]
  onAuthorize: (auth: AuthorizationInfo, source?: ChatTurnRetrySource) => void
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

  const composer = (
    <ChatComposer
      disabled={disabled}
      error={error}
      hasMessages={hasMessages}
      initialSendPending={initialSendPending}
      placeholder={placeholder}
      providers={providers}
      queuedMessages={queuedMessages}
      status={status}
      onQueuedMessageRemove={onQueuedMessageRemove}
      onSend={onSend}
      onStop={onStop}
      onViewBilling={onViewBilling}
    />
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
          {composer}
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
          {composer}
        </div>
      </div>
    </div>
  )
}
