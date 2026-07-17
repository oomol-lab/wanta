import type { SessionInfo, SessionProject, SessionScope } from "../../../electron/session/common.ts"
import type { AppShellRoute } from "./app-shell-types.ts"
import type { SidebarSegment } from "./sidebar-persistence.ts"

import * as React from "react"
import { toast } from "sonner"
import { newSessionComposerDraftKey, NO_DRAFT_PROJECT_ID, resolveNewSessionTarget } from "./app-shell-model.ts"
import { useT } from "@/i18n/i18n"
import { resolveUserFacingError, userFacingErrorDescription } from "@/lib/user-facing-error"

type ProjectSelectionSource = "composer" | "sidebar"

export interface ComposerNavigationController {
  handleNewSession: () => void
  handleNewTaskSession: () => void
  handleOpenProjectDraft: (project: SessionProject) => void
  handleSelectComposerProject: (projectId: string | undefined) => Promise<void>
  handleSelectComposerProjectFolder: () => Promise<void>
  handleSelectProjectFolder: () => Promise<void>
  handleSelectSession: (session: SessionInfo) => void
  requestComposerFocus: () => void
}

export function useComposerNavigation({
  activeChatSessionId,
  activeSession,
  assignSessionProject,
  clearComposerDraft,
  createProject,
  draftProjectId,
  isDraftSession,
  lastProjectId,
  route,
  sessionScope,
  setComposerFocusRequest,
  setDraftPermissionMode,
  setDraftProjectId,
  setIsDraftSession,
  setPendingChatTransition,
  setRoute,
  setSearchOpen,
  setSelectedSessionId,
  setSidebarSegment,
  sidebarSegment,
}: {
  activeChatSessionId: string | null
  activeSession?: SessionInfo
  assignSessionProject: (sessionId: string, projectId: string | undefined) => Promise<void>
  clearComposerDraft: (draftKey: string) => void
  createProject: (input: { name: string; path: string }) => Promise<SessionProject>
  draftProjectId: string | null
  isDraftSession: boolean
  lastProjectId: () => string | null
  route: AppShellRoute
  sessionScope: SessionScope | null
  setComposerFocusRequest: React.Dispatch<React.SetStateAction<number>>
  setDraftPermissionMode: React.Dispatch<React.SetStateAction<"default" | "full_access">>
  setDraftProjectId: React.Dispatch<React.SetStateAction<string | null>>
  setIsDraftSession: React.Dispatch<React.SetStateAction<boolean>>
  setPendingChatTransition: React.Dispatch<
    React.SetStateAction<import("./pending-chat.ts").PendingChatTransition | null>
  >
  setRoute: React.Dispatch<React.SetStateAction<AppShellRoute>>
  setSearchOpen: React.Dispatch<React.SetStateAction<boolean>>
  setSelectedSessionId: React.Dispatch<React.SetStateAction<string | null>>
  setSidebarSegment: React.Dispatch<React.SetStateAction<SidebarSegment>>
  sidebarSegment: SidebarSegment
}): ComposerNavigationController {
  const t = useT()
  const startNewSessionDraft = React.useCallback(
    (target: ReturnType<typeof resolveNewSessionTarget>, clearTargetDraft = true): void => {
      if (clearTargetDraft) {
        clearComposerDraft(newSessionComposerDraftKey(sessionScope, target.projectId))
      }
      setSelectedSessionId(null)
      setIsDraftSession(true)
      setDraftPermissionMode("default")
      setDraftProjectId(target.projectId ?? NO_DRAFT_PROJECT_ID)
      setPendingChatTransition(null)
      setRoute("chat")
      setSidebarSegment(target.sidebarSegment)
      setSearchOpen(false)
      setComposerFocusRequest((request) => request + 1)
    },
    [
      clearComposerDraft,
      sessionScope,
      setComposerFocusRequest,
      setDraftPermissionMode,
      setDraftProjectId,
      setIsDraftSession,
      setPendingChatTransition,
      setRoute,
      setSearchOpen,
      setSelectedSessionId,
      setSidebarSegment,
    ],
  )
  const handleNewSession = React.useCallback((): void => {
    startNewSessionDraft(
      resolveNewSessionTarget({
        activeSession,
        draftProjectId,
        lastProjectId: lastProjectId(),
        preferLastProject: route !== "chat",
        sidebarSegment,
      }),
    )
  }, [activeSession, draftProjectId, lastProjectId, route, sidebarSegment, startNewSessionDraft])
  const handleNewTaskSession = React.useCallback((): void => {
    startNewSessionDraft({ sidebarSegment: "tasks" })
  }, [startNewSessionDraft])
  const handleOpenProjectDraft = React.useCallback(
    (project: SessionProject): void => {
      // 项目入口用于切换当前草稿；仅“新建会话”操作才会显式清空该项目已有草稿。
      startNewSessionDraft(resolveNewSessionTarget({ draftProjectId, explicitProjectId: project.id }), false)
    },
    [draftProjectId, startNewSessionDraft],
  )
  const handleSelectComposerProject = React.useCallback(
    async (projectId: string | undefined): Promise<void> => {
      if (activeChatSessionId && !isDraftSession) {
        try {
          await assignSessionProject(activeChatSessionId, projectId)
          setSidebarSegment(projectId ? "projects" : "tasks")
        } catch (cause) {
          showSessionError(cause, t)
        }
        return
      }
      setDraftProjectId(projectId ?? NO_DRAFT_PROJECT_ID)
      setIsDraftSession(true)
      setRoute("chat")
      setSidebarSegment(projectId ? "projects" : "tasks")
    },
    [
      activeChatSessionId,
      assignSessionProject,
      isDraftSession,
      setDraftProjectId,
      setIsDraftSession,
      setRoute,
      setSidebarSegment,
      t,
    ],
  )
  const handleCreatedProject = React.useCallback(
    async (project: SessionProject, source: ProjectSelectionSource): Promise<void> => {
      if (source === "composer") {
        await handleSelectComposerProject(project.id)
      } else {
        handleOpenProjectDraft(project)
      }
    },
    [handleOpenProjectDraft, handleSelectComposerProject],
  )
  const handleSelectProjectDirectory = React.useCallback(
    async (source: ProjectSelectionSource): Promise<void> => {
      releaseTransientFocus()
      const picker = globalThis.wanta?.selectProjectDirectory
      if (!picker) {
        toast.error(t("project.folderPickerUnavailable"))
        return
      }
      try {
        const directory = await picker()
        if (directory) {
          await handleCreatedProject(await createProject({ name: directory.name, path: directory.path }), source)
        }
      } catch (cause) {
        showSessionError(cause, t)
      } finally {
        releaseTransientFocus()
      }
    },
    [createProject, handleCreatedProject, t],
  )
  const handleSelectSession = React.useCallback(
    (session: SessionInfo): void => {
      setSelectedSessionId(session.id)
      setIsDraftSession(false)
      setDraftProjectId(null)
      setRoute("chat")
      setSidebarSegment(session.projectId ? "projects" : "tasks")
    },
    [setDraftProjectId, setIsDraftSession, setRoute, setSelectedSessionId, setSidebarSegment],
  )
  const requestComposerFocus = React.useCallback((): void => {
    setRoute("chat")
    setSearchOpen(false)
    setComposerFocusRequest((request) => request + 1)
  }, [setComposerFocusRequest, setRoute, setSearchOpen])
  const handleSelectComposerProjectFolder = React.useCallback(
    (): Promise<void> => handleSelectProjectDirectory("composer"),
    [handleSelectProjectDirectory],
  )
  const handleSelectProjectFolder = React.useCallback(
    (): Promise<void> => handleSelectProjectDirectory("sidebar"),
    [handleSelectProjectDirectory],
  )

  return {
    handleNewSession,
    handleNewTaskSession,
    handleOpenProjectDraft,
    handleSelectComposerProject,
    handleSelectComposerProjectFolder,
    handleSelectProjectFolder,
    handleSelectSession,
    requestComposerFocus,
  }
}

function releaseTransientFocus(): void {
  const blurActiveElement = (): void => {
    const activeElement = document.activeElement
    if (activeElement instanceof HTMLElement) {
      activeElement.blur()
    }
  }
  blurActiveElement()
  window.requestAnimationFrame(blurActiveElement)
}

function showSessionError(cause: unknown, t: ReturnType<typeof useT>): void {
  const notice = resolveUserFacingError(cause, { area: "session" })
  toast.error(userFacingErrorDescription(notice, t))
}
