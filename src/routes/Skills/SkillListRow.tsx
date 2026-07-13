import * as React from "react"
import { cn } from "@/lib/utils"

interface SkillListRowProps {
  actions?: React.ReactNode
  badges?: React.ReactNode
  description?: React.ReactNode
  icon: React.ReactNode
  meta?: React.ReactNode
  onSelect?: () => void
  selected?: boolean
  showTrailingDivider?: boolean
  subtitle?: React.ReactNode
  title: React.ReactNode
}

export function SkillListRow({
  actions,
  badges,
  description,
  icon,
  meta,
  onSelect,
  selected = false,
  showTrailingDivider = false,
  subtitle,
  title,
}: SkillListRowProps) {
  const content = (
    <>
      {icon}
      <div className="grid min-w-0 gap-0.5">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
          <div className="oo-text-label min-w-0 truncate text-foreground">{title}</div>
          {subtitle ? <div className="oo-text-caption min-w-0 truncate text-muted-foreground">{subtitle}</div> : null}
          {badges}
        </div>
        {description ? <div className="oo-text-caption line-clamp-1 text-foreground/75">{description}</div> : null}
        {meta ? <div className="oo-text-caption-compact min-w-0 text-muted-foreground">{meta}</div> : null}
      </div>
    </>
  )

  return (
    <div
      className={cn(
        "oo-list-render-boundary grid min-w-0 gap-2 border-b border-[var(--oo-divider)] px-3 py-2.5 transition-colors md:grid-cols-[minmax(0,1fr)_auto] md:items-center",
        !showTrailingDivider && "last:border-b-0",
        onSelect && "hover:bg-[var(--oo-row-hover)]",
        selected && "bg-[var(--oo-row-selected)] hover:bg-[var(--oo-row-selected)]",
      )}
    >
      {onSelect ? (
        <button
          type="button"
          className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-3 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
          onClick={onSelect}
        >
          {content}
        </button>
      ) : (
        <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-3 text-left">{content}</div>
      )}
      {actions ? (
        <div className="flex min-w-0 flex-wrap items-center justify-start gap-2 md:justify-end">{actions}</div>
      ) : null}
    </div>
  )
}
