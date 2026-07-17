import type {
  AuthorizationInfo,
  AssistantActivityEvent,
  ChatPermissionReply,
  ChatPermissionRequest,
  ChatQuestionRequest,
  QuestionResolvedEvent,
  ChatMessage,
  ChatMessagePart,
  ChatRole,
  ChatTokenUsage,
  MessageAttachmentEvent,
  MessageCompletedEvent,
  MessageDeltaEvent,
  MessagePartRemovedEvent,
  MessageReasoningDeltaEvent,
  MessageStartedEvent,
  ToolCallResultEvent,
  ToolCallStartedEvent,
  ToolStatus,
} from "../chat/common.ts"

import { parseAuthorizationSignal } from "../chat/authorization-signal.ts"

// OpenCode SSE 事件经此翻译为 ChatService ServerEvents。无状态：每个 OpenCode 事件
// 直接映射为 0..n 个 {event, data}，node.ts 据此 this.send(event, data)。

export type ChatEmit =
  | { event: "messageStarted"; data: MessageStartedEvent }
  | { event: "messageDelta"; data: MessageDeltaEvent }
  | { event: "messageReasoningDelta"; data: MessageReasoningDeltaEvent }
  | { event: "messageAttachment"; data: MessageAttachmentEvent }
  | { event: "assistantActivity"; data: AssistantActivityEvent }
  | { event: "toolCallStarted"; data: ToolCallStartedEvent }
  | { event: "toolCallResult"; data: ToolCallResultEvent }
  | { event: "questionAsked"; data: { sessionId: string; request: ChatQuestionRequest } }
  | { event: "questionReplied"; data: QuestionResolvedEvent }
  | { event: "questionRejected"; data: QuestionResolvedEvent }
  | { event: "permissionAsked"; data: { sessionId: string; request: ChatPermissionRequest } }
  | { event: "permissionReplied"; data: { sessionId: string; requestId: string } }
  | { event: "messageCompleted"; data: MessageCompletedEvent }
  | { event: "messagePartRemoved"; data: MessagePartRemovedEvent }
  | { event: "agentError"; data: { sessionId?: string; message: string } }

interface OpencodeEvent {
  type: string
  data?: Record<string, unknown>
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
  if (!value || typeof value !== "object") {
    return false
  }
  const error = value as OpencodeError
  return typeof error.name === "string" || Boolean(error.data && typeof error.data === "object")
}

function isMessageAbortedError(error: unknown): boolean {
  return isOpencodeError(error) && error.name === "MessageAbortedError"
}

/** 若工具输出是 call_action 的结构化授权信号，解析出授权信息。 */
export function parseAuthorization(output: string | undefined): AuthorizationInfo | null {
  return parseAuthorizationSignal(output)
}

function parseToolAuthorization(tool: string, output: string | undefined): AuthorizationInfo | null {
  if (tool === "call_action") {
    return parseAuthorizationSignal(output)
  }
  return null
}

function errorMessage(error: unknown): string {
  if (!isOpencodeError(error)) {
    return "Agent error"
  }
  return error.data?.message ?? error.name ?? "Agent error"
}

function messageErrorPart(error: unknown): ChatMessagePart | undefined {
  if (!isOpencodeError(error) || isMessageAbortedError(error)) {
    return undefined
  }
  const message = errorMessage(error)
  return {
    kind: "error",
    partId: `message-error-${error.name ?? "unknown"}`,
    errorText: message,
  }
}

function normalizeQuestionOption(value: unknown): { label: string; description?: string } | null {
  if (!value || typeof value !== "object") {
    return null
  }
  const option = value as { label?: unknown; description?: unknown }
  if (typeof option.label !== "string" || !option.label.trim()) {
    return null
  }
  return {
    label: option.label,
    ...(typeof option.description === "string" && option.description.trim() ? { description: option.description } : {}),
  }
}

