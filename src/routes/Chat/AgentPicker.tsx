import type { AgentKind } from "../../../electron/agent/contract/profile.ts"
import type { ExternalAgentRuntimeStatus } from "../../../electron/agent/external/status.ts"
import type { AgentPickerRow } from "./agent-control-options.ts"

import { Bot, Check, ChevronDown } from "lucide-react"
import * as React from "react"
import { createPortal } from "react-dom"
import { agentPickerTriggerLabel, buildAgentPickerRows } from "./agent-control-options.ts"
import { nextModelMenuIndex } from "./model-control-utils.ts"
import { useComposerMenu } from "./useComposerMenu.ts"
import { Button } from "@/components/ui/button"
import { useT } from "@/i18n/i18n"
import { cn } from "@/lib/utils"

function agentPickerMenuItemElementId(kind: AgentKind): string {
  return `agent-picker-menu-item-${kind}`
}

/**
 * Picks which agent drives a new session. `locked` keeps the trigger visible
 * on existing sessions without opening the menu: the agent choice is fixed at
 * session creation.
 */
export function AgentPicker({
  disabled,
  locked,
  options,
  value,
  onOpen,
  onSelect,
}: {
  disabled: boolean
  locked: boolean
  options: ExternalAgentRuntimeStatus[]
  value: AgentKind
  onOpen?: () => void
  onSelect: (kind: AgentKind) => void
}) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const [activeIndex, setActiveIndex] = React.useState(0)
  const itemRefs = React.useRef(new Map<AgentKind, HTMLButtonElement>())
  const menuDisabled = disabled || locked
  const { closeMenu, handleTriggerKeyDown, menuRef, menuStyle, rootRef, toggleMenu, triggerRef } = useComposerMenu({
    align: "left",
    disabled: menuDisabled,
    minHeight: 160,
    open,
    setOpen,
    width: 280,
  })
  const rows = React.useMemo(
    () =>
      buildAgentPickerRows(options, {
        builtIn: t("chat.agentBuiltIn"),
        loginRequired: (hint) => t("chat.agentLoginRequired", { hint }),
        notDetected: t("chat.agentNotDetected"),
      }),
    [options, t],
  )
  const selectedLabel = agentPickerTriggerLabel(value, t("chat.agentBuiltIn"))
  const activeRow = rows[activeIndex]
  const activeItemElementId = activeRow ? agentPickerMenuItemElementId(activeRow.kind) : undefined

  // Refresh probed statuses whenever the menu opens, regardless of how it was
  // opened (click or keyboard).
  const onOpenRef = React.useRef(onOpen)
  onOpenRef.current = onOpen
  React.useEffect(() => {
    if (open) {
      onOpenRef.current?.()
    }
  }, [open])

  const focusRow = React.useCallback((row: AgentPickerRow | undefined): void => {
    if (!row) {
      return
    }
    itemRefs.current.get(row.kind)?.focus()
  }, [])

  const activateRow = React.useCallback(
    (row: AgentPickerRow | undefined): void => {
      if (!row || !row.selectable || menuDisabled) {
        return
      }
      onSelect(row.kind)
      closeMenu()
    },
    [closeMenu, menuDisabled, onSelect],
  )

  React.useEffect(() => {
    if (!open) {
      return
    }
    const selectedIndex = rows.findIndex((row) => row.kind === value)
    const nextIndex = selectedIndex >= 0 ? selectedIndex : 0
    setActiveIndex(nextIndex)
    window.requestAnimationFrame(() => focusRow(rows[nextIndex]))
  }, [focusRow, open, rows, value])

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
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault()
      const direction = event.key === "ArrowDown" ? 1 : -1
      const nextIndex = nextModelMenuIndex(activeIndex, rows.length, direction)
      setActiveIndex(nextIndex)
      focusRow(rows[nextIndex])
      return
    }
    if (event.key === "Home") {
      event.preventDefault()
      setActiveIndex(0)
      focusRow(rows[0])
      return
    }
    if (event.key === "End") {
      event.preventDefault()
      const nextIndex = rows.length - 1
      setActiveIndex(nextIndex)
      focusRow(rows[nextIndex])
      return
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      activateRow(rows[activeIndex])
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
          aria-label={t("chat.agentPickerLabel")}
          className="oo-border-divider fixed z-50 overflow-y-auto rounded-lg border bg-popover p-1.5 text-popover-foreground shadow-xl"
          onKeyDown={handleMenuKeyDown}
        >
          {rows.map((row, index) => {
            const active = value === row.kind
            const highlighted = index === activeIndex
            return (
              <button
                key={row.kind}
                id={agentPickerMenuItemElementId(row.kind)}
                ref={(node) => {
                  if (node) {
                    itemRefs.current.set(row.kind, node)
                  } else {
                    itemRefs.current.delete(row.kind)
                  }
                }}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                tabIndex={-1}
                title={row.title ?? row.label}
                className={cn(
                  "flex min-h-10 w-full min-w-0 items-start gap-2 rounded-md px-2 py-2 text-left hover:bg-accent hover:text-accent-foreground disabled:opacity-50 disabled:hover:bg-transparent",
                  active && "font-medium",
                  highlighted && "bg-accent text-accent-foreground",
                )}
                disabled={disabled || !row.selectable}
                onMouseEnter={() => {
                  if (!disabled && row.selectable) {
                    setActiveIndex(index)
                  }
                }}
                onClick={() => activateRow(row)}
              >
                <Bot className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-baseline gap-1.5">
                    <span className={cn("oo-text-label min-w-0 truncate", active && "font-medium")}>{row.label}</span>
                    {row.sublabel ? (
                      <span className="oo-text-caption shrink-0 text-muted-foreground">{row.sublabel}</span>
                    ) : null}
                  </span>
                  {row.hint ? (
                    <span className="oo-text-caption mt-0.5 block truncate text-muted-foreground">{row.hint}</span>
                  ) : null}
                </span>
                {active ? (
                  <Check className="mt-0.5 size-4 shrink-0" />
                ) : (
                  <span className="size-4 shrink-0" aria-hidden />
                )}
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
        title={selectedLabel}
        aria-label={t("chat.agentPickerLabel")}
        aria-expanded={open}
        aria-haspopup="menu"
        disabled={disabled}
        className="oo-composer-control-button h-8 max-w-full min-w-0 shrink rounded-full px-2"
        onClick={toggleMenu}
        onKeyDown={handleTriggerKeyDown}
      >
        <Bot className="size-4 shrink-0 text-muted-foreground" />
        <span className="oo-composer-control-label min-w-0 flex-1 truncate text-left">{selectedLabel}</span>
        {locked ? null : (
          <ChevronDown
            className={cn("oo-composer-control-chevron size-3.5 shrink-0 transition-transform", open && "rotate-180")}
          />
        )}
      </Button>
      {menu}
    </div>
  )
}
