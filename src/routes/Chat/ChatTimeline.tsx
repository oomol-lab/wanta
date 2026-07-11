import type {
  AuthorizationInfo,
  AssistantActivityEvent,
  ChatPermissionReply,
  ChatPermissionRequest,
  ChatQuestionRequest,
  ChatAttachment,
  ChatMessage,
  ChatMessagePart,
  TurnOutputRecord,
} from "../../../electron/chat/common.ts"
import type { ConnectionProvider } from "../../../electron/connections/common.ts"
import type { ResolvedArtifactGroup } from "./artifact-resolution.ts"
import type { AssistantTimelineBlock } from "./assistant-timeline.ts"
import type { ChatTurn, ChatTurnProcessStatus, ChatTurnRetrySource } from "./chat-turns.ts"
import type { ProcessOpenPreference } from "./process-activity-open.ts"
import type { QuestionDraftStore } from "./question-fields.ts"
import type { TranslateFn } from "@/i18n/i18n"
import type { ArtifactSelection } from "@/routes/Chat/GeneratedArtifacts"
import type { TurnOutputSelection } from "@/routes/Chat/TurnOutputs"
import type { ChatStatus } from "ai"
import type { StickToBottomContext } from "use-stick-to-bottom"

import { ChevronDown, ChevronRight, ChevronUp } from "lucide-react"
import * as React from "react"
import { isConnectionlessNoAuthProvider } from "../../../electron/connections/summary.ts"
import { useArtifactBundles } from "./artifact-bundle-records.ts"
import { splitAssistantTimelineBlocks, textFromTimelineBlocks } from "./assistant-timeline.ts"
import { attachmentWithPreview } from "./chat-attachment-utils.ts"
import {
  activityForChatTurn,
  assistantMessageIdsKey,
  chatTurnProcessStatus,
  groupChatTurns,
  isLiveTurnProcess,
  latestAssistantMessage,
  retrySourceFromTurn,
  reuseStableChatTurns,
  shouldShowPlainTurnActivity,
  shouldShowSuggestedAuthorization,
  shouldShowTurnProcess,
  summarizeTurnProcess,
} from "./chat-turns.ts"
import { AttachmentList } from "./ChatAttachments.tsx"
import { ChatErrorNotice } from "./ChatErrorNotice.tsx"
import {
  AssistantMessageActions,
  ConnectionSuggestionAction,
  CopyMessageAction,
  MessageTimestamp,
} from "./ChatMessageActions.tsx"
import { ContextMentionChips } from "./ContextMentionChips.tsx"
import { LoadingShimmerText } from "./LoadingShimmerText.tsx"
import {
  assistantResponseActionTextByMessageId,
  copyableMessageText,
  reuseStableTextMap,
  shouldCollapseUserMessageText,
  visibleUserText,
} from "./message-text.ts"
import { PermissionRequiredCard } from "./PermissionRequiredCard.tsx"
import { processOpenAfterStatusChange, processShouldOpenAutomatically } from "./process-activity-open.ts"
import { QuestionPromptCard } from "./QuestionPromptCard.tsx"
import { renderBlocks } from "./render-blocks.ts"
import { formatWholeSecondDuration } from "./tool-activity.ts"
import { normalizeServiceSlug, toolActionSummary, toolServiceSlug } from "./tool-display.ts"
import { hasStoppedTool, isActiveToolPart } from "./tool-state.ts"
import { ToolActivityStep } from "./ToolActivityStep.tsx"
import {
  turnOutputInitialRole,
  turnOutputRecordsByMessageId,
  turnOutputRecordsByTurnId,
  useTurnOutputRecords,
} from "./turn-output-records.ts"
import { TurnOutputShelf } from "./TurnOutputShelf.tsx"
import { Conversation, ConversationContent, ConversationScrollButton } from "@/components/ai-elements/conversation"
import { Message, MessageActions, MessageContent, MessageResponse } from "@/components/ai-elements/message"
import { Task, TaskContent, TaskTrigger } from "@/components/ai-elements/task"
import { useT } from "@/i18n/i18n"
import { cn } from "@/lib/utils"

const GeneratedArtifacts = React.lazy(() =>
  import("@/routes/Chat/GeneratedArtifacts").then((module) => ({ default: module.GeneratedArtifacts })),
)
const CHAT_CONTENT_MAX_WIDTH_CLASS = "min-w-0 max-w-[50rem]"
const ASSISTANT_TEXT_SMOOTH_WINDOW_MS = 45_000

