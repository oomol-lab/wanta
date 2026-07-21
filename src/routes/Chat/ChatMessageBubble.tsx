import type { AuthorizationInfo, ChatAttachment, ChatMessage } from "../../../electron/chat/common.ts"
import type { ChatErrorKind } from "../../../electron/chat/error.ts"
import type { ConnectionProvider } from "../../../electron/connections/common.ts"
import type { AssistantTimelineBlock } from "./assistant-timeline.ts"

import { ChevronDown, ChevronUp } from "lucide-react"
import * as React from "react"
import { assistantBlockClassName } from "./assistant-turn-renderer-model.ts"
import { AssistantBlock } from "./AssistantTurnRenderer.tsx"
import { attachmentWithPreview } from "./chat-attachment-utils.ts"
import { AttachmentList } from "./ChatAttachments.tsx"
import { AssistantMessageActions, CopyMessageAction, MessageTimestamp } from "./ChatMessageActions.tsx"
import { ContextMentionChips } from "./ContextMentionChips.tsx"
import { LoadingShimmerText } from "./LoadingShimmerText.tsx"
import { visibleUserContextMentions } from "./message-context.ts"
import { copyableMessageText, shouldCollapseUserMessageText, visibleUserText } from "./message-text.ts"
import { renderBlocks } from "./render-blocks.ts"
import { hasStoppedTool } from "./tool-state.ts"
import { Message, MessageActions, MessageContent } from "@/components/ai-elements/message"
import { useT } from "@/i18n/i18n"
import { cn } from "@/lib/utils"

export function MessageBubble({
  billingCacheScope,
  message,
  smoothText,
  onViewBilling,
  assistantActionsText,
  providerByService,
  onAuthorize,
  onRecover,
  onRetryFresh,
  liveTools = false,
}: {
  billingCacheScope: string
  message: ChatMessage
  smoothText: boolean
  onViewBilling?: () => void
  assistantActionsText: string | null
  providerByService: Map<string, ConnectionProvider>
  onAuthorize: (auth: AuthorizationInfo) => void
  onRecover?: (kind: ChatErrorKind) => Promise<void> | void
  onRetryFresh?: () => Promise<void> | void
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
    const contextMentions = visibleUserContextMentions(message.contextMentions)
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
            onRecover={onRecover}
            onRetryFresh={onRetryFresh}
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

export function AssistantTimelineMessage({
  blocks,
  billingCacheScope,
  smoothAssistantMessageId,
  assistantActionsText,
  assistantCancelled,
  activeAssistantMessageId,
  providerByService,
  onAuthorize,
  onRecover,
  onRetryFresh,
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
  onRecover?: (kind: ChatErrorKind) => Promise<void> | void
  onRetryFresh?: () => Promise<void> | void
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
            onRecover={onRecover}
            onRetryFresh={onRetryFresh}
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

export function PlainAssistantActivity() {
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
