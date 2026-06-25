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

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  const selector = [
    "a[href]",
    "button:not([disabled])",
    "input:not([disabled])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    '[tabindex]:not([tabindex="-1"])',
  ].join(",")

  return Array.from(container.querySelectorAll<HTMLElement>(selector)).filter((element) => {
    return (
      !element.hasAttribute("disabled") &&
      element.getAttribute("aria-hidden") !== "true" &&
      element.getClientRects().length > 0
    )
  })
}

function isPortalKeyboardOwner(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    Boolean(target.closest('[data-slot="select-content"], [data-slot="dropdown-menu-content"]'))
  )
}

/** 轻量模态：portal + 遮罩 + Esc 关闭 + 焦点循环 / 恢复。无 Radix 依赖。 */
export function Dialog({ open, onClose, title, description, children, footer, closeLabel, className }: DialogProps) {
  const panelRef = React.useRef<HTMLDivElement>(null)
  const onCloseRef = React.useRef(onClose)

  React.useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  React.useEffect(() => {
    if (!open) {
      return
    }
    const previousActiveElement = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const onKey = (e: KeyboardEvent): void => {
      if (isPortalKeyboardOwner(e.target)) {
        return
      }

      if (e.key === "Escape") {
        e.preventDefault()
        e.stopPropagation()
        onCloseRef.current()
        return
      }

      if (e.key !== "Tab") {
        return
      }

      const panel = panelRef.current
      if (!panel) {
        return
      }
      const focusableElements = getFocusableElements(panel)
      if (focusableElements.length === 0) {
        e.preventDefault()
        panel.focus()
        return
      }

      const firstElement = focusableElements[0]
      const lastElement = focusableElements[focusableElements.length - 1]
      const activeElement = document.activeElement
      if (e.shiftKey) {
        if (activeElement === firstElement || activeElement === panel || !panel.contains(activeElement)) {
          e.preventDefault()
          lastElement.focus()
        }
        return
      }

      if (activeElement === lastElement || activeElement === panel || !panel.contains(activeElement)) {
        e.preventDefault()
        firstElement.focus()
      }
    }
    document.addEventListener("keydown", onKey)
    // 挂载后优先聚焦第一个控件；没有控件时聚焦面板本身。
    const frame = window.requestAnimationFrame(() => {
      const panel = panelRef.current
      if (!panel) {
        return
      }
      ;(getFocusableElements(panel)[0] ?? panel).focus()
    })
    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener("keydown", onKey)
      if (previousActiveElement?.isConnected) {
        previousActiveElement.focus()
      }
    }
  }, [open])

  if (!open) {
    return null
  }

  return createPortal(
    <div
      className="oo-modal-backdrop fixed inset-0 z-[120] flex items-center justify-center p-4"
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
          "oo-modal-surface flex max-h-[85vh] w-full max-w-lg flex-col rounded-lg border text-popover-foreground outline-none",
          className,
        )}
      >
        <div className="oo-border-divider flex items-start justify-between gap-3 border-b px-4 py-3">
          <div className="min-w-0">
            <h2 className="oo-text-dialog-title truncate">{title}</h2>
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