function shouldRenderConnectionSuggestion(
  authorization: AuthorizationInfo | undefined,
  providerByService: Map<string, ConnectionProvider>,
): AuthorizationInfo | undefined {
  if (!authorization) {
    return undefined
  }
  const provider = providerByService.get(normalizeServiceSlug(authorization.service))
  if (!provider) {
    return authorization
  }
  return provider.status === "connected" || isConnectionlessNoAuthProvider(provider) ? undefined : authorization
}
const EMPTY_ARTIFACT_GROUPS: ResolvedArtifactGroup[] = []

function noopArtifactsAvailable(_selection: ArtifactSelection): void {
  // 只有最新的产物需要自动成为右侧面板的默认选择。
}

function artifactGroupArraysEqual(
  left: readonly ResolvedArtifactGroup[],
  right: readonly ResolvedArtifactGroup[],
): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index])
}

function reuseStableArtifactGroupMap(
  previous: Map<string, ResolvedArtifactGroup[]>,
  next: Map<string, ResolvedArtifactGroup[]>,
): Map<string, ResolvedArtifactGroup[]> {
  let changed = previous.size !== next.size
  const stable = new Map<string, ResolvedArtifactGroup[]>()
  for (const [key, groups] of next) {
    const previousGroups = previous.get(key)
    const stableGroups = previousGroups && artifactGroupArraysEqual(previousGroups, groups) ? previousGroups : groups
    stable.set(key, stableGroups)
    if (stableGroups !== previousGroups) {
      changed = true
    }
  }
  return changed ? stable : previous
}

function formatSettledToolActivityDuration(parts: ChatMessagePart[]): string | null {
  let start: number | undefined
  let end: number | undefined
  for (const part of parts) {
    const partStart = part.timing?.start
    const partEnd = part.timing?.end
    if (typeof partStart !== "number" || typeof partEnd !== "number" || partEnd < partStart) {
      continue
    }
    start = start === undefined ? partStart : Math.min(start, partStart)
    end = end === undefined ? partEnd : Math.max(end, partEnd)
  }
  return start === undefined || end === undefined ? null : formatWholeSecondDuration(end - start)
}

