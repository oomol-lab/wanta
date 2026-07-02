import type { SessionInfo, SessionProject } from "../../../electron/session/common.ts"

import { LoaderCircle } from "lucide-react"
import * as React from "react"
import { trimTitleToColumns } from "../../../electron/session/title.ts"
import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import { useT } from "@/i18n/i18n"

export function RenameSessionDialog({
  session,
  open,
  onClose,
  onRename,
}: {
  session: SessionInfo | null
  open: boolean
  onClose: () => void
  onRename: (sessionId: string, title: string) => void
}) {
  const t = useT()
  const inputRef = React.useRef<HTMLInputElement | null>(null)
  const [draft, setDraft] = React.useState("")
  const trimmedDraft = draft.trim()
  const canSave = Boolean(session && trimmedDraft)

  React.useEffect(() => {
    if (!open || !session) {
      return
    }
    setDraft(session.title)
    window.setTimeout(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }, 0)
  }, [open, session])

  if (!open || !session) {
    return null
  }

  const save = (): void => {
    if (!canSave) {
      return
    }
    const nextTitle = trimTitleToColumns(trimmedDraft)
    if (nextTitle !== session.title) {
      onRename(session.id, nextTitle)
    }
    onClose()
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="rename-session-title"
      aria-describedby="rename-session-description"
      className="oo-modal-backdrop fixed inset-0 z-[120] flex items-center justify-center p-5"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault()
          onClose()
        }
      }}
    >
      <form
        className="oo-modal-surface w-full max-w-[440px] rounded-xl p-6"
        onSubmit={(event) => {
          event.preventDefault()
          save()
        }}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 id="rename-session-title" className="oo-text-dialog-title text-foreground">
              {t("session.renameTitle")}
            </h2>
            <p id="rename-session-description" className="oo-text-caption mt-1 text-muted-foreground">
              {t("session.renameDescription")}
            </p>
          </div>
          <button
            type="button"
            aria-label={t("session.renameClose")}
            onClick={onClose}
            className="oo-icon-muted -mt-1 -mr-1 flex size-7 shrink-0 items-center justify-center rounded-md hover:bg-accent hover:text-foreground"
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>

        <input
          ref={inputRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          aria-label={t("session.renameInputLabel")}
          className="oo-text-value mt-6 block h-8 w-full min-w-0 border-0 bg-transparent p-0 text-foreground shadow-none ring-0 outline-none selection:bg-primary selection:text-primary-foreground placeholder:text-muted-foreground focus:border-0 focus:ring-0 focus:outline-none focus-visible:outline-none"
        />

        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" disabled={!canSave}>
            {t("common.save")}
          </Button>
        </div>
      </form>
    </div>
  )
}

export function ArchiveSessionDialog({
  confirming,
  open,
  onClose,
  onConfirm,
}: {
  confirming: boolean
  open: boolean
  onClose: () => void
  onConfirm: () => void
}) {
  const t = useT()

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!confirming) {
          onClose()
        }
      }}
      closeLabel={t("common.cancel")}
      title={t("session.archiveConfirmTitle")}
      footer={
        <>
          <Button type="button" variant="outline" disabled={confirming} onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="button" disabled={confirming} onClick={onConfirm}>
            {confirming ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
            {confirming ? t("session.archiveConfirming") : t("session.archiveConfirmAction")}
          </Button>
        </>
      }
    >
      <p className="oo-text-body text-muted-foreground">{t("session.archiveConfirmDescription")}</p>
    </Dialog>
  )
}

