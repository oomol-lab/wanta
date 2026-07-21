import type { AttentionService } from "../../electron/attention/common.ts"
import type { AuthService } from "../../electron/auth/common.ts"
import type { ChatService } from "../../electron/chat/common.ts"
import type { GitService } from "../../electron/git/common.ts"
import type { KnowledgeService } from "../../electron/knowledge/common.ts"
import type { LinkRuntimeService } from "../../electron/link-runtime/common.ts"
import type { ModelsService } from "../../electron/models/common.ts"
import type { SessionService } from "../../electron/session/common.ts"
import type { SettingsService } from "../../electron/settings/common.ts"
import type { SkillService } from "../../electron/skills/common.ts"
import type { UpdateService } from "../../electron/update/common.ts"
import type { ConnectionClientService } from "@oomol/connection"

import * as React from "react"

export interface AppContextValue {
  attentionService: ConnectionClientService<AttentionService>
  chatService: ConnectionClientService<ChatService>
  gitService: ConnectionClientService<GitService>
  knowledgeService: ConnectionClientService<KnowledgeService>
  linkRuntimeService: ConnectionClientService<LinkRuntimeService>
  sessionService: ConnectionClientService<SessionService>
  skillService: ConnectionClientService<SkillService>
  modelsService: ConnectionClientService<ModelsService>
  settingsService: ConnectionClientService<SettingsService>
  authService: ConnectionClientService<AuthService>
  updateService: ConnectionClientService<UpdateService>
}

export const AppContext = React.createContext<AppContextValue | null>(null)

export function useAppContext(): AppContextValue {
  const ctx = React.useContext(AppContext)
  if (!ctx) {
    throw new Error("useAppContext must be used within AppContext.Provider")
  }
  return ctx
}

export function useChatService(): ConnectionClientService<ChatService> {
  return useAppContext().chatService
}

export function useAttentionService(): ConnectionClientService<AttentionService> {
  return useAppContext().attentionService
}

export function useSessionService(): ConnectionClientService<SessionService> {
  return useAppContext().sessionService
}

export function useGitService(): ConnectionClientService<GitService> {
  return useAppContext().gitService
}

export function useKnowledgeService(): ConnectionClientService<KnowledgeService> {
  return useAppContext().knowledgeService
}

export function useLinkRuntimeService(): ConnectionClientService<LinkRuntimeService> {
  return useAppContext().linkRuntimeService
}

export function useSkillService(): ConnectionClientService<SkillService> {
  return useAppContext().skillService
}

export function useModelsService(): ConnectionClientService<ModelsService> {
  return useAppContext().modelsService
}

export function useSettingsService(): ConnectionClientService<SettingsService> {
  return useAppContext().settingsService
}

export function useAuthService(): ConnectionClientService<AuthService> {
  return useAppContext().authService
}

export function useUpdateService(): ConnectionClientService<UpdateService> {
  return useAppContext().updateService
}