function formatProcessDuration(
  process: ReturnType<typeof summarizeTurnProcess>,
  now: number,
  live = false,
): string | null {
  const isLive = isLiveTurnProcess(process, live)
  const toolDuration = !isLive && process.tools.length > 0 ? formatSettledToolActivityDuration(process.tools) : null
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

function processStatusText(t: TranslateFn, status: ChatTurnProcessStatus): string {
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

function processTitle(t: TranslateFn, status: ChatTurnProcessStatus, duration: string | null): string {
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
  const status = chatTurnProcessStatus(process, live)
  const shouldOpen = processShouldOpenAutomatically(status, process.hasFinalAnswer)
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
  const settlingToolPartId =
    !activeTool && status === "running" && process.activity && process.tools.length > 0
      ? process.tools.at(-1)?.partId
      : undefined
  const openPreferenceRef = React.useRef<ProcessOpenPreference>("auto")

  React.useEffect(() => {
    setOpen(
      processOpenAfterStatusChange({
        hasFinalAnswer: process.hasFinalAnswer,
        preference: openPreferenceRef.current,
        status,
      }),
    )
  }, [process.hasFinalAnswer, status, statusKey])

  React.useEffect(() => {
    if (status !== "running" && status !== "retrying") {
      return
    }
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [status])

  const handleOpenChange = React.useCallback((nextOpen: boolean) => {
    openPreferenceRef.current = nextOpen ? "user_open" : "user_closed"
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
              settlingToolPartId={settlingToolPartId}
              liveTools={live}
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
  status = chatTurnProcessStatus(process),
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

  const status = chatTurnProcessStatus(process, live)
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

function statusPartText(t: TranslateFn, part: ChatMessagePart): string {
  switch (part.statusType) {
    case "reconnecting":
      return part.attempt && part.maxAttempts
        ? t("chat.connectionReconnectingWithAttempt", { attempt: part.attempt, maxAttempts: part.maxAttempts })
        : t("chat.connectionReconnecting")
    case "reconnected":
      return t("chat.connectionReconnected")
    case "connectionFailed":
      return t("chat.connectionFailed")
    case "generationStale":
      return t("chat.generationStale")
    case "toolRunningWithoutOutput":
      return t("chat.toolRunningWithoutOutput")
    case "runtimeRestarting":
      return part.attempt && part.maxAttempts
        ? t("chat.runtimeRestartingWithAttempt", { attempt: part.attempt, maxAttempts: part.maxAttempts })
        : t("chat.runtimeRestarting")
    case "runtimeRecovered":
      return t("chat.runtimeRecovered")
    case "runtimeFailed":
      return t("chat.runtimeFailed")
    default:
      return part.text ?? ""
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
  settlingToolPartId,
  liveTools = true,
  showAuthorizationPrompt = true,
  onAuthorize,
  onViewBilling,
}: {
  block: AssistantBlockType
  blockClassName?: string
  billingCacheScope: string
  smoothText: boolean
  providerByService: Map<string, ConnectionProvider>
  settlingToolPartId?: string
  liveTools?: boolean
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
      ) : block.kind === "status" ? (
        <div className="text-sm leading-6 font-medium text-muted-foreground/80">{statusPartText(t, block.part)}</div>
      ) : (
        <div className="space-y-0.5">
          {block.parts.map((part) => {
            const service = toolServiceSlug(part)
            return (
              <ToolActivityStep
                key={part.partId}
                part={part}
                provider={service ? providerByService.get(service) : undefined}
                live={liveTools}
                shimmer={part.partId === settlingToolPartId}
                settling={part.partId === settlingToolPartId}
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
  liveTools = false,
}: {
  billingCacheScope: string
  message: ChatMessage
  smoothText: boolean
  onViewBilling?: () => void
  assistantActionsText: string | null
  providerByService: Map<string, ConnectionProvider>
  onAuthorize: (auth: AuthorizationInfo) => void
  suggestedAuthorization?: AuthorizationInfo
  liveTools?: boolean
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
          <ContextMentionChips
            mentions={contextMentions}
            providerByService={providerByService}
            className="max-w-[min(34rem,85%)] justify-end"
          />
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
            liveTools={liveTools}
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
  activeAssistantMessageId,
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
  activeAssistantMessageId?: string
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
            liveTools={message.id === activeAssistantMessageId}
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
  activeSessionId: string | null
  artifactGroups: ResolvedArtifactGroup[]
  artifactSelectionGroups: ResolvedArtifactGroup[]
  billingCacheScope: string
  turnOutputRecord: TurnOutputRecord | null
  turn: ChatTurn
  activity: AssistantActivityEvent | null
  activeAssistantMessageId?: string
  smoothAssistantMessageId?: string
  providerByService: Map<string, ConnectionProvider>
  onAuthorize: (auth: AuthorizationInfo, source?: ChatTurnRetrySource) => void
  onArtifactsAvailable: (selection: ArtifactSelection) => void
  onArtifactsOpen: (selection: ArtifactSelection) => void
  onTurnOutputOpen: (selection: TurnOutputSelection) => void
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
    previous.activeSessionId === next.activeSessionId &&
    previous.artifactGroups === next.artifactGroups &&
    previous.artifactSelectionGroups === next.artifactSelectionGroups &&
    previous.billingCacheScope === next.billingCacheScope &&
    previous.turnOutputRecord === next.turnOutputRecord &&
    previous.turn === next.turn &&
    previous.activity === next.activity &&
    previous.activeAssistantMessageId === next.activeAssistantMessageId &&
    previous.smoothAssistantMessageId === next.smoothAssistantMessageId &&
    previous.providerByService === next.providerByService &&
    previous.onAuthorize === next.onAuthorize &&
    previous.onArtifactsAvailable === next.onArtifactsAvailable &&
    previous.onArtifactsOpen === next.onArtifactsOpen &&
    previous.onTurnOutputOpen === next.onTurnOutputOpen &&
    previous.onViewBilling === next.onViewBilling &&
    assistantActionTextsEqual(previous, next)
  )
}

const ChatTurnView = React.memo(function ChatTurnView({
  activeSessionId,
  artifactGroups,
  artifactSelectionGroups,
  billingCacheScope,
  turnOutputRecord,
  turn,
  activity,
  activeAssistantMessageId,
  smoothAssistantMessageId,
  providerByService,
  onAuthorize,
  onArtifactsAvailable,
  onArtifactsOpen,
  onTurnOutputOpen,
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
  const suggestedAuthorization = shouldRenderConnectionSuggestion(
    showSuggestedAuthorization ? process.suggestedAuthorization : undefined,
    providerByService,
  )
  const responseSuggestedAuthorization =
    suggestedAuthorization && responseRenderBlocks.length > 0 ? suggestedAuthorization : undefined
  const processSuggestedAuthorization =
    suggestedAuthorization && responseRenderBlocks.length === 0 ? suggestedAuthorization : undefined
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
              activeAssistantMessageId={activeAssistantMessageId}
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
              liveTools={message.id === activeAssistantMessageId}
              onAuthorize={handleAuthorize}
              suggestedAuthorization={message.id === lastAssistant?.id ? process.suggestedAuthorization : undefined}
            />
          ))}
        </>
      )}
      {artifactGroups.length > 0 ? (
        <React.Suspense fallback={null}>
          <GeneratedArtifacts
            groups={artifactGroups}
            selectionGroups={artifactSelectionGroups}
            onOpen={onArtifactsOpen}
            onAvailable={onArtifactsAvailable}
          />
        </React.Suspense>
      ) : null}
      {activeSessionId && turnOutputRecord ? (
        <TurnOutputShelf record={turnOutputRecord} onOpen={onTurnOutputOpen} />
      ) : null}
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
  pendingPermissions: ChatPermissionRequest[]
  pendingQuestions: ChatQuestionRequest[]
  status: ChatStatus
  activity: AssistantActivityEvent | null
  isGenerating: boolean
  providers: ConnectionProvider[]
  onAuthorize: (auth: AuthorizationInfo, source?: ChatTurnRetrySource) => void
  onArtifactsOpen: (selection: ArtifactSelection) => void
  onArtifactsAvailable: (selection: ArtifactSelection) => void
  onTurnOutputOpen: (selection: TurnOutputSelection) => void
  onTurnOutputAvailable: (selection: TurnOutputSelection) => void
  onAnswerQuestion: (requestId: string, answers: string[][]) => Promise<void>
  onAnswerPermission: (requestId: string, reply: ChatPermissionReply) => Promise<void>
  onRejectQuestion: (requestId: string) => Promise<void>
  questionDrafts: QuestionDraftStore
  onViewBilling?: () => void
}

export const ChatTimeline = React.memo(function ChatTimeline({
  activeSessionId,
  billingCacheScope,
  messages,
  pendingPermissions = [],
  pendingQuestions = [],
  status,
  activity,
  isGenerating,
  providers,
  onAuthorize,
  onArtifactsOpen,
  onArtifactsAvailable,
  onTurnOutputOpen,
  onTurnOutputAvailable,
  onAnswerQuestion,
  onAnswerPermission,
  onRejectQuestion,
  questionDrafts,
  onViewBilling,
}: ChatTimelineProps) {
  const conversationRef = React.useRef<StickToBottomContext | null>(null)
  const lastAutoScrolledUserMessageIdRef = React.useRef<string | null>(null)
  const stableTurnsRef = React.useRef<ChatTurn[]>([])
  const assistantActionTextByMessageIdRef = React.useRef<Map<string, string>>(new Map())
  const artifactGroupsByMessageIdRef = React.useRef<Map<string, ResolvedArtifactGroup[]>>(new Map())
  const artifactGroupsByTurnIdRef = React.useRef<Map<string, ResolvedArtifactGroup[]>>(new Map())
  const latestAssistant = React.useMemo(() => latestAssistantMessage(messages), [messages])
  const groupedTurns = React.useMemo(() => groupChatTurns(messages), [messages])
  const turns = React.useMemo(() => {
    const stableTurns = reuseStableChatTurns(stableTurnsRef.current, groupedTurns)
    stableTurnsRef.current = stableTurns
    return stableTurns
  }, [groupedTurns])
  const messageIdsKey = React.useMemo(() => assistantMessageIdsKey(messages), [messages])
  const artifactBundles = useArtifactBundles(activeSessionId, messageIdsKey)
  const turnOutputRecords = useTurnOutputRecords(activeSessionId, messageIdsKey)
  const turnOutputRecordsByMessage = React.useMemo(
    () => turnOutputRecordsByMessageId(turnOutputRecords),
    [turnOutputRecords],
  )
  const turnOutputRecordsByTurn = React.useMemo(
    () => turnOutputRecordsByTurnId(turns, turnOutputRecordsByMessage),
    [turnOutputRecordsByMessage, turns],
  )
  const latestTurnOutputRecord = turnOutputRecords.at(-1)
  const providerByService = React.useMemo(
    () => new Map(providers.map((provider) => [normalizeServiceSlug(provider.service), provider])),
    [providers],
  )
  const answerPermissionSafely = React.useCallback(
    (requestId: string, reply: ChatPermissionReply): void => {
      void onAnswerPermission(requestId, reply).catch(() => undefined)
    },
    [onAnswerPermission],
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
  const visibleArtifactGroups = React.useMemo<ResolvedArtifactGroup[]>(
    () =>
      artifactBundles.map((bundle) => ({
        messageId: bundle.messageId,
        group: {
          root: {
            path: bundle.rootPath,
            name: bundle.rootPath.split(/[\\/]/u).pop() ?? bundle.rootPath,
            kind: "directory" as const,
            mime: "inode/directory",
          },
          items: bundle.items,
          totalItems: bundle.totalItems,
          truncated: bundle.truncated,
        },
        status: bundle.status,
        ...(bundle.failure ? { failure: bundle.failure } : {}),
      })),
    [artifactBundles],
  )
  const artifactGroupsByMessageId = React.useMemo(() => {
    const byMessageId = new Map<string, ResolvedArtifactGroup[]>()
    for (const group of visibleArtifactGroups) {
      const groups = byMessageId.get(group.messageId) ?? []
      groups.push(group)
      byMessageId.set(group.messageId, groups)
    }
    const stable = reuseStableArtifactGroupMap(artifactGroupsByMessageIdRef.current, byMessageId)
    artifactGroupsByMessageIdRef.current = stable
    return stable
  }, [visibleArtifactGroups])
  const artifactGroupsByTurnId = React.useMemo(() => {
    const byTurnId = new Map<string, ResolvedArtifactGroup[]>()
    for (const turn of turns) {
      const groups = turn.assistants.flatMap((message) => artifactGroupsByMessageId.get(message.id) ?? [])
      if (groups.length > 0) {
        byTurnId.set(turn.id, groups)
      }
    }
    const stable = reuseStableArtifactGroupMap(artifactGroupsByTurnIdRef.current, byTurnId)
    artifactGroupsByTurnIdRef.current = stable
    return stable
  }, [artifactGroupsByMessageId, turns])
  const latestArtifactGroupMessageId = visibleArtifactGroups.at(-1)?.messageId
  React.useEffect(() => {
    if (latestTurnOutputRecord) {
      onTurnOutputAvailable({
        record: latestTurnOutputRecord,
        initialRole: turnOutputInitialRole(latestTurnOutputRecord),
      })
    }
  }, [latestTurnOutputRecord, onTurnOutputAvailable])

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
          const turnArtifactGroups = artifactGroupsByTurnId.get(turn.id) ?? EMPTY_ARTIFACT_GROUPS
          const publishArtifactAvailability =
            turnArtifactGroups.length > 0 &&
            turn.assistants.some((message) => message.id === latestArtifactGroupMessageId)
          const turnActiveAssistantMessageId = chatTurnHasAssistantMessage(turn, activeAssistantMessageId)
            ? activeAssistantMessageId
            : undefined
          const turnSmoothAssistantMessageId = chatTurnHasAssistantMessage(turn, smoothAssistantMessageId)
            ? smoothAssistantMessageId
            : undefined
          return (
            <div key={turn.id} className="oo-chat-turn-render-boundary grid gap-4">
              <ChatTurnView
                activeSessionId={activeSessionId}
                artifactGroups={turnArtifactGroups}
                artifactSelectionGroups={visibleArtifactGroups}
                turn={turn}
                billingCacheScope={billingCacheScope}
                turnOutputRecord={turnOutputRecordsByTurn.get(turn.id) ?? null}
                activity={activityForChatTurn(turn, activity, activeAssistantMessageId, index === turns.length - 1)}
                activeAssistantMessageId={turnActiveAssistantMessageId}
                smoothAssistantMessageId={turnSmoothAssistantMessageId}
                providerByService={providerByService}
                onAuthorize={onAuthorize}
                onArtifactsOpen={onArtifactsOpen}
                onArtifactsAvailable={publishArtifactAvailability ? onArtifactsAvailable : noopArtifactsAvailable}
                onTurnOutputOpen={onTurnOutputOpen}
                onViewBilling={onViewBilling}
                assistantActionTextByMessageId={assistantActionTextByMessageId}
              />
            </div>
          )
        })}
        {pendingQuestions.map((request) => (
          <div key={request.id} className="flex justify-start">
            <div className="w-full max-w-full">
              <QuestionPromptCard
                request={request}
                busy={status === "submitted"}
                onAnswer={onAnswerQuestion}
                onReject={onRejectQuestion}
                questionDrafts={questionDrafts}
              />
            </div>
          </div>
        ))}
        {pendingPermissions.map((request) => (
          <div key={request.id} className="flex justify-start">
            <div className="w-full max-w-full">
              <PermissionRequiredCard
                request={request}
                busy={status === "submitted"}
                onAllowOnce={(requestId) => answerPermissionSafely(requestId, "once")}
                onAllowForSession={(requestId) => answerPermissionSafely(requestId, "always")}
                onReject={(requestId) => answerPermissionSafely(requestId, "reject")}
              />
            </div>
          </div>
        ))}
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  )
})
