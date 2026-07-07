import type {
  AgentMode,
  AgentPermissionMode,
  ChatAttachment,
  ChatContextMention,
  ChatOrganizationSkillContext,
  ChatProjectContext,
  ChatMessage,
  ReasoningLevel,
} from "../../../electron/chat/common.ts"
import type { ConnectionProvider } from "../../../electron/connections/common.ts"
import type { GitRepositoryState } from "../../../electron/git/common.ts"
import type { ModelChoice } from "../../../electron/models/common.ts"
import type { SessionInfo, SessionProject, SessionScope } from "../../../electron/session/common.ts"
import type { AppShellRoute as Route } from "./app-shell-types.ts"
import type { QueuedChatMessage } from "./chat-queue.ts"
import type { WorkspaceSelection } from "@/hooks/useOrganizationWorkspace"

import { shouldAutoRefreshSessionTitle } from "../../../electron/session/title.ts"
import { visibleUserText } from "@/routes/Chat/message-text"

export const SIDEBAR_RESTORE_DELAY_MS = 260
export const SIDEBAR_AUTO_COLLAPSE_MAX_WIDTH_PX = 720
export const SIDEBAR_DEFAULT_WIDTH_PX = 264
export const SIDEBAR_MIN_WIDTH_PX = 220
export const SIDEBAR_MAX_WIDTH_PX = 420
export const SIDEBAR_WIDTH_STORAGE_KEY = "wanta.sidebarWidth"
export const CHAT_AREA_MIN_WIDTH_PX = 420
export const CHAT_CONNECTION_DRAWER_WIDTH = "min(31.5rem, 38vw)"
export const ARTIFACTS_PANEL_DEFAULT_WIDTH_PX = 300
export const ARTIFACTS_PANEL_MIN_WIDTH_PX = 260
export const ARTIFACTS_PANEL_WIDTH_STORAGE_KEY = "wanta.artifactsPanelWidth"
export const TURN_RETRY_OPTIONS_LIMIT = 48
export const SESSION_TITLE_RETRY_DELAY_MS = 20_000
export const AUTH_RETRY_POLL_INTERVAL_MS = 2_000
export const AUTH_RETRY_POLL_TIMEOUT_MS = 5 * 60_000
export const WORKSPACE_SWITCH_TIMEOUT_MS = 20_000
export const EMPTY_CONNECTION_PROVIDERS: ConnectionProvider[] = []
export const NEW_SESSION_COMPOSER_DRAFT_KEY = "__new_session__"
export const NO_DRAFT_PROJECT_ID = "__no_project__"

export { connectionWorkspaceKey as connectionWorkspaceSwitchKey } from "@/hooks/connection-oauth-pending"

export interface TurnRetryOptions {
  contextMentions?: ChatContextMention[]
  organizationSkills?: ChatOrganizationSkillContext[]
  projectContext?: ChatProjectContext
  model?: ModelChoice
  reasoningLevel?: ReasoningLevel
  mode?: AgentMode
  permissionMode?: AgentPermissionMode
  sessionScope?: SessionScope
}

export interface ChatSendRequest {
  attachments?: ChatAttachment[]
  contextMentions?: ChatContextMention[]
  mode?: AgentMode
  model?: ModelChoice
  permissionMode?: AgentPermissionMode
  reasoningLevel?: ReasoningLevel
  text: string
}

export function rememberTurnRetryOptions(
  store: Map<string, Map<string, TurnRetryOptions>>,
  sessionId: string,
  key: string,
  options: TurnRetryOptions,
): void {
  const sessionStore = store.get(sessionId) ?? new Map<string, TurnRetryOptions>()
  sessionStore.set(key, options)
  while (sessionStore.size > TURN_RETRY_OPTIONS_LIMIT) {
    const first = sessionStore.keys().next()
    if (first.done) {
      break
    }
    sessionStore.delete(first.value)
  }
  store.set(sessionId, sessionStore)
}

export function buildSessionTitleInput(
  messages: ChatMessage[],
  text: string,
  attachments: ChatAttachment[],
): { text: string; attachmentNames?: string[] } {
  const recentUserMessages = messages
    .filter((message) => message.role === "user")
    .map(chatMessageText)
    .map((messageText) => messageText.trim())
    .filter(Boolean)
    .slice(-3)
  const currentText = text.trim()
  const titleText = [...recentUserMessages, currentText].filter(Boolean).join("\n\n")
  const attachmentNames = attachments.map((attachment) => attachment.name.trim()).filter(Boolean)
  return {
    text: titleText || attachmentNames.join("\n"),
    ...(attachmentNames.length > 0 ? { attachmentNames } : {}),
  }
}

export function sessionTitleGenerationKey(
  input: { text: string; attachmentNames?: string[] },
  allowPlaceholder: boolean,
  replaceableTitle?: string,
): string {
  return JSON.stringify({
    allowPlaceholder,
    attachmentNames: input.attachmentNames ?? [],
    replaceableTitle: replaceableTitle ?? "",
    text: input.text,
  })
}

