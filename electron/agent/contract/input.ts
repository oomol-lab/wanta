import type { ChatAttachment, ChatPermissionReply } from "../../chat/common.ts"
import type { ModelChoice } from "../../models/common.ts"
import type { WantaAgentMode } from "../mode.ts"
import type { WantaReasoningLevel } from "../reasoning.ts"

import { z } from "zod"
import { chatAttachmentSchema } from "./event.ts"

// Normalized agent input contract (BYOA phase 0).
//
// AgentInput is the single inbound channel of every AgentAdapter. A new kind of
// interaction is a new variant here, never a new adapter method. The variant
// vocabulary follows the Agent Client Protocol where a counterpart exists
// (`cancel` ~ session/cancel, `permission-response` ~ the permission request
// outcome), while the payload fields stay aligned with what the Wanta chat
// pipeline actually sends today.

/**
 * One user turn. Everything the built-in kernel needs travels in the input;
 * Prompt-field support is composed by the chat layer from the selected
 * profile; independent interactions remain explicit input variants so an
 * adapter cannot silently drop them.
 */
export interface PromptAgentInput {
  type: "prompt"
  sessionId: string
  text: string
  /** Pre-allocated user message id so streaming overlays can correlate early. */
  messageId?: string
  attachments?: ChatAttachment[]
  mode?: WantaAgentMode
  model?: ModelChoice
  reasoningLevel?: WantaReasoningLevel
  /** Link workspace identity for this turn (OOMOL runtime only). */
  teamName?: string
  /** Per-turn system prompt tail composed by the chat layer. */
  system?: string
  /** Host-owned restricted diagnostic turn; adapters must isolate native scope and capabilities. */
  diagnostic?: boolean
  /** Managed output directories assigned by the chat layer for this turn. */
  artifactDir?: string
  /** Host-selected project cwd. Kept separate from artifact placement. */
  workingDirectory?: string
  /** Stable host-authorized local roots available in addition to the cwd. */
  additionalDirectories?: string[]
  outputProjectRoot?: string
  processDir?: string
  /**
   * Agent-native model/effort ids for adapters whose profile declares
   * setModel/setEffort. Carried on the prompt so a choice made before the
   * session's first turn applies from turn one.
   */
  agentModelId?: string
  agentEffortId?: string
}

/** Abort the active generation of a session (ACP: session/cancel). */
export interface CancelAgentInput {
  type: "cancel"
  sessionId: string
}

/** Settle a permission request previously emitted as a permissionAsked event. */
export interface PermissionResponseAgentInput {
  type: "permission-response"
  sessionId: string
  requestId: string
  reply: ChatPermissionReply
}

export type QuestionResponseOutcome = { kind: "answered"; answers: string[][] } | { kind: "rejected" }

/** Settle a question request previously emitted as a questionAsked event. */
export interface QuestionResponseAgentInput {
  type: "question-response"
  sessionId: string
  requestId: string
  outcome: QuestionResponseOutcome
}

/** Switch the agent-native model of a session (absent id = agent default). */
export interface SetModelAgentInput {
  type: "set-model"
  sessionId: string
  modelId?: string
}

/** Switch the agent-native reasoning effort of a session (absent id = agent default). */
export interface SetEffortAgentInput {
  type: "set-effort"
  sessionId: string
  effortId?: string
}

/** Start an agent-owned authentication method advertised during ACP initialize. */
export interface AuthenticateAgentInput {
  type: "authenticate"
  methodId: string
}

export type AgentInput =
  | AuthenticateAgentInput
  | PromptAgentInput
  | CancelAgentInput
  | PermissionResponseAgentInput
  | QuestionResponseAgentInput
  | SetModelAgentInput
  | SetEffortAgentInput

