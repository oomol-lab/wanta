import type { AuthService } from "../../electron/auth/common"
import type { ChatService } from "../../electron/chat/common"
import type { ConnectionsService } from "../../electron/connections/common"
import type { SessionService } from "../../electron/session/common"
import type { SettingsService } from "../../electron/settings/common"
import type { UpdateService } from "../../electron/update/common.ts"
import type { ConnectionClientService } from "@oomol/connection"

import * as React from "react"

export interface AppContextValue {
  chatService: ConnectionClientService<ChatService>
  sessionService: ConnectionClientService<SessionService>
  connectionsService: ConnectionClientService<ConnectionsService>
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

export function useSessionService(): ConnectionClientService<SessionService> {
  return useAppContext().sessionService
}

export function useConnectionsService(): ConnectionClientService<ConnectionsService> {
  return useAppContext().connectionsService
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
