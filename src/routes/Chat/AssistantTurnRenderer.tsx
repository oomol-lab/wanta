import type {
  AuthorizationInfo,
  AssistantActivityEvent,
  ChatAttachment,
  ChatMessagePart,
} from "../../../electron/chat/common.ts"
import type { ChatErrorKind } from "../../../electron/chat/error.ts"
import type { ConnectionProvider } from "../../../electron/connections/common.ts"
import type { AssistantTimelineBlock } from "./assistant-timeline.ts"
import type { AssistantBlockType } from "./assistant-turn-renderer-model.ts"
import type { ChatTurnProcessStatus, ChatTurnRetrySource } from "./chat-turns.ts"
import type { ProcessOpenPreference } from "./process-activity-open.ts"
import type { TranslateFn } from "@/i18n/i18n"

import { ChevronRight } from "lucide-react"
import * as React from "react"
import { assistantBlockClassName } from "./assistant-turn-renderer-model.ts"
import { chatTurnProcessStatus, isLiveTurnProcess, summarizeTurnProcess } from "./chat-turns.ts"
import { ChatErrorNotice } from "./ChatErrorNotice.tsx"
import { LoadingShimmerText } from "./LoadingShimmerText.tsx"
import { processOpenAfterStatusChange, processShouldOpenAutomatically } from "./process-activity-open.ts"
import { formatWholeSecondDuration } from "./tool-activity.ts"
import { toolActionSummary, toolServiceSlug } from "./tool-display.ts"
import { isActiveToolPart } from "./tool-state.ts"
import { ToolActivityStep } from "./ToolActivityStep.tsx"
import { MessageResponse } from "@/components/ai-elements/message"
import { MarkdownImage } from "@/components/ai-elements/message-image"
import { Task, TaskContent, TaskTrigger } from "@/components/ai-elements/task"
import { useT } from "@/i18n/i18n"

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

export function TurnProcessActivity({
  blocks,
  process,
  live = false,
  billingCacheScope,
  providerByService,
  onAuthorize,
  onRecover,
  onRetryFresh,
  onViewBilling,
}: {
  blocks: AssistantTimelineBlock[]
  process: ReturnType<typeof summarizeTurnProcess>
  live?: boolean
  billingCacheScope: string
  providerByService: Map<string, ConnectionProvider>
  onAuthorize: (auth: AuthorizationInfo, source?: ChatTurnRetrySource) => void
  onRecover?: (kind: ChatErrorKind) => Promise<void> | void
  onRetryFresh?: () => Promise<void> | void
  onViewBilling?: () => void
}) {
  const t = useT()
  const status = chatTurnProcessStatus(process, live)
  const shouldOpen = processShouldOpenAutomatically(status, process.hasVisibleOutcome)
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
        hasVisibleOutcome: process.hasVisibleOutcome,
        preference: openPreferenceRef.current,
        status,
      }),
    )
  }, [process.hasVisibleOutcome, status, statusKey])

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
              showAuthorizationPrompt={false}
              onAuthorize={onAuthorize}
              onRecover={onRecover}
              onRetryFresh={onRetryFresh}
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

export function AssistantBlock({
  block,
  blockClassName,
  billingCacheScope,
  smoothText,
  providerByService,
  settlingToolPartId,
  liveTools = true,
  showAuthorizationPrompt = true,
  onAuthorize,
  onRecover,
  onRetryFresh,
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
  onRecover?: (kind: ChatErrorKind) => Promise<void> | void
  onRetryFresh?: () => Promise<void> | void
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
          onRecover={onRecover}
          onRetryFresh={onRetryFresh}
          onViewBilling={onViewBilling}
        />
      ) : block.kind === "status" ? (
        <div className="text-sm leading-6 font-medium text-muted-foreground/80">{statusPartText(t, block.part)}</div>
      ) : block.kind === "attachment" ? (
        block.part.attachment ? (
          <AssistantAttachment attachment={block.part.attachment} />
        ) : null
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

function AssistantAttachment({ attachment }: { attachment: ChatAttachment }) {
  return <MarkdownImage src={attachment.path} alt={attachment.name} />
}
