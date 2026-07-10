import type { ReasoningLevel } from "../../../electron/chat/common.ts"
import type { ModelCatalog, ModelChoice } from "../../../electron/models/common.ts"
import type { ModelMenuItem } from "./model-control-options.ts"

import { Brain, Check, ChevronDown, ChevronRight, Settings2 } from "lucide-react"
import * as React from "react"
import { createPortal } from "react-dom"
import { buildModelMenuItems, combinedModelReasoningLabel, selectedModelSummary } from "./model-control-options.ts"
import { ModelRow, ProviderMark } from "./model-control-rows.tsx"
import { clampNumber, modelMenuItemElementId, nextModelMenuIndex, reasoningLevelLabel } from "./model-control-utils.ts"
import { selectedModelReasoningLevels } from "./model-reasoning-levels.ts"
import { useComposerMenu } from "./useComposerMenu.ts"
import { Button } from "@/components/ui/button"
import { useT } from "@/i18n/i18n"
import { cn } from "@/lib/utils"

type ModelReasoningRootItem =
  | {
      active: boolean
      id: string
      kind: "reasoning"
      level: ReasoningLevel
      title: string
    }
  | {
      id: "model"
      kind: "model"
      title: string
    }

function modelReasoningRootItemElementId(itemId: string): string {
  return `model-reasoning-root-item-${itemId}`
}

