import { File as FileIcon, Folder, Plus } from "lucide-react"
import * as React from "react"
import { createPortal } from "react-dom"
import { useComposerMenu } from "./useComposerMenu.ts"
import { PromptInputTools } from "@/components/ai-elements/prompt-input"
import { Button } from "@/components/ui/button"
import { useT } from "@/i18n/i18n"

interface ComposerAttachmentMenuProps {
  disabled: boolean
  fileInputRef: React.RefObject<HTMLInputElement | null>
  onFileInputChange: (event: React.ChangeEvent<HTMLInputElement>) => void
  onSelectDirectory: () => Promise<void> | void
  onSelectFile: () => Promise<void> | void
}

export function ComposerAttachmentMenu({
  disabled,
  fileInputRef,
  onFileInputChange,
  onSelectDirectory,
  onSelectFile,
}: ComposerAttachmentMenuProps) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const { closeMenu, handleTriggerKeyDown, menuRef, menuStyle, rootRef, toggleMenu, triggerRef } = useComposerMenu({
    align: "left",
    disabled,
    gap: 8,
    margin: 8,
    minHeight: 80,
    open,
    setOpen,
    width: 160,
  })

  const selectAndClose = React.useCallback(
    (select: () => Promise<void> | void): void => {
      if (disabled) {
        return
      }
      closeMenu(false)
      void select()
    },
    [closeMenu, disabled],
  )

  return (
    <PromptInputTools className="shrink-0 justify-start">
      <input ref={fileInputRef} type="file" multiple className="hidden" onChange={onFileInputChange} />
      <div ref={rootRef} className="relative">
        <Button
          ref={triggerRef}
          type="button"
          variant="ghost"
          size="icon"
          title={t("chat.attachFile")}
          aria-label={t("chat.attachFile")}
          aria-expanded={open}
          disabled={disabled}
          className="size-8 rounded-full"
          onClick={toggleMenu}
          onKeyDown={handleTriggerKeyDown}
        >
          <Plus className="size-4" />
        </Button>
      </div>
      {open
        ? createPortal(
            <div
              ref={menuRef}
              style={menuStyle}
              className="fixed z-[130] rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
            >
              <AttachmentMenuButton disabled={disabled} onClick={() => selectAndClose(onSelectFile)}>
                <FileIcon className="size-4" />
                {t("chat.attachFileAction")}
              </AttachmentMenuButton>
              <AttachmentMenuButton disabled={disabled} onClick={() => selectAndClose(onSelectDirectory)}>
                <Folder className="size-4" />
                {t("chat.attachFolderAction")}
              </AttachmentMenuButton>
            </div>,
            document.body,
          )
        : null}
    </PromptInputTools>
  )
}

function AttachmentMenuButton({
  children,
  disabled = false,
  onClick,
}: {
  children: React.ReactNode
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      className="relative flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
      onClick={onClick}
    >
      {children}
    </button>
  )
}
