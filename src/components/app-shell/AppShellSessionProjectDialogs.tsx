import type { SessionInfo, SessionProject } from "../../../electron/session/common.ts"

import {
  ArchiveProjectDialog,
  ArchiveSessionDialog,
  RemoveProjectDialog,
  RenameProjectDialog,
  RenameSessionDialog,
} from "./AppShellDialogs.tsx"
import { SessionSearchOverlay } from "./SessionSearchOverlay.tsx"

export function AppShellSessionProjectDialogs({
  archiveConfirming,
  archiveProjectConfirming,
  archiveProjectTarget,
  archiveSession,
  onArchiveProject,
  onArchiveSession,
  onCloseArchiveProject,
  onCloseArchiveSession,
  onCloseRemoveProject,
  onCloseRenameProject,
  onCloseRenameSession,
  onCloseSearch,
  onRemoveProject,
  onRenameProject,
  onRenameSession,
  onSearchSelect,
  openSearch,
  removeProjectConfirming,
  removeProjectTarget,
  renameProjectTarget,
  renameSession,
  sessions,
}: {
  archiveConfirming: boolean
  archiveProjectConfirming: boolean
  archiveProjectTarget: SessionProject | null
  archiveSession: SessionInfo | null
  onArchiveProject: (project: SessionProject) => void
  onArchiveSession: (session: SessionInfo) => void
  onCloseArchiveProject: () => void
  onCloseArchiveSession: () => void
  onCloseRemoveProject: () => void
  onCloseRenameProject: () => void
  onCloseRenameSession: () => void
  onCloseSearch: () => void
  onRemoveProject: (project: SessionProject) => void
  onRenameProject: (projectId: string, name: string) => void
  onRenameSession: (sessionId: string, title: string) => void
  onSearchSelect: (session: SessionInfo) => void
  openSearch: boolean
  removeProjectConfirming: boolean
  removeProjectTarget: SessionProject | null
  renameProjectTarget: SessionProject | null
  renameSession: SessionInfo | null
  sessions: SessionInfo[]
}) {
  return (
    <>
      <SessionSearchOverlay sessions={sessions} open={openSearch} onClose={onCloseSearch} onSelect={onSearchSelect} />
      <RenameSessionDialog
        session={renameSession}
        open={Boolean(renameSession)}
        onClose={onCloseRenameSession}
        onRename={onRenameSession}
      />
      <RenameProjectDialog
        project={renameProjectTarget}
        open={Boolean(renameProjectTarget)}
        onClose={onCloseRenameProject}
        onRename={onRenameProject}
      />
      <ArchiveSessionDialog
        confirming={archiveConfirming}
        open={Boolean(archiveSession)}
        onClose={onCloseArchiveSession}
        onConfirm={() => {
          if (archiveSession) {
            onArchiveSession(archiveSession)
          }
        }}
      />
      <ArchiveProjectDialog
        confirming={archiveProjectConfirming}
        open={Boolean(archiveProjectTarget)}
        onClose={onCloseArchiveProject}
        onConfirm={() => {
          if (archiveProjectTarget) {
            onArchiveProject(archiveProjectTarget)
          }
        }}
      />
      <RemoveProjectDialog
        confirming={removeProjectConfirming}
        open={Boolean(removeProjectTarget)}
        onClose={onCloseRemoveProject}
        onConfirm={() => {
          if (removeProjectTarget) {
            onRemoveProject(removeProjectTarget)
          }
        }}
      />
    </>
  )
}