export function ModelReasoningPicker({
  catalog,
  disabled,
  reasoningLevel,
  onSelectModel,
  onDeleteModel,
  onAddModel,
  onSelectReasoningLevel,
}: {
  catalog: ModelCatalog | null
  disabled: boolean
  reasoningLevel: ReasoningLevel
  onSelectModel: (choice: ModelChoice) => void
  onDeleteModel: (id: string) => void
  onAddModel: () => void
  onSelectReasoningLevel: (level: ReasoningLevel) => void
}) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const [modelSubmenuOpen, setModelSubmenuOpen] = React.useState(false)
  const [activeRootIndex, setActiveRootIndex] = React.useState(0)
  const [activeModelIndex, setActiveModelIndex] = React.useState(0)
  const [modelMenuStyle, setModelMenuStyle] = React.useState<React.CSSProperties>({})
  const rootMenuRef = React.useRef<HTMLDivElement | null>(null)
  const modelMenuRef = React.useRef<HTMLDivElement | null>(null)
  const rootItemRefs = React.useRef(new Map<string, HTMLButtonElement>())
  const modelItemRefs = React.useRef(new Map<string, HTMLButtonElement>())
  const selected = selectedModelSummary(catalog)
  const availableReasoningLevels = React.useMemo(() => selectedModelReasoningLevels(catalog), [catalog])
  const effectiveReasoningLevel = availableReasoningLevels.includes(reasoningLevel) ? reasoningLevel : "default"
  const selectedReasoningLabel = reasoningLevelLabel(effectiveReasoningLevel, t)
  const triggerLabel = combinedModelReasoningLabel(selected.label, selectedReasoningLabel)
  const triggerTitle = selected.supportsImages ? `${triggerLabel} · ${t("chat.modelVision")}` : triggerLabel
  const rootItems = React.useMemo<ModelReasoningRootItem[]>(
    () => [
      ...availableReasoningLevels.map(
        (level): ModelReasoningRootItem => ({
          active: effectiveReasoningLevel === level,
          id: `reasoning:${level}`,
          kind: "reasoning",
          level,
          title: reasoningLevelLabel(level, t),
        }),
      ),
      {
        id: "model",
        kind: "model",
        title: selected.label,
      },
    ],
    [availableReasoningLevels, effectiveReasoningLevel, selected.label, t],
  )
  const modelItems = React.useMemo<ModelMenuItem[]>(
    () => buildModelMenuItems(catalog, t("chat.modelAdd")),
    [catalog, t],
  )
  const activeRootItem = rootItems[activeRootIndex]
  const activeRootItemElementId = activeRootItem ? modelReasoningRootItemElementId(activeRootItem.id) : undefined
  const activeModelItem = modelItems[activeModelIndex]
  const activeModelItemElementId = activeModelItem ? modelMenuItemElementId(activeModelItem.id) : undefined
  const modelRootIndex = rootItems.findIndex((item) => item.kind === "model")

  const updateModelMenuPosition = React.useCallback(() => {
    const menu = rootMenuRef.current
    if (!menu) {
      return
    }
    const rect = menu.getBoundingClientRect()
    const margin = 16
    const gap = 6
    const width = Math.min(280, window.innerWidth - margin * 2)
    const rightLeft = rect.right + gap
    const left =
      rightLeft + width <= window.innerWidth - margin
        ? rightLeft
        : clampNumber(rect.left - width - gap, margin, window.innerWidth - width - margin)
    const bottom = Math.max(margin, window.innerHeight - rect.bottom)
    const maxHeight = Math.max(180, rect.bottom - margin)
    setModelMenuStyle({ left, bottom, width, maxHeight })
  }, [])

  const additionalOutsideRefs = React.useMemo(() => [modelMenuRef], [])
  const closeModelSubmenu = React.useCallback((): void => setModelSubmenuOpen(false), [])
  const repositionModelSubmenu = React.useCallback((): void => {
    if (modelSubmenuOpen) {
      updateModelMenuPosition()
    }
  }, [modelSubmenuOpen, updateModelMenuPosition])
  const { closeMenu, handleTriggerKeyDown, menuRef, menuStyle, rootRef, toggleMenu, triggerRef } = useComposerMenu({
    additionalOutsideRefs,
    align: "right",
    disabled,
    menuRef: rootMenuRef,
    minHeight: 180,
    onClose: closeModelSubmenu,
    onReposition: repositionModelSubmenu,
    open,
    setOpen,
    width: 232,
  })

  React.useLayoutEffect(() => {
    if (open && modelSubmenuOpen) {
      updateModelMenuPosition()
    }
  }, [menuStyle, modelSubmenuOpen, open, updateModelMenuPosition])

  const focusRootItem = React.useCallback((item: ModelReasoningRootItem | undefined): void => {
    if (!item) {
      return
    }
    rootItemRefs.current.get(item.id)?.focus()
  }, [])

  const focusModelItem = React.useCallback((item: ModelMenuItem | undefined): void => {
    if (!item) {
      return
    }
    modelItemRefs.current.get(item.id)?.focus()
  }, [])

  const openModelSubmenu = React.useCallback(
    (focusSelected = false): void => {
      const selectedIndex = modelItems.findIndex((item) => item.active)
      const nextIndex = selectedIndex >= 0 ? selectedIndex : 0
      setActiveModelIndex(nextIndex)
      setModelSubmenuOpen(true)
      if (focusSelected) {
        window.requestAnimationFrame(() => focusModelItem(modelItems[nextIndex]))
      }
    },
    [focusModelItem, modelItems],
  )

  const activateModelItem = React.useCallback(
    (item: ModelMenuItem | undefined): void => {
      if (!item) {
        return
      }
      if (item.kind === "add") {
        closeMenu(false)
        onAddModel()
        return
      }
      const nextReasoningLevels = selectedModelReasoningLevels(
        catalog ? { ...catalog, selected: item.choice } : catalog,
      )
      if (!nextReasoningLevels.includes(reasoningLevel)) {
        onSelectReasoningLevel("default")
      }
      onSelectModel(item.choice)
      closeMenu()
    },
    [catalog, closeMenu, onAddModel, onSelectModel, onSelectReasoningLevel, reasoningLevel],
  )

  const activateRootItem = React.useCallback(
    (item: ModelReasoningRootItem | undefined): void => {
      if (!item) {
        return
      }
      if (item.kind === "model") {
        openModelSubmenu(true)
        return
      }
      onSelectReasoningLevel(item.level)
      closeMenu()
    },
    [closeMenu, onSelectReasoningLevel, openModelSubmenu],
  )

  const setRootHighlight = React.useCallback(
    (nextIndex: number, focus = false): void => {
      const item = rootItems[nextIndex]
      setActiveRootIndex(nextIndex)
      if (item?.kind === "model") {
        openModelSubmenu(false)
      } else {
        setModelSubmenuOpen(false)
      }
      if (focus) {
        window.requestAnimationFrame(() => focusRootItem(item))
      }
    },
    [focusRootItem, openModelSubmenu, rootItems],
  )

  React.useEffect(() => {
    if (!open) {
      return
    }
    const selectedIndex = rootItems.findIndex((item) => item.kind === "reasoning" && item.active)
    const nextIndex = selectedIndex >= 0 ? selectedIndex : 0
    setActiveRootIndex(nextIndex)
    setModelSubmenuOpen(false)
    window.requestAnimationFrame(() => focusRootItem(rootItems[nextIndex]))
  }, [focusRootItem, open, rootItems])

  React.useEffect(() => {
    setActiveRootIndex((index) => Math.min(index, Math.max(0, rootItems.length - 1)))
  }, [rootItems.length])

  React.useEffect(() => {
    setActiveModelIndex((index) => Math.min(index, Math.max(0, modelItems.length - 1)))
  }, [modelItems.length])

  const handleRootMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Tab") {
      closeMenu(false)
      return
    }

    if (rootItems.length === 0) {
      return
    }

    if (event.key === "Escape") {
      event.preventDefault()
      closeMenu()
      return
    }
    if (event.key === "ArrowDown") {
      event.preventDefault()
      setRootHighlight(nextModelMenuIndex(activeRootIndex, rootItems.length, 1), true)
      return
    }
    if (event.key === "ArrowUp") {
      event.preventDefault()
      setRootHighlight(nextModelMenuIndex(activeRootIndex, rootItems.length, -1), true)
      return
    }
    if (event.key === "Home") {
      event.preventDefault()
      setRootHighlight(0, true)
      return
    }
    if (event.key === "End") {
      event.preventDefault()
      setRootHighlight(rootItems.length - 1, true)
      return
    }
    if (event.key === "ArrowRight") {
      const item = rootItems[activeRootIndex]
      if (item?.kind === "model") {
        event.preventDefault()
        openModelSubmenu(true)
      }
      return
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      activateRootItem(rootItems[activeRootIndex])
    }
  }

  const handleModelMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Tab") {
      closeMenu(false)
      return
    }

    if (modelItems.length === 0) {
      return
    }

    if (event.key === "Escape") {
      event.preventDefault()
      closeMenu()
      return
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault()
      setModelSubmenuOpen(false)
      if (modelRootIndex >= 0) {
        setActiveRootIndex(modelRootIndex)
        window.requestAnimationFrame(() => focusRootItem(rootItems[modelRootIndex]))
      }
      return
    }
    if (event.key === "ArrowDown") {
      event.preventDefault()
      const nextIndex = nextModelMenuIndex(activeModelIndex, modelItems.length, 1)
      setActiveModelIndex(nextIndex)
      focusModelItem(modelItems[nextIndex])
      return
    }
    if (event.key === "ArrowUp") {
      event.preventDefault()
      const nextIndex = nextModelMenuIndex(activeModelIndex, modelItems.length, -1)
      setActiveModelIndex(nextIndex)
      focusModelItem(modelItems[nextIndex])
      return
    }
    if (event.key === "Home") {
      event.preventDefault()
      setActiveModelIndex(0)
      focusModelItem(modelItems[0])
      return
    }
    if (event.key === "End") {
      event.preventDefault()
      const nextIndex = modelItems.length - 1
      setActiveModelIndex(nextIndex)
      focusModelItem(modelItems[nextIndex])
      return
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      activateModelItem(modelItems[activeModelIndex])
      return
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      const item = modelItems[activeModelIndex]
      if (item?.kind === "custom") {
        event.preventDefault()
        onDeleteModel(item.modelId)
      }
    }
  }

  const modelMenu =
    open && modelSubmenuOpen
      ? createPortal(
          <div
            ref={modelMenuRef}
            style={modelMenuStyle}
            role="menu"
            tabIndex={-1}
            aria-activedescendant={activeModelItemElementId}
            aria-label={t("chat.modelSection")}
            className="oo-border-divider fixed z-50 overflow-y-auto rounded-lg border bg-popover p-1.5 text-popover-foreground shadow-xl"
            onKeyDown={handleModelMenuKeyDown}
          >
            <div className="oo-text-caption-compact px-2 py-1.5 font-medium text-muted-foreground">
              {t("chat.modelSection")}
            </div>
            {modelItems.map((item, index) => {
              if (item.kind !== "builtin") {
                return null
              }
              return (
                <ModelRow
                  key={item.id}
                  id={modelMenuItemElementId(item.id)}
                  ref={(node) => {
                    if (node) {
                      modelItemRefs.current.set(item.id, node)
                    } else {
                      modelItemRefs.current.delete(item.id)
                    }
                  }}
                  active={item.active}
                  highlighted={index === activeModelIndex}
                  icon={<Brain className="size-4 shrink-0 text-muted-foreground" />}
                  role="menuitemradio"
                  title={item.title}
                  supportsImages={item.supportsImages}
                  visionLabel={t("chat.modelVision")}
                  onHighlight={() => setActiveModelIndex(index)}
                  onSelect={() => activateModelItem(item)}
                />
              )
            })}

            {modelItems.some((item) => item.kind === "custom") ? (
              <div className="oo-border-divider mt-1 border-t pt-1">
                <div className="oo-text-caption-compact px-2 py-1.5 font-medium text-muted-foreground">
                  {t("chat.modelCustom")}
                </div>
                {modelItems.map((item, index) => {
                  if (item.kind !== "custom") {
                    return null
                  }
                  return (
                    <ModelRow
                      key={item.id}
                      id={modelMenuItemElementId(item.id)}
                      ref={(node) => {
                        if (node) {
                          modelItemRefs.current.set(item.id, node)
                        } else {
                          modelItemRefs.current.delete(item.id)
                        }
                      }}
                      active={item.active}
                      highlighted={index === activeModelIndex}
                      icon={<ProviderMark name={item.providerName} />}
                      role="menuitemradio"
                      title={item.title}
                      supportsImages={item.supportsImages}
                      visionLabel={t("chat.modelVision")}
                      deleteLabel={t("chat.modelDelete")}
                      onHighlight={() => setActiveModelIndex(index)}
                      onSelect={() => activateModelItem(item)}
                      onDelete={() => onDeleteModel(item.modelId)}
                    />
                  )
                })}
              </div>
            ) : null}

            <div className="oo-border-divider mt-1 border-t pt-1">
              {modelItems.map((item, index) => {
                if (item.kind !== "add") {
                  return null
                }
                return (
                  <button
                    key={item.id}
                    id={modelMenuItemElementId(item.id)}
                    ref={(node) => {
                      if (node) {
                        modelItemRefs.current.set(item.id, node)
                      } else {
                        modelItemRefs.current.delete(item.id)
                      }
                    }}
                    type="button"
                    role="menuitem"
                    tabIndex={-1}
                    className={cn(
                      "oo-text-body flex h-9 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-accent hover:text-accent-foreground",
                      index === activeModelIndex && "bg-accent text-accent-foreground",
                    )}
                    onMouseEnter={() => setActiveModelIndex(index)}
                    onClick={() => activateModelItem(item)}
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

  const rootMenu = open
    ? createPortal(
        <div
          ref={menuRef}
          style={menuStyle}
          role="menu"
          tabIndex={-1}
          aria-activedescendant={activeRootItemElementId}
          aria-label={t("chat.modelReasoningPicker")}
          className="oo-border-divider fixed z-50 overflow-y-auto rounded-lg border bg-popover p-1.5 text-popover-foreground shadow-xl"
          onKeyDown={handleRootMenuKeyDown}
        >
          <div className="oo-text-caption-compact px-2 py-1.5 font-medium text-muted-foreground">
            {t("chat.reasoningSection")}
          </div>
          {rootItems.map((item, index) => {
            const highlighted = index === activeRootIndex
            if (item.kind === "model") {
              return (
                <div key={item.id} className="oo-border-divider mt-1 border-t pt-1">
                  <button
                    id={modelReasoningRootItemElementId(item.id)}
                    ref={(node) => {
                      if (node) {
                        rootItemRefs.current.set(item.id, node)
                      } else {
                        rootItemRefs.current.delete(item.id)
                      }
                    }}
                    type="button"
                    role="menuitem"
                    aria-haspopup="menu"
                    aria-expanded={modelSubmenuOpen}
                    tabIndex={-1}
                    title={`${t("chat.modelSection")} · ${item.title}`}
                    className={cn(
                      "flex h-9 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left hover:bg-accent hover:text-accent-foreground",
                      highlighted && "bg-accent text-accent-foreground",
                    )}
                    onMouseEnter={() => {
                      setActiveRootIndex(index)
                      openModelSubmenu(false)
                    }}
                    onClick={() => openModelSubmenu(true)}
                  >
                    <Brain className="size-4 shrink-0 text-muted-foreground" />
                    <span className="oo-text-label min-w-0 flex-1 truncate">{item.title}</span>
                    <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
                  </button>
                </div>
              )
            }
            return (
              <button
                key={item.id}
                id={modelReasoningRootItemElementId(item.id)}
                ref={(node) => {
                  if (node) {
                    rootItemRefs.current.set(item.id, node)
                  } else {
                    rootItemRefs.current.delete(item.id)
                  }
                }}
                type="button"
                role="menuitemradio"
                aria-checked={item.active}
                tabIndex={-1}
                title={item.title}
                className={cn(
                  "flex h-9 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left hover:bg-accent hover:text-accent-foreground",
                  item.active && "font-medium",
                  highlighted && "bg-accent text-accent-foreground",
                )}
                onMouseEnter={() => setRootHighlight(index)}
                onClick={() => activateRootItem(item)}
              >
                <span className="oo-text-label min-w-0 flex-1 truncate">{item.title}</span>
                {item.active ? <Check className="size-4 shrink-0" /> : <span className="size-4 shrink-0" />}
              </button>
            )
          })}
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
        title={`${t("chat.modelReasoningPicker")} · ${triggerTitle}`}
        aria-label={t("chat.modelReasoningPicker")}
        aria-expanded={open}
        aria-haspopup="menu"
        disabled={disabled}
        className="oo-composer-model-button h-8 max-w-[15rem] min-w-0 shrink rounded-full px-2"
        onClick={toggleMenu}
        onKeyDown={handleTriggerKeyDown}
      >
        <Brain className="size-4 shrink-0" />
        <span className="oo-composer-model-text flex min-w-0 flex-1 items-center gap-1 text-left">
          <span className="min-w-0 truncate">{selected.label}</span>
          <span className="oo-composer-model-reasoning shrink-0 text-muted-foreground">·</span>
          <span className="oo-composer-model-reasoning shrink-0">{selectedReasoningLabel}</span>
        </span>
        <ChevronDown
          className={cn("oo-composer-control-chevron size-3.5 shrink-0 transition-transform", open && "rotate-180")}
        />
      </Button>
      {rootMenu}
      {modelMenu}
    </div>
  )
}