/** Options that cannot be serialized into the input payload. */
export interface AgentSendOptions {
  /**
   * Aborts submission and, for the prompt input, the in-flight turn. Adapters
   * must treat an already-aborted signal as "do nothing".
   */
  signal?: AbortSignal
  /** Called once when a queued prompt reaches the native runtime boundary. */
  onDispatch?: () => void
}

const agentModeSchema: z.ZodType<WantaAgentMode> = z.enum(["build", "plan"])

const reasoningLevelSchema: z.ZodType<WantaReasoningLevel> = z.enum(["default", "low", "medium", "high", "max"])

/**
 * Shallow structural check only: model id membership is resolved (and rejected)
 * by the adapter/kernel, which owns the model catalog.
 */
const modelChoiceSchema: z.ZodType<ModelChoice> = z.custom<ModelChoice>((value) => {
  if (!value || typeof value !== "object") {
    return false
  }
  const choice = value as { kind?: unknown; id?: unknown }
  return (choice.kind === "builtin" || choice.kind === "custom") && typeof choice.id === "string"
})

const promptInputSchema = z.object({
  type: z.literal("prompt"),
  sessionId: z.string().min(1),
  text: z.string(),
  messageId: z.string().optional(),
  attachments: z.array(chatAttachmentSchema).optional(),
  mode: agentModeSchema.optional(),
  model: modelChoiceSchema.optional(),
  reasoningLevel: reasoningLevelSchema.optional(),
  teamName: z.string().optional(),
  system: z.string().optional(),
  diagnostic: z.boolean().optional(),
  artifactDir: z.string().optional(),
  workingDirectory: z.string().optional(),
  additionalDirectories: z.array(z.string().min(1)).optional(),
  outputProjectRoot: z.string().optional(),
  processDir: z.string().optional(),
  // Same floor as the dedicated set-model/set-effort inputs: an empty id would
  // otherwise reach the adapters and be sent as a real selection.
  agentModelId: z.string().min(1).optional(),
  agentEffortId: z.string().min(1).optional(),
})

const cancelInputSchema = z.object({
  type: z.literal("cancel"),
  sessionId: z.string().min(1),
})

const permissionReplySchema: z.ZodType<ChatPermissionReply> = z.enum(["once", "always", "reject"])

const permissionResponseInputSchema = z.object({
  type: z.literal("permission-response"),
  sessionId: z.string().min(1),
  requestId: z.string().min(1),
  reply: permissionReplySchema,
})

const questionOutcomeSchema: z.ZodType<QuestionResponseOutcome> = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("answered"), answers: z.array(z.array(z.string())) }),
  z.object({ kind: z.literal("rejected") }),
])

const questionResponseInputSchema = z.object({
  type: z.literal("question-response"),
  sessionId: z.string().min(1),
  requestId: z.string().min(1),
  outcome: questionOutcomeSchema,
})

const setModelInputSchema = z.object({
  type: z.literal("set-model"),
  sessionId: z.string().min(1),
  modelId: z.string().min(1).optional(),
})

const setEffortInputSchema = z.object({
  type: z.literal("set-effort"),
  sessionId: z.string().min(1),
  effortId: z.string().min(1).optional(),
})

const authenticateInputSchema = z.object({
  type: z.literal("authenticate"),
  methodId: z.string().min(1),
})

/** Compile-time check: schema union and AgentInput must stay in lockstep. */
export const agentInputSchema: z.ZodType<AgentInput> = z.discriminatedUnion("type", [
  authenticateInputSchema,
  promptInputSchema,
  cancelInputSchema,
  permissionResponseInputSchema,
  questionResponseInputSchema,
  setModelInputSchema,
  setEffortInputSchema,
])

/**
 * Assert an input against the schema without rewriting it (the parsed value is
 * discarded so zod's unknown-key stripping can never mutate a payload).
 * Returns the issue summary when invalid.
 */
export function agentInputIssues(input: AgentInput): string | null {
  const result = agentInputSchema.safeParse(input)
  if (result.success) {
    return null
  }
  return result.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ")
}
