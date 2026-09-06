import * as React from "react"
import { Dialog } from "@/components/ui/dialog"
import { useAppI18n } from "@/i18n"
import { cn } from "@/lib/utils"

/** Shared drawer layout; Radix owns modal focus, keyboard handling and nested layers. */
export function ManagementSheet({
  children,
  title,
  ariaLabel,
  onClose,
  fallbackFocus,
  open = true,
  wide = false,
}: {
  children: React.ReactNode
  title: string
  ariaLabel?: string
  onClose: () => void
  fallbackFocus?: () => HTMLElement | null
  open?: boolean
  wide?: boolean
}) {
  const { t } = useAppI18n()
  const contentRef = React.useRef<HTMLDivElement>(null)
  return (
    <Dialog
      open={open}
      onClose={onClose}
      fallbackFocus={fallbackFocus}
      title={title}
      ariaLabel={ariaLabel}
      closeLabel={t("common.close")}
      className={cn(
        "top-0 right-0 left-auto h-full max-h-none max-w-none translate-x-0 translate-y-0 rounded-none border-0 border-l bg-background shadow-xl",
        wide ? "w-[min(42rem,calc(100vw-2rem))]" : "w-[min(30rem,calc(100vw-2rem))]",
      )}
      contentClassName="p-3"
      initialFocus={() => contentRef.current}
    >
      <div ref={contentRef} tabIndex={-1} className="outline-none">
        {children}
      </div>
    </Dialog>
  )
}