function normalizeQuestion(value: unknown): ChatQuestionRequest["questions"][number] | null {
  if (!value || typeof value !== "object") {
    return null
  }
  const question = value as {
    custom?: unknown
    header?: unknown
    multiple?: unknown
    options?: unknown
    question?: unknown
  }
  if (typeof question.question !== "string" || !question.question.trim()) {
    return null
  }
  const header =
    typeof question.header === "string" && question.header.trim() ? question.header.trim() : question.question.trim()
  return {
    question: question.question,
    header,
    options: Array.isArray(question.options)
      ? question.options
          .map(normalizeQuestionOption)
          .filter((option): option is NonNullable<typeof option> => Boolean(option))
      : [],
    ...(typeof question.multiple === "boolean" ? { multiple: question.multiple } : {}),
    ...(typeof question.custom === "boolean" ? { custom: question.custom } : {}),
  }
}

export function normalizeQuestionRequest(value: unknown): ChatQuestionRequest | null {
  if (!value || typeof value !== "object") {
    return null
  }
  const request = value as {
    id?: unknown
    questions?: unknown
    sessionID?: unknown
    sessionId?: unknown
    tool?: { callID?: unknown; callId?: unknown; messageID?: unknown; messageId?: unknown }
  }
  const sessionId = typeof request.sessionID === "string" ? request.sessionID : request.sessionId
  if (typeof request.id !== "string" || typeof sessionId !== "string" || !Array.isArray(request.questions)) {
    return null
  }
  const questions = request.questions
    .map(normalizeQuestion)
    .filter((question): question is NonNullable<typeof question> => Boolean(question))
  if (questions.length === 0) {
    return null
  }
  const messageId = typeof request.tool?.messageID === "string" ? request.tool.messageID : request.tool?.messageId
  const callId = typeof request.tool?.callID === "string" ? request.tool.callID : request.tool?.callId
  return {
    id: request.id,
    sessionId,
    questions,
    ...(typeof messageId === "string" && typeof callId === "string" ? { tool: { messageId, callId } } : {}),
  }
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

function normalizeQuestionAnswers(value: unknown): string[][] | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }
  return value.map(normalizeStringArray)
}

function normalizePermissionTool(value: unknown): { messageId: string; callId: string } | undefined {
  if (!value || typeof value !== "object") {
    return undefined
  }
  const tool = value as { callID?: unknown; callId?: unknown; messageID?: unknown; messageId?: unknown }
  const messageId = typeof tool.messageID === "string" ? tool.messageID : tool.messageId
  const callId = typeof tool.callID === "string" ? tool.callID : tool.callId
  return typeof messageId === "string" && typeof callId === "string" ? { messageId, callId } : undefined
}

export function normalizePermissionRequest(value: unknown): ChatPermissionRequest | null {
  if (!value || typeof value !== "object") {
    return null
  }
  const request = value as {
    action?: unknown
    always?: unknown
    id?: unknown
    metadata?: unknown
    patterns?: unknown
    permission?: unknown
    resources?: unknown
    save?: unknown
    sessionID?: unknown
    sessionId?: unknown
    source?: unknown
    tool?: unknown
  }
  const sessionId = typeof request.sessionID === "string" ? request.sessionID : request.sessionId
  if (typeof request.id !== "string" || typeof sessionId !== "string") {
    return null
  }
  const action =
    typeof request.action === "string"
      ? request.action
      : typeof request.permission === "string"
        ? request.permission
        : "permission"
  const resources = normalizeStringArray(request.resources)
  const legacyPatterns = normalizeStringArray(request.patterns)
  const legacyAlways = normalizeStringArray(request.always)
  const tool = normalizePermissionTool(request.source) ?? normalizePermissionTool(request.tool)
  return {
    id: request.id,
    sessionId,
    action,
    resources: resources.length > 0 ? resources : legacyPatterns,
    ...(legacyAlways.length > 0 || Array.isArray(request.save)
      ? { save: normalizeStringArray(request.save).length > 0 ? normalizeStringArray(request.save) : legacyAlways }
      : {}),
    ...(request.metadata && typeof request.metadata === "object"
      ? { metadata: request.metadata as Record<string, unknown> }
      : {}),
    ...(tool ? { tool } : {}),
  }
}

