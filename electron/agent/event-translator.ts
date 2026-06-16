import type {
  AuthorizationInfo,
  ChatMessage,
  ChatMessagePart,
  ChatRole,
  MessageAttachmentEvent,
  MessageCompletedEvent,
  MessageDeltaEvent,
  MessageReasoningDeltaEvent,
  MessageStartedEvent,
  ToolCallResultEvent,
  ToolCallStartedEvent,
  ToolStatus,
} from "../chat/common.ts"

// OpenCode SSE 事件经此翻译为 ChatService ServerEvents。无状态：每个 OpenCode 事件
// 直接映射为 0..n 个 {event, data}，node.ts 据此 this.send(event, data)。

export type ChatEmit =
  | { event: "messageStarted"; data: MessageStartedEvent }
  | { event: "messageDelta"; data: MessageDeltaEvent }
  | { event: "messageReasoningDelta"; data: MessageReasoningDeltaEvent }
  | { event: "messageAttachment"; data: MessageAttachmentEvent }
  | { event: "toolCallStarted"; data: ToolCallStartedEvent }
  | { event: "toolCallResult"; data: ToolCallResultEvent }
  | { event: "authorizationRequired"; data: AuthorizationRequiredEmit }
  | { event: "messageCompleted"; data: MessageCompletedEvent }
  | { event: "agentError"; data: { sessionId?: string; message: string } }

interface AuthorizationRequiredEmit extends AuthorizationInfo {
  sessionId: string
  messageId: string
}

interface OpencodeEvent {
  type: string
  properties?: Record<string, unknown>
}

interface OpencodeError {
  name?: string
  data?: {
    message?: string
    statusCode?: number
    code?: string
  }
}

function isOpencodeError(value: unknown): value is OpencodeError {
  return Boolean(value && typeof value === "object")
}

/** 若工具输出是 call_action 的结构化授权信号，解析出授权信息。 */
export function parseAuthorization(output: string | undefined): AuthorizationInfo | null {
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
    // 非 JSON 或非授权信号：忽略。
  }
  return null
}

function errorMessage(error: unknown): string {
  if (!isOpencodeError(error)) {
    return "Agent error"
  }
  return error.data?.message ?? error.name ?? "Agent error"
}

function messageErrorPart(error: OpencodeError | undefined): ChatMessagePart | undefined {
  if (!error || error.name === "MessageAbortedError") {
    return undefined
  }
  const message = errorMessage(error)
  return {
    kind: "error",
    partId: `message-error-${error.name ?? "unknown"}`,
    errorText: message,
  }
}

export function translateOpencodeEvent(event: OpencodeEvent): ChatEmit[] {
  const props = event.properties ?? {}
  switch (event.type) {
    case "message.updated": {
      const info = props.info as { id?: string; sessionID?: string; role?: ChatRole; error?: unknown } | undefined
      if (!info?.id || !info.sessionID || !info.role) {
        return []
      }
      const emits: ChatEmit[] = [
        { event: "messageStarted", data: { sessionId: info.sessionID, messageId: info.id, role: info.role } },
      ]
      if (info.role === "assistant" && info.error) {
        emits.push({ event: "agentError", data: { sessionId: info.sessionID, message: errorMessage(info.error) } })
      }
      return emits
    }
    case "message.part.updated": {
      const part = props.part as OpencodePart | undefined
      if (!part) {
        return []
      }
      return translatePart(part, typeof props.delta === "string" ? props.delta : undefined)
    }
    case "session.idle": {
      const sessionID = (props as { sessionID?: string }).sessionID
      if (!sessionID) {
        return []
      }
      return [{ event: "messageCompleted", data: { sessionId: sessionID } }]
    }
    case "session.error": {
      const p = props as { sessionID?: string; error?: unknown }
      return [{ event: "agentError", data: { sessionId: p.sessionID, message: errorMessage(p.error) } }]
    }
    default:
      return []
  }
}

interface OpencodePart {
  id: string
  sessionID: string
  messageID: string
  type: string
  text?: string
  mime?: string
  filename?: string
  url?: string
  source?: {
    type?: string
    path?: string
  }
  callID?: string
  tool?: string
  state?: {
    status: ToolStatus
    input?: Record<string, unknown>
    raw?: string
    output?: string
    error?: string
    title?: string
    metadata?: Record<string, unknown>
    time?: {
      start?: number
      end?: number
      compacted?: number
    }
    attachments?: unknown[]
  }
}

function toolContext(state: NonNullable<OpencodePart["state"]>) {
  const description = typeof state.input?.description === "string" ? state.input.description : undefined
  const title = state.title ?? description
  return {
    input: state.input ?? {},
    ...(title ? { title } : {}),
    ...(state.metadata ? { metadata: state.metadata } : {}),
    ...(state.time ? { timing: { start: state.time.start, end: state.time.end } } : {}),
    ...(Array.isArray(state.attachments) ? { attachmentsCount: state.attachments.length } : {}),
  }
}

