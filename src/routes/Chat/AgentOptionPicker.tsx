import type { ExternalAgentCatalogOption } from "../../../electron/agent/external/status.ts"
import type { AgentOptionRow } from "./agent-control-options.ts"
import type { LucideIcon } from "lucide-react"

import { Check, ChevronDown } from "lucide-react"
import * as React from "react"
import { createPortal } from "react-dom"
import {
  AGENT_OPTION_DEFAULT_ROW_ID as DEFAULT_ROW_ID,
  buildAgentOptionRows,
  normalizeAgentOptionValue,
} from "./agent-control-options.ts"
import { nextModelMenuIndex } from "./model-control-utils.ts"
import { useComposerMenu } from "./useComposerMenu.ts"
import { Button } from "@/components/ui/button"
import { useT } from "@/i18n/i18n"
import { cn } from "@/lib/utils"

/**
 * Single-select menu over agent-native options (models, reasoning efforts).
 * The first row is always "Default" (the agent's own default); option labels come
 * verbatim from the agent and are rendered as data, never translated.
 */
export function AgentOptionPicker({
  ariaLabel,
  defaultOptionId,
  disabled,
  icon: Icon,
  options,
  value,
  onOpen,
  onSelect,
}: {
  ariaLabel: string
  /** The agent-reported default id; captions the Default row when known. */
  defaultOptionId?: string
  disabled: boolean
  icon: LucideIcon
  options: readonly ExternalAgentCatalogOption[]
  /** Selected option id; undefined = the agent default. */
  value?: string
  onOpen?: () => void
  onSelect: (id?: string) => void
}) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const [activeIndex, setActiveIndex] = React.useState(0)
  const itemRefs = React.useRef(new Map<string, HTMLButtonElement>())
  const { closeMenu, handleTriggerKeyDown, menuRef, menuStyle, rootRef, toggleMenu, triggerRef } = useComposerMenu({
    align: "left",
    disabled,
    minHeight: 160,
    open,
    setOpen,
    width: 280,
  })
  const normalizedValue = normalizeAgentOptionValue(value, defaultOptionId)
  const rows = React.useMemo<AgentOptionRow[]>(
    () =>
      buildAgentOptionRows(options, defaultOptionId, {
        defaultLabel: t("chat.agentOptionDefault"),
        defaultDescription: t("chat.agentOptionDefaultDescription"),
      }),
    [defaultOptionId, options, t],
  )
  const selectedRow = normalizedValue !== undefined ? rows.find((row) => row.id === normalizedValue) : undefined
  const selectedLabel = selectedRow?.label ?? normalizedValue ?? t("chat.agentOptionDefault")

  const onOpenRef = React.useRef(onOpen)
  onOpenRef.current = onOpen
  React.useEffect(() => {
    if (open) {
      onOpenRef.current?.()
    }
  }, [open])

  const focusRow = React.useCallback((row: AgentOptionRow | undefined): void => {
    if (!row) {
      return
    }
    itemRefs.current.get(row.id)?.focus()
  }, [])

  const activateRow = React.useCallback(
    (row: AgentOptionRow | undefined): void => {
      if (!row || disabled) {
        return
      }
      closeMenu()
      onSelect(row.id === DEFAULT_ROW_ID ? undefined : row.id)
    },
    [closeMenu, disabled, onSelect],
  )

  React.useEffect(() => {
    if (!open) {
      return
    }
    const selectedIndex = normalizedValue !== undefined ? rows.findIndex((row) => row.id === normalizedValue) : 0
    const nextIndex = selectedIndex >= 0 ? selectedIndex : 0
    setActiveIndex(nextIndex)
    window.requestAnimationFrame(() => focusRow(rows[nextIndex]))
  }, [focusRow, open, rows, normalizedValue])

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
          aria-label={ariaLabel}
          className="oo-border-divider fixed z-50 overflow-y-auto rounded-lg border bg-popover p-1.5 text-popover-foreground shadow-xl"
          onKeyDown={handleMenuKeyDown}
        >
          {rows.map((row, index) => {
            const active = row.id === (normalizedValue ?? DEFAULT_ROW_ID)
            const highlighted = index === activeIndex
            return (
              <button
                key={row.id}
                ref={(node) => {
                  if (node) {
                    itemRefs.current.set(row.id, node)
                  } else {
                    itemRefs.current.delete(row.id)
                  }
                }}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                tabIndex={-1}
                title={row.description ? `${row.label} · ${row.description}` : row.label}
                className={cn(
                  "flex w-full min-w-0 items-start gap-2 rounded-md px-2 py-2 text-left hover:bg-accent hover:text-accent-foreground",
                  active && "font-medium",
                  highlighted && "bg-accent text-accent-foreground",
                )}
                disabled={disabled}
                onMouseEnter={() => {
                  if (!disabled) {
                    setActiveIndex(index)
                  }
                }}
                onClick={() => activateRow(row)}
              >
                <span className="min-w-0 flex-1">
                  <span className={cn("oo-text-label block truncate", active && "font-medium")}>{row.label}</span>
                  {row.description ? (
                    <span className="oo-text-caption mt-0.5 block truncate text-muted-foreground">
                      {row.description}
                    </span>
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
        title={`${ariaLabel} · ${selectedLabel}`}
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="menu"
        disabled={disabled}
        className="oo-composer-control-button h-8 max-w-full min-w-0 shrink rounded-full px-2"
        onClick={toggleMenu}
        onKeyDown={handleTriggerKeyDown}
      >
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <span className="oo-composer-control-label min-w-0 flex-1 truncate text-left">{selectedLabel}</span>
        <ChevronDown
          className={cn("oo-composer-control-chevron size-3.5 shrink-0 transition-transform", open && "rotate-180")}
        />
      </Button>
      {menu}
    </div>
  )
}
