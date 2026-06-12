import type { AuthorizationInfo, ChatMessage, ChatMessagePart, ToolStatus } from "../../../electron/chat/common"
import type { PromptInputMessage } from "@/components/ai-elements/prompt-input"
import type { TranslateFn } from "@/i18n/i18n"
import type { ChatStatus, ToolUIPart } from "ai"

import { AlertTriangle, Plug, Sparkles } from "lucide-react"
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
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from "@/components/ai-elements/tool"
import { Button } from "@/components/ui/button"
import { useT } from "@/i18n/i18n"
import { cn } from "@/lib/utils"

interface ChatAreaProps {
  messages: ChatMessage[]
  status: ChatStatus
  showEmptyState: boolean
  error: string | null
  disabled: boolean
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

/** 工具调用的一行人话摘要（折叠态显示）；缺少入参时退回原始工具名。 */
function toolSummary(t: TranslateFn, part: ChatMessagePart): string {
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
    default:
      return part.tool ?? ""
  }
}

/** 把项目的工具状态映射为 ai-elements Tool 的 state。 */
function toolState(status: ToolStatus | undefined): ToolUIPart["state"] {
  switch (status) {
    case "running":
      return "input-available"
    case "completed":
      return "output-available"
    case "error":
      return "output-error"
    default:
      return "input-streaming"
  }
}

/** 输出若是 JSON 文本，转为对象交给 ToolOutput 缩进美化；否则原样返回字符串。 */
function toolOutputValue(output: string | undefined): unknown {
  if (!output) {
    return undefined
  }
  try {
    return JSON.parse(output)
  } catch {
    return output
  }
}

function ToolStep({ part, onAuthorize }: { part: ChatMessagePart; onAuthorize: (auth: AuthorizationInfo) => void }) {
  const t = useT()
  const auth = part.tool === "call_action" && part.status === "completed" ? parseAuthorization(part.output) : null
  const hasInput = Boolean(part.input && Object.keys(part.input).length > 0)
  const showOutput = part.status === "completed" && Boolean(part.output) && !auth
  const showError = part.status === "error" && Boolean(part.error)

  return (
    <div className="oo-text-micro">
      <Tool defaultOpen={part.status === "error"}>
        <ToolHeader
          title={toolSummary(t, part)}
          type={`tool-${part.tool ?? "unknown"}`}
          state={toolState(part.status)}
          expandable={hasInput || showOutput || showError}
        />
        {(hasInput || showOutput || showError) && (
          <ToolContent>
            {hasInput && <ToolInput input={part.input} />}
            {showOutput && <ToolOutput output={toolOutputValue(part.output)} errorText={undefined} />}
            {showError && <ToolOutput output={undefined} errorText={part.error} />}
          </ToolContent>
        )}
      </Tool>

      {auth && (
        <div className="mt-1.5 flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <span className="oo-text-caption">{t("chat.authNeeded", { name: auth.displayName })}</span>
            <Button size="sm" variant="outline" className="gap-1" onClick={() => onAuthorize(auth)}>
              <Plug className="size-3.5" />
              {t("chat.authorize")}
            </Button>
          </div>
          {auth.message && (
            <pre className="oo-text-micro max-h-40 overflow-auto whitespace-pre-wrap text-destructive">
              {auth.message}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}

function isRenderablePart(part: ChatMessagePart): boolean {
  return part.kind === "tool" || Boolean(part.text)
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
    return (
      <Message from="user">
        <MessageContent>
          <div className="break-words whitespace-pre-wrap">{text}</div>
        </MessageContent>
      </Message>
    )
  }
  const visibleParts = message.parts.filter(isRenderablePart)
  if (visibleParts.length === 0) {
    return null
  }
  return (
    <Message from="assistant">
      <MessageContent>
        {visibleParts.map((part) =>
          part.kind === "text" ? (
            part.text ? (
              <MessageResponse key={part.partId}>{part.text}</MessageResponse>
            ) : null
          ) : (
            <ToolStep key={part.partId} part={part} onAuthorize={onAuthorize} />
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
    isSubmitted || (status === "streaming" && latestAssistant ? !latestAssistant.parts.some(isRenderablePart) : false)

  // 表单提交（含回车）始终走"发送"路径；"停止"只通过按钮的显式点击触发（见 PromptInputSubmit
  // 的 onClick），避免生成中按回车误中止流。
  const handleSubmit = (message: PromptInputMessage): void => {
    const text = message.text
    if (!text || disabled) {
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
          disabled={isSubmitted ? true : status === "streaming" ? false : disabled || draft.trim().length === 0}
          aria-label={status === "streaming" ? t("aria.stop") : t("aria.send")}
          onClick={
            status === "streaming"
              ? (e) => {
                  e.preventDefault()
                  onStop()
                }
              : undefined
          }
        />
      </PromptInputToolbar>
    </PromptInput>
  )

  if (showEmptyState && !hasMessages && !isGenerating) {
    return (
      <div className="grid h-full min-h-0 place-items-center px-1 py-6">
        <div className="flex w-full max-w-[48rem] -translate-y-[6vh] flex-col gap-4">
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
    <div className="flex h-full min-h-0 flex-col pb-6">
      <Conversation className="min-h-0 flex-1">
        <ConversationContent data-selectable="true" className="mx-auto min-h-full w-full max-w-[48rem] gap-4 px-0 py-2">
          {messages.map((message) => (
            <MessageBubble key={message.id} message={message} onAuthorize={onAuthorize} />
          ))}
          {showPendingMessage && <AssistantPendingMessage />}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="mx-auto flex w-full max-w-[48rem] flex-col gap-2">
        {errorBanner}
        {promptInput}
      </div>
    </div>
  )
}
