import * as React from "react"
import { getFocusableElements } from "./skill-focus.ts"
import { isEmojiIcon, isImageIcon } from "./skill-route-model.ts"
import { AppIcons } from "@/components/AppIcons"
import { normalizeSkillIconSource } from "@/components/skill-icon-source.ts"
import { SkillIcon } from "@/components/SkillIcon"
import { Button } from "@/components/ui/button"
import { useAppI18n } from "@/i18n"
import { cn } from "@/lib/utils"

/** 技能页各 Tab 共用的可滚动内容区，预留双侧滚动条空间以保证列表留白对称。 */
export function SkillPageScrollArea({
  children,
  className,
  onScroll,
}: {
  children: React.ReactNode
  className?: string
  onScroll?: React.UIEventHandler<HTMLDivElement>
}) {
  return (
    <div
      className={cn("min-h-0 [scrollbar-gutter:stable_both-edges] overflow-auto px-3 py-3", className)}
      onScroll={onScroll}
    >
      {children}
    </div>
  )
}

export function SkillManagementSheet({
  children,
  onClose,
  title,
}: {
  children: React.ReactNode
  onClose: () => void
  title: string
}) {
  const { t } = useAppI18n()
  const sheetRef = React.useRef<HTMLElement | null>(null)

  React.useEffect(() => {
    const previousActiveElement = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const frame = window.requestAnimationFrame(() => {
      sheetRef.current?.focus()
    })

    return () => {
      window.cancelAnimationFrame(frame)
      previousActiveElement?.focus()
    }
  }, [])

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
        className="absolute top-0 right-0 grid h-full w-[min(30rem,calc(100vw-2rem))] grid-rows-[auto_minmax(0,1fr)] border-l bg-background shadow-xl [-webkit-app-region:no-drag]"
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
        <div className="oo-border-divider flex min-w-0 items-center justify-between gap-3 border-b px-3 py-2 [-webkit-app-region:no-drag]">
          <div className="oo-text-label min-w-0 truncate">{title}</div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t("skills.discoverCloseDetail")}
            className="[-webkit-app-region:no-drag]"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={onClose}
          >
            <AppIcons.action.cancel />
          </Button>
        </div>
        <div className="min-h-0 overflow-auto p-3">{children}</div>
      </aside>
    </div>
  )
}

export function SkillIconFrame({
  className,
  icon,
  iconClassName,
}: {
  className?: string
  icon?: string
  iconClassName?: string
}) {
  const normalizedIcon = normalizeSkillIconSource(icon)
  const frameClassName = cn(
    "flex size-10 shrink-0 items-center justify-center rounded-md border bg-background",
    className,
  )

  if (isImageIcon(normalizedIcon)) {
    return (
      <span className={cn(frameClassName, "overflow-hidden")}>
        <img alt="" src={normalizedIcon} className="size-full object-contain p-1.5" />
      </span>
    )
  }

  if (isEmojiIcon(normalizedIcon)) {
    return <span className={cn(frameClassName, "text-xl")}>{normalizedIcon}</span>
  }

  return (
    <span className={frameClassName}>
      <SkillIcon icon={normalizedIcon} className={cn("size-5", iconClassName)} />
    </span>
  )
}
