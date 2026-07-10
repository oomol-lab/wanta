import type { AgentMode } from "../../../electron/chat/common.ts"

import { Check, ChevronDown, Hammer, ListChecks } from "lucide-react"
import * as React from "react"
import { createPortal } from "react-dom"
import { WANTA_AGENT_MODES } from "../../../electron/agent/mode.ts"
import { nextModelMenuIndex } from "./model-control-utils.ts"
import { useComposerMenu } from "./useComposerMenu.ts"
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
  const itemRefs = React.useRef(new Map<AgentMode, HTMLButtonElement>())
  const { closeMenu, handleTriggerKeyDown, menuRef, menuStyle, rootRef, toggleMenu, triggerRef } = useComposerMenu({
    align: "left",
    disabled,
    minHeight: 120,
    open,
    setOpen,
    width: 164,
  })
  const selectedLabel = agentModeLabel(value, t)
  const activeMode = agentModeOptions[activeIndex]
  const activeItemElementId = activeMode ? agentModeMenuItemElementId(activeMode) : undefined

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
    if (!open) {
      return
    }
    const selectedIndex = agentModeOptions.indexOf(value)
    const nextIndex = selectedIndex >= 0 ? selectedIndex : 0
    setActiveIndex(nextIndex)
    window.requestAnimationFrame(() => focusMode(agentModeOptions[nextIndex]))
  }, [focusMode, open, value])

  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Tab") {
      closeMenu(false)
      return
    }
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
                  active && "font-medium",
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
                {active ? <Check className="size-4 shrink-0" /> : <span className="size-4 shrink-0" aria-hidden />}
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
        className="oo-composer-control-button h-8 max-w-full min-w-0 shrink rounded-full px-2"
        onClick={toggleMenu}
        onKeyDown={handleTriggerKeyDown}
      >
        <AgentModeIcon mode={value} />
        <span className="oo-composer-control-label min-w-0 flex-1 truncate text-left">{selectedLabel}</span>
        <ChevronDown
          className={cn("oo-composer-control-chevron size-3.5 shrink-0 transition-transform", open && "rotate-180")}
        />
      </Button>
      {menu}
    </div>
  )
}
