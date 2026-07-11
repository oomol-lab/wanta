import type { AuthorizationInfo, ChatMessagePart, ToolStatus } from "../../../electron/chat/common.ts"
import type { ConnectionProvider } from "../../../electron/connections/common.ts"
import type { ToolDisplayLine } from "./tool-display.ts"
import type { TranslateFn } from "@/i18n/i18n"

import {
  ChevronRight,
  CircleAlert,
  Circle,
  CircleHelp,
  FilePenLine,
  FilePlus2,
  FileSearch,
  FileText,
  FolderOpen,
  Globe,
  ListChecks,
  Loader2,
  Package,
  PlayCircle,
  Plug,
  Search,
  SlidersHorizontal,
  Square,
  SquareTerminal,
  Wrench,
} from "lucide-react"
import * as React from "react"
import { LoadingShimmerText } from "./LoadingShimmerText.tsx"
import { shouldShowRunningNoOutput } from "./tool-activity.ts"
import { shouldHideToolDetailsImmediately } from "./tool-details-visibility.ts"
import { parseToolAuthorization, toolDisplayLine } from "./tool-display.ts"
import { formatToolOutputPreview, toolOutputPreviewLimitChars } from "./tool-output-preview.ts"
import { isActiveToolPart, isToolCancellation } from "./tool-state.ts"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { useT } from "@/i18n/i18n"
import { cn } from "@/lib/utils"
import { ProviderIcon } from "@/routes/Connections/ProviderIcon"

function hasKeys(value: Record<string, unknown> | undefined): boolean {
  return Boolean(value && Object.keys(value).length > 0)
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

function toolPartStatusLabel(t: TranslateFn, part: ChatMessagePart, stopped = false): string {
  if (stopped) {
    return t("chat.toolStatusStopped")
  }
  if (part.tool === "question" && (part.status === "pending" || part.status === "running")) {
    return t("chat.toolStatusWaitingForAnswer")
  }
  return isToolCancellation(part) ? t("chat.toolStatusStopped") : toolStatusLabel(t, part.status)
}

function ToolInlineDetail({ line }: { line: ToolDisplayLine }) {
  if (!line.detail) {
    return null
  }
  if (line.detailKind === "code") {
    return (
      <code className="w-0 max-w-full min-w-0 flex-1 truncate rounded bg-muted px-1.5 py-0.5 font-mono text-[0.875em] font-medium text-muted-foreground">
        {line.detail}
      </code>
    )
  }
  return <span className="w-0 max-w-full min-w-0 flex-1 truncate font-medium text-muted-foreground">{line.detail}</span>
}

function formatJson(value: Record<string, unknown>): string {
  return JSON.stringify(value, null, 2)
}

function normalizeQuestionAnswers(answers: unknown[]): string {
  return answers
    .flatMap((answer) => (Array.isArray(answer) ? answer : [answer]))
    .map((answer) => String(answer).trim())
    .filter(Boolean)
    .join("\n")
}

function questionAnswerSummary(part: ChatMessagePart): string {
  const answers = part.metadata?.answers
  if (Array.isArray(answers)) {
    return normalizeQuestionAnswers(answers)
  }
  if (!part.output) {
    return ""
  }
  try {
    const parsed = JSON.parse(part.output) as { answers?: unknown }
    if (!Array.isArray(parsed.answers)) {
      return ""
    }
    return normalizeQuestionAnswers(parsed.answers)
  } catch {
    return ""
  }
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
      return <CircleAlert className="size-3.5 text-muted-foreground" />
    case "pending":
    default:
      return <Circle className="size-3.5 text-muted-foreground" />
  }
}

