import type { SessionProject } from "../../../electron/session/common.ts"

import * as React from "react"
import { toast } from "sonner"
import { useChatService } from "@/components/AppContext"
import { useT } from "@/i18n/i18n"
import { reportRendererHandledError } from "@/lib/renderer-diagnostics"
import { resolveUserFacingError, userFacingErrorDescription } from "@/lib/user-facing-error"

export interface ProjectActionsController {
  archiveConfirming: boolean
  archiveTarget: SessionProject | null
  closeArchive: () => void
  closeRemove: () => void
  closeRename: () => void
  handleArchive: (project: SessionProject) => Promise<void>
  handlePin: (project: SessionProject) => Promise<void>
  handleRemove: (project: SessionProject) => Promise<void>
  handleRename: (projectId: string, name: string) => Promise<void>
  handleShowInFolder: (project: SessionProject) => void
  removeConfirming: boolean
  removeTarget: SessionProject | null
  renameTarget: SessionProject | null
  requestArchive: (project: SessionProject) => void
  requestRemove: (project: SessionProject) => void
  requestRename: (project: SessionProject) => void
  resetDialogs: () => void
}

export function useProjectActions({
  archiveProject,
  onProjectUnavailable,
  pinProject,
  projects,
  removeProject,
  renameProject,
}: {
  archiveProject: (projectId: string) => Promise<void>
  onProjectUnavailable: (projectId: string) => void
  pinProject: (projectId: string, pinned: boolean) => Promise<void>
  projects: SessionProject[]
  removeProject: (projectId: string) => Promise<void>
  renameProject: (projectId: string, name: string) => Promise<void>
}): ProjectActionsController {
  const t = useT()
  const chatService = useChatService()
  const [renameProjectId, setRenameProjectId] = React.useState<string | null>(null)
  const [archiveProjectId, setArchiveProjectId] = React.useState<string | null>(null)
  const [removeProjectId, setRemoveProjectId] = React.useState<string | null>(null)
  const [archiveConfirming, setArchiveConfirming] = React.useState(false)
  const [removeConfirming, setRemoveConfirming] = React.useState(false)
  const renameTarget = projects.find((project) => project.id === renameProjectId) ?? null
  const archiveTarget = projects.find((project) => project.id === archiveProjectId) ?? null
  const removeTarget = projects.find((project) => project.id === removeProjectId) ?? null

  React.useEffect(() => {
    if (renameProjectId && !renameTarget) {
      setRenameProjectId(null)
    }
  }, [renameProjectId, renameTarget])
  React.useEffect(() => {
    if (archiveProjectId && !archiveTarget) {
      setArchiveProjectId(null)
    }
  }, [archiveProjectId, archiveTarget])
  React.useEffect(() => {
    if (removeProjectId && !removeTarget) {
      setRemoveProjectId(null)
    }
  }, [removeProjectId, removeTarget])

  const handlePin = React.useCallback(
    async (project: SessionProject): Promise<void> => {
      try {
        await pinProject(project.id, !project.pinnedAt)
      } catch (cause) {
        showSessionError(cause, t)
      }
    },
    [pinProject, t],
  )
  const handleRename = React.useCallback(
    async (projectId: string, name: string): Promise<void> => {
      try {
        await renameProject(projectId, name)
      } catch (cause) {
        showSessionError(cause, t)
      }
    },
    [renameProject, t],
  )
  const handleShowInFolder = React.useCallback(
    (project: SessionProject): void => {
      void chatService.invoke("showLocalPathInFolder", { path: project.path }).catch((cause: unknown) => {
        reportRendererHandledError("appShell.showProjectInFolder", "Failed to reveal project folder", cause)
        const notice = resolveUserFacingError(cause, { area: "artifact" })
        toast.error(userFacingErrorDescription(notice, t))
      })
    },
    [chatService, t],
  )
  const handleArchive = React.useCallback(
    async (project: SessionProject): Promise<void> => {
      setArchiveConfirming(true)
      try {
        await archiveProject(project.id)
        onProjectUnavailable(project.id)
        setArchiveProjectId(null)
      } catch (cause) {
        showSessionError(cause, t)
      } finally {
        setArchiveConfirming(false)
      }
    },
    [archiveProject, onProjectUnavailable, t],
  )
  const handleRemove = React.useCallback(
    async (project: SessionProject): Promise<void> => {
      setRemoveConfirming(true)
      try {
        await removeProject(project.id)
        onProjectUnavailable(project.id)
        setRemoveProjectId(null)
      } catch (cause) {
        showSessionError(cause, t)
      } finally {
        setRemoveConfirming(false)
      }
    },
    [onProjectUnavailable, removeProject, t],
  )
  const resetDialogs = React.useCallback((): void => {
    setRenameProjectId(null)
    setArchiveProjectId(null)
    setRemoveProjectId(null)
  }, [])
  const closeArchive = React.useCallback((): void => setArchiveProjectId(null), [])
  const closeRemove = React.useCallback((): void => setRemoveProjectId(null), [])
  const closeRename = React.useCallback((): void => setRenameProjectId(null), [])
  const requestArchive = React.useCallback((project: SessionProject): void => setArchiveProjectId(project.id), [])
  const requestRemove = React.useCallback((project: SessionProject): void => setRemoveProjectId(project.id), [])
  const requestRename = React.useCallback((project: SessionProject): void => setRenameProjectId(project.id), [])

  return {
    archiveConfirming,
    archiveTarget,
    closeArchive,
    closeRemove,
    closeRename,
    handleArchive,
    handlePin,
    handleRemove,
    handleRename,
    handleShowInFolder,
    removeConfirming,
    removeTarget,
    renameTarget,
    requestArchive,
    requestRemove,
    requestRename,
    resetDialogs,
  }
}

function showSessionError(cause: unknown, t: ReturnType<typeof useT>): void {
  const notice = resolveUserFacingError(cause, { area: "session" })
  toast.error(userFacingErrorDescription(notice, t))
}
