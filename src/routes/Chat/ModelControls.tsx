import type { WantaReasoningVariant } from "../../../electron/agent/reasoning.ts"
import type { AgentMode, ReasoningLevel } from "../../../electron/chat/common.ts"
import type {
  CustomModelApiPlan,
  CustomModelProvider,
  ModelCatalog,
  ModelChoice,
  SaveCustomModelRequest,
} from "../../../electron/models/common.ts"
import type { ModelMenuItem } from "./model-control-options.ts"
import type { UserFacingError } from "@/lib/user-facing-error"

import {
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Hammer,
  ImageIcon,
  ListChecks,
  SlidersHorizontal,
  Settings2,
  Trash2,
} from "lucide-react"
import * as React from "react"
import { createPortal } from "react-dom"
import { WANTA_AGENT_MODES } from "../../../electron/agent/mode.ts"
import { WANTA_REASONING_LEVELS, WANTA_REASONING_VARIANT_LEVELS } from "../../../electron/agent/reasoning.ts"
import { buildModelMenuItems, combinedModelReasoningLabel, selectedModelSummary } from "./model-control-options.ts"
import { selectedModelReasoningLevels } from "./model-reasoning-levels.ts"
import { ErrorNotice } from "@/components/ErrorNotice"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useT } from "@/i18n/i18n"
import { cn } from "@/lib/utils"

function providerInitial(name: string): string {
  return (name.trim()[0] ?? "M").toUpperCase()
}

