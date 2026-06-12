import { X } from "lucide-react"
import * as React from "react"
import { createPortal } from "react-dom"
import { cn } from "@/lib/utils"

export interface DialogProps {
  open: boolean
  onClose: () => void
  title: React.ReactNode
  description?: React.ReactNode
  children: React.ReactNode
  footer?: React.ReactNode
  closeLabel?: string
  className?: string
}

/** 轻量模态：portal + 遮罩 + Esc 关闭 + 挂载聚焦。无 Radix 依赖。 */
export function Dialog({ open, onClose, title, description, children, footer, closeLabel, className }: DialogProps) {
  const panelRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (!open) {
      return
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        onClose()
      }
    }
    document.addEventListener("keydown", onKey)
    // 挂载后聚焦面板，便于 Esc / 表单内首个输入接管。
    panelRef.current?.focus()
    return () => document.removeEventListener("keydown", onKey)
  }, [open, onClose])

  if (!open) {
    return null
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "color-mix(in oklab, var(--foreground) 28%, transparent)" }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          onClose()
        }
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        className={cn(
          "oo-border-divider flex max-h-[85vh] w-full max-w-lg flex-col rounded-xl border bg-popover shadow-xl outline-none",
          className,
        )}
      >
        <div className="oo-border-divider flex items-start justify-between gap-3 border-b px-4 py-3">
          <div className="min-w-0">
            <h2 className="oo-text-title truncate">{title}</h2>
            {description && <p className="oo-text-caption mt-0.5">{description}</p>}
          </div>
          <button
            type="button"
            aria-label={closeLabel ?? "Close"}
            onClick={onClose}
            className="oo-icon-muted -mr-1 flex size-7 shrink-0 items-center justify-center rounded-md hover:bg-accent hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">{children}</div>

        {footer && <div className="oo-border-divider flex justify-end gap-2 border-t px-4 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}
