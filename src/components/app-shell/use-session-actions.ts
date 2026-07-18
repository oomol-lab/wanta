import type { SessionInfo } from "../../../electron/session/common.ts"

import * as React from "react"
import { toast } from "sonner"
import { useT } from "@/i18n/i18n"
import { reportRendererHandledError } from "@/lib/renderer-diagnostics"
import { resolveUserFacingError, userFacingErrorDescription } from "@/lib/user-facing-error"

export interface SessionActionsController {
  archiveConfirming: boolean
  archiveTarget: SessionInfo | null
  closeArchive: () => void
  closeRename: () => void
  handleArchive: (session: SessionInfo) => Promise<void>
  handlePin: (session: SessionInfo) => Promise<void>
  handleRename: (sessionId: string, title: string) => void
  renameTarget: SessionInfo | null
  requestArchive: (session: SessionInfo) => void
  requestRename: (session: SessionInfo) => void
  resetDialogs: () => void
}

export function useSessionActions({
  archive,
  clearAutoFallbackTitle,
  isSessionRunning,
  onArchived,
  pin,
  rename,
  sessions,
}: {
  archive: (sessionId: string) => Promise<void>
  clearAutoFallbackTitle: (sessionId: string) => void
  isSessionRunning: (sessionId: string) => boolean
  onArchived: (session: SessionInfo) => void
  pin: (sessionId: string, pinned: boolean) => Promise<void>
  rename: (sessionId: string, title: string) => Promise<void>
  sessions: SessionInfo[]
}): SessionActionsController {
  const t = useT()
  const [renameSessionId, setRenameSessionId] = React.useState<string | null>(null)
  const [archiveSessionId, setArchiveSessionId] = React.useState<string | null>(null)
  const [archiveConfirming, setArchiveConfirming] = React.useState(false)
  const renameTarget = sessions.find((session) => session.id === renameSessionId) ?? null
  const archiveTarget = sessions.find((session) => session.id === archiveSessionId) ?? null

  React.useEffect(() => {
    if (renameSessionId && !renameTarget) {
      setRenameSessionId(null)
    }
  }, [renameSessionId, renameTarget])
  React.useEffect(() => {
    if (archiveSessionId && !archiveTarget) {
      setArchiveSessionId(null)
    }
  }, [archiveSessionId, archiveTarget])

  const handlePin = React.useCallback(
    async (session: SessionInfo): Promise<void> => {
      try {
        await pin(session.id, !session.pinnedAt)
      } catch (cause) {
        showSessionError(cause, t)
      }
    },
    [pin, t],
  )
  const handleRename = React.useCallback(
    (sessionId: string, title: string): void => {
      clearAutoFallbackTitle(sessionId)
      void rename(sessionId, title).catch((cause: unknown) => {
        console.error("[wanta] rename session failed", cause)
        reportRendererHandledError("appShell.renameSession", "Failed to rename session", cause)
        toast.error(t("session.renameFailed"))
      })
    },
    [clearAutoFallbackTitle, rename, t],
  )
  const handleArchive = React.useCallback(
    async (session: SessionInfo): Promise<void> => {
      if (isSessionRunning(session.id)) {
        return
      }
      setArchiveConfirming(true)
      try {
        await archive(session.id)
        onArchived(session)
        setArchiveSessionId(null)
      } catch (cause) {
        showSessionError(cause, t)
      } finally {
        setArchiveConfirming(false)
      }
    },
    [archive, isSessionRunning, onArchived, t],
  )
  const resetDialogs = React.useCallback((): void => {
    setRenameSessionId(null)
    setArchiveSessionId(null)
  }, [])
  const closeArchive = React.useCallback((): void => setArchiveSessionId(null), [])
  const closeRename = React.useCallback((): void => setRenameSessionId(null), [])
  const requestArchive = React.useCallback(
    (session: SessionInfo): void => {
      if (!isSessionRunning(session.id)) {
        setArchiveSessionId(session.id)
      }
    },
    [isSessionRunning],
  )
  const requestRename = React.useCallback((session: SessionInfo): void => setRenameSessionId(session.id), [])

  return {
    archiveConfirming,
    archiveTarget,
    closeArchive,
    closeRename,
    handleArchive,
    handlePin,
    handleRename,
    renameTarget,
    requestArchive,
    requestRename,
    resetDialogs,
  }
}

function showSessionError(cause: unknown, t: ReturnType<typeof useT>): void {
  const notice = resolveUserFacingError(cause, { area: "session" })
  toast.error(userFacingErrorDescription(notice, t))
}
