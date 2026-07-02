import { ImageIcon, Trash2 } from "lucide-react"
import * as React from "react"
import { providerInitial } from "./model-control-utils.ts"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

export function ProviderMark({ name }: { name: string }) {
  return (
    <span className="oo-text-micro flex size-5 shrink-0 items-center justify-center rounded-md bg-muted font-medium text-muted-foreground">
      {providerInitial(name)}
    </span>
  )
}

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
    visionLabel,
    deleteLabel,
    onHighlight,
    onSelect,
    onDelete,
  },
  ref,
) {
  return (
    <div className="group flex min-w-0 items-center gap-1">
      <button
        ref={ref}
        id={id}
        type="button"
        role={role}
        aria-checked={role === "menuitemradio" ? active : undefined}
        className={cn(
          "flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent hover:text-accent-foreground",
          active && "bg-accent font-medium text-accent-foreground",
          highlighted && "bg-accent text-accent-foreground",
        )}
        tabIndex={-1}
        title={title}
        onMouseEnter={onHighlight}
        onClick={onSelect}
      >
        {icon}
        <span className="min-w-0 flex-1">
          <span className="oo-text-label block truncate">{title}</span>
        </span>
        <span className="flex shrink-0 items-center justify-end gap-1">
          {supportsImages ? (
            <Badge
              variant="outline"
              className="h-5 rounded-md px-1.5 py-0 text-[10px] font-medium"
              title={visionLabel}
              aria-label={visionLabel}
            >
              <ImageIcon className="size-3" />
              <span>{visionLabel}</span>
            </Badge>
          ) : null}
        </span>
      </button>
      {onDelete ? (
        <button
          type="button"
          tabIndex={-1}
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100"
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
