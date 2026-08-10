import type {
  AgentErrorEvent,
  AssistantActivityEvent,
  ChatPermissionRequest,
  ChatQuestionRequest,
  MessageAttachmentEvent,
  MessageCompletedEvent,
  MessageDeltaEvent,
  MessagePartRemovedEvent,
  MessageReasoningDeltaEvent,
  MessageStartedEvent,
  QuestionResolvedEvent,
  ToolCallResultEvent,
  ToolCallStartedEvent,
} from "../../chat/common.ts"

import { z } from "zod"

// Normalized agent event contract (BYOA phase 0).
//
// AgentEvent is the single outbound channel of every AgentAdapter: each adapter
// translates its native protocol (OpenCode SSE, Claude Agent SDK messages, ACP
// session/update notifications, ...) into this discriminated union. The variants
// were promoted from the former ChatEmit union in event-translator.ts, so the
// chat event bridge consumes them unchanged; payload types stay shared with the
// IPC contract in electron/chat/common.ts on purpose (the UI vocabulary is the
// source of truth, per the BYOA plan). Where a concept exists in the Agent
// Client Protocol we keep its vocabulary (tool call ids/status, cancel,
// permission options), but the event envelope stays `{event, data}` to match
// the ServerEvents broadcast layer one hop downstream.
//
// The zod schemas are the machine-checked half of the contract: the
// `z.ZodType<AgentEvent>` annotation forces schema and TS union to agree at
// compile time, and BaseAgentAdapter asserts events against the schema at
// runtime while always forwarding the original object (validation never
// rewrites or strips payloads).

/**
 * Runtime connection/health report of an adapter, unified into the same event
 * stream as business events so adapters have exactly one outbound channel.
 * Vocabulary matches the historical AgentManager connection statuses.
 */
export type AgentConnectionStatusKind =
  | "reconnecting"
  | "reconnected"
  | "failed"
  | "runtime_restarting"
  | "runtime_recovered"
  | "runtime_failed"

export interface AgentConnectionStatus {
  status: AgentConnectionStatusKind
  attempt: number
  maxAttempts: number
  message?: string
}

export type AgentEvent =
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
  | { event: "agentError"; data: AgentErrorEvent }
  | { event: "connectionStatus"; data: AgentConnectionStatus }

/** Business events an adapter translator may produce (everything but connection health). */
export type AgentBusinessEvent = Exclude<AgentEvent, { event: "connectionStatus" }>

const chatRoleSchema = z.enum(["user", "assistant"])

const toolTimingSchema = z.object({
  start: z.number().optional(),
  end: z.number().optional(),
})

export const chatAttachmentSchema = z.object({
  id: z.string(),
  name: z.string(),
  mime: z.string(),
  size: z.number(),
  path: z.string(),
  kind: z.enum(["file", "directory"]).optional(),
  agentPath: z.string().optional(),
  agentName: z.string().optional(),
  agentMime: z.string().optional(),
  agentSize: z.number().optional(),
})

const authorizationInfoSchema = z.object({
  service: z.string(),
  connectionName: z.string().optional(),
  displayName: z.string(),
  action: z.string().optional(),
  authUrl: z.string().optional(),
  errorCode: z.string().optional(),
  message: z.string().optional(),
})

const questionOptionSchema = z.object({
  label: z.string(),
  description: z.string().optional(),
})

const questionInfoSchema = z.object({
  question: z.string(),
  header: z.string(),
  options: z.array(questionOptionSchema),
  multiple: z.boolean().optional(),
  custom: z.boolean().optional(),
})

const requestToolRefSchema = z.object({
  messageId: z.string(),
  callId: z.string(),
})

export const questionRequestSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  questions: z.array(questionInfoSchema),
  tool: requestToolRefSchema.optional(),
})

const permissionPromptReasonSchema = z.enum([
  "automatic_reply_failed",
  "broad_resource",
  "dependency_mutation",
  "high_risk_command",
  "sensitive_resource",
  "unclassified_request",
])

export const permissionRequestSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  action: z.string(),
  resources: z.array(z.string()),
  save: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  wanta: z
    .object({
      automaticReplyFailed: z.boolean().optional(),
      promptReason: permissionPromptReasonSchema.optional(),
    })
    .optional(),
  tool: requestToolRefSchema.optional(),
})

const messageStartedSchema = z.object({
  sessionId: z.string(),
  messageId: z.string(),
  role: chatRoleSchema,
  internal: z.boolean().optional(),
  finishReason: z.string().optional(),
  completedAt: z.number().optional(),
})

const messageDeltaSchema = z.object({
  sessionId: z.string(),
  messageId: z.string(),
  partId: z.string(),
  text: z.string(),
  delta: z.string().optional(),
  synthetic: z.boolean().optional(),
})