export function isSessionTitleAutoRefreshable(
  session: SessionInfo,
  allowPlaceholder: boolean,
  fallbackTitles: Map<string, string>,
  fallbackTitle?: string,
): boolean {
  return (
    shouldAutoRefreshSessionTitle(session.title, allowPlaceholder) ||
    fallbackTitles.get(session.id) === session.title ||
    fallbackTitle === session.title
  )
}

export function createQueuedChatMessage(
  sessionId: string,
  text: string,
  attachments: ChatAttachment[],
  contextMentions: ChatContextMention[] | undefined,
  model?: ModelChoice,
  reasoningLevel?: ReasoningLevel,
  mode?: AgentMode,
  permissionMode?: AgentPermissionMode,
): QueuedChatMessage {
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    sessionId,
    text,
    attachments,
    ...(contextMentions && contextMentions.length > 0 ? { contextMentions } : {}),
    model,
    reasoningLevel,
    mode,
    permissionMode,
    createdAt: Date.now(),
  }
}

export function initialRoute(): Route {
  const route = (import.meta.env as Record<string, string | undefined>)["VITE_WANTA_ROUTE"]
  return route === "settings" ||
    route === "connections" ||
    route === "skills" ||
    route === "organizations" ||
    route === "billing" ||
    route === "archived"
    ? route
    : "chat"
}

export function clampSidebarWidth(width: number): number {
  return Math.min(SIDEBAR_MAX_WIDTH_PX, Math.max(SIDEBAR_MIN_WIDTH_PX, width))
}

export function readStoredSidebarWidth(): number {
  try {
    const stored = globalThis.localStorage?.getItem(SIDEBAR_WIDTH_STORAGE_KEY)
    if (!stored) {
      return SIDEBAR_DEFAULT_WIDTH_PX
    }
    const width = Number.parseInt(stored, 10)
    return Number.isFinite(width) ? clampSidebarWidth(width) : SIDEBAR_DEFAULT_WIDTH_PX
  } catch {
    return SIDEBAR_DEFAULT_WIDTH_PX
  }
}

export function clampArtifactsPanelWidth(width: number): number {
  return Math.max(ARTIFACTS_PANEL_MIN_WIDTH_PX, width)
}

export function artifactsPanelMaxWidth(appWidth: number, sidebarWidth: number, sidebarCollapsed: boolean): number {
  const sidebarTrackWidth = sidebarCollapsed ? 0 : sidebarWidth
  const maxWidth = Math.floor(appWidth - sidebarTrackWidth - CHAT_AREA_MIN_WIDTH_PX)
  return Math.max(ARTIFACTS_PANEL_MIN_WIDTH_PX, maxWidth)
}

export function clampArtifactsPanelWidthForLayout(width: number, maxWidth: number): number {
  return Math.min(maxWidth, clampArtifactsPanelWidth(width))
}

export function readStoredArtifactsPanelWidth(): number {
  try {
    const stored = globalThis.localStorage?.getItem(ARTIFACTS_PANEL_WIDTH_STORAGE_KEY)
    if (!stored) {
      return ARTIFACTS_PANEL_DEFAULT_WIDTH_PX
    }
    const width = Number.parseInt(stored, 10)
    return Number.isFinite(width) ? clampArtifactsPanelWidth(width) : ARTIFACTS_PANEL_DEFAULT_WIDTH_PX
  } catch {
    return ARTIFACTS_PANEL_DEFAULT_WIDTH_PX
  }
}

export function chatMessageText(message: ChatMessage): string {
  const text = message.parts
    .filter((part) => part.kind === "text")
    .map((part) => part.text ?? "")
    .join("")
  return message.role === "user" ? visibleUserText(text) : text
}

export function sessionScopeFromWorkspace(workspace: WorkspaceSelection): SessionScope | null {
  if (workspace.type === "personal") {
    return { type: "personal" }
  }
  const organizationId = workspace.organizationId.trim()
  const organizationName = workspace.organization?.name.trim()
  if (!organizationId || !organizationName) {
    return null
  }
  return { type: "organization", organizationId, organizationName }
}

export function workspaceSelectionSwitchKey(workspace: WorkspaceSelection): string {
  return workspace.type === "organization" ? `organization:${workspace.organizationId}` : "personal"
}

export function sessionScopeKey(scope: SessionScope | null): string {
  if (!scope) {
    return "workspace-loading"
  }
  return scope.type === "organization" ? `organization:${scope.organizationId}` : "personal"
}

export function sessionRecordScopeKey(scope: SessionScope | undefined): string {
  if (scope?.type !== "organization") {
    return "personal"
  }
  return `organization:${scope.organizationId}`
}

