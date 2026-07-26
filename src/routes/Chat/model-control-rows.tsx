import { ImageIcon, Trash2 } from "lucide-react"
import * as React from "react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

interface ModelRowProps {
  active: boolean
  deleteLabel?: string
  highlighted: boolean
  icon: React.ReactNode
  id: string
  onDelete?: () => void
  onHighlight: () => void
  onSelect: () => void
  role: "menuitem" | "menuitemradio"
  supportsImages?: boolean
  tierDescription?: string
  tierLabel?: string
  title: string
  visionLabel: string
}

export const ModelRow = React.forwardRef<HTMLButtonElement, ModelRowProps>(function ModelRow(
  {
    active,
    highlighted,
    icon,
    id,
    role,
    title,
    supportsImages,
    tierDescription,
    tierLabel,
    visionLabel,
    deleteLabel,
    onHighlight,
    onSelect,
    onDelete,
  },
  ref,
) {
  return (
    <div
      className={cn(
        "group flex min-w-0 items-center gap-1 rounded-md focus-within:bg-accent focus-within:text-accent-foreground hover:bg-accent hover:text-accent-foreground",
        active && "bg-accent font-medium text-accent-foreground",
        highlighted && "bg-accent text-accent-foreground",
      )}
      onMouseEnter={onHighlight}
    >
      <button
        ref={ref}
        id={id}
        type="button"
        role={role}
        aria-checked={role === "menuitemradio" ? active : undefined}
        className="flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left"
        tabIndex={-1}
        title={title}
        onClick={onSelect}
      >
        {icon}
        <span className="min-w-0 flex-1">
          <span className="oo-text-label block truncate">{title}</span>
        </span>
        <span className="flex shrink-0 items-center justify-end gap-1">
          {tierLabel ? (
            <Badge
              variant="secondary"
              className="h-5 min-w-5 rounded-md px-1.5 py-0 text-[10px] font-medium"
              title={tierDescription}
              aria-label={tierDescription}
            >
              {tierLabel}
            </Badge>
          ) : null}
          {supportsImages ? (
            <span
              role="img"
              className="flex size-5 items-center justify-center text-muted-foreground"
              title={visionLabel}
              aria-label={visionLabel}
            >
              <ImageIcon className="size-3.5" aria-hidden="true" />
            </span>
          ) : null}
        </span>
      </button>
      {onDelete ? (
        <button
          type="button"
          tabIndex={-1}
          className="mr-1 flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100"
          aria-label={deleteLabel}
          onClick={(event) => {
            event.stopPropagation()
            onDelete()
          }}
        >
          <Trash2 className="size-3.5" />
        </button>
      ) : null}
    </div>
  )
})
