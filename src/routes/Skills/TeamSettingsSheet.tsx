import { XIcon } from "lucide-react"
import * as React from "react"
import { Button } from "@/components/ui/button"
import { useAppI18n } from "@/i18n"

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

export function TeamSettingsSheet({
  children,
  onClose,
  open,
  title,
}: {
  children: React.ReactNode
  onClose: () => void
  open: boolean
  title: string
}) {
  const { t } = useAppI18n()
  const sheetRef = React.useRef<HTMLElement | null>(null)

  React.useEffect(() => {
    if (!open) {
      return
    }

    const previousActiveElement = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const frame = window.requestAnimationFrame(() => {
      sheetRef.current?.focus()
    })

    return () => {
      window.cancelAnimationFrame(frame)
      if (previousActiveElement?.isConnected) {
        previousActiveElement.focus()
      }
    }
  }, [open])

  if (!open) {
    return null
  }

  return (
    <div
      className="oo-modal-backdrop fixed inset-0 z-[120] [-webkit-app-region:no-drag]"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <aside
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="absolute top-0 right-0 grid h-full w-[min(42rem,calc(100vw-2rem))] grid-rows-[auto_minmax(0,1fr)] border-l bg-background shadow-xl outline-none [-webkit-app-region:no-drag]"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation()
            onClose()
            return
          }
          if (event.key !== "Tab") {
            return
          }

          const sheet = sheetRef.current
          if (!sheet) {
            return
          }

          const focusableElements = getFocusableElements(sheet)
          if (focusableElements.length === 0) {
            event.preventDefault()
            sheet.focus()
            return
          }

          const firstElement = focusableElements[0]
          const lastElement = focusableElements[focusableElements.length - 1]
          const activeElement = document.activeElement
          if (event.shiftKey) {
            if (activeElement === firstElement || activeElement === sheet || !sheet.contains(activeElement)) {
              event.preventDefault()
              lastElement.focus()
            }
            return
          }

          if (activeElement === lastElement || activeElement === sheet || !sheet.contains(activeElement)) {
            event.preventDefault()
            firstElement.focus()
          }
        }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="oo-border-divider flex min-w-0 items-center justify-between gap-2 border-b px-3 py-2">
          <div className="oo-text-label min-w-0 truncate">{title}</div>
          <Button type="button" variant="ghost" size="icon" aria-label={t("common.close")} onClick={onClose}>
            <XIcon className="size-4" />
          </Button>
        </div>
        <div className="min-h-0 overflow-auto p-3">{children}</div>
      </aside>
    </div>
  )
}
