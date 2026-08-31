import { X } from "lucide-react"
import { Dialog as DialogPrimitive } from "radix-ui"
import * as React from "react"
import { cn } from "@/lib/utils"

export interface DialogProps {
  open: boolean
  onClose: () => void
  title: React.ReactNode
  description?: React.ReactNode
  children: React.ReactNode
  footer?: React.ReactNode
  ariaLabel?: string
  closeLabel?: string
  className?: string
  contentClassName?: string
  headerHidden?: boolean
  initialFocus?: () => HTMLElement | null
  titleId?: string
}

function DialogTitle({ children, className, id }: { children: React.ReactNode; className?: string; id: string }) {
  if (typeof children === "string") {
    return (
      <DialogPrimitive.Title id={id} className={className}>
        {children}
      </DialogPrimitive.Title>
    )
  }

  return (
    <DialogPrimitive.Title asChild>
      <div id={id} className={className}>
        {children}
      </div>
    </DialogPrimitive.Title>
  )
}

/** Radix-backed modal that preserves Wanta's compact title/content/footer API and visual tokens. */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  ariaLabel,
  closeLabel,
  className,
  contentClassName,
  headerHidden = false,
  initialFocus,
  titleId: titleIdProp,
}: DialogProps) {
  const panelRef = React.useRef<HTMLDivElement>(null)
  const initialFocusRef = React.useRef(initialFocus)
  const generatedTitleId = React.useId()
  const generatedDescriptionId = React.useId()
  const titleId = titleIdProp ?? generatedTitleId

  React.useEffect(() => {
    initialFocusRef.current = initialFocus
  }, [initialFocus])

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onClose()
        }
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          data-slot="dialog-overlay"
          className="oo-modal-backdrop fixed inset-0 z-[120] [-webkit-app-region:no-drag]"
        />
        <DialogPrimitive.Content
          ref={panelRef}
          data-slot="dialog-content"
          aria-modal="true"
          aria-label={ariaLabel}
          aria-labelledby={ariaLabel ? undefined : titleId}
          aria-describedby={description ? generatedDescriptionId : undefined}
          onOpenAutoFocus={(event) => {
            const requestedFocus = initialFocusRef.current?.()
            if (requestedFocus && panelRef.current?.contains(requestedFocus)) {
              event.preventDefault()
              requestedFocus.focus()
            }
          }}
          className={cn(
            "oo-modal-surface fixed top-1/2 left-1/2 z-[121] flex max-h-[85vh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border text-popover-foreground outline-none [-webkit-app-region:no-drag]",
            className,
          )}
        >
          {headerHidden ? (
            <div className="sr-only">
              <DialogTitle id={titleId}>{title}</DialogTitle>
              {description ? (
                <DialogPrimitive.Description id={generatedDescriptionId}>{description}</DialogPrimitive.Description>
              ) : null}
            </div>
          ) : (
            <div className="oo-border-divider flex items-start justify-between gap-3 border-b px-4 py-3">
              <div className="min-w-0">
                <DialogTitle id={titleId} className="oo-text-dialog-title truncate">
                  {title}
                </DialogTitle>
                {description ? (
                  <DialogPrimitive.Description id={generatedDescriptionId} className="oo-text-caption mt-0.5">
                    {description}
                  </DialogPrimitive.Description>
                ) : null}
              </div>
              <DialogPrimitive.Close
                aria-label={closeLabel ?? "Close"}
                className="oo-icon-muted -mr-1 flex size-7 shrink-0 items-center justify-center rounded-md hover:bg-accent hover:text-foreground"
              >
                <X className="size-4" />
              </DialogPrimitive.Close>
            </div>
          )}

          <div className={cn("min-h-0 flex-1 overflow-y-auto px-4 py-4", contentClassName)}>{children}</div>

          {footer ? <div className="oo-border-divider flex justify-end gap-2 border-t px-4 py-3">{footer}</div> : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
