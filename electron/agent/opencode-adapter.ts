import type { ChatMessage, ChatPermissionRequest, ChatQuestionRequest } from "../chat/common.ts"
import type { GenerateSessionTitleRequest, SessionInfo } from "../session/common.ts"
import type {
  AgentSendOptions,
  CancelAgentInput,
  PermissionResponseAgentInput,
  PromptAgentInput,
  QuestionResponseAgentInput,
} from "./contract/input.ts"
import type { AgentManager, GeneratedSessionTitle } from "./manager.ts"

import { BaseAgentAdapter } from "./contract/adapter.ts"
import { AGENT_PROFILES } from "./contract/profile.ts"
import { translateOpencodeEvent } from "./event-translator.ts"

// The built-in OpenCode kernel behind the AgentAdapter contract (BYOA phase 0).
//
// The normalized surface (send/onEvent/lifecycle) is what every agent shares;
// everything below "Deep kernel surface" is the OpenCode-specific depth Wanta
// deliberately keeps (server-side sessions, artifact/process directories, Link
// team scoping, title generation). Deep capabilities stay on this concrete
// class — they are not part of the AgentAdapter contract, and future external
// adapters must not be forced to fake them.

export class OpencodeAgentAdapter extends BaseAgentAdapter {
  public readonly kind = "opencode"
  public readonly profile = AGENT_PROFILES.opencode

  private readonly manager: AgentManager
  private readonly prepareHostContext?: (input: PromptAgentInput) => Promise<void>
  private detachManagerEvents: (() => void) | null = null

  public constructor(manager: AgentManager, prepareHostContext?: (input: PromptAgentInput) => Promise<void>) {
    super()
    this.manager = manager
    this.prepareHostContext = prepareHostContext
  }

  protected async handleStart(): Promise<void> {
    if (!this.manager.isReady()) {
      await this.manager.start()
    }
    this.detachManagerEvents = this.manager.subscribe(
      (event) => {
        for (const translated of translateOpencodeEvent(event)) {
          this.emit(translated)
        }
      },
      (status) => {
        this.emit({ event: "connectionStatus", data: status })
      },
    )
  }

  protected async handleStop(): Promise<void> {
    this.detachManagerEvents?.()
    this.detachManagerEvents = null
    await this.manager.dispose()
  }

  protected async handlePrompt(input: PromptAgentInput, options?: AgentSendOptions): Promise<void> {
    await this.prepareHostContext?.(input)
    await this.manager.promptStreaming(input.sessionId, input.text, {
      attachments: input.attachments,
      mode: input.mode,
      model: input.model,
      teamName: input.teamName,
      reasoningLevel: input.reasoningLevel,
      artifactDir: input.artifactDir,
      outputProjectRoot: input.outputProjectRoot,
      processDir: input.processDir,
      messageId: input.messageId,
      system: input.system,
      signal: options?.signal,
    })
  }

  protected async handleCancel(input: CancelAgentInput): Promise<void> {
    await this.manager.abort(input.sessionId)
  }

  protected override async handlePermissionResponse(input: PermissionResponseAgentInput): Promise<void> {
    // "always" is a Wanta-side session grant, not a kernel rule: the chat
    // service records it and the kernel only needs this one approval.
    const reply = input.reply === "always" ? "once" : input.reply
    await this.manager.answerPermission(input.sessionId, input.requestId, reply)
  }

  protected override async handleQuestionResponse(input: QuestionResponseAgentInput): Promise<void> {
    if (input.outcome.kind === "answered") {
      await this.manager.answerQuestion(input.sessionId, input.requestId, input.outcome.answers)
      return
    }
    await this.manager.rejectQuestion(input.sessionId, input.requestId)
  }

  /** Retirement-pool compatibility: disposing the adapter tears down the kernel. */
  public dispose(): Promise<void> {
    return this.stop()
  }

  // ── Deep kernel surface (OpenCode-specific, outside the normalized contract) ──

  public isReady(): boolean {
    return this.manager.isReady()
  }

  public get url(): string {
    return this.manager.url
  }

  public setTeamName(teamName?: string): Promise<void> {
    return this.manager.setTeamName(teamName)
  }

  public removeKnowledgeBaseAccess(knowledgeBaseId: string): Promise<void> {
    return this.manager.removeKnowledgeBaseAccess(knowledgeBaseId)
  }

  public getMessages(sessionId: string): Promise<ChatMessage[]> {
    return this.manager.getMessages(sessionId)
  }

  public getPendingQuestionsForSessions(sessionIds: readonly string[]): Promise<ChatQuestionRequest[]> {
    return this.manager.getPendingQuestionsForSessions(sessionIds)
  }

  public getPendingPermissions(sessionId: string): Promise<ChatPermissionRequest[]> {
    return this.manager.getPendingPermissions(sessionId)
  }

  public getPendingPermissionsForSessions(sessionIds: readonly string[]): Promise<ChatPermissionRequest[]> {
    return this.manager.getPendingPermissionsForSessions(sessionIds)
  }

  public createArtifactDir(sessionId: string, projectRoot?: string): Promise<string> {
    return this.manager.createArtifactDir(sessionId, projectRoot)
  }

  public artifactSessionDir(sessionId: string, projectRoot?: string): string {
    return this.manager.artifactSessionDir(sessionId, projectRoot)
  }

  public createProcessDir(sessionId: string): Promise<string> {
    return this.manager.createProcessDir(sessionId)
  }

  public setSessionTeamName(sessionId: string, teamName?: string): Promise<void> {
    return this.manager.setSessionTeamName(sessionId, teamName)
  }

  public clearSessionTeamName(sessionId: string): Promise<void> {
    return this.manager.clearSessionTeamName(sessionId)
  }

  public setSessionKnowledgeBaseIds(sessionId: string, knowledgeBaseIds: readonly string[]): Promise<void> {
    return this.manager.setSessionKnowledgeBaseIds(sessionId, knowledgeBaseIds)
  }

  public clearSessionKnowledgeBaseIds(sessionId: string): Promise<void> {
    return this.manager.clearSessionKnowledgeBaseIds(sessionId)
  }

  public inheritSessionKnowledgeBaseIds(parentSessionId: string, childSessionId: string): Promise<void> {
    return this.manager.inheritSessionKnowledgeBaseIds(parentSessionId, childSessionId)
  }

  public listSessions(): Promise<SessionInfo[]> {
    return this.manager.listSessions()
  }

  public createSession(title?: string): Promise<SessionInfo> {
    return this.manager.createSession(title)
  }

  public renameSession(id: string, title: string): Promise<void> {
    return this.manager.renameSession(id, title)
  }

  public deleteSession(id: string): Promise<void> {
    return this.manager.deleteSession(id)
  }

  public generateSessionTitle(input: GenerateSessionTitleRequest): Promise<GeneratedSessionTitle> {
    return this.manager.generateSessionTitle(input)
  }
}
