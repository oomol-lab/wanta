import type { ModelCatalog, ModelChoice } from "../../../electron/models/common.ts"
import type { ModelMenuItem } from "./model-control-options.ts"

import { Brain, ChevronDown, Settings2 } from "lucide-react"
import * as React from "react"
import { createPortal } from "react-dom"
import { buildModelMenuItems, selectedModelSummary } from "./model-control-options.ts"
import { ModelRow, ProviderMark } from "./model-control-rows.tsx"
import { clampNumber, modelMenuItemElementId, nextModelMenuIndex } from "./model-control-utils.ts"
import { Button } from "@/components/ui/button"
import { useT } from "@/i18n/i18n"
import { cn } from "@/lib/utils"

export function ModelPicker({
  catalog,
  disabled,
  onSelect,
  onDelete,
  onAdd,
}: {
  catalog: ModelCatalog | null
  disabled: boolean
  onSelect: (choice: ModelChoice) => void
  onDelete: (id: string) => void
  onAdd: () => void
}) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const [activeIndex, setActiveIndex] = React.useState(0)
  const [menuStyle, setMenuStyle] = React.useState<React.CSSProperties>({})
  const rootRef = React.useRef<HTMLDivElement | null>(null)
  const menuRef = React.useRef<HTMLDivElement | null>(null)
  const triggerRef = React.useRef<HTMLButtonElement | null>(null)
  const itemRefs = React.useRef(new Map<string, HTMLButtonElement>())
  const selected = selectedModelSummary(catalog)
  const selectedTitle = selected.supportsImages ? `${selected.label} · ${t("chat.modelVision")}` : selected.label
  const items = React.useMemo<ModelMenuItem[]>(() => buildModelMenuItems(catalog, t("chat.modelAdd")), [catalog, t])
  const activeItem = items[activeIndex]
  const activeItemElementId = activeItem ? modelMenuItemElementId(activeItem.id) : undefined

  const updateMenuPosition = React.useCallback(() => {
    const anchor = rootRef.current
    if (!anchor) {
      return
    }
    const rect = anchor.getBoundingClientRect()
    const margin = 16
    const gap = 8
    const width = Math.min(320, window.innerWidth - margin * 2)
    const left = clampNumber(rect.right - width, margin, window.innerWidth - width - margin)
    const bottom = Math.max(margin, window.innerHeight - rect.top + gap)
    const maxHeight = Math.max(180, rect.top - margin - gap)
    setMenuStyle({ left, bottom, width, maxHeight })
  }, [])

  React.useLayoutEffect(() => {
    if (open) {
      updateMenuPosition()
    }
  }, [open, updateMenuPosition])

  const closeMenu = React.useCallback((restoreFocus = true): void => {
    setOpen(false)
    if (restoreFocus) {
      window.requestAnimationFrame(() => triggerRef.current?.focus())
    }
  }, [])

  const activateItem = React.useCallback(
    (item: ModelMenuItem | undefined): void => {
      if (!item) {
        return
      }
      if (item.kind === "add") {
        closeMenu(false)
        onAdd()
        return
      }
      onSelect(item.choice)
      closeMenu()
    },
    [closeMenu, onAdd, onSelect],
  )

  const focusItem = React.useCallback((item: ModelMenuItem | undefined): void => {
    if (!item) {
      return
    }
    itemRefs.current.get(item.id)?.focus()
  }, [])

  React.useEffect(() => {
    if (!open) {
      return
    }
    const selectedIndex = items.findIndex((item) => item.active)
    const nextIndex = selectedIndex >= 0 ? selectedIndex : 0
    setActiveIndex(nextIndex)
    window.requestAnimationFrame(() => focusItem(items[nextIndex]))
  }, [focusItem, items, open])

  React.useEffect(() => {
    setActiveIndex((index) => Math.min(index, Math.max(0, items.length - 1)))
  }, [items.length])

  React.useEffect(() => {
    if (!open) {
      return
    }
    const onMouseDown = (event: MouseEvent): void => {
      const target = event.target as Node
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        closeMenu(false)
      }
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        closeMenu()
      }
    }
    const onReposition = (): void => updateMenuPosition()
    document.addEventListener("mousedown", onMouseDown)
    document.addEventListener("keydown", onKeyDown)
    window.addEventListener("resize", onReposition)
    window.addEventListener("scroll", onReposition, true)
    return () => {
      document.removeEventListener("mousedown", onMouseDown)
      document.removeEventListener("keydown", onKeyDown)
      window.removeEventListener("resize", onReposition)
      window.removeEventListener("scroll", onReposition, true)
    }
  }, [closeMenu, open, updateMenuPosition])

  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (items.length === 0) {
      return
    }

    if (event.key === "Escape") {
      event.preventDefault()
      closeMenu()
      return
    }
    if (event.key === "ArrowDown") {
      event.preventDefault()
      const nextIndex = nextModelMenuIndex(activeIndex, items.length, 1)
      setActiveIndex(nextIndex)
      focusItem(items[nextIndex])
      return
    }
    if (event.key === "ArrowUp") {
      event.preventDefault()
      const nextIndex = nextModelMenuIndex(activeIndex, items.length, -1)
      setActiveIndex(nextIndex)
      focusItem(items[nextIndex])
      return
    }
    if (event.key === "Home") {
      event.preventDefault()
      setActiveIndex(0)
      focusItem(items[0])
      return
    }
    if (event.key === "End") {
      event.preventDefault()
      const nextIndex = items.length - 1
      setActiveIndex(nextIndex)
      focusItem(items[nextIndex])
      return
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      activateItem(items[activeIndex])
      return
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      const item = items[activeIndex]
      if (item?.kind === "custom") {
        event.preventDefault()
        onDelete(item.modelId)
      }
    }
  }

  const menu = open
    ? createPortal(
        <div
          ref={menuRef}
          style={menuStyle}
          role="menu"
          tabIndex={-1}
          aria-activedescendant={activeItemElementId}
          aria-label={t("chat.modelPicker")}
          className="oo-border-divider fixed z-50 overflow-y-auto rounded-lg border bg-popover p-1.5 text-popover-foreground shadow-xl"
          onKeyDown={handleMenuKeyDown}
        >
          <div className="oo-text-caption-compact px-2 py-1.5 font-medium text-muted-foreground">
            {t("chat.modelBuiltIn")}
          </div>
          {items.map((item, index) => {
            if (item.kind !== "builtin") {
              return null
            }
            return (
              <ModelRow
                key={item.id}
                id={modelMenuItemElementId(item.id)}
                ref={(node) => {
                  if (node) {
                    itemRefs.current.set(item.id, node)
                  } else {
                    itemRefs.current.delete(item.id)
                  }
                }}
                active={item.active}
                highlighted={index === activeIndex}
                icon={<Brain className="size-4 shrink-0 text-muted-foreground" />}
                role="menuitemradio"
                title={item.title}
                supportsImages={item.supportsImages}
                visionLabel={t("chat.modelVision")}
                onHighlight={() => setActiveIndex(index)}
                onSelect={() => activateItem(item)}
              />
            )
          })}

          {items.some((item) => item.kind === "custom") ? (
            <div className="oo-border-divider mt-1 border-t pt-1">
              <div className="oo-text-caption-compact px-2 py-1.5 font-medium text-muted-foreground">
                {t("chat.modelCustom")}
              </div>
              {items.map((item, index) => {
                if (item.kind !== "custom") {
                  return null
                }
                return (
                  <ModelRow
                    key={item.id}
                    id={modelMenuItemElementId(item.id)}
                    ref={(node) => {
                      if (node) {
                        itemRefs.current.set(item.id, node)
                      } else {
                        itemRefs.current.delete(item.id)
                      }
                    }}
                    active={item.active}
                    highlighted={index === activeIndex}
                    icon={<ProviderMark name={item.providerName} />}
                    role="menuitemradio"
                    title={item.title}
                    supportsImages={item.supportsImages}
                    visionLabel={t("chat.modelVision")}
                    deleteLabel={t("chat.modelDelete")}
                    onHighlight={() => setActiveIndex(index)}
                    onSelect={() => activateItem(item)}
                    onDelete={() => onDelete(item.modelId)}
                  />
                )
              })}
            </div>
          ) : null}

          <div className="oo-border-divider mt-1 border-t pt-1">
            {items.map((item, index) => {
              if (item.kind !== "add") {
                return null
              }
              return (
                <button
                  key={item.id}
                  id={modelMenuItemElementId(item.id)}
                  ref={(node) => {
                    if (node) {
                      itemRefs.current.set(item.id, node)
                    } else {
                      itemRefs.current.delete(item.id)
                    }
                  }}
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  className={cn(
                    "oo-text-body flex h-9 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-accent hover:text-accent-foreground",
                    index === activeIndex && "bg-accent text-accent-foreground",
                  )}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => activateItem(item)}
                >
                  <Settings2 className="size-4 text-muted-foreground" />
                  <span>{item.title}</span>
                </button>
              )
            })}
          </div>
        </div>,
        document.body,
      )
    : null

  return (
    <div ref={rootRef} className="max-w-full min-w-0 shrink">
      <Button
        ref={triggerRef}
        type="button"
        variant="ghost"
        size="sm"
        title={selectedTitle}
        aria-label={t("chat.modelPicker")}
        aria-expanded={open}
        aria-haspopup="menu"
        disabled={disabled}
        className="h-8 max-w-full min-w-0 shrink rounded-full px-2"
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Enter" || event.key === " ") {
            event.preventDefault()
            setOpen(true)
          }
        }}
      >
        <Brain className="size-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-left">{selected.label}</span>
        <ChevronDown className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-180")} />
      </Button>
      {menu}
    </div>
  )
}
