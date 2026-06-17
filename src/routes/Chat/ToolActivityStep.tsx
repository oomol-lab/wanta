import type { AuthorizationInfo, ChatMessagePart, ToolStatus } from "../../../electron/chat/common.ts"
import type { ConnectionProvider } from "../../../electron/connections/common.ts"
import type { TranslateFn } from "@/i18n/i18n"

import {
  AlertTriangle,
  ChevronRight,
  Circle,
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
import { compactToolDetail, shouldShowRunningNoOutput } from "./tool-activity.ts"
import { parseToolAuthorization, toolActionSummary, toolInputString } from "./tool-display.ts"
import { isToolCancellation } from "./tool-state.ts"
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

function toolPartStatusLabel(t: TranslateFn, part: ChatMessagePart): string {
  return isToolCancellation(part) ? t("chat.toolStatusStopped") : toolStatusLabel(t, part.status)
}

function toolInlineDetail(part: ChatMessagePart): string {
  if (part.tool !== "bash") {
    return ""
  }
  const command = toolInputString(part.input?.command).split("\n")[0]
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

export function ToolActivityStep({
  part,
  provider,
  onAuthorize,
}: {
  part: ChatMessagePart
  provider?: ConnectionProvider
  onAuthorize: (auth: AuthorizationInfo) => void
}) {
  const t = useT()
  const auth = parseToolAuthorization(part)
  const stopped = isToolCancellation(part)
  const details = hasToolDetails(part, auth)
  const defaultOpen = (part.status === "error" && !stopped) || Boolean(auth)
  const [open, setOpen] = React.useState(defaultOpen)
  const statusText = toolPartStatusLabel(t, part)
  const inlineDetail = toolInlineDetail(part)
  const active = part.status === "pending" || part.status === "running"
  const metaItems = [provider?.displayName, statusText].filter(Boolean)
  const actionText = toolActionSummary(t, part)
  const activeText = [actionText, inlineDetail, ...metaItems].filter(Boolean).join("  ")

  React.useEffect(() => {
    if (defaultOpen) {
      setOpen(true)
    }
  }, [defaultOpen])

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
    <Collapsible open={open} onOpenChange={setOpen}>
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
            {open && hasKeys(part.input) && (
              <ToolDetailSection label={t("chat.toolParams")}>
                <ToolPre>{formatJson(part.input ?? {})}</ToolPre>
              </ToolDetailSection>
            )}
            {open && shouldShowRunningNoOutput(part) && (
              <div className="oo-text-caption text-muted-foreground">{t("chat.toolRunningNoOutput")}</div>
            )}
            {open && part.output && !auth && (
              <ToolDetailSection label={t("chat.toolResult")}>
                <ToolPre>{formatToolOutput(part.output)}</ToolPre>
              </ToolDetailSection>
            )}
            {open && part.error && !stopped && (
              <ToolDetailSection label={t("chat.toolError")}>
                <ToolPre tone="error">{part.error}</ToolPre>
              </ToolDetailSection>
            )}
            {open && auth?.message && (
              <ToolDetailSection label={t("chat.toolError")}>
                <ToolPre tone="error">{auth.message}</ToolPre>
              </ToolDetailSection>
            )}
            {open && hasKeys(part.metadata) && (
              <ToolDetailSection label={t("chat.toolMetadata")}>
                <ToolPre>{formatJson(part.metadata ?? {})}</ToolPre>
              </ToolDetailSection>
            )}
            {open && part.attachmentsCount ? (
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
