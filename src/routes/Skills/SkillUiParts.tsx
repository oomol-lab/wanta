import * as React from "react"
import { isEmojiIcon, isImageIcon } from "./skill-route-model.ts"
import { ManagementSheet } from "@/components/ManagementSheet"
import { normalizeSkillIconSource } from "@/components/skill-icon-source.ts"
import { SkillIcon } from "@/components/SkillIcon"
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
  ariaLabel,
  children,
  onClose,
  fallbackFocus,
  subjectName,
  title,
}: {
  ariaLabel?: string
  children: React.ReactNode
  onClose: () => void
  fallbackFocus?: () => HTMLElement | null
  subjectName: string
  title?: string
}) {
  const { t } = useAppI18n()
  return (
    <ManagementSheet
      title={title ?? t("skills.managementTitle")}
      ariaLabel={ariaLabel ?? t("skills.managementDialogLabel", { name: subjectName })}
      onClose={onClose}
      fallbackFocus={fallbackFocus}
    >
      {children}
    </ManagementSheet>
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
        <img alt="" src={normalizedIcon} loading="lazy" decoding="async" className="size-full object-contain p-1.5" />
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
