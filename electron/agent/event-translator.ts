import type {
  AuthorizationInfo,
  ChatMessage,
  ChatMessagePart,
  ChatRole,
  MessageCompletedEvent,
  MessageDeltaEvent,
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
  if (!error || typeof error !== "object") {
    return "Agent error"
  }
  const e = error as { name?: string; data?: { message?: string } }
  return e.data?.message ?? e.name ?? "Agent error"
}

export function translateOpencodeEvent(event: OpencodeEvent): ChatEmit[] {
  const props = event.properties ?? {}
  switch (event.type) {
    case "message.updated": {
      const info = props.info as { id?: string; sessionID?: string; role?: ChatRole } | undefined
      if (!info?.id || !info.sessionID || !info.role) {
        return []
      }
      return [{ event: "messageStarted", data: { sessionId: info.sessionID, messageId: info.id, role: info.role } }]
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
  return {
    input: state.input ?? {},
    ...(state.title ? { title: state.title } : {}),
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

/** 把 OpenCode 的 message {info, parts} 规范化为 ChatMessage（切换会话加载历史用）。 */
export function normalizeMessage(message: { info?: unknown; parts?: unknown }): ChatMessage | null {
  const info = message.info as { id?: string; role?: ChatRole; time?: { created?: number } } | undefined
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
    } else if (part.type === "file") {
      const path = attachmentPath(part)
      if (path) {
        parts.push({
          kind: "attachment",
          partId: part.id,
          attachment: {
            id: part.id,
            name: part.filename ?? path.split(/[\\/]/).pop() ?? "attachment",
            mime: part.mime ?? "application/octet-stream",
            size: 0,
            path,
          },
        })
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
        title: state.title,
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
  return { id: info.id, role: info.role, parts, createdAt: info.time?.created ?? 0 }
}
