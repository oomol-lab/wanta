import type { AgentPermissionMode } from "../../../electron/chat/common.ts"

import { Check, ChevronDown, ShieldCheck, TriangleAlert } from "lucide-react"
import * as React from "react"
import { createPortal } from "react-dom"
import { nextModelMenuIndex } from "./model-control-utils.ts"
import { useComposerMenu } from "./useComposerMenu.ts"
import { Button } from "@/components/ui/button"
import { useT } from "@/i18n/i18n"
import { cn } from "@/lib/utils"

const permissionModeOptions: readonly AgentPermissionMode[] = ["default", "full_access"]

function permissionModeMenuItemElementId(mode: AgentPermissionMode): string {
  return `permission-mode-menu-item-${mode}`
}

function permissionModeLabel(mode: AgentPermissionMode, t: ReturnType<typeof useT>): string {
  return mode === "full_access" ? t("chat.permissionModeFullAccess") : t("chat.permissionModeDefault")
}

function permissionModeDescription(mode: AgentPermissionMode, t: ReturnType<typeof useT>): string {
  return mode === "full_access"
    ? t("chat.permissionModeFullAccessDescription")
    : t("chat.permissionModeDefaultDescription")
}

function PermissionModeIcon({ mode, active = false }: { mode: AgentPermissionMode; active?: boolean }) {
  return mode === "full_access" ? (
    <TriangleAlert className={cn("size-4 shrink-0", active ? "text-[var(--oo-warning-foreground)]" : undefined)} />
  ) : (
    <ShieldCheck className="size-4 shrink-0" />
  )
}

export function PermissionModePicker({
  disabled,
  value,
  onDefault,
  onFullAccess,
}: {
  disabled: boolean
  value: AgentPermissionMode
  onDefault: () => void
  onFullAccess: () => void
}) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const [activeIndex, setActiveIndex] = React.useState(0)
  const itemRefs = React.useRef(new Map<AgentPermissionMode, HTMLButtonElement>())
  const { closeMenu, handleTriggerKeyDown, menuRef, menuStyle, rootRef, toggleMenu, triggerRef } = useComposerMenu({
    align: "left",
    disabled,
    minHeight: 144,
    open,
    setOpen,
    width: 300,
  })
  const selectedLabel = permissionModeLabel(value, t)
  const activeMode = permissionModeOptions[activeIndex]
  const activeItemElementId = activeMode ? permissionModeMenuItemElementId(activeMode) : undefined

  const focusMode = React.useCallback((mode: AgentPermissionMode | undefined): void => {
    if (!mode) {
      return
    }
    itemRefs.current.get(mode)?.focus()
  }, [])

  const activateMode = React.useCallback(
    (mode: AgentPermissionMode | undefined): void => {
      if (!mode || disabled) {
        return
      }
      closeMenu()
      if (mode === "full_access") {
        onFullAccess()
      } else {
        onDefault()
      }
    },
    [closeMenu, disabled, onDefault, onFullAccess],
  )

  React.useEffect(() => {
    if (!open) {
      return
    }
    const selectedIndex = permissionModeOptions.indexOf(value)
    const nextIndex = selectedIndex >= 0 ? selectedIndex : 0
    setActiveIndex(nextIndex)
    window.requestAnimationFrame(() => focusMode(permissionModeOptions[nextIndex]))
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
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault()
      const direction = event.key === "ArrowDown" ? 1 : -1
      const nextIndex = nextModelMenuIndex(activeIndex, permissionModeOptions.length, direction)
      setActiveIndex(nextIndex)
      focusMode(permissionModeOptions[nextIndex])
      return
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      activateMode(permissionModeOptions[activeIndex])
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
          aria-label={t("chat.permissionModePicker")}
          className="oo-border-divider fixed z-50 overflow-y-auto rounded-lg border bg-popover p-1.5 text-popover-foreground shadow-xl"
          onKeyDown={handleMenuKeyDown}
        >
          {permissionModeOptions.map((mode, index) => {
            const active = value === mode
            const highlighted = index === activeIndex
            const label = permissionModeLabel(mode, t)
            const description = permissionModeDescription(mode, t)
            return (
              <button
                key={mode}
                id={permissionModeMenuItemElementId(mode)}
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
                title={`${label} · ${description}`}
                className={cn(
                  "flex min-h-14 w-full min-w-0 items-start gap-2 rounded-md px-2 py-2 text-left hover:bg-accent hover:text-accent-foreground",
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
                <span className="mt-0.5">
                  <PermissionModeIcon mode={mode} active={active} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className={cn("oo-text-label block truncate", active && "font-medium")}>{label}</span>
                  <span className="oo-text-caption mt-0.5 block text-muted-foreground">{description}</span>
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
        title={`${t("chat.permissionModePicker")} · ${selectedLabel}`}
        aria-label={t("chat.permissionModePicker")}
        aria-expanded={open}
        aria-haspopup="menu"
        disabled={disabled}
        className={cn(
          "oo-composer-control-button h-8 max-w-full min-w-0 shrink rounded-full px-2",
          value === "full_access" && "text-[var(--oo-warning-foreground)] hover:text-[var(--oo-warning-foreground)]",
        )}
        onClick={toggleMenu}
        onKeyDown={handleTriggerKeyDown}
      >
        <PermissionModeIcon mode={value} active={value === "full_access"} />
        <span className="oo-composer-control-label min-w-0 flex-1 truncate text-left">{selectedLabel}</span>
        <ChevronDown
          className={cn("oo-composer-control-chevron size-3.5 shrink-0 transition-transform", open && "rotate-180")}
        />
      </Button>
      {menu}
    </div>
  )
}