export function RenameProjectDialog({
  project,
  open,
  onClose,
  onRename,
}: {
  project: SessionProject | null
  open: boolean
  onClose: () => void
  onRename: (projectId: string, name: string) => void
}) {
  const t = useT()
  const inputRef = React.useRef<HTMLInputElement | null>(null)
  const formId = React.useId()
  const [draft, setDraft] = React.useState("")
  const trimmedDraft = draft.trim()
  const canSave = Boolean(project && trimmedDraft)

  React.useEffect(() => {
    if (!open || !project) {
      return
    }
    setDraft(project.name)
  }, [open, project])

  if (!open || !project) {
    return null
  }

  const save = (): void => {
    if (!canSave) {
      return
    }
    const nextName = trimTitleToColumns(trimmedDraft)
    if (nextName !== project.name) {
      onRename(project.id, nextName)
    }
    onClose()
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      closeLabel={t("common.close")}
      title={t("project.renameTitle")}
      description={t("project.renameDescription")}
      className="max-w-[440px]"
      initialFocus={() => {
        const input = inputRef.current
        input?.select()
        return input
      }}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form={formId} disabled={!canSave}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        onSubmit={(event) => {
          event.preventDefault()
          save()
        }}
      >
        <input
          ref={inputRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          aria-label={t("project.renameInputLabel")}
          className="oo-text-value block h-8 w-full min-w-0 border-0 bg-transparent p-0 text-foreground shadow-none ring-0 outline-none selection:bg-primary selection:text-primary-foreground placeholder:text-muted-foreground focus:border-0 focus:ring-0 focus:outline-none focus-visible:outline-none"
        />
      </form>
    </Dialog>
  )
}

export function ArchiveProjectDialog({
  confirming,
  open,
  onClose,
  onConfirm,
}: {
  confirming: boolean
  open: boolean
  onClose: () => void
  onConfirm: () => void
}) {
  const t = useT()

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!confirming) {
          onClose()
        }
      }}
      closeLabel={t("common.cancel")}
      title={t("project.archiveConfirmTitle")}
      footer={
        <>
          <Button type="button" variant="outline" disabled={confirming} onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="button" disabled={confirming} onClick={onConfirm}>
            {confirming ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
            {confirming ? t("project.archiveConfirming") : t("project.archiveConfirmAction")}
          </Button>
        </>
      }
    >
      <p className="oo-text-body text-muted-foreground">{t("project.archiveConfirmDescription")}</p>
    </Dialog>
  )
}

export function RemoveProjectDialog({
  confirming,
  open,
  onClose,
  onConfirm,
}: {
  confirming: boolean
  open: boolean
  onClose: () => void
  onConfirm: () => void
}) {
  const t = useT()

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!confirming) {
          onClose()
        }
      }}
      closeLabel={t("common.cancel")}
      title={t("project.removeConfirmTitle")}
      footer={
        <>
          <Button type="button" variant="outline" disabled={confirming} onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="button" variant="destructive" disabled={confirming} onClick={onConfirm}>
            {confirming ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
            {confirming ? t("project.removeConfirming") : t("project.removeConfirmAction")}
          </Button>
        </>
      }
    >
      <p className="oo-text-body text-muted-foreground">{t("project.removeConfirmDescription")}</p>
    </Dialog>
  )
}

export function EditableTitlebarTitle({
  title,
  editable,
  onRename,
}: {
  title: string
  editable: boolean
  onRename: (title: string) => void
}) {
  const t = useT()
  const inputRef = React.useRef<HTMLInputElement | null>(null)
  const cancelNextBlur = React.useRef(false)
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(title)

  React.useEffect(() => {
    if (!editing) {
      setDraft(title)
    }
  }, [editing, title])

  React.useEffect(() => {
    if (!editing) {
      return
    }
    window.setTimeout(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }, 0)
  }, [editing])

  const startEditing = (): void => {
    if (!editable) {
      return
    }
    setDraft(title)
    setEditing(true)
  }
  const handleRenameKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === "F2" || event.key === "Enter") {
      event.preventDefault()
      startEditing()
    }
  }

  const commit = (): void => {
    const trimmedDraft = draft.trim()
    setEditing(false)
    if (!trimmedDraft) {
      return
    }
    const nextTitle = trimTitleToColumns(trimmedDraft)
    if (nextTitle && nextTitle !== title) {
      onRename(nextTitle)
    }
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (cancelNextBlur.current) {
            cancelNextBlur.current = false
            return
          }
          commit()
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault()
            commit()
          } else if (event.key === "Escape") {
            event.preventDefault()
            cancelNextBlur.current = true
            setDraft(title)
            setEditing(false)
          }
        }}
        aria-label={t("session.renameInputLabel")}
        className="oo-toolbar-title oo-text-title block h-[var(--oo-line-control)] w-full min-w-0 border-0 bg-transparent p-0 shadow-none ring-0 outline-none [-webkit-app-region:no-drag] selection:bg-primary selection:text-primary-foreground focus:border-0 focus:ring-0 focus:outline-none focus-visible:outline-none"
      />
    )
  }

  if (!editable) {
    return (
      <span className="oo-toolbar-title oo-text-title inline-block max-w-full min-w-0 truncate" title={title}>
        {title}
      </span>
    )
  }

  return (
    <button
      type="button"
      onDoubleClick={startEditing}
      onKeyDown={handleRenameKeyDown}
      title={title}
      aria-label={t("session.renameFromTitlebar")}
      className="oo-toolbar-title oo-text-title inline-block max-w-full min-w-0 cursor-pointer truncate border-0 bg-transparent p-0 text-left outline-none [-webkit-app-region:no-drag]"
    >
      {title}
    </button>
  )
}
