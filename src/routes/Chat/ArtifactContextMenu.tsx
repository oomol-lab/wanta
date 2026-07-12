import type { LocalArtifactItem } from "../../../electron/chat/common.ts"

import { ExternalLink, Eye, FolderOpen, Info } from "lucide-react"
import * as React from "react"
import { createPortal } from "react-dom"
import { useT } from "@/i18n/i18n"

export interface ArtifactContextMenuState {
  item: LocalArtifactItem
  x: number
  y: number
}

export function ArtifactContextMenu({
  activeInfoPath,
  menu,
  onClose,
  onOpenPath,
  onShowInFolder,
  onToggleInfo,
}: {
  activeInfoPath?: string | null
  menu: ArtifactContextMenuState | null
  onClose: () => void
  onOpenPath: (filePath: string | undefined) => void
  onShowInFolder: (filePath: string | undefined) => void
  onToggleInfo?: (item: LocalArtifactItem) => void
}) {
  const t = useT()

  React.useEffect(() => {
    if (!menu) {
      return
    }
    const close = (): void => onClose()
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        onClose()
      }
    }
    window.addEventListener("pointerdown", close)
    window.addEventListener("resize", close)
    window.addEventListener("scroll", close, true)
    window.addEventListener("keydown", handleKeyDown)
    return () => {
      window.removeEventListener("pointerdown", close)
      window.removeEventListener("resize", close)
      window.removeEventListener("scroll", close, true)
      window.removeEventListener("keydown", handleKeyDown)
    }
  }, [menu, onClose])

  if (!menu) {
    return null
  }

  const left = Math.max(8, Math.min(menu.x, window.innerWidth - 220))
  const hasInfoAction = Boolean(onToggleInfo)
  const infoActive = activeInfoPath === menu.item.path
  const top = Math.max(8, Math.min(menu.y, window.innerHeight - (hasInfoAction ? 128 : 92)))

  return createPortal(
    <div
      role="menu"
      aria-label={menu.item.name}
      className="fixed z-[140] min-w-52 rounded-md border bg-popover p-1 text-popover-foreground shadow-lg outline-hidden"
      style={{ left, top }}
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <MenuAction
        icon={<ExternalLink />}
        label={t("artifacts.openInSystem")}
        onClick={() => onOpenPath(menu.item.path)}
        onClose={onClose}
      />
      <MenuAction
        icon={<FolderOpen />}
        label={t("artifacts.openInSystemFolder")}
        onClick={() => onShowInFolder(menu.item.path)}
        onClose={onClose}
      />
      {onToggleInfo ? (
        <MenuAction
          icon={infoActive ? <Eye /> : <Info />}
          label={infoActive ? t("artifacts.previewTab") : t("artifacts.infoTab")}
          onClick={() => onToggleInfo(menu.item)}
          onClose={onClose}
        />
      ) : null}
    </div>,
    document.body,
  )
}

function MenuAction({
  icon,
  label,
  onClick,
  onClose,
}: {
  icon: React.ReactElement<{ className?: string }>
  label: string
  onClick: () => void
  onClose: () => void
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground focus-visible:outline-none"
      onClick={() => {
        onClick()
        onClose()
      }}
    >
      {React.cloneElement(icon, { className: "size-3.5 shrink-0" })}
      <span>{label}</span>
    </button>
  )
}
