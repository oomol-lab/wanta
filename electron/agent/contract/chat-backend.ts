import type { AgentPermissionMode, ChatMessage, ChatPermissionRequest, ChatQuestionRequest } from "../../chat/common.ts"
import type { AgentAdapter } from "./adapter.ts"

/** Host-facing read model required by ChatService after session routing. */
export interface ChatAgentBackend extends AgentAdapter {
  isReady(): boolean
  getMessages(sessionId: string): Promise<ChatMessage[]>
  getPendingPermissions(sessionId: string): Promise<ChatPermissionRequest[]>
  getPendingPermissionsForSessions(sessionIds: readonly string[]): Promise<ChatPermissionRequest[]>
  getPendingQuestionsForSessions(sessionIds: readonly string[]): Promise<ChatQuestionRequest[]>
  applyPermissionMode?(sessionId: string, mode: AgentPermissionMode): Promise<void>
  sessionSelection?(sessionId: string): { modelId?: string; effortId?: string }
  warmCatalog?(): Promise<void>
}
