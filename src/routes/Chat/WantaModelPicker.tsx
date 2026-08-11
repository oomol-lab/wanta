import type { ModelCatalog, ModelChoice } from "../../../electron/models/common.ts"
import type { ModelMenuItem, ModelTier } from "./model-control-options.ts"

import { ChevronDown, Cpu, Settings2 } from "lucide-react"
import * as React from "react"
import { createPortal } from "react-dom"
import { buildModelMenuItems, selectedModelSummary } from "./model-control-options.ts"
import { ModelRow } from "./model-control-rows.tsx"
import { modelMenuItemElementId, nextModelMenuIndex } from "./model-control-utils.ts"
import { useComposerMenu } from "./useComposerMenu.ts"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useT } from "@/i18n/i18n"
import { cn } from "@/lib/utils"

function modelTierCopy(tier: ModelTier, t: ReturnType<typeof useT>): { description: string; label: string } {
  switch (tier) {
    case "high":
      return { description: t("chat.modelTierHighDescription"), label: t("chat.modelTierHigh") }
    case "medium":
      return { description: t("chat.modelTierMediumDescription"), label: t("chat.modelTierMedium") }
    case "low":
      return { description: t("chat.modelTierLowDescription"), label: t("chat.modelTierLow") }
  }
}

/**
 * Single-level picker over the Wanta model catalog (built-in models plus BYOK
 * custom models). Applies only to agents that route models through Wanta;
 * agents that bring their own models render an AgentOptionPicker instead.
 */
export function WantaModelPicker({
  catalog,
  disabled,
  modelRequired = false,
  onAddModel,
  onDeleteModel,
  onSelectModel,
}: {
  catalog: ModelCatalog | null
  disabled: boolean
  modelRequired?: boolean
  onAddModel: () => void
  onDeleteModel: (id: string) => void
  onSelectModel: (choice: ModelChoice) => void
}) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const [activeIndex, setActiveIndex] = React.useState(0)
  const itemRefs = React.useRef(new Map<string, HTMLButtonElement>())
  const selected = selectedModelSummary(catalog)
  const modelLabel = modelRequired ? t("chat.modelSelectOrConfigure") : selected.label
  const triggerTitle = !modelRequired
    ? [
        modelLabel,
        selected.kind === "custom" ? t("chat.modelByokDescription") : null,
        selected.supportsImages ? t("chat.modelVision") : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : modelLabel
  const items = React.useMemo<ModelMenuItem[]>(() => buildModelMenuItems(catalog, t("chat.modelAdd")), [catalog, t])
  const activeItem = items[activeIndex]
  const activeItemElementId = activeItem ? modelMenuItemElementId(activeItem.id) : undefined
  const hasBuiltInModels = items.some((item) => item.kind === "builtin")
  const hasCustomModels = items.some((item) => item.kind === "custom")
  const { closeMenu, handleTriggerKeyDown, menuRef, menuStyle, rootRef, toggleMenu, triggerRef } = useComposerMenu({
    align: "left",
    disabled,
    minHeight: 180,
    open,
    setOpen,
    width: 232,
  })

  const focusItem = React.useCallback((item: ModelMenuItem | undefined): void => {
    if (!item) {
      return
    }
    itemRefs.current.get(item.id)?.focus()
  }, [])

  const activateItem = React.useCallback(
    (item: ModelMenuItem | undefined): void => {
      if (!item) {
        return
      }
      if (item.kind === "add") {
        closeMenu(false)
        onAddModel()
        return
      }
      onSelectModel(item.choice)
      closeMenu()
    },
    [closeMenu, onAddModel, onSelectModel],
  )

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

  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Tab") {
      closeMenu(false)
      return
    }

    if (items.length === 0) {
      return
    }

    if (event.key === "Escape") {
      event.preventDefault()
      closeMenu()
      return
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault()
      const direction = event.key === "ArrowDown" ? 1 : -1
      const nextIndex = nextModelMenuIndex(activeIndex, items.length, direction)
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
        onDeleteModel(item.modelId)
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
          aria-label={t("chat.modelSection")}
          className="oo-border-divider fixed z-50 overflow-y-auto rounded-lg border bg-popover p-1.5 text-popover-foreground shadow-xl"
          onKeyDown={handleMenuKeyDown}
        >
          {hasBuiltInModels ? (
            <div className="oo-text-caption-compact px-2 py-1.5 font-medium text-muted-foreground">
              {t("chat.modelBuiltIn")}
            </div>
          ) : null}
          {items.map((item, index) => {
            if (item.kind !== "builtin") {
              return null
            }
            const tierCopy = item.tier ? modelTierCopy(item.tier, t) : undefined
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
                icon={<Cpu className="size-4 shrink-0 text-muted-foreground" />}
                role="menuitemradio"
                title={item.title}
                supportsImages={item.supportsImages}
                tierDescription={tierCopy?.description}
                tierLabel={tierCopy?.label}
                visionLabel={t("chat.modelSupportsImages")}
                onHighlight={() => setActiveIndex(index)}
                onSelect={() => activateItem(item)}
              />
            )
          })}

          {hasCustomModels ? (
            <div className={cn(hasBuiltInModels && "oo-border-divider mt-1 border-t pt-1")}>
              <div className="flex items-center justify-between gap-2 px-2 py-1.5 text-muted-foreground">
                <span className="oo-text-caption-compact font-medium">{t("chat.modelCustom")}</span>
                <Badge
                  variant="outline"
                  className="h-5 rounded-md px-1.5 py-0 text-[10px] font-medium"
                  title={t("chat.modelByokDescription")}
                >
                  {t("chat.modelByok")}
                </Badge>
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
                    icon={<Cpu className="size-4 shrink-0 text-muted-foreground" />}
                    role="menuitemradio"
                    title={item.title}
                    supportsImages={item.supportsImages}
                    visionLabel={t("chat.modelSupportsImages")}
                    deleteLabel={t("chat.modelDelete")}
                    onHighlight={() => setActiveIndex(index)}
                    onSelect={() => activateItem(item)}
                    onDelete={() => onDeleteModel(item.modelId)}
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
        title={`${t("chat.modelPicker")} · ${triggerTitle}`}
        aria-label={t("chat.modelPicker")}
        aria-expanded={open}
        aria-haspopup="menu"
        disabled={disabled}
        className="oo-composer-model-button h-8 max-w-[15rem] min-w-0 shrink rounded-full px-2"
        onClick={toggleMenu}
        onKeyDown={handleTriggerKeyDown}
      >
        <Cpu className="size-4 shrink-0" />
        <span className="oo-composer-model-text min-w-0 flex-1 truncate text-left">{modelLabel}</span>
        <ChevronDown
          className={cn("oo-composer-control-chevron size-3.5 shrink-0 transition-transform", open && "rotate-180")}
        />
      </Button>
      {menu}
    </div>
  )
}
