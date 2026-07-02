import type { AgentMode } from "../../../electron/chat/common.ts"

import { ChevronDown, Hammer, ListChecks } from "lucide-react"
import * as React from "react"
import { createPortal } from "react-dom"
import { WANTA_AGENT_MODES } from "../../../electron/agent/mode.ts"
import { clampNumber, nextModelMenuIndex } from "./model-control-utils.ts"
import { Button } from "@/components/ui/button"
import { useT } from "@/i18n/i18n"
import { cn } from "@/lib/utils"

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
      if (!mode || disabled) {
        return
      }
      onValueChange(mode)
      closeMenu()
    },
    [closeMenu, disabled, onValueChange],
  )

  React.useEffect(() => {
    if (disabled && open) {
      closeMenu(false)
    }
  }, [closeMenu, disabled, open])

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
                disabled={disabled}
                onMouseEnter={() => {
                  if (!disabled) {
                    setActiveIndex(index)
                  }
                }}
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
        onClick={() => {
          if (!disabled) {
            setOpen((value) => !value)
          }
        }}
        onKeyDown={(event) => {
          if (disabled) {
            return
          }
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
