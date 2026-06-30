import type { AgentMode, ReasoningLevel } from "../../../electron/chat/common.ts"
import type {
  CustomModelApiPlan,
  CustomModelProvider,
  ModelCatalog,
  ModelChoice,
  SaveCustomModelRequest,
} from "../../../electron/models/common.ts"
import type { UserFacingError } from "@/lib/user-facing-error"

import {
  Brain,
  ChevronDown,
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
import { DEFAULT_BUILTIN_MODEL_ID, resolveBuiltinModel } from "../../../electron/models/builtin.ts"
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

function sameModelChoice(a: ModelChoice | undefined, b: ModelChoice | undefined): boolean {
  return Boolean(a && b && a.kind === b.kind && a.id === b.id)
}

function selectedModelSummary(catalog: ModelCatalog | null): { label: string; supportsImages: boolean } {
  if (!catalog) {
    const fallback = resolveBuiltinModel(DEFAULT_BUILTIN_MODEL_ID)
    return { label: fallback.displayName, supportsImages: fallback.capabilities.supportsImages }
  }
  const selected = catalog.selected
  if (selected.kind === "custom") {
    const custom = catalog.customModels.find((model) => model.id === selected.id)
    if (custom) {
      return { label: custom.displayName, supportsImages: custom.supportsImages }
    }
  }
  const builtin =
    (selected.kind === "builtin" ? catalog.builtins.find((model) => model.id === selected.id) : undefined) ??
    catalog.builtins[0]
  return { label: builtin?.displayName ?? "Auto", supportsImages: builtin?.supportsImages ?? false }
}

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

type ModelMenuItem =
  | {
      active: boolean
      choice: ModelChoice
      id: string
      kind: "builtin"
      supportsImages?: boolean
      title: string
    }
  | {
      active: boolean
      choice: ModelChoice
      id: string
      kind: "custom"
      modelId: string
      providerName: string
      supportsImages?: boolean
      title: string
    }
  | {
      active: false
      id: string
      kind: "add"
      title: string
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
        <span className="flex shrink-0 justify-end">
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
  const items = React.useMemo<ModelMenuItem[]>(() => {
    if (!catalog) {
      return [
        {
          active: true,
          choice: { kind: "builtin", id: DEFAULT_BUILTIN_MODEL_ID },
          id: `builtin:${DEFAULT_BUILTIN_MODEL_ID}`,
          kind: "builtin",
          supportsImages: selected.supportsImages,
          title: selected.label,
        },
        { active: false, id: "action:add", kind: "add", title: t("chat.modelAdd") },
      ]
    }

    return [
      ...catalog.builtins.map((model): ModelMenuItem => {
        const choice: ModelChoice = { kind: "builtin", id: model.id }
        return {
          active: sameModelChoice(catalog.selected, choice),
          choice,
          id: `builtin:${model.id}`,
          kind: "builtin",
          supportsImages: model.supportsImages,
          title: model.displayName,
        }
      }),
      ...catalog.customModels.map((model): ModelMenuItem => {
        const choice: ModelChoice = { kind: "custom", id: model.id }
        return {
          active: sameModelChoice(catalog.selected, choice),
          choice,
          id: `custom:${model.id}`,
          kind: "custom",
          modelId: model.id,
          providerName: model.providerName,
          supportsImages: model.supportsImages,
          title: model.displayName,
        }
      }),
      { active: false, id: "action:add", kind: "add", title: t("chat.modelAdd") },
    ]
  }, [catalog, selected.label, selected.supportsImages, t])
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

const reasoningLevelOptions: ReasoningLevel[] = ["default", "low", "medium", "high", "max"]
const agentModeOptions: AgentMode[] = ["build", "plan"]

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
  const [saving, setSaving] = React.useState(false)
  const supportsImagesId = React.useId()
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
  }

  const handleModelChange = (nextModelName: string): void => {
    setModelName(nextModelName)
    setSupportsImages(providerDefaultSupportsImages(provider, nextModelName))
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

        {error ? <ErrorNotice error={error} compact /> : null}
      </div>
    </Dialog>
  )
}
