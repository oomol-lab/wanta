import type {
  AuthorizationInfo,
  AssistantActivityEvent,
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
import type {
  PromptFileAttachment,
  SessionMessage,
  SessionMessageAssistantTool,
  ToolFileContent,
  ToolTextContent,
} from "@opencode-ai/sdk/v2/client"

import { fileURLToPath } from "node:url"
import { parseAuthorizationSignal } from "../chat/authorization-signal.ts"
import { stripWantaPromptContext } from "./prompt-context.ts"

export type ChatEmit =
  | { event: "messageStarted"; data: MessageStartedEvent }
  | { event: "messageDelta"; data: MessageDeltaEvent }
  | { event: "messageReasoningDelta"; data: MessageReasoningDeltaEvent }
  | { event: "messageAttachment"; data: MessageAttachmentEvent }
  | { event: "assistantActivity"; data: AssistantActivityEvent }
  | { event: "toolCallStarted"; data: ToolCallStartedEvent }
  | { event: "toolCallResult"; data: ToolCallResultEvent }
  | { event: "messageCompleted"; data: MessageCompletedEvent }
  | { event: "messagePartRemoved"; data: MessagePartRemovedEvent }
  | { event: "agentError"; data: { sessionId?: string; message: string } }
  | { event: "unexpectedPermission"; data: { sessionId: string; messageId: string; message: string } }

interface OpencodeEvent {
  type: string
  data?: Record<string, unknown>
  properties?: Record<string, unknown>
}

interface OpencodeError {
  name?: string
  type?: string
  message?: string
  data?: {
    message?: string
    statusCode?: number
    code?: string
  }
}

interface ToolCallSnapshot {
  input: Record<string, unknown>
  metadata?: Record<string, unknown>
  tool: string
}

interface PendingToolInput {
  raw: string
  tool: string
}

const toolPartPrefix = "tool-"
const activeToolCalls = new Map<string, ToolCallSnapshot>()
const pendingToolInputs = new Map<string, PendingToolInput>()

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function eventPayload(event: OpencodeEvent): Record<string, unknown> {
  if (isRecord(event.data)) {
    return event.data
  }
  if (isRecord(event.properties)) {
    return event.properties
  }
  return {}
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function parseJsonObject(value: string | undefined): Record<string, unknown> | null {
  if (!value) {
    return null
  }
  try {
    const parsed = JSON.parse(value) as unknown
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

function visibleText(text: string): string {
  return stripWantaPromptContext(text)
}

function toolKey(sessionId: string, messageId: string, callId: string): string {
  return `${sessionId}\0${messageId}\0${callId}`
}

function toolPartId(callId: string): string {
  return `${toolPartPrefix}${callId}`
}

function isOpencodeError(value: unknown): value is OpencodeError {
  return isRecord(value) && (typeof value.name === "string" || typeof value.type === "string" || "data" in value)
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
  return error.message ?? error.data?.message ?? error.name ?? error.type ?? "Agent error"
}

function messageErrorPart(error: unknown): ChatMessagePart | undefined {
  if (!isOpencodeError(error) || isMessageAbortedError(error)) {
    return undefined
  }
  const name = error.name ?? error.type ?? "unknown"
  return {
    kind: "error",
    partId: `message-error-${name}`,
    errorText: errorMessage(error),
  }
}

const ignoredOpencodeEventTypes = new Set([
  "command.executed",
  "file.edited",
  "file.watcher.updated",
  "installation.update-available",
  "installation.updated",
  "lsp.client.diagnostics",
  "lsp.updated",
  "message.removed",
  "permission.replied",
  "pty.created",
  "pty.deleted",
  "pty.exited",
  "pty.updated",
  "server.connected",
  "server.instance.disposed",
  "session.compacted",
  "session.created",
  "session.deleted",
  "session.diff",
  "session.updated",
  "todo.updated",
  "tui.command.execute",
  "tui.prompt.append",
  "tui.toast.show",
  "vcs.branch.updated",
])

const ignoredOpencodePartTypes = new Set(["agent", "compaction", "patch", "snapshot", "subtask"])

function warnUnhandledOpencode(kind: "event" | "part", type: string): void {
  if (process.env.NODE_ENV === "test") {
    return
  }
  console.warn(`[wanta] unhandled OpenCode ${kind} type: ${type}`)
}

export function translateOpencodeEvent(event: OpencodeEvent): ChatEmit[] {
  const props = eventPayload(event)
  switch (event.type) {
    case "message.updated": {
      const info = props.info as { id?: string; sessionID?: string; role?: ChatRole; error?: unknown } | undefined
      const sessionId = asString(props.sessionID) ?? info?.sessionID
      if (!info?.id || !sessionId || !info.role) {
        return []
      }
      const emits: ChatEmit[] = [{ event: "messageStarted", data: { sessionId, messageId: info.id, role: info.role } }]
      if (info.role === "assistant" && isOpencodeError(info.error) && !isMessageAbortedError(info.error)) {
        emits.push({ event: "agentError", data: { sessionId, message: errorMessage(info.error) } })
      }
      return emits
    }
    case "message.part.updated": {
      const part = props.part as OpencodePart | undefined
      if (!part) {
        return []
      }
      return translatePart(part, asString(props.delta))
    }
    case "message.part.removed": {
      const sessionId = asString(props.sessionID)
      const messageId = asString(props.messageID)
      const partId = asString(props.partID)
      if (!sessionId || !messageId || !partId) {
        return []
      }
      return [{ event: "messagePartRemoved", data: { sessionId, messageId, partId } }]
    }
    case "session.next.step.started": {
      const sessionId = asString(props.sessionID)
      const messageId = asString(props.assistantMessageID)
      if (!sessionId || !messageId) {
        return []
      }
      return [
        { event: "messageStarted", data: { sessionId, messageId, role: "assistant" } },
        { event: "assistantActivity", data: { sessionId, messageId, phase: "thinking" } },
      ]
    }
    case "session.next.step.ended": {
      const sessionId = asString(props.sessionID)
      const messageId = asString(props.assistantMessageID)
      if (!sessionId || !messageId) {
        return []
      }
      return [{ event: "assistantActivity", data: { sessionId, messageId, phase: "finalizing" } }]
    }
    case "session.next.step.failed": {
      const sessionId = asString(props.sessionID)
      const messageId = asString(props.assistantMessageID)
      return [
        ...(sessionId && messageId
          ? ([{ event: "messageStarted", data: { sessionId, messageId, role: "assistant" } }] as ChatEmit[])
          : []),
        { event: "agentError", data: { sessionId, message: errorMessage(props.error) } },
      ]
    }
    case "session.next.text.delta": {
      const data = textDeltaData(props, false)
      return data ? [{ event: "messageDelta", data }] : []
    }
    case "session.next.text.ended": {
      const data = textDeltaData(props, true)
      return data ? [{ event: "messageDelta", data }] : []
    }
    case "session.next.reasoning.delta": {
      const data = reasoningDeltaData(props, false)
      return data ? [{ event: "messageReasoningDelta", data }] : []
    }
    case "session.next.reasoning.ended": {
      const data = reasoningDeltaData(props, true)
      return data ? [{ event: "messageReasoningDelta", data }] : []
    }
    case "session.next.tool.input.started":
      return translateToolInputStarted(props)
    case "session.next.tool.input.delta":
      return translateToolInputDelta(props)
    case "session.next.tool.input.ended":
      return translateToolInputEnded(props)
    case "session.next.tool.called":
      return translateToolCalled(props)
    case "session.next.tool.progress":
      return translateToolProgress(props)
    case "session.next.tool.success":
      return translateToolSuccess(props)
    case "session.next.tool.failed":
      return translateToolFailed(props)
    case "session.next.retried": {
      const sessionId = asString(props.sessionID)
      if (!sessionId) {
        return []
      }
      const error = props.error as { message?: string } | undefined
      return [
        {
          event: "assistantActivity",
          data: {
            sessionId,
            phase: "retrying",
            message: error?.message,
            attempt: asNumber(props.attempt),
          },
        },
      ]
    }
    case "session.status": {
      const sessionId = asString(props.sessionID)
      const status = props.status as { type?: string; attempt?: number; message?: string; next?: number } | undefined
      if (!sessionId || status?.type !== "retry") {
        return []
      }
      return [
        {
          event: "assistantActivity",
          data: {
            sessionId,
            phase: "retrying",
            message: status.message,
            attempt: status.attempt,
            nextRetryAt: status.next,
          },
        },
      ]
    }
    case "session.idle": {
      const sessionId = asString(props.sessionID)
      if (!sessionId) {
        return []
      }
      return [{ event: "messageCompleted", data: { sessionId } }]
    }
    case "session.error": {
      if (isMessageAbortedError(props.error)) {
        return []
      }
      return [
        { event: "agentError", data: { sessionId: asString(props.sessionID), message: errorMessage(props.error) } },
      ]
    }
    case "permission.updated": {
      const p = props as { sessionID?: string; messageID?: string; title?: string; type?: string }
      if (!p.sessionID || !p.messageID) {
        return []
      }
      const detail = [p.title, p.type].filter(Boolean).join(" · ")
      return [
        {
          event: "unexpectedPermission",
          data: {
            sessionId: p.sessionID,
            messageId: p.messageID,
            message: detail
              ? `OpenCode requested permission approval (${detail}), but Wanta does not support ask permissions. The generation was stopped.`
              : "OpenCode requested permission approval, but Wanta does not support ask permissions. The generation was stopped.",
          },
        },
      ]
    }
    default:
      if (!ignoredOpencodeEventTypes.has(event.type)) {
        warnUnhandledOpencode("event", event.type)
      }
      return []
  }
}

function textDeltaData(props: Record<string, unknown>, ended: boolean): MessageDeltaEvent | null {
  const sessionId = asString(props.sessionID)
  const messageId = asString(props.assistantMessageID)
  const partId = asString(props.textID)
  if (!sessionId || !messageId || !partId) {
    return null
  }
  if (ended) {
    return { sessionId, messageId, partId, text: visibleText(asString(props.text) ?? "") }
  }
  return { sessionId, messageId, partId, text: "", delta: visibleText(asString(props.delta) ?? "") }
}

function reasoningDeltaData(props: Record<string, unknown>, ended: boolean): MessageReasoningDeltaEvent | null {
  const sessionId = asString(props.sessionID)
  const messageId = asString(props.assistantMessageID)
  const partId = asString(props.reasoningID)
  if (!sessionId || !messageId || !partId) {
    return null
  }
  if (ended) {
    return { sessionId, messageId, partId, text: asString(props.text) ?? "" }
  }
  return { sessionId, messageId, partId, text: "", delta: asString(props.delta) ?? "" }
}

function baseToolEvent(props: Record<string, unknown>) {
  const sessionId = asString(props.sessionID)
  const messageId = asString(props.assistantMessageID)
  const callId = asString(props.callID)
  if (!sessionId || !messageId || !callId) {
    return null
  }
  return { sessionId, messageId, callId, partId: toolPartId(callId) }
}

function translateToolInputStarted(props: Record<string, unknown>): ChatEmit[] {
  const base = baseToolEvent(props)
  const tool = asString(props.name)
  if (!base || !tool) {
    return []
  }
  pendingToolInputs.set(toolKey(base.sessionId, base.messageId, base.callId), { raw: "", tool })
  return [{ event: "toolCallStarted", data: { ...base, tool, input: {}, status: "pending" } }]
}

function translateToolInputDelta(props: Record<string, unknown>): ChatEmit[] {
  const base = baseToolEvent(props)
  if (!base) {
    return []
  }
  const key = toolKey(base.sessionId, base.messageId, base.callId)
  const current = pendingToolInputs.get(key)
  if (!current) {
    return []
  }
  const next = { ...current, raw: current.raw + (asString(props.delta) ?? "") }
  pendingToolInputs.set(key, next)
  return [
    {
      event: "toolCallStarted",
      data: { ...base, tool: next.tool, input: parseJsonObject(next.raw) ?? {}, status: "pending" },
    },
  ]
}

function translateToolInputEnded(props: Record<string, unknown>): ChatEmit[] {
  const base = baseToolEvent(props)
  if (!base) {
    return []
  }
  const key = toolKey(base.sessionId, base.messageId, base.callId)
  const current = pendingToolInputs.get(key)
  if (!current) {
    return []
  }
  const raw = asString(props.text) ?? current.raw
  pendingToolInputs.set(key, { ...current, raw })
  return [
    {
      event: "toolCallStarted",
      data: { ...base, tool: current.tool, input: parseJsonObject(raw) ?? {}, status: "pending" },
    },
  ]
}

function translateToolCalled(props: Record<string, unknown>): ChatEmit[] {
  const base = baseToolEvent(props)
  const tool = asString(props.tool)
  if (!base || !tool) {
    return []
  }
  const input = isRecord(props.input) ? props.input : {}
  const metadata = providerMetadata(props.provider)
  activeToolCalls.set(toolKey(base.sessionId, base.messageId, base.callId), { input, metadata, tool })
  pendingToolInputs.delete(toolKey(base.sessionId, base.messageId, base.callId))
  return [
    {
      event: "toolCallStarted",
      data: {
        ...base,
        tool,
        status: "running",
        ...toolContext({
          status: "running",
          input,
          metadata,
          time: { start: asNumber(props.timestamp) ?? Date.now() },
        }),
      },
    },
  ]
}

function translateToolProgress(props: Record<string, unknown>): ChatEmit[] {
  const base = baseToolEvent(props)
  if (!base) {
    return []
  }
  const snapshot = activeToolCalls.get(toolKey(base.sessionId, base.messageId, base.callId))
  if (!snapshot) {
    return []
  }
  return [
    {
      event: "toolCallStarted",
      data: {
        ...base,
        tool: snapshot.tool,
        input: snapshot.input,
        status: "running",
        ...(snapshot.metadata ? { metadata: snapshot.metadata } : {}),
      },
    },
  ]
}

function translateToolSuccess(props: Record<string, unknown>): ChatEmit[] {
  const base = baseToolEvent(props)
  if (!base) {
    return []
  }
  const key = toolKey(base.sessionId, base.messageId, base.callId)
  const snapshot = activeToolCalls.get(key)
  activeToolCalls.delete(key)
  pendingToolInputs.delete(key)
  const tool = snapshot?.tool ?? "tool"
  const output = toolOutput(props.content, props.result, props.structured)
  const auth = parseToolAuthorization(tool, output)
  return [
    {
      event: "toolCallResult",
      data: {
        ...base,
        tool,
        input: snapshot?.input ?? {},
        status: "completed",
        output,
        ...(snapshot?.metadata ? { metadata: snapshot.metadata } : {}),
        ...(toolAttachmentsCount(props.content, props.outputPaths)
          ? { attachmentsCount: toolAttachmentsCount(props.content, props.outputPaths) }
          : {}),
        ...(auth ? { authorization: auth } : {}),
      },
    },
  ]
}

function translateToolFailed(props: Record<string, unknown>): ChatEmit[] {
  const base = baseToolEvent(props)
  if (!base) {
    return []
  }
  const key = toolKey(base.sessionId, base.messageId, base.callId)
  const snapshot = activeToolCalls.get(key)
  activeToolCalls.delete(key)
  pendingToolInputs.delete(key)
  return [
    {
      event: "toolCallResult",
      data: {
        ...base,
        tool: snapshot?.tool ?? "tool",
        input: snapshot?.input ?? {},
        status: "error",
        error: errorMessage(props.error),
        ...(snapshot?.metadata ? { metadata: snapshot.metadata } : {}),
      },
    },
  ]
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
  ignored?: boolean
  synthetic?: boolean
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
    attachments?: OpencodePart[]
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
  const attachments = toolAttachments(state.attachments)
  const attachmentsCount = attachments.length > 0 ? attachments.length : (state.attachments?.length ?? 0)
  return {
    input: state.input ?? {},
    ...(title ? { title } : {}),
    ...(state.metadata ? { metadata: state.metadata } : {}),
    ...(state.time ? { timing: { start: state.time.start, end: state.time.end } } : {}),
    ...(attachmentsCount > 0 ? { attachmentsCount } : {}),
    ...(attachments.length > 0 ? { attachments } : {}),
  }
}

function translatePart(part: OpencodePart, delta?: string): ChatEmit[] {
  if (part.type === "step-start") {
    return [
      { event: "assistantActivity", data: { sessionId: part.sessionID, messageId: part.messageID, phase: "thinking" } },
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
    if (part.ignored === true) {
      return []
    }
    const rawText = part.text ?? ""
    const text = visibleText(rawText)
    const cleanedDelta = delta === undefined ? undefined : visibleText(delta)
    return [
      {
        event: "messageDelta",
        data: {
          sessionId: part.sessionID,
          messageId: part.messageID,
          partId: part.id,
          text,
          ...(cleanedDelta === undefined || cleanedDelta.length === 0 || text !== rawText
            ? {}
            : { delta: cleanedDelta }),
        },
      },
    ]
  }
  if (part.type === "reasoning") {
    return [
      {
        event: "messageReasoningDelta",
        data: {
          sessionId: part.sessionID,
          messageId: part.messageID,
          partId: part.id,
          text: part.text ?? "",
          ...(delta === undefined ? {} : { delta }),
        },
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
  if (!ignoredOpencodePartTypes.has(part.type)) {
    warnUnhandledOpencode("part", part.type)
  }
  return []
}

function attachmentPath(part: OpencodePart): string {
  if (part.source?.path) {
    return part.source.path
  }
  if (part.url?.startsWith("file://")) {
    try {
      return fileURLToPath(part.url)
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

function toolAttachments(value: OpencodePart[] | undefined): NonNullable<ToolCallResultEvent["attachments"]> {
  if (!Array.isArray(value)) {
    return []
  }
  return value
    .map((part) => attachmentPart(part).attachment)
    .filter((attachment): attachment is NonNullable<ChatMessagePart["attachment"]> => Boolean(attachment))
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0
}

function messageTokenUsage(info: unknown): ChatTokenUsage | undefined {
  const message = info as { role?: ChatRole; tokens?: unknown; type?: string } | undefined
  if (
    (message?.role !== "assistant" && message?.type !== "assistant") ||
    !message.tokens ||
    typeof message.tokens !== "object"
  ) {
    return undefined
  }
  const tokens = message.tokens as {
    input?: unknown
    output?: unknown
    reasoning?: unknown
    cache?: { read?: unknown; write?: unknown }
  }
  return {
    input: numberOrZero(tokens.input),
    output: numberOrZero(tokens.output),
    reasoning: numberOrZero(tokens.reasoning),
    cache: {
      read: numberOrZero(tokens.cache?.read),
      write: numberOrZero(tokens.cache?.write),
    },
  }
}

export function normalizeSyncMessage(message: { info?: unknown; parts?: unknown }): ChatMessage | null {
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
      if (part.ignored === true) {
        continue
      }
      const text = visibleText(part.text ?? "")
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
      const attachments = toolAttachments(state.attachments)
      const attachmentsCount = attachments.length > 0 ? attachments.length : (state.attachments?.length ?? 0)
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
        attachmentsCount: attachmentsCount > 0 ? attachmentsCount : undefined,
        attachments: attachments.length > 0 ? attachments : undefined,
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

export function normalizeMessage(message: SessionMessage): ChatMessage | null {
  if (message.type === "user") {
    const parts: ChatMessagePart[] = []
    const text = visibleText(message.text)
    if (text) {
      parts.push({ kind: "text", partId: `${message.id}-text`, text })
    }
    for (const [index, file] of (message.files ?? []).entries()) {
      const part = promptFilePart(file, `${message.id}-file-${index}`)
      if (part.attachment) {
        parts.push(part)
      }
    }
    return parts.length > 0 ? { id: message.id, role: "user", parts, createdAt: message.time.created ?? 0 } : null
  }
  if (message.type !== "assistant") {
    return null
  }
  const parts: ChatMessagePart[] = []
  for (const part of message.content) {
    if (part.type === "text" && part.text) {
      const text = visibleText(part.text)
      if (text) {
        parts.push({ kind: "text", partId: part.id, text })
      }
    } else if (part.type === "reasoning" && part.text) {
      parts.push({ kind: "reasoning", partId: part.id, text: part.text })
    } else if (part.type === "tool") {
      parts.push(projectedToolPart(part))
    }
  }
  const error = messageErrorPart(message.error)
  if (error) {
    parts.push(error)
  }
  const tokenUsage = messageTokenUsage(message)
  if (parts.length === 0) {
    return null
  }
  return {
    id: message.id,
    role: "assistant",
    parts,
    createdAt: message.time.created ?? 0,
    ...(tokenUsage ? { tokenUsage } : {}),
  }
}

function promptFilePart(file: PromptFileAttachment, partId: string): ChatMessagePart {
  const path = attachmentUriPath(file.uri)
  if (!path) {
    return { kind: "attachment", partId }
  }
  const mime = file.mime || "application/octet-stream"
  return {
    kind: "attachment",
    partId,
    attachment: {
      id: partId,
      name: file.name ?? path.split(/[\\/]/).pop() ?? "attachment",
      mime,
      size: 0,
      path,
      kind: mime === "inode/directory" ? "directory" : "file",
    },
  }
}

function attachmentUriPath(uri: string | undefined): string {
  if (!uri) {
    return ""
  }
  if (uri.startsWith("file://")) {
    try {
      return fileURLToPath(uri)
    } catch {
      return uri
    }
  }
  return uri
}

function projectedToolPart(part: SessionMessageAssistantTool): ChatMessagePart {
  const state = part.state
  const output =
    state.status === "completed" || state.status === "error"
      ? toolOutput(state.content, state.result, state.structured)
      : undefined
  const tool: ChatMessagePart = {
    kind: "tool",
    partId: toolPartId(part.id),
    callId: part.id,
    tool: part.name,
    status: state.status,
    input: toolInput(state),
    output,
    error: state.status === "error" ? state.error.message : undefined,
    title: toolTitle(state),
    metadata: projectedToolMetadata(part),
    timing: { start: part.time.ran ?? part.time.created, end: part.time.completed },
    attachmentsCount: projectedToolAttachmentsCount(part),
  }
  if (state.status === "completed") {
    const auth = parseToolAuthorization(part.name, output)
    if (auth) {
      tool.authorization = auth
    }
  }
  return tool
}

function toolInput(state: SessionMessageAssistantTool["state"]): Record<string, unknown> {
  if (state.status === "pending") {
    return parseJsonObject(state.input) ?? {}
  }
  return state.input
}

function toolTitle(state: SessionMessageAssistantTool["state"]): string | undefined {
  const input = toolInput(state)
  return typeof input.description === "string" ? input.description : undefined
}

function providerMetadata(provider: unknown): Record<string, unknown> | undefined {
  if (!isRecord(provider)) {
    return undefined
  }
  const metadata = provider.metadata
  return isRecord(metadata) ? { provider: metadata } : undefined
}

function projectedToolMetadata(part: SessionMessageAssistantTool): Record<string, unknown> | undefined {
  const metadata: Record<string, unknown> = {}
  if (part.provider?.metadata) {
    metadata.provider = part.provider.metadata
  }
  if ("structured" in part.state && Object.keys(part.state.structured).length > 0) {
    metadata.structured = part.state.structured
  }
  return Object.keys(metadata).length > 0 ? metadata : undefined
}

function projectedToolAttachmentsCount(part: SessionMessageAssistantTool): number | undefined {
  if (part.state.status === "pending" || part.state.status === "running") {
    return undefined
  }
  const attachments = part.state.status === "completed" ? (part.state.attachments?.length ?? 0) : 0
  return toolAttachmentsCount(
    part.state.content,
    part.state.status === "completed" ? part.state.outputPaths : undefined,
    attachments,
  )
}

function toolAttachmentsCount(content: unknown, outputPaths: unknown, base = 0): number | undefined {
  const files = Array.isArray(content) ? content.filter((item) => isRecord(item) && item.type === "file").length : 0
  const paths = Array.isArray(outputPaths) ? outputPaths.length : 0
  const count = base + files + paths
  return count > 0 ? count : undefined
}

function toolOutput(content: unknown, result: unknown, structured: unknown): string | undefined {
  const text = toolTextContent(content)
  if (text) {
    return text
  }
  if (result !== undefined) {
    return stringifyResult(result)
  }
  if (isRecord(structured) && Object.keys(structured).length > 0) {
    return stringifyResult(structured)
  }
  return undefined
}

function toolTextContent(content: unknown): string | undefined {
  if (!Array.isArray(content)) {
    return undefined
  }
  const texts = (content as Array<ToolTextContent | ToolFileContent>)
    .filter((item): item is ToolTextContent => item.type === "text" && item.text.length > 0)
    .map((item) => item.text)
  return texts.length > 0 ? texts.join("\n") : undefined
}

function stringifyResult(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value)
}