function normalizeQuestionResolved(value: unknown, event: "questionReplied" | "questionRejected"): ChatEmit[] {
  if (!value || typeof value !== "object") {
    return []
  }
  const resolved = value as {
    answers?: unknown
    requestID?: unknown
    requestId?: unknown
    sessionID?: unknown
    sessionId?: unknown
  }
  const requestId = typeof resolved.requestID === "string" ? resolved.requestID : resolved.requestId
  const sessionId = typeof resolved.sessionID === "string" ? resolved.sessionID : resolved.sessionId
  if (typeof requestId !== "string" || typeof sessionId !== "string") {
    return []
  }
  const answers = normalizeQuestionAnswers(resolved.answers)
  return [{ event, data: { sessionId, requestId, ...(answers ? { answers } : {}) } }]
}

function normalizePermissionResolved(value: unknown): ChatEmit[] {
  if (!value || typeof value !== "object") {
    return []
  }
  const resolved = value as {
    requestID?: unknown
    requestId?: unknown
    sessionID?: unknown
    sessionId?: unknown
    reply?: unknown
  }
  const requestId = typeof resolved.requestID === "string" ? resolved.requestID : resolved.requestId
  const sessionId = typeof resolved.sessionID === "string" ? resolved.sessionID : resolved.sessionId
  const reply = resolved.reply as ChatPermissionReply | undefined
  if (typeof requestId !== "string" || typeof sessionId !== "string") {
    return []
  }
  if (reply && reply !== "once" && reply !== "always" && reply !== "reject") {
    return []
  }
  return [{ event: "permissionReplied", data: { sessionId, requestId } }]
}

