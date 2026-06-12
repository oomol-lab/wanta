import type { AuthorizationInfo, ChatMessage, ChatMessagePart, ToolStatus } from "../../../electron/chat/common"
import type { PromptInputMessage } from "@/components/ai-elements/prompt-input"
import type { TranslateFn } from "@/i18n/i18n"
import type { ToolUIPart } from "ai"

import { AlertTriangle, Plug, Sparkles } from "lucide-react"
import * as React from "react"
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation"
import { Loader } from "@/components/ai-elements/loader"
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message"
import {
  PromptInput,
  PromptInputBody,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputToolbar,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input"
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion"
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from "@/components/ai-elements/tool"
import { Button } from "@/components/ui/button"
import { useT } from "@/i18n/i18n"

interface ChatAreaProps {
  sessionTitle: string
  messages: ChatMessage[]
  isGenerating: boolean
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
  return (
    <Message from="assistant">
      <MessageContent>
        {message.parts.map((part) =>
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

export function ChatArea({
  sessionTitle,
  messages,
  isGenerating,
  error,
  disabled,
  placeholder,
  onSend,
  onStop,
  onAuthorize,
}: ChatAreaProps) {
  const t = useT()
  const [draft, setDraft] = React.useState("")

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

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 px-1">
        <span className="oo-text-title truncate">{sessionTitle || t("chat.defaultTitle")}</span>
        {isGenerating && <Loader className="text-muted-foreground" size={14} />}
      </div>

      <Conversation className="min-h-0 flex-1">
        <ConversationContent data-selectable="true" className="min-h-full gap-4 px-0 py-2">
          {messages.length === 0 ? (
            <ConversationEmptyState
              className="h-full"
              icon={<Sparkles className="size-8" />}
              title={t("chat.emptyTitle")}
            />
          ) : (
            messages.map((message) => <MessageBubble key={message.id} message={message} onAuthorize={onAuthorize} />)
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      {messages.length === 0 && (
        <Suggestions className="mb-2 px-1">
          <Suggestion
            suggestion={t("chat.emptyExample")}
            disabled={disabled}
            onClick={(text) => {
              onSend(text)
              setDraft("")
            }}
          />
        </Suggestions>
      )}

      {error && (
        <div className="oo-error mb-2 flex items-center gap-2">
          <AlertTriangle className="size-4" />
          {error}
        </div>
      )}

      <PromptInput onSubmit={handleSubmit} className="shrink-0">
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
            status={isGenerating ? "streaming" : undefined}
            disabled={isGenerating ? false : disabled || draft.trim().length === 0}
            aria-label={isGenerating ? t("aria.stop") : t("aria.send")}
            onClick={
              isGenerating
                ? (e) => {
                    e.preventDefault()
                    onStop()
                  }
                : undefined
            }
          />
        </PromptInputToolbar>
      </PromptInput>
    </div>
  )
}
