import { ChevronLeft } from "lucide-react"
import * as React from "react"
import { cn } from "@/lib/utils"

export interface ComposerPaletteItem {
  description: string
  disabled?: boolean
  icon: React.ReactNode
  id: string
  keywords?: string[]
  meta?: string
  secondaryActionDisabled?: boolean
  secondaryActionLabel?: string
  secondaryActionTitle?: string
  title: string
}

export interface ComposerPaletteProps<TItem extends ComposerPaletteItem = ComposerPaletteItem> {
  activeId?: string
  emptyLabel: string
  headerLabel?: string
  items: TItem[]
  onBack?: () => void
  onSelect: (item: TItem) => void
  onSecondarySelect?: (item: TItem) => void
}

function readTitlebarHeight(): number {
  const value = getComputedStyle(document.documentElement).getPropertyValue("--app-titlebar-height")
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 48
}

export function ComposerPalette<TItem extends ComposerPaletteItem>({
  activeId,
  emptyLabel,
  headerLabel,
  items,
  onBack,
  onSelect,
  onSecondarySelect,
}: ComposerPaletteProps<TItem>) {
  const rootRef = React.useRef<HTMLDivElement | null>(null)
  const activeItemRef = React.useRef<HTMLDivElement | null>(null)
  const [maxHeight, setMaxHeight] = React.useState<number | undefined>(undefined)

  const updateMaxHeight = React.useCallback(() => {
    const root = rootRef.current
    const anchor = root?.parentElement
    if (!anchor) {
      return
    }

    const titlebarHeight = readTitlebarHeight()
    const safeTop = titlebarHeight + 12
    const paletteGap = 8
    const anchorTop = anchor.getBoundingClientRect().top
    const availableHeight = Math.floor(anchorTop - safeTop - paletteGap)
    setMaxHeight(Math.max(1, Math.min(400, availableHeight)))
  }, [])

  React.useLayoutEffect(() => {
    updateMaxHeight()
  }, [items.length, updateMaxHeight])

  React.useEffect(() => {
    const onReposition = (): void => updateMaxHeight()
    window.addEventListener("resize", onReposition)
    window.addEventListener("scroll", onReposition, true)
    return () => {
      window.removeEventListener("resize", onReposition)
      window.removeEventListener("scroll", onReposition, true)
    }
  }, [updateMaxHeight])

  React.useEffect(() => {
    if (activeId && activeId === items[0]?.id) {
      rootRef.current?.scrollTo({ top: 0 })
      return
    }
    activeItemRef.current?.scrollIntoView({ block: "nearest" })
  }, [activeId, items])

  return (
    <div
      ref={rootRef}
      style={maxHeight === undefined ? undefined : { maxHeight }}
      className="oo-border-divider absolute right-0 bottom-full left-0 z-20 mb-2 overflow-y-auto rounded-xl border bg-popover p-2 text-popover-foreground shadow-xl"
    >
      {headerLabel ? (
        <div className="mb-1 flex h-8 items-center gap-1 px-1">
          {onBack ? (
            <button
              type="button"
              className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground focus-visible:outline-none"
              onMouseDown={(event) => event.preventDefault()}
              onClick={onBack}
            >
              <ChevronLeft className="size-4" />
            </button>
          ) : null}
          <div className="oo-text-caption-compact min-w-0 truncate px-1 font-medium text-muted-foreground">
            {headerLabel}
          </div>
        </div>
      ) : null}
      {items.length > 0 ? (
        items.map((item) => {
          const active = item.id === activeId
          return (
            <div
              key={item.id}
              ref={active ? activeItemRef : undefined}
              className={cn(
                "flex h-9 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left outline-none",
                active && "bg-accent text-accent-foreground",
                item.disabled && "cursor-not-allowed opacity-55",
              )}
            >
              <button
                type="button"
                disabled={item.disabled}
                className={cn(
                  "-mx-2 flex h-full min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left outline-none",
                  "hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground",
                  active && "text-accent-foreground",
                  item.disabled && "cursor-not-allowed",
                )}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onSelect(item)}
              >
                <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground">
                  {item.icon}
                </span>
                <span className="flex min-w-0 flex-1 items-baseline gap-2">
                  <span className="oo-text-label max-w-[42%] shrink-0 truncate">{item.title}</span>
                  <span className="oo-text-caption-compact min-w-0 flex-1 truncate text-muted-foreground">
                    {item.description}
                  </span>
                </span>
              </button>
              {item.secondaryActionLabel && onSecondarySelect ? (
                <button
                  type="button"
                  title={item.secondaryActionTitle ?? item.secondaryActionLabel}
                  disabled={item.secondaryActionDisabled}
                  className="oo-text-caption-compact ml-1 max-w-32 shrink-0 truncate rounded-md px-2 py-1 text-muted-foreground outline-none hover:bg-background hover:text-foreground focus-visible:bg-background focus-visible:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => onSecondarySelect(item)}
                >
                  {item.secondaryActionLabel}
                </button>
              ) : item.meta ? (
                <span className="oo-text-caption-compact ml-1 max-w-20 shrink-0 truncate text-muted-foreground">
                  {item.meta}
                </span>
              ) : null}
            </div>
          )
        })
      ) : (
        <div className="oo-text-body px-3 py-5 text-center text-muted-foreground">{emptyLabel}</div>
      )}
    </div>
  )
}