export function translateOpencodeEvent(event: OpencodeEvent): ChatEmit[] {
  const props = event.properties ?? event.data ?? {}
  switch (event.type) {
    case "question.asked":
    case "question.v2.asked": {
      const request = normalizeQuestionRequest(props)
      return request ? [{ event: "questionAsked", data: { sessionId: request.sessionId, request } }] : []
    }
    case "question.replied":
    case "question.v2.replied": {
      return normalizeQuestionResolved(props, "questionReplied")
    }
    case "question.rejected":
    case "question.v2.rejected": {
      return normalizeQuestionResolved(props, "questionRejected")
    }
    case "permission.asked":
    case "permission.v2.asked": {
      const request = normalizePermissionRequest(props)
      return request ? [{ event: "permissionAsked", data: { sessionId: request.sessionId, request } }] : []
    }
    case "permission.replied":
    case "permission.v2.replied": {
      return normalizePermissionResolved(props)
    }
    case "message.updated": {
      const info = props.info as { id?: string; sessionID?: string; role?: ChatRole; error?: unknown } | undefined
      if (!info?.id || !info.sessionID || !info.role) {
        return []
      }
      const emits: ChatEmit[] = [
        { event: "messageStarted", data: { sessionId: info.sessionID, messageId: info.id, role: info.role } },
      ]
      if (info.role === "assistant" && isOpencodeError(info.error) && !isMessageAbortedError(info.error)) {
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
    case "message.part.removed": {
      const p = props as { sessionID?: string; messageID?: string; partID?: string }
      if (!p.sessionID || !p.messageID || !p.partID) {
        return []
      }
      return [
        {
          event: "messagePartRemoved",
          data: { sessionId: p.sessionID, messageId: p.messageID, partId: p.partID },
        },
      ]
    }
    case "session.status": {
      const p = props as {
        sessionID?: string
        status?: { type?: string; attempt?: number; message?: string }
      }
      if (!p.sessionID || p.status?.type !== "retry") {
        return []
      }
      // v2 的 retry status 不再带 next 字段，nextRetryAt 在 UI 契约里可选，故省略。
      return [
        {
          event: "assistantActivity",
          data: {
            sessionId: p.sessionID,
            phase: "retrying",
            message: p.status.message,
            attempt: p.status.attempt,
          },
        },
      ]
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
      if (isMessageAbortedError(p.error)) {
        return []
      }
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
  synthetic?: boolean
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
  attempt?: number
  error?: unknown
  time?: {
    created?: number
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
  if (part.type === "step-start") {
    return [
      {
        event: "assistantActivity",
        data: { sessionId: part.sessionID, messageId: part.messageID, phase: "thinking" },
      },
    ]
  }
  if (part.type === "step-finish") {
    return [
      {
        event: "assistantActivity",
        data: { sessionId: part.sessionID, messageId: part.messageID, phase: "finalizing" },
      },
    ]
  }
  if (part.type === "retry") {
    return [
      {
        event: "assistantActivity",
        data: {
          sessionId: part.sessionID,
          messageId: part.messageID,
          phase: "retrying",
          message: errorMessage(part.error),
          attempt: part.attempt,
        },
      },
    ]
  }
  if (part.type === "text") {
    const data: MessageDeltaEvent = {
      sessionId: part.sessionID,
      messageId: part.messageID,
      partId: part.id,
      text: part.text ?? "",
      ...(delta === undefined ? {} : { delta }),
      ...(part.synthetic ? { synthetic: true } : {}),
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
    if (state.error && state.status !== "completed") {
      return [{ event: "toolCallResult", data: { ...base, ...context, status: "error", error: state.error } }]
    }
    if (state.status === "pending" || state.status === "running") {
      return [{ event: "toolCallStarted", data: { ...base, ...context, status: state.status } }]
    }
    if (state.status === "completed") {
      const auth = parseToolAuthorization(part.tool, state.output)
      return [
        {
          event: "toolCallResult",
          data: {
            ...base,
            ...context,
            status: "completed",
            output: state.output,
            ...(auth ? { authorization: auth } : {}),
          },
        },
      ]
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

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0
}

function messageTokenUsage(info: unknown): ChatTokenUsage | undefined {
  const message = info as { role?: ChatRole; tokens?: unknown } | undefined
  if (message?.role !== "assistant" || !message.tokens || typeof message.tokens !== "object") {
    return undefined
  }
  const tokens = message.tokens as {
    total?: unknown
    input?: unknown
    output?: unknown
    reasoning?: unknown
    cache?: { read?: unknown; write?: unknown }
  }
  const total = numberOrZero(tokens.total)
  return {
    ...(total ? { total } : {}),
    input: numberOrZero(tokens.input),
    output: numberOrZero(tokens.output),
    reasoning: numberOrZero(tokens.reasoning),
    cache: {
      read: numberOrZero(tokens.cache?.read),
      write: numberOrZero(tokens.cache?.write),
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
      if (info.role === "user" && part.synthetic === true) {
        continue
      }
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
        status: state.error && state.status !== "completed" ? "error" : state.status,
        input: state.input ?? {},
        output: state.output,
        error: state.error,
        title: state.title ?? (typeof state.input?.description === "string" ? state.input.description : undefined),
        metadata: state.metadata,
        timing: state.time ? { start: state.time.start, end: state.time.end } : undefined,
        attachmentsCount: Array.isArray(state.attachments) ? state.attachments.length : undefined,
      }
      if (state.status === "completed") {
        const auth = parseToolAuthorization(part.tool, state.output)
        if (auth) {
          tool.authorization = auth
        }
      }
      parts.push(tool)
    }
  }
  if (info.role === "assistant") {
    const part = messageErrorPart(info.error)
    if (part) {
      parts.push(part)
    }
  }
  const tokenUsage = messageTokenUsage(message.info)
  return {
    id: info.id,
    role: info.role,
    parts,
    createdAt: info.time?.created ?? 0,
    ...(tokenUsage ? { tokenUsage } : {}),
  }
}
