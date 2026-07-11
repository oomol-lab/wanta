import type { AuthorizationInfo } from "../../../electron/chat/common.ts"
import type { ConnectionProvider } from "../../../electron/connections/common.ts"
import type { ConnectorAuthorizationIssue } from "./chat-turns.ts"

import { CheckIcon, CopyIcon, PlugZap, ThumbsDown, ThumbsUp } from "lucide-react"
import * as React from "react"
import { MessageAction, MessageActions } from "@/components/ai-elements/message"
import { Button } from "@/components/ui/button"
import { useT } from "@/i18n/i18n"
import { cn } from "@/lib/utils"

function formatMessageTime(createdAt: number): string {
  if (!Number.isFinite(createdAt)) {
    return ""
  }
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(new Date(createdAt))
}

export function MessageTimestamp({ createdAt }: { createdAt: number }) {
  const label = formatMessageTime(createdAt)
  if (!label) {
    return null
  }
  return <span className="oo-text-caption text-muted-foreground/80 tabular-nums">{label}</span>
}

export function CopyMessageAction({ text }: { text: string }) {
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

export function AssistantMessageActions({ text, cancelled }: { text: string; cancelled: boolean }) {
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

export function ConnectionSuggestionAction({
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
      {authorization.message ? (
        <span className="oo-text-caption text-muted-foreground">{authorization.message}</span>
      ) : null}
      <Button size="sm" variant="outline" className="h-8 gap-1.5 px-2.5" onClick={() => onAuthorize(authorization)}>
        <PlugZap className="size-3.5" />
        {t("chat.authorizeConnection")}
      </Button>
    </div>
  )
}

export function ConnectionAuthorizationIssueAction({
  issue,
  provider,
  onAuthorize,
}: {
  issue: ConnectorAuthorizationIssue
  provider?: ConnectionProvider
  onAuthorize: (auth: AuthorizationInfo) => void
}) {
  const t = useT()
  const providerConnected = provider?.status === "connected" && provider.appStatus === "active"
  const uncertain = issue.inconsistent || providerConnected
  const displayName = provider?.displayName ?? issue.authorization.displayName
  const message = issue.inconsistent
    ? t("chat.connectionIssueInconsistent", { name: displayName })
    : providerConnected
      ? t("chat.connectionIssueConnected", { name: displayName })
      : t("chat.authNeeded", { name: displayName })

  return (
    <div className="not-prose mt-3 rounded-md border bg-muted/30 px-3 py-2.5">
      <div className="oo-text-caption text-muted-foreground">{message}</div>
      {issue.count > 1 ? (
        <div className="oo-text-micro mt-1 text-muted-foreground">
          {t("chat.connectionIssueDuplicateCount", { count: issue.count })}
        </div>
      ) : null}
      <Button
        size="sm"
        variant="outline"
        className="mt-2 h-8 gap-1.5 px-2.5"
        onClick={() => onAuthorize(issue.authorization)}
      >
        <PlugZap className="size-3.5" />
        {uncertain ? t("chat.reviewConnection") : t("chat.authorizeConnection")}
      </Button>
    </div>
  )
}
