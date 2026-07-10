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

  React.useEffect(() => {
    if (!open) {
      return
    }
    const frame = window.requestAnimationFrame(() => {
      menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [menuRef, open])

  const handleMenuKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>): void => {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
        return
      }
      const items = [
        ...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []),
      ]
      if (items.length === 0) {
        return
      }
      event.preventDefault()
      const currentIndex = items.findIndex((item) => item === document.activeElement)
      const direction = event.key === "ArrowDown" ? 1 : -1
      const nextIndex =
        currentIndex < 0
          ? direction > 0
            ? 0
            : items.length - 1
          : (currentIndex + direction + items.length) % items.length
      items[nextIndex]?.focus()
    },
    [menuRef],
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
          aria-haspopup="menu"
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
              role="menu"
              style={menuStyle}
              className="fixed z-[130] rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
              onKeyDown={handleMenuKeyDown}
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
      role="menuitem"
      disabled={disabled}
      className="relative flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
      onClick={onClick}
    >
      {children}
    </button>
  )
}