function ProviderMark({ name }: { name: string }) {
  return (
    <span className="oo-text-micro flex size-5 shrink-0 items-center justify-center rounded-md bg-muted font-medium text-muted-foreground">
      {providerInitial(name)}
    </span>
  )
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function nextModelMenuIndex(currentIndex: number, itemCount: number, direction: -1 | 1): number {
  return itemCount === 0 ? 0 : (currentIndex + direction + itemCount) % itemCount
}

function modelMenuItemElementId(itemId: string): string {
  const encoded = Array.from(itemId, (char) => {
    const codePoint = char.codePointAt(0)
    return codePoint === undefined ? "0" : codePoint.toString(16)
  }).join("-")
  return `model-menu-item-${encoded}`
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

const ModelRow = React.forwardRef<HTMLButtonElement, ModelRowProps>(function ModelRow(
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

const reasoningLevelOptions: readonly ReasoningLevel[] = WANTA_REASONING_LEVELS
const agentModeOptions: readonly AgentMode[] = WANTA_AGENT_MODES

function agentModeMenuItemElementId(mode: AgentMode): string {
  return `agent-mode-menu-item-${mode}`
}

function agentModeLabel(mode: AgentMode, t: ReturnType<typeof useT>): string {
  switch (mode) {
    case "build":
      return t("chat.agentModeBuild")
    case "plan":
      return t("chat.agentModePlan")
  }
}

function AgentModeIcon({ mode }: { mode: AgentMode }) {
  return mode === "plan" ? (
    <ListChecks className="size-4 shrink-0 text-muted-foreground" />
  ) : (
    <Hammer className="size-4 shrink-0 text-muted-foreground" />
  )
}

export function AgentModePicker({
  disabled,
  value,
  onValueChange,
}: {
  disabled: boolean
  value: AgentMode
  onValueChange: (mode: AgentMode) => void
}) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const [activeIndex, setActiveIndex] = React.useState(0)
  const [menuStyle, setMenuStyle] = React.useState<React.CSSProperties>({})
  const rootRef = React.useRef<HTMLDivElement | null>(null)
  const menuRef = React.useRef<HTMLDivElement | null>(null)
  const triggerRef = React.useRef<HTMLButtonElement | null>(null)
  const itemRefs = React.useRef(new Map<AgentMode, HTMLButtonElement>())
  const selectedLabel = agentModeLabel(value, t)
  const activeMode = agentModeOptions[activeIndex]
  const activeItemElementId = activeMode ? agentModeMenuItemElementId(activeMode) : undefined

  const updateMenuPosition = React.useCallback(() => {
    const anchor = rootRef.current
    if (!anchor) {
      return
    }
    const rect = anchor.getBoundingClientRect()
    const margin = 16
    const gap = 8
    const width = Math.min(164, window.innerWidth - margin * 2)
    const left = clampNumber(rect.left, margin, window.innerWidth - width - margin)
    const bottom = Math.max(margin, window.innerHeight - rect.top + gap)
    const maxHeight = Math.max(120, rect.top - margin - gap)
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

  const focusMode = React.useCallback((mode: AgentMode | undefined): void => {
    if (!mode) {
      return
    }
    itemRefs.current.get(mode)?.focus()
  }, [])

  const activateMode = React.useCallback(
    (mode: AgentMode | undefined): void => {
      if (!mode) {
        return
      }
      onValueChange(mode)
      closeMenu()
    },
    [closeMenu, onValueChange],
  )

  React.useEffect(() => {
    if (!open) {
      return
    }
    const selectedIndex = agentModeOptions.indexOf(value)
    const nextIndex = selectedIndex >= 0 ? selectedIndex : 0
    setActiveIndex(nextIndex)
    window.requestAnimationFrame(() => focusMode(agentModeOptions[nextIndex]))
  }, [focusMode, open, value])

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
    if (event.key === "Escape") {
      event.preventDefault()
      closeMenu()
      return
    }
    if (event.key === "ArrowDown") {
      event.preventDefault()
      const nextIndex = nextModelMenuIndex(activeIndex, agentModeOptions.length, 1)
      setActiveIndex(nextIndex)
      focusMode(agentModeOptions[nextIndex])
      return
    }
    if (event.key === "ArrowUp") {
      event.preventDefault()
      const nextIndex = nextModelMenuIndex(activeIndex, agentModeOptions.length, -1)
      setActiveIndex(nextIndex)
      focusMode(agentModeOptions[nextIndex])
      return
    }
    if (event.key === "Home") {
      event.preventDefault()
      setActiveIndex(0)
      focusMode(agentModeOptions[0])
      return
    }
    if (event.key === "End") {
      event.preventDefault()
      const nextIndex = agentModeOptions.length - 1
      setActiveIndex(nextIndex)
      focusMode(agentModeOptions[nextIndex])
      return
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      activateMode(agentModeOptions[activeIndex])
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
          aria-label={t("chat.agentModePicker")}
          className="oo-border-divider fixed z-50 overflow-y-auto rounded-lg border bg-popover p-1.5 text-popover-foreground shadow-xl"
          onKeyDown={handleMenuKeyDown}
        >
          {agentModeOptions.map((mode, index) => {
            const active = value === mode
            const highlighted = index === activeIndex
            const label = agentModeLabel(mode, t)
            return (
              <button
                key={mode}
                id={agentModeMenuItemElementId(mode)}
                ref={(node) => {
                  if (node) {
                    itemRefs.current.set(mode, node)
                  } else {
                    itemRefs.current.delete(mode)
                  }
                }}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                tabIndex={-1}
                title={label}
                className={cn(
                  "flex min-h-10 w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent hover:text-accent-foreground",
                  active && "bg-accent font-medium text-accent-foreground",
                  highlighted && "bg-accent text-accent-foreground",
                )}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => activateMode(mode)}
              >
                <AgentModeIcon mode={mode} />
                <span className="oo-text-label min-w-0 flex-1 truncate">{label}</span>
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
        title={`${t("chat.agentModePicker")} · ${selectedLabel}`}
        aria-label={t("chat.agentModePicker")}
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
        <AgentModeIcon mode={value} />
        <span className="min-w-0 flex-1 truncate text-left">{selectedLabel}</span>
        <ChevronDown className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-180")} />
      </Button>
      {menu}
    </div>
  )
}

function reasoningLevelMenuItemElementId(level: ReasoningLevel): string {
  return `reasoning-level-menu-item-${level}`
}

function reasoningLevelLabel(level: ReasoningLevel, t: ReturnType<typeof useT>): string {
  switch (level) {
    case "default":
      return t("chat.reasoningLevelDefault")
    case "low":
      return t("chat.reasoningLevelLow")
    case "medium":
      return t("chat.reasoningLevelMedium")
    case "high":
      return t("chat.reasoningLevelHigh")
    case "max":
      return t("chat.reasoningLevelMax")
  }
}

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
  const [menuStyle, setMenuStyle] = React.useState<React.CSSProperties>({})
  const [modelMenuStyle, setModelMenuStyle] = React.useState<React.CSSProperties>({})
  const rootRef = React.useRef<HTMLDivElement | null>(null)
  const menuRef = React.useRef<HTMLDivElement | null>(null)
  const modelMenuRef = React.useRef<HTMLDivElement | null>(null)
  const triggerRef = React.useRef<HTMLButtonElement | null>(null)
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

  const updateMenuPosition = React.useCallback(() => {
    const anchor = rootRef.current
    if (!anchor) {
      return
    }
    const rect = anchor.getBoundingClientRect()
    const margin = 16
    const gap = 8
    const width = Math.min(232, window.innerWidth - margin * 2)
    const left = clampNumber(rect.right - width, margin, window.innerWidth - width - margin)
    const bottom = Math.max(margin, window.innerHeight - rect.top + gap)
    const maxHeight = Math.max(180, rect.top - margin - gap)
    setMenuStyle({ left, bottom, width, maxHeight })
  }, [])

  const updateModelMenuPosition = React.useCallback(() => {
    const menu = menuRef.current
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

  React.useLayoutEffect(() => {
    if (open) {
      updateMenuPosition()
    }
  }, [open, updateMenuPosition])

  React.useLayoutEffect(() => {
    if (open && modelSubmenuOpen) {
      updateModelMenuPosition()
    }
  }, [modelSubmenuOpen, open, updateModelMenuPosition])

  const closeMenu = React.useCallback((restoreFocus = true): void => {
    setOpen(false)
    setModelSubmenuOpen(false)
    if (restoreFocus) {
      window.requestAnimationFrame(() => triggerRef.current?.focus())
    }
  }, [])

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

  React.useEffect(() => {
    if (!open) {
      return
    }
    const onMouseDown = (event: MouseEvent): void => {
      const target = event.target as Node
      if (
        !rootRef.current?.contains(target) &&
        !menuRef.current?.contains(target) &&
        !modelMenuRef.current?.contains(target)
      ) {
        closeMenu(false)
      }
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        closeMenu()
      }
    }
    const onReposition = (): void => {
      updateMenuPosition()
      if (modelSubmenuOpen) {
        updateModelMenuPosition()
      }
    }
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
  }, [closeMenu, modelSubmenuOpen, open, updateMenuPosition, updateModelMenuPosition])

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
        className="h-8 max-w-[15rem] min-w-0 shrink rounded-full px-2"
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Enter" || event.key === " ") {
            event.preventDefault()
            setOpen(true)
          }
        }}
      >
        <Brain className="size-4 shrink-0" />
        <span className="flex min-w-0 flex-1 items-center gap-1 text-left">
          <span className="min-w-0 truncate">{selected.label}</span>
          <span className="shrink-0 text-muted-foreground">·</span>
          <span className="shrink-0">{selectedReasoningLabel}</span>
        </span>
        <ChevronDown className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-180")} />
      </Button>
      {rootMenu}
      {modelMenu}
    </div>
  )
}

export function ReasoningLevelPicker({
  disabled,
  value,
  onValueChange,
}: {
  disabled: boolean
  value: ReasoningLevel
  onValueChange: (level: ReasoningLevel) => void
}) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const [activeIndex, setActiveIndex] = React.useState(0)
  const [menuStyle, setMenuStyle] = React.useState<React.CSSProperties>({})
  const rootRef = React.useRef<HTMLDivElement | null>(null)
  const menuRef = React.useRef<HTMLDivElement | null>(null)
  const triggerRef = React.useRef<HTMLButtonElement | null>(null)
  const itemRefs = React.useRef(new Map<ReasoningLevel, HTMLButtonElement>())
  const selectedLabel = reasoningLevelLabel(value, t)
  const activeLevel = reasoningLevelOptions[activeIndex]
  const activeItemElementId = activeLevel ? reasoningLevelMenuItemElementId(activeLevel) : undefined

  const updateMenuPosition = React.useCallback(() => {
    const anchor = rootRef.current
    if (!anchor) {
      return
    }
    const rect = anchor.getBoundingClientRect()
    const margin = 16
    const gap = 8
    const width = Math.min(212, window.innerWidth - margin * 2)
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

  const focusLevel = React.useCallback((level: ReasoningLevel | undefined): void => {
    if (!level) {
      return
    }
    itemRefs.current.get(level)?.focus()
  }, [])

  const activateLevel = React.useCallback(
    (level: ReasoningLevel | undefined): void => {
      if (!level) {
        return
      }
      onValueChange(level)
      closeMenu()
    },
    [closeMenu, onValueChange],
  )

  React.useEffect(() => {
    if (!open) {
      return
    }
    const selectedIndex = reasoningLevelOptions.indexOf(value)
    const nextIndex = selectedIndex >= 0 ? selectedIndex : 0
    setActiveIndex(nextIndex)
    window.requestAnimationFrame(() => focusLevel(reasoningLevelOptions[nextIndex]))
  }, [focusLevel, open, value])

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
    if (event.key === "Escape") {
      event.preventDefault()
      closeMenu()
      return
    }
    if (event.key === "ArrowDown") {
      event.preventDefault()
      const nextIndex = nextModelMenuIndex(activeIndex, reasoningLevelOptions.length, 1)
      setActiveIndex(nextIndex)
      focusLevel(reasoningLevelOptions[nextIndex])
      return
    }
    if (event.key === "ArrowUp") {
      event.preventDefault()
      const nextIndex = nextModelMenuIndex(activeIndex, reasoningLevelOptions.length, -1)
      setActiveIndex(nextIndex)
      focusLevel(reasoningLevelOptions[nextIndex])
      return
    }
    if (event.key === "Home") {
      event.preventDefault()
      setActiveIndex(0)
      focusLevel(reasoningLevelOptions[0])
      return
    }
    if (event.key === "End") {
      event.preventDefault()
      const nextIndex = reasoningLevelOptions.length - 1
      setActiveIndex(nextIndex)
      focusLevel(reasoningLevelOptions[nextIndex])
      return
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      activateLevel(reasoningLevelOptions[activeIndex])
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
          aria-label={t("chat.reasoningLevelPicker")}
          className="oo-border-divider fixed z-50 overflow-y-auto rounded-lg border bg-popover p-1.5 text-popover-foreground shadow-xl"
          onKeyDown={handleMenuKeyDown}
        >
          {reasoningLevelOptions.map((level, index) => {
            const active = value === level
            const highlighted = index === activeIndex
            const label = reasoningLevelLabel(level, t)
            return (
              <button
                key={level}
                id={reasoningLevelMenuItemElementId(level)}
                ref={(node) => {
                  if (node) {
                    itemRefs.current.set(level, node)
                  } else {
                    itemRefs.current.delete(level)
                  }
                }}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                tabIndex={-1}
                title={label}
                className={cn(
                  "flex min-h-10 w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent hover:text-accent-foreground",
                  active && "bg-accent font-medium text-accent-foreground",
                  highlighted && "bg-accent text-accent-foreground",
                )}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => activateLevel(level)}
              >
                <SlidersHorizontal className="size-4 shrink-0 text-muted-foreground" />
                <span className="oo-text-label min-w-0 flex-1 truncate">{label}</span>
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
        title={`${t("chat.reasoningLevelPicker")} · ${selectedLabel}`}
        aria-label={t("chat.reasoningLevelPicker")}
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
        <SlidersHorizontal className="size-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-left">{selectedLabel}</span>
        <ChevronDown className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-180")} />
      </Button>
      {menu}
    </div>
  )
}

type ApiEndpointSource = Pick<CustomModelProvider | CustomModelApiPlan, "apiRegions" | "baseUrl">

function selectedApiPlan(provider: CustomModelProvider | undefined, apiPlanId: string): CustomModelApiPlan | undefined {
  return provider?.apiPlans?.find((plan) => plan.id === apiPlanId) ?? provider?.apiPlans?.[0]
}

function providerDefaultApiPlanId(provider: CustomModelProvider | undefined): string {
  return provider?.apiPlans?.[0]?.id ?? ""
}

function providerEndpoint(
  provider: CustomModelProvider | undefined,
  apiPlanId = providerDefaultApiPlanId(provider),
): ApiEndpointSource | undefined {
  return selectedApiPlan(provider, apiPlanId) ?? provider
}

function endpointBaseUrl(endpoint: ApiEndpointSource | undefined): string {
  return endpoint?.apiRegions?.[0]?.baseUrl ?? endpoint?.baseUrl ?? ""
}

function providerBaseUrl(provider: CustomModelProvider | undefined): string {
  return endpointBaseUrl(providerEndpoint(provider))
}

function endpointDefaultApiRegionId(endpoint: ApiEndpointSource | undefined): string {
  return endpoint?.apiRegions?.[0]?.id ?? ""
}

function providerDefaultModelName(provider: CustomModelProvider | undefined): string {
  return provider?.modelOptions?.[0]?.id ?? ""
}

function apiPlanLabel(id: string, t: ReturnType<typeof useT>): string {
  if (id === "standard") {
    return t("chat.modelApiPlanStandard")
  }
  if (id === "coding") {
    return t("chat.modelApiPlanCoding")
  }
  if (id === "token") {
    return t("chat.modelApiPlanToken")
  }
  return id
}

function apiRegionLabel(id: string, t: ReturnType<typeof useT>): string {
  if (id === "cn") {
    return t("chat.modelApiRegionCn")
  }
  if (id === "global") {
    return t("chat.modelApiRegionGlobal")
  }
  if (id === "sgp") {
    return t("chat.modelApiRegionSgp")
  }
  if (id === "ams") {
    return t("chat.modelApiRegionAms")
  }
  return id
}

function providerDisplayName(provider: CustomModelProvider | undefined, t: ReturnType<typeof useT>): string {
  if (!provider) {
    return ""
  }
  if (provider.id === "custom") {
    return t("chat.modelProviderCustom")
  }
  return provider.displayName
}

function providerDefaultSupportsImages(provider: CustomModelProvider | undefined, modelName: string): boolean {
  const option = provider?.modelOptions?.find((model) => model.id === modelName.trim())
  return option?.supportsImages ?? provider?.supportsImages ?? false
}

function providerDefaultSupportsToolCalls(provider: CustomModelProvider | undefined, modelName: string): boolean {
  const option = provider?.modelOptions?.find((model) => model.id === modelName.trim())
  return option?.supportsToolCalls ?? provider?.supportsToolCalls ?? true
}

function providerDefaultContextWindow(provider: CustomModelProvider | undefined, modelName: string): string {
  const option = provider?.modelOptions?.find((model) => model.id === modelName.trim())
  return String(option?.contextWindow ?? provider?.contextWindow ?? "")
}

function providerDefaultInputTokenLimit(provider: CustomModelProvider | undefined, modelName: string): string {
  const option = provider?.modelOptions?.find((model) => model.id === modelName.trim())
  return String(option?.inputTokenLimit ?? provider?.inputTokenLimit ?? "")
}

function providerDefaultMaxOutputTokens(provider: CustomModelProvider | undefined, modelName: string): string {
  const option = provider?.modelOptions?.find((model) => model.id === modelName.trim())
  return String(option?.maxOutputTokens ?? provider?.maxOutputTokens ?? "")
}

function providerDefaultReasoningVariants(
  provider: CustomModelProvider | undefined,
  modelName: string,
): WantaReasoningVariant[] {
  const option = provider?.modelOptions?.find((model) => model.id === modelName.trim())
  return [...(option?.reasoningVariants ?? provider?.reasoningVariants ?? [])]
}

function optionalTokenLimit(value: string): number | undefined {
  const trimmed = value.trim()
  if (!trimmed) {
    return undefined
  }
  return Number(trimmed)
}

const modelDialogControlClass = "h-[var(--oo-control-height)] w-full px-2.5 text-sm"

export function AddCustomModelDialog({
  open,
  providers,
  error,
  onClose,
  onSave,
}: {
  open: boolean
  providers: CustomModelProvider[]
  error: UserFacingError | null
  onClose: () => void
  onSave: (req: SaveCustomModelRequest) => Promise<void>
}) {
  const t = useT()
  const firstProvider = providers[0]
  const [providerId, setProviderId] = React.useState(firstProvider?.id ?? "custom")
  const [apiPlanId, setApiPlanId] = React.useState(providerDefaultApiPlanId(firstProvider))
  const [baseUrl, setBaseUrl] = React.useState(providerBaseUrl(firstProvider))
  const [apiKey, setApiKey] = React.useState("")
  const [modelName, setModelName] = React.useState("")
  const [apiRegionId, setApiRegionId] = React.useState(endpointDefaultApiRegionId(providerEndpoint(firstProvider)))
  const [supportsImages, setSupportsImages] = React.useState(providerDefaultSupportsImages(firstProvider, ""))
  const [supportsToolCalls, setSupportsToolCalls] = React.useState(providerDefaultSupportsToolCalls(firstProvider, ""))
  const [contextWindow, setContextWindow] = React.useState(providerDefaultContextWindow(firstProvider, ""))
  const [inputTokenLimit, setInputTokenLimit] = React.useState(providerDefaultInputTokenLimit(firstProvider, ""))
  const [maxOutputTokens, setMaxOutputTokens] = React.useState(providerDefaultMaxOutputTokens(firstProvider, ""))
  const [reasoningVariants, setReasoningVariants] = React.useState<WantaReasoningVariant[]>(
    providerDefaultReasoningVariants(firstProvider, ""),
  )
  const [saving, setSaving] = React.useState(false)
  const supportsImagesId = React.useId()
  const supportsToolCallsId = React.useId()
  const contextWindowId = React.useId()
  const inputTokenLimitId = React.useId()
  const maxOutputTokensId = React.useId()
  const provider = providers.find((item) => item.id === providerId)
  const modelOptions = provider?.modelOptions ?? []
  const apiPlans = provider?.apiPlans ?? []
  const apiEndpoint = providerEndpoint(provider, apiPlanId)
  const apiRegions = apiEndpoint?.apiRegions ?? []

  React.useEffect(() => {
    if (open) {
      const initial = providers[0]
      setProviderId(initial?.id ?? "custom")
      setBaseUrl(providerBaseUrl(initial))
      const initialModelName = providerDefaultModelName(initial)
      setModelName(initialModelName)
      setApiPlanId(providerDefaultApiPlanId(initial))
      setApiRegionId(endpointDefaultApiRegionId(providerEndpoint(initial)))
      setSupportsImages(providerDefaultSupportsImages(initial, initialModelName))
      setSupportsToolCalls(providerDefaultSupportsToolCalls(initial, initialModelName))
      setContextWindow(providerDefaultContextWindow(initial, initialModelName))
      setInputTokenLimit(providerDefaultInputTokenLimit(initial, initialModelName))
      setMaxOutputTokens(providerDefaultMaxOutputTokens(initial, initialModelName))
      setReasoningVariants(providerDefaultReasoningVariants(initial, initialModelName))
      setApiKey("")
      setSaving(false)
    }
  }, [open, providers])

  const handleProviderChange = (nextId: string): void => {
    const next = providers.find((item) => item.id === nextId)
    const nextPlanId = providerDefaultApiPlanId(next)
    const nextEndpoint = providerEndpoint(next, nextPlanId)
    const nextModelName = providerDefaultModelName(next)
    setProviderId(nextId)
    setApiPlanId(nextPlanId)
    setBaseUrl(endpointBaseUrl(nextEndpoint))
    setModelName(nextModelName)
    setApiRegionId(endpointDefaultApiRegionId(nextEndpoint))
    setSupportsImages(providerDefaultSupportsImages(next, nextModelName))
    setSupportsToolCalls(providerDefaultSupportsToolCalls(next, nextModelName))
    setContextWindow(providerDefaultContextWindow(next, nextModelName))
    setInputTokenLimit(providerDefaultInputTokenLimit(next, nextModelName))
    setMaxOutputTokens(providerDefaultMaxOutputTokens(next, nextModelName))
    setReasoningVariants(providerDefaultReasoningVariants(next, nextModelName))
  }

  const handleModelChange = (nextModelName: string): void => {
    setModelName(nextModelName)
    setSupportsImages(providerDefaultSupportsImages(provider, nextModelName))
    setSupportsToolCalls(providerDefaultSupportsToolCalls(provider, nextModelName))
    setContextWindow(providerDefaultContextWindow(provider, nextModelName))
    setInputTokenLimit(providerDefaultInputTokenLimit(provider, nextModelName))
    setMaxOutputTokens(providerDefaultMaxOutputTokens(provider, nextModelName))
    setReasoningVariants(providerDefaultReasoningVariants(provider, nextModelName))
  }

  const handleApiPlanChange = (nextId: string): void => {
    if (!nextId) {
      return
    }
    const nextEndpoint = providerEndpoint(provider, nextId)
    setApiPlanId(nextId)
    setBaseUrl(endpointBaseUrl(nextEndpoint))
    setApiRegionId(endpointDefaultApiRegionId(nextEndpoint))
  }

  const handleApiRegionChange = (nextId: string): void => {
    if (!nextId) {
      return
    }
    const next = apiRegions.find((item) => item.id === nextId)
    if (!next) {
      return
    }
    setApiRegionId(nextId)
    setBaseUrl(next.baseUrl)
  }

  const canSave = Boolean(
    providerId && apiKey.trim() && modelName.trim() && (!(provider?.requiresBaseUrl ?? true) || baseUrl.trim()),
  )
  const toggleReasoningVariant = (variant: WantaReasoningVariant, checked: boolean): void => {
    setReasoningVariants((current) =>
      checked ? [...new Set([...current, variant])] : current.filter((item) => item !== variant),
    )
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("chat.modelAddTitle")}
      description={t("chat.modelAddDescription")}
      closeLabel={t("common.cancel")}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            disabled={!canSave || saving}
            onClick={() => {
              setSaving(true)
              void onSave({
                providerId,
                providerName: providerDisplayName(provider, t),
                baseUrl,
                apiKey,
                modelName,
                supportsImages,
                supportsToolCalls,
                contextWindow: optionalTokenLimit(contextWindow),
                inputTokenLimit: optionalTokenLimit(inputTokenLimit),
                maxOutputTokens: optionalTokenLimit(maxOutputTokens),
                reasoningVariants,
              })
                .catch(() => undefined)
                .finally(() => setSaving(false))
            }}
          >
            {t("common.save")}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <div className="grid gap-1.5">
          <Label>{t("chat.modelProvider")}</Label>
          <Select value={providerId} onValueChange={handleProviderChange}>
            <SelectTrigger className={modelDialogControlClass}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" className="w-[var(--radix-select-trigger-width)]">
              {providers.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {providerDisplayName(item, t)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {apiPlans.length > 0 ? (
          <div className="grid gap-1.5">
            <Label>{t("chat.modelApiPlan")}</Label>
            <ToggleGroup
              type="single"
              value={apiPlanId}
              onValueChange={handleApiPlanChange}
              variant="outline"
              className="w-full"
              aria-label={t("chat.modelApiPlan")}
            >
              {apiPlans.map((plan) => (
                <ToggleGroupItem key={plan.id} value={plan.id} className="flex-1">
                  {apiPlanLabel(plan.id, t)}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
        ) : null}

        {apiRegions.length > 0 ? (
          <div className="grid gap-1.5">
            <Label>{t("chat.modelApiRegion")}</Label>
            <ToggleGroup
              type="single"
              value={apiRegionId}
              onValueChange={handleApiRegionChange}
              variant="outline"
              className="w-full"
              aria-label={t("chat.modelApiRegion")}
            >
              {apiRegions.map((region) => (
                <ToggleGroupItem key={region.id} value={region.id} className="flex-1">
                  {apiRegionLabel(region.id, t)}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
        ) : null}

        <div className="grid gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <Label>{t("chat.modelBaseUrl")}</Label>
            {provider?.documentationUrl ? (
              <a
                href={provider.documentationUrl}
                target="_blank"
                rel="noreferrer"
                className="oo-text-caption-compact inline-flex items-center gap-1 font-normal text-primary hover:underline"
              >
                {t("chat.modelDocs")}
                <ExternalLink className="size-3" />
              </a>
            ) : null}
          </div>
          <Input
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder={t("chat.modelBaseUrlPlaceholder")}
            readOnly={!provider?.requiresBaseUrl}
            className={modelDialogControlClass}
          />
        </div>

        <div className="grid gap-1.5">
          <Label>{t("chat.modelApiKey")}</Label>
          <Input
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            type="password"
            placeholder="sk-..."
            autoComplete="off"
            className={modelDialogControlClass}
          />
        </div>

        <div className="grid gap-1.5">
          <Label>{t("chat.modelName")}</Label>
          {modelOptions.length > 0 ? (
            <Select value={modelName} onValueChange={handleModelChange}>
              <SelectTrigger className={modelDialogControlClass}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" className="w-[var(--radix-select-trigger-width)]">
                {modelOptions.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.displayName ?? option.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              value={modelName}
              onChange={(event) => setModelName(event.target.value)}
              placeholder="openai/gpt-5.5"
              className={modelDialogControlClass}
            />
          )}
        </div>

        <div className="rounded-md border border-border/70 px-3 py-2.5">
          <label htmlFor={supportsImagesId} className="flex cursor-pointer items-start gap-3">
            <input
              id={supportsImagesId}
              type="checkbox"
              checked={supportsImages}
              onChange={(event) => setSupportsImages(event.target.checked)}
              className="mt-0.5 size-4 shrink-0 accent-primary"
            />
            <span className="grid gap-1">
              <span className="oo-text-label">{t("chat.modelSupportsImages")}</span>
              <span className="oo-text-caption text-muted-foreground">{t("chat.modelSupportsImagesDescription")}</span>
            </span>
          </label>
        </div>

        <div className="rounded-md border border-border/70 px-3 py-2.5">
          <label htmlFor={supportsToolCallsId} className="flex cursor-pointer items-start gap-3">
            <input
              id={supportsToolCallsId}
              type="checkbox"
              checked={supportsToolCalls}
              onChange={(event) => setSupportsToolCalls(event.target.checked)}
              className="mt-0.5 size-4 shrink-0 accent-primary"
            />
            <span className="grid gap-1">
              <span className="oo-text-label">{t("chat.modelSupportsToolCalls")}</span>
              <span className="oo-text-caption text-muted-foreground">
                {t("chat.modelSupportsToolCallsDescription")}
              </span>
            </span>
          </label>
        </div>

        <div className="grid gap-2 rounded-md border border-border/70 px-3 py-2.5">
          <div className="grid gap-1">
            <span className="oo-text-label">{t("chat.modelTokenLimits")}</span>
            <span className="oo-text-caption text-muted-foreground">{t("chat.modelTokenLimitsDescription")}</span>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="grid gap-1.5">
              <Label htmlFor={contextWindowId}>{t("chat.modelContextWindow")}</Label>
              <Input
                id={contextWindowId}
                value={contextWindow}
                onChange={(event) => setContextWindow(event.target.value)}
                inputMode="numeric"
                placeholder={t("chat.modelOptionalTokenPlaceholder")}
                className={modelDialogControlClass}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={inputTokenLimitId}>{t("chat.modelInputTokenLimit")}</Label>
              <Input
                id={inputTokenLimitId}
                value={inputTokenLimit}
                onChange={(event) => setInputTokenLimit(event.target.value)}
                inputMode="numeric"
                placeholder={t("chat.modelOptionalTokenPlaceholder")}
                className={modelDialogControlClass}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={maxOutputTokensId}>{t("chat.modelMaxOutputTokens")}</Label>
              <Input
                id={maxOutputTokensId}
                value={maxOutputTokens}
                onChange={(event) => setMaxOutputTokens(event.target.value)}
                inputMode="numeric"
                placeholder={t("chat.modelOptionalTokenPlaceholder")}
                className={modelDialogControlClass}
              />
            </div>
          </div>
        </div>

        <div className="grid gap-2 rounded-md border border-border/70 px-3 py-2.5">
          <div className="grid gap-1">
            <span className="oo-text-label">{t("chat.modelReasoningVariants")}</span>
            <span className="oo-text-caption text-muted-foreground">{t("chat.modelReasoningVariantsDescription")}</span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {WANTA_REASONING_VARIANT_LEVELS.map((variant) => (
              <label key={variant} className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={reasoningVariants.includes(variant)}
                  onChange={(event) => toggleReasoningVariant(variant, event.target.checked)}
                  className="size-4 shrink-0 accent-primary"
                />
                <span>{reasoningLevelLabel(variant, t)}</span>
              </label>
            ))}
          </div>
        </div>

        {error ? <ErrorNotice error={error} compact /> : null}
      </div>
    </Dialog>
  )
}