const messageReasoningDeltaSchema = z.object({
  sessionId: z.string(),
  messageId: z.string(),
  partId: z.string(),
  text: z.string(),
  delta: z.string().optional(),
})

const messageAttachmentSchema = z.object({
  sessionId: z.string(),
  messageId: z.string(),
  partId: z.string(),
  attachment: chatAttachmentSchema,
})

const assistantActivitySchema = z.object({
  sessionId: z.string(),
  messageId: z.string().optional(),
  phase: z.enum(["thinking", "finalizing", "retrying", "compacting", "resuming"]),
  finishReason: z.string().optional(),
  message: z.string().optional(),
  attempt: z.number().optional(),
  nextRetryAt: z.number().optional(),
})

const toolCallStartedSchema = z.object({
  sessionId: z.string(),
  messageId: z.string(),
  partId: z.string(),
  callId: z.string(),
  tool: z.string(),
  input: z.record(z.string(), z.unknown()),
  status: z.enum(["pending", "running"]),
  title: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  timing: toolTimingSchema.optional(),
})

const toolCallResultSchema = z.object({
  sessionId: z.string(),
  messageId: z.string(),
  partId: z.string(),
  callId: z.string(),
  tool: z.string(),
  status: z.enum(["completed", "error"]),
  input: z.record(z.string(), z.unknown()),
  output: z.string().optional(),
  error: z.string().optional(),
  title: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  timing: toolTimingSchema.optional(),
  attachmentsCount: z.number().optional(),
  authorization: authorizationInfoSchema.optional(),
})

const questionResolvedSchema = z.object({
  sessionId: z.string(),
  requestId: z.string(),
  answers: z.array(z.array(z.string())).optional(),
})

const permissionResolvedSchema = z.object({
  sessionId: z.string(),
  requestId: z.string(),
})

const messageCompletedSchema = z.object({
  sessionId: z.string(),
})

const messagePartRemovedSchema = z.object({
  sessionId: z.string(),
  messageId: z.string(),
  partId: z.string(),
})

const agentErrorSchema = z.object({
  sessionId: z.string().optional(),
  message: z.string(),
})

const connectionStatusSchema = z.object({
  status: z.enum([
    "reconnecting",
    "reconnected",
    "failed",
    "runtime_restarting",
    "runtime_recovered",
    "runtime_failed",
  ]),
  attempt: z.number(),
  maxAttempts: z.number(),
  message: z.string().optional(),
})

/**
 * The type annotation is the compile-time contract check: the schema union must
 * stay assignable to AgentEvent, so a variant added to one side without the
 * other fails typecheck.
 */
export const agentEventSchema: z.ZodType<AgentEvent> = z.discriminatedUnion("event", [
  z.object({ event: z.literal("messageStarted"), data: messageStartedSchema }),
  z.object({ event: z.literal("messageDelta"), data: messageDeltaSchema }),
  z.object({ event: z.literal("messageReasoningDelta"), data: messageReasoningDeltaSchema }),
  z.object({ event: z.literal("messageAttachment"), data: messageAttachmentSchema }),
  z.object({ event: z.literal("assistantActivity"), data: assistantActivitySchema }),
  z.object({ event: z.literal("toolCallStarted"), data: toolCallStartedSchema }),
  z.object({ event: z.literal("toolCallResult"), data: toolCallResultSchema }),
  z.object({
    event: z.literal("questionAsked"),
    data: z.object({ sessionId: z.string(), request: questionRequestSchema }),
  }),
  z.object({ event: z.literal("questionReplied"), data: questionResolvedSchema }),
  z.object({ event: z.literal("questionRejected"), data: questionResolvedSchema }),
  z.object({
    event: z.literal("permissionAsked"),
    data: z.object({ sessionId: z.string(), request: permissionRequestSchema }),
  }),
  z.object({ event: z.literal("permissionReplied"), data: permissionResolvedSchema }),
  z.object({ event: z.literal("messageCompleted"), data: messageCompletedSchema }),
  z.object({ event: z.literal("messagePartRemoved"), data: messagePartRemovedSchema }),
  z.object({ event: z.literal("agentError"), data: agentErrorSchema }),
  z.object({ event: z.literal("connectionStatus"), data: connectionStatusSchema }),
])

/**
 * Assert an event against the schema without rewriting it. Returns the issue
 * summary when invalid so callers can log or throw; validation must never strip
 * or transform payloads (zod object parsing drops unknown keys, so the parsed
 * value is deliberately discarded).
 */
export function agentEventIssues(event: AgentEvent): string | null {
  const result = agentEventSchema.safeParse(event)
  if (result.success) {
    return null
  }
  return result.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ")
}
