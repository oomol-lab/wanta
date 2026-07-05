import type { AgentPermissionMode } from "../../../electron/chat/common.ts"

import { Check, ChevronDown, ShieldCheck, TriangleAlert } from "lucide-react"
import * as React from "react"
import { createPortal } from "react-dom"
import { clampNumber, nextModelMenuIndex } from "./model-control-utils.ts"
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
  const [menuStyle, setMenuStyle] = React.useState<React.CSSProperties>({})
  const rootRef = React.useRef<HTMLDivElement | null>(null)
  const triggerRef = React.useRef<HTMLButtonElement | null>(null)
  const menuRef = React.useRef<HTMLDivElement | null>(null)
  const itemRefs = React.useRef(new Map<AgentPermissionMode, HTMLButtonElement>())
  const selectedLabel = permissionModeLabel(value, t)
  const activeMode = permissionModeOptions[activeIndex]
  const activeItemElementId = activeMode ? permissionModeMenuItemElementId(activeMode) : undefined

  const updateMenuPosition = React.useCallback(() => {
    const anchor = rootRef.current
    if (!anchor) {
      return
    }
    const rect = anchor.getBoundingClientRect()
    const margin = 16
    const gap = 8
    const width = Math.min(220, window.innerWidth - margin * 2)
    const left = clampNumber(rect.left, margin, window.innerWidth - width - margin)
    const bottom = Math.max(margin, window.innerHeight - rect.top + gap)
    const maxHeight = Math.max(112, rect.top - margin - gap)
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
    if (disabled && open) {
      closeMenu(false)
    }
  }, [closeMenu, disabled, open])

  React.useEffect(() => {
    if (!open) {
      return
    }
    const selectedIndex = permissionModeOptions.indexOf(value)
    const nextIndex = selectedIndex >= 0 ? selectedIndex : 0
    setActiveIndex(nextIndex)
    window.requestAnimationFrame(() => focusMode(permissionModeOptions[nextIndex]))
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
                <PermissionModeIcon mode={mode} active={active} />
                <span className={cn("oo-text-label min-w-0 flex-1 truncate", active && "font-medium")}>{label}</span>
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
        title={`${t("chat.permissionModePicker")} · ${selectedLabel}`}
        aria-label={t("chat.permissionModePicker")}
        aria-expanded={open}
        aria-haspopup="menu"
        disabled={disabled}
        className={cn(
          "oo-composer-control-button h-8 max-w-full min-w-0 shrink rounded-full px-2",
          value === "full_access" && "text-[var(--oo-warning-foreground)] hover:text-[var(--oo-warning-foreground)]",
        )}
        onClick={() => {
          if (!disabled) {
            setOpen((current) => !current)
          }
        }}
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