export interface WorkspaceSwitchPendingInput {
  connectionSettledWorkspaceKey: string | null
  connectionWorkspaceKey: string | null
  connectionsRefreshing: boolean
  currentScopeKey: string
  loadedSessionScopeKey: string | null
  organizationSkillsSettled: boolean
  targetScopeKey: string | null
}

export function isWorkspaceSwitchPending(input: WorkspaceSwitchPendingInput): boolean {
  if (!input.targetScopeKey) {
    return false
  }
  if (input.currentScopeKey !== input.targetScopeKey) {
    return true
  }
  if (input.loadedSessionScopeKey !== input.targetScopeKey) {
    return true
  }
  if (!input.connectionWorkspaceKey) {
    return true
  }
  if (input.connectionsRefreshing) {
    return true
  }
  if (input.connectionSettledWorkspaceKey !== input.connectionWorkspaceKey) {
    return true
  }
  return !input.organizationSkillsSettled
}

export interface WorkspaceSwitchTargetReachableInput {
  activeWorkspaceKey: string
  hasLoadedOrganizations: boolean
  loadingOrganizations: boolean
  organizationIds: readonly string[]
  targetScopeKey: string | null
}

export interface WorkspaceSwitchClearInput extends WorkspaceSwitchTargetReachableInput {
  workspaceSwitching: boolean
}

export function workspaceSwitchOrganizationId(scopeKey: string): string | null {
  const prefix = "organization:"
  if (!scopeKey.startsWith(prefix)) {
    return null
  }
  const organizationId = scopeKey.slice(prefix.length)
  return organizationId ? organizationId : null
}

export function isWorkspaceSwitchTargetReachable(input: WorkspaceSwitchTargetReachableInput): boolean {
  if (!input.targetScopeKey || input.targetScopeKey === "personal") {
    return true
  }
  if (input.activeWorkspaceKey === input.targetScopeKey) {
    return true
  }
  if (input.loadingOrganizations || !input.hasLoadedOrganizations) {
    return true
  }
  const organizationId = workspaceSwitchOrganizationId(input.targetScopeKey)
  return organizationId ? input.organizationIds.includes(organizationId) : false
}

export function shouldClearWorkspaceSwitchTarget(input: WorkspaceSwitchClearInput): boolean {
  if (!input.targetScopeKey) {
    return false
  }
  if (!isWorkspaceSwitchTargetReachable(input)) {
    return true
  }
  if (!input.workspaceSwitching) {
    return true
  }
  return false
}

export function projectContextFromProject(
  project: SessionProject | undefined,
  gitState?: GitRepositoryState | null,
): ChatProjectContext | undefined {
  if (!project) {
    return undefined
  }
  return {
    id: project.id,
    name: project.name,
    path: project.path,
    ...(gitState?.available && gitState.repositoryRoot
      ? {
          git: {
            repositoryRoot: gitState.repositoryRoot,
            ...(gitState.currentBranch ? { currentBranch: gitState.currentBranch } : {}),
            ...(gitState.detachedHead ? { detachedHead: gitState.detachedHead } : {}),
            dirty: gitState.dirty,
          },
        }
      : {}),
  }
}

export function activeProjectIdForComposer({
  activeSession,
  draftProjectId,
}: {
  activeSession?: SessionInfo
  draftProjectId: string | null
}): string | undefined {
  if (activeSession?.projectId) {
    return activeSession.projectId
  }
  if (draftProjectId === NO_DRAFT_PROJECT_ID) {
    return undefined
  }
  if (draftProjectId) {
    return draftProjectId
  }
  return undefined
}

export interface NewSessionTarget {
  projectId?: string
  sidebarSegment: "projects" | "tasks"
}

function validProjectId(projectId: string | null | undefined): string | undefined {
  const normalized = projectId?.trim()
  return normalized && normalized !== NO_DRAFT_PROJECT_ID ? normalized : undefined
}

export function resolveNewSessionTarget({
  activeSession,
  draftProjectId,
  explicitProjectId,
  lastProjectId,
  preferLastProject = false,
}: {
  activeSession?: Pick<SessionInfo, "projectId"> | null
  draftProjectId: string | null
  explicitProjectId?: string | null
  lastProjectId?: string | null
  preferLastProject?: boolean
}): NewSessionTarget {
  const projectId =
    validProjectId(explicitProjectId) ??
    validProjectId(activeSession?.projectId) ??
    validProjectId(draftProjectId) ??
    (preferLastProject ? validProjectId(lastProjectId) : undefined)
  return projectId ? { projectId, sidebarSegment: "projects" } : { sidebarSegment: "tasks" }
}

export function newSessionComposerDraftKey(scope: SessionScope | null, projectId: string | undefined): string {
  return `${NEW_SESSION_COMPOSER_DRAFT_KEY}:${sessionScopeKey(scope)}:${projectId ?? "none"}`
}

export function existingSessionComposerDraftKey(scopeKey: string, sessionId: string): string {
  return `session:${scopeKey}:${sessionId}`
}