function translatePart(part: OpencodePart, delta?: string): ChatEmit[] {
  if (part.type === "text") {
    const data: MessageDeltaEvent = {
      sessionId: part.sessionID,
      messageId: part.messageID,
      partId: part.id,
      text: part.text ?? "",
      ...(delta === undefined ? {} : { delta }),
    }
    return [
      {
        event: "messageDelta",
        data,
      },
    ]
  }
  if (part.type === "reasoning") {
    const data: MessageReasoningDeltaEvent = {
      sessionId: part.sessionID,
      messageId: part.messageID,
      partId: part.id,
      text: part.text ?? "",
      ...(delta === undefined ? {} : { delta }),
    }
    return [
      {
        event: "messageReasoningDelta",
        data,
      },
    ]
  }
  if (part.type === "file") {
    const attachment = attachmentPart(part)
    if (!attachment.attachment) {
      return []
    }
    return [
      {
        event: "messageAttachment",
        data: {
          sessionId: part.sessionID,
          messageId: part.messageID,
          partId: part.id,
          attachment: attachment.attachment,
        },
      },
    ]
  }
  if (part.type === "tool" && part.state && part.callID && part.tool) {
    const base = {
      sessionId: part.sessionID,
      messageId: part.messageID,
      partId: part.id,
      callId: part.callID,
      tool: part.tool,
    }
    const state = part.state
    const context = toolContext(state)
    if (state.status === "pending" || state.status === "running") {
      return [{ event: "toolCallStarted", data: { ...base, ...context, status: state.status } }]
    }
    if (state.status === "completed") {
      const emits: ChatEmit[] = [
        { event: "toolCallResult", data: { ...base, ...context, status: "completed", output: state.output } },
      ]
      if (part.tool === "call_action") {
        const auth = parseAuthorization(state.output)
        if (auth) {
          emits.push({
            event: "authorizationRequired",
            data: { sessionId: part.sessionID, messageId: part.messageID, ...auth },
          })
        }
      }
      return emits
    }
    if (state.status === "error") {
      return [{ event: "toolCallResult", data: { ...base, ...context, status: "error", error: state.error } }]
    }
  }
  return []
}

function attachmentPath(part: OpencodePart): string {
  if (part.source?.path) {
    return part.source.path
  }
  if (part.url?.startsWith("file://")) {
    try {
      return decodeURIComponent(new URL(part.url).pathname)
    } catch {
      return part.url
    }
  }
  return part.url ?? ""
}

function attachmentPart(part: OpencodePart): ChatMessagePart {
  const path = attachmentPath(part)
  if (!path) {
    return { kind: "attachment", partId: part.id }
  }
  const mime = part.mime ?? "application/octet-stream"
  return {
    kind: "attachment",
    partId: part.id,
    attachment: {
      id: part.id,
      name: part.filename ?? path.split(/[\\/]/).pop() ?? "attachment",
      mime,
      size: 0,
      path,
      kind: mime === "inode/directory" ? "directory" : "file",
    },
  }
}

/** 把 OpenCode 的 message {info, parts} 规范化为 ChatMessage（切换会话加载历史用）。 */
export function normalizeMessage(message: { info?: unknown; parts?: unknown }): ChatMessage | null {
  const info = message.info as
    | { id?: string; role?: ChatRole; time?: { created?: number }; error?: unknown }
    | undefined
  if (!info?.id || !info.role) {
    return null
  }
  const rawParts = Array.isArray(message.parts) ? (message.parts as OpencodePart[]) : []
  const parts: ChatMessagePart[] = []
  for (const part of rawParts) {
    if (part.type === "text") {
      const text = part.text ?? ""
      if (text.length > 0) {
        parts.push({ kind: "text", partId: part.id, text })
      }
    } else if (part.type === "reasoning") {
      const text = part.text ?? ""
      if (text.length > 0) {
        parts.push({ kind: "reasoning", partId: part.id, text })
      }
    } else if (part.type === "file") {
      const attachment = attachmentPart(part)
      if (attachment.attachment) {
        parts.push(attachment)
      }
    } else if (part.type === "tool" && part.state && part.callID && part.tool) {
      const state = part.state
      const tool: ChatMessagePart = {
        kind: "tool",
        partId: part.id,
        callId: part.callID,
        tool: part.tool,
        status: state.status,
        input: state.input ?? {},
        output: state.output,
        error: state.error,
        title: state.title ?? (typeof state.input?.description === "string" ? state.input.description : undefined),
        metadata: state.metadata,
        timing: state.time ? { start: state.time.start, end: state.time.end } : undefined,
        attachmentsCount: Array.isArray(state.attachments) ? state.attachments.length : undefined,
      }
      if (part.tool === "call_action" && state.status === "completed") {
        const auth = parseAuthorization(state.output)
        if (auth) {
          tool.authorization = auth
        }
      }
      parts.push(tool)
    }
  }
  if (info.role === "assistant" && isOpencodeError(info.error)) {
    const part = messageErrorPart(info.error)
    if (part) {
      parts.push(part)
    }
  }
  return { id: info.id, role: info.role, parts, createdAt: info.time?.created ?? 0 }
}