function ToolActionIcon({ part }: { part: ChatMessagePart }) {
  const className = "size-3.5 text-muted-foreground"
  switch (part.tool) {
    case "list_apps":
      return <Plug className={className} />
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
    case "question":
      return <CircleHelp className={className} />
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

function ToolStepIcon({
  part,
  provider,
  stopped = false,
}: {
  part: ChatMessagePart
  provider?: ConnectionProvider
  stopped?: boolean
}) {
  if (provider && part.status !== "error" && !stopped) {
    return <ProviderIcon iconUrl={provider.iconUrl} displayName={provider.displayName} size="compact" />
  }
  if (part.status === "error" || stopped) {
    return <ToolStatusIcon status={part.status} stopped={stopped} />
  }
  return <ToolActionIcon part={part} />
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

function hasToolDetails(
  part: ChatMessagePart,
  auth: AuthorizationInfo | null,
  answerSummary: string,
  stopped = false,
): boolean {
  if (part.tool === "question") {
    return Boolean(answerSummary)
  }
  return (
    hasKeys(part.input) ||
    hasKeys(part.metadata) ||
    Boolean(part.output && !auth) ||
    Boolean(part.error && !stopped) ||
    Boolean(auth?.message) ||
    (!stopped && shouldShowRunningNoOutput(part)) ||
    Boolean(part.attachmentsCount)
  )
}

export function ToolActivityStep({
  part,
  provider,
  live = true,
  shimmer = false,
  settling = false,
  showAuthorizationPrompt = true,
  onAuthorize,
}: {
  part: ChatMessagePart
  provider?: ConnectionProvider
  live?: boolean
  shimmer?: boolean
  settling?: boolean
  showAuthorizationPrompt?: boolean
  onAuthorize: (auth: AuthorizationInfo) => void
}) {
  const t = useT()
  const auth = parseToolAuthorization(part)
  const activePart = isActiveToolPart(part)
  const stopped = isToolCancellation(part) || (!live && activePart)
  const answerSummary = questionAnswerSummary(part)
  const details = hasToolDetails(part, auth, answerSummary, stopped)
  const [open, setOpen] = React.useState(false)
  const [detailsVisible, setDetailsVisible] = React.useState(false)
  const outputPreviewRef = React.useRef<{ output: string; text: string; truncated: boolean } | null>(null)
  const statusText =
    settling && part.status === "completed" ? t("chat.toolStatusFinalizing") : toolPartStatusLabel(t, part, stopped)
  const active = live && activePart
  const showShimmer = active || shimmer
  const displayLine = toolDisplayLine(t, part)
  const metaItems = [provider?.displayName, statusText].filter(Boolean)
  const completedMeta = part.status === "completed" && !auth
  const outputPreview = React.useMemo(() => {
    if (!detailsVisible || !part.output || auth) {
      return null
    }
    const cached = outputPreviewRef.current
    if (cached?.output === part.output) {
      return cached
    }
    const preview = formatToolOutputPreview(part.output)
    const next = { output: part.output, ...preview }
    outputPreviewRef.current = next
    return next
  }, [auth, detailsVisible, part.output])

  const handleOpenChange = React.useCallback((nextOpen: boolean) => {
    if (nextOpen) {
      setDetailsVisible(true)
    } else if (
      shouldHideToolDetailsImmediately(
        nextOpen,
        typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      )
    ) {
      setDetailsVisible(false)
    }
    setOpen(nextOpen)
  }, [])

  const handleContentAnimationEnd = React.useCallback(
    (event: React.AnimationEvent<HTMLDivElement>) => {
      if (event.target === event.currentTarget && !open) {
        setDetailsVisible(false)
      }
    },
    [open],
  )

  const row = (
    <div className="group/tool-step flex min-h-6 w-full max-w-full min-w-0 flex-1 items-center gap-2 overflow-hidden">
      <span
        className="flex size-5 shrink-0 items-center justify-center"
        title={provider ? `${provider.displayName} · ${statusText}` : statusText}
      >
        <ToolStepIcon part={part} provider={provider} stopped={stopped} />
      </span>
      <div className="w-0 max-w-full min-w-0 flex-1 overflow-hidden">
        {showShimmer ? (
          <div className="flex w-full max-w-full min-w-0 items-center gap-2 overflow-hidden">
            <LoadingShimmerText className="min-w-0 shrink-0 truncate font-medium">
              {displayLine.title}
            </LoadingShimmerText>
            <ToolInlineDetail line={displayLine} />
            {displayLine.detail ? null : <span aria-hidden="true" className="min-w-0 flex-1" />}
            <span className="flex min-w-0 shrink-0 items-center gap-1 font-medium text-muted-foreground">
              {metaItems.map((item, index) => (
                <React.Fragment key={`${index}:${item}`}>
                  {index > 0 ? <span className="text-muted-foreground/70">·</span> : null}
                  <span>{item}</span>
                </React.Fragment>
              ))}
            </span>
          </div>
        ) : (
          <div className="flex w-full max-w-full min-w-0 items-center gap-2 overflow-hidden">
            <span
              className={cn("min-w-0 truncate font-medium text-foreground", displayLine.detail ? "shrink-0" : "flex-1")}
            >
              {displayLine.title}
            </span>
            <ToolInlineDetail line={displayLine} />
            <span
              className={cn(
                "flex min-w-0 shrink-0 items-center gap-1 font-medium text-muted-foreground transition-opacity",
                completedMeta && "opacity-0 group-hover/tool-step:opacity-100",
                completedMeta &&
                  details &&
                  "group-focus-visible/tool-step:opacity-100 group-data-[state=open]/tool-step:opacity-100",
              )}
            >
              {metaItems.map((item, index) => (
                <React.Fragment key={`${index}:${item}`}>
                  {index > 0 ? <span className="text-muted-foreground/70">·</span> : null}
                  <span>{item}</span>
                </React.Fragment>
              ))}
            </span>
          </div>
        )}
      </div>
    </div>
  )
  const authPrompt =
    auth && showAuthorizationPrompt ? (
      <div className="mt-1 ml-7 flex flex-wrap items-center gap-2">
        <span>{t("chat.authNeeded", { name: auth.displayName })}</span>
        <Button size="sm" variant="outline" className="h-7 gap-1 px-2" onClick={() => onAuthorize(auth)}>
          <Plug className="size-3.5" />
          {t("chat.authorizeConnection")}
        </Button>
      </div>
    ) : null

  return (
    <Collapsible className="w-full max-w-full min-w-0 overflow-hidden" open={open} onOpenChange={handleOpenChange}>
      <div className="w-full max-w-full min-w-0 overflow-hidden rounded-md">
        {details ? (
          <CollapsibleTrigger className="group/tool-step flex w-full max-w-full min-w-0 items-center justify-between gap-2 overflow-hidden text-left">
            {row}
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-[opacity,transform] group-hover/tool-step:opacity-100 group-focus-visible/tool-step:opacity-100 group-data-[state=open]/tool-step:rotate-90 group-data-[state=open]/tool-step:opacity-100" />
          </CollapsibleTrigger>
        ) : (
          row
        )}
        {authPrompt}
      </div>
      {details && (
        <CollapsibleContent
          className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=closed]:fade-out-0 data-[state=open]:animate-collapsible-down data-[state=open]:fade-in-0 motion-reduce:animate-none"
          onAnimationEnd={handleContentAnimationEnd}
        >
          <div className="ml-6 space-y-2.5 pt-1.5 pb-1">
            {detailsVisible && part.tool === "question" && answerSummary ? (
              <ToolDetailSection label={t("chat.questionAnswered")}>
                <ToolPre>{answerSummary}</ToolPre>
              </ToolDetailSection>
            ) : null}
            {detailsVisible && part.tool !== "question" && hasKeys(part.input) && (
              <ToolDetailSection label={t("chat.toolParams")}>
                <ToolPre>{formatJson(part.input ?? {})}</ToolPre>
              </ToolDetailSection>
            )}
            {detailsVisible && !stopped && shouldShowRunningNoOutput(part) && (
              <div className="oo-text-caption text-muted-foreground">{t("chat.toolRunningNoOutput")}</div>
            )}
            {detailsVisible && part.error && !stopped && (
              <div className="oo-text-caption text-muted-foreground">{t("chat.toolRecoverableIssue")}</div>
            )}
            {outputPreview ? (
              <ToolDetailSection label={t("chat.toolResult")}>
                <ToolPre>{outputPreview.text}</ToolPre>
                {outputPreview.truncated ? (
                  <div className="oo-text-caption text-muted-foreground">
                    {t("chat.toolResultPreviewTruncated", { limit: toolOutputPreviewLimitChars })}
                  </div>
                ) : null}
              </ToolDetailSection>
            ) : null}
            {detailsVisible && part.error && !stopped && (
              <ToolDetailSection label={t("chat.toolError")}>
                <ToolPre>{part.error}</ToolPre>
              </ToolDetailSection>
            )}
            {detailsVisible && auth?.message && (
              <ToolDetailSection label={t("chat.toolError")}>
                <ToolPre tone="error">{auth.message}</ToolPre>
              </ToolDetailSection>
            )}
            {detailsVisible && hasKeys(part.metadata) && (
              <ToolDetailSection label={t("chat.toolMetadata")}>
                <ToolPre>{formatJson(part.metadata ?? {})}</ToolPre>
              </ToolDetailSection>
            )}
            {detailsVisible && part.attachmentsCount ? (
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
