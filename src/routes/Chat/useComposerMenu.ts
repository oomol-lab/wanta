import * as React from "react"
import { clampNumber } from "./model-control-utils.ts"

type ComposerMenuAlign = "left" | "right"

interface UseComposerMenuOptions {
  additionalOutsideRefs?: ReadonlyArray<React.RefObject<HTMLElement | null>>
  align: ComposerMenuAlign
  disabled?: boolean
  gap?: number
  margin?: number
  menuRef?: React.RefObject<HTMLDivElement | null>
  minHeight: number
  onClose?: () => void
  onReposition?: () => void
  open: boolean
  setOpen: React.Dispatch<React.SetStateAction<boolean>>
  width: number
}

function isMenuTriggerKey(key: string): boolean {
  return key === "ArrowDown" || key === "ArrowUp" || key === "Enter" || key === " "
}

const noAdditionalOutsideRefs: ReadonlyArray<React.RefObject<HTMLElement | null>> = []

export function useComposerMenu({
  additionalOutsideRefs = noAdditionalOutsideRefs,
  align,
  disabled = false,
  gap = 8,
  margin = 16,
  menuRef: providedMenuRef,
  minHeight,
  onClose,
  onReposition,
  open,
  setOpen,
  width,
}: UseComposerMenuOptions) {
  const rootRef = React.useRef<HTMLDivElement | null>(null)
  const internalMenuRef = React.useRef<HTMLDivElement | null>(null)
  const menuRef = providedMenuRef ?? internalMenuRef
  const triggerRef = React.useRef<HTMLButtonElement | null>(null)
  const [menuStyle, setMenuStyle] = React.useState<React.CSSProperties>({})

  const updateMenuPosition = React.useCallback(() => {
    const anchor = rootRef.current
    if (!anchor) {
      return
    }
    const rect = anchor.getBoundingClientRect()
    const availableWidth = Math.max(1, window.innerWidth - margin * 2)
    const menuWidth = Math.min(width, availableWidth)
    const rawLeft = align === "right" ? rect.right - menuWidth : rect.left
    const left = clampNumber(rawLeft, margin, Math.max(margin, window.innerWidth - menuWidth - margin))
    const bottom = Math.max(margin, window.innerHeight - rect.top + gap)
    const maxHeight = Math.max(minHeight, rect.top - margin - gap)
    setMenuStyle({ left, bottom, width: menuWidth, maxHeight })
  }, [align, gap, margin, minHeight, width])

  React.useLayoutEffect(() => {
    if (open) {
      updateMenuPosition()
    }
  }, [open, updateMenuPosition])

  const closeMenu = React.useCallback(
    (restoreFocus = true): void => {
      setOpen(false)
      onClose?.()
      if (restoreFocus) {
        window.requestAnimationFrame(() => triggerRef.current?.focus())
      }
    },
    [onClose, setOpen],
  )

  const toggleMenu = React.useCallback((): void => {
    if (disabled) {
      return
    }
    if (open) {
      closeMenu(false)
      return
    }
    setOpen(true)
  }, [closeMenu, disabled, open, setOpen])

  const handleTriggerKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>): void => {
      if (disabled || !isMenuTriggerKey(event.key)) {
        return
      }
      event.preventDefault()
      setOpen(true)
    },
    [disabled, setOpen],
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
    const onMouseDown = (event: MouseEvent): void => {
      const target = event.target as Node
      const clickedAdditionalMenu = additionalOutsideRefs.some((ref) => ref.current?.contains(target))
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target) && !clickedAdditionalMenu) {
        closeMenu(false)
      }
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        closeMenu()
      }
    }
    const reposition = (): void => {
      updateMenuPosition()
      onReposition?.()
    }
    document.addEventListener("mousedown", onMouseDown)
    document.addEventListener("keydown", onKeyDown)
    window.addEventListener("resize", reposition)
    window.addEventListener("scroll", reposition, true)
    return () => {
      document.removeEventListener("mousedown", onMouseDown)
      document.removeEventListener("keydown", onKeyDown)
      window.removeEventListener("resize", reposition)
      window.removeEventListener("scroll", reposition, true)
    }
  }, [additionalOutsideRefs, closeMenu, onReposition, open, updateMenuPosition])

  return {
    closeMenu,
    handleTriggerKeyDown,
    menuRef,
    menuStyle,
    rootRef,
    toggleMenu,
    triggerRef,
  }
}
