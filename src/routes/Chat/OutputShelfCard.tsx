import type * as React from "react"

import { ChevronRight } from "lucide-react"

export function OutputShelfCard({
  description,
  icon,
  onClick,
  onContextMenu,
  title,
}: {
  description: React.ReactNode
  icon: React.ReactNode
  onClick: React.MouseEventHandler<HTMLButtonElement>
  onContextMenu?: React.MouseEventHandler<HTMLButtonElement>
  title: string
}) {
  return (
    <button
      type="button"
      title={title}
      className="oo-border-divider flex min-h-16 w-full min-w-0 items-center gap-3 rounded-lg border bg-muted/55 px-3 py-2 text-left transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      {icon}
      <span className="min-w-0 flex-1">
        <span className="oo-text-label block truncate text-foreground">{title}</span>
        <span className="oo-text-caption-compact block truncate text-muted-foreground">{description}</span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </button>
  )
}
