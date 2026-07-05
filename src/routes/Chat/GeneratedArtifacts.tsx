import type {
  LocalArtifactGroup,
  LocalArtifactItem,
  LocalArtifactPack,
  ResolveLocalArtifactsResult,
} from "../../../electron/chat/common.ts"
import type { ResolvedArtifactPayload } from "./artifact-filter.ts"
import type { LocalArtifactPreviewCache } from "./artifact-preview-cache.ts"
import type { GeneratedArtifactSource } from "./artifact-sources.ts"
import type { ArtifactPreviewMode } from "./ArtifactPreviewPane.tsx"

import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Eye,
  FolderOpen,
  Image,
  Info,
  Maximize2,
  Minimize2,
  PanelRightClose,
} from "lucide-react"
import * as React from "react"
import { createPortal } from "react-dom"
import { toast } from "sonner"
import { dedupeArtifactPayloadsAcrossSources, mergeArtifactGroups } from "./artifact-filter.ts"
import {
  artifactKindLabel,
  artifactGroupDisplayItem,
  artifactMetaLabel,
  artifactSummary,
  isImageArtifact,
  readableArtifactTitle,
} from "./artifact-metadata.ts"
import { useLocalArtifactPreview } from "./artifact-preview-cache.ts"
import {
  ArtifactConsumablePreview,
  ArtifactInfo,
  ArtifactPreview,
  ArtifactsEmptyState,
} from "./ArtifactPreviewPane.tsx"
import { FileKindIcon, FileKindTile } from "./file-type-icons.tsx"
import { useChatService } from "@/components/AppContext"
import { Badge } from "@/components/ui/badge"
import { useT } from "@/i18n/i18n"
import { reportRendererHandledError } from "@/lib/renderer-diagnostics"
import { resolveUserFacingError, userFacingErrorDescription } from "@/lib/user-facing-error"
import { cn } from "@/lib/utils"

const previewLimit = 4
const artifactResolveCacheLimit = 24
const artifactListHeightStorageKey = "wanta:artifacts:list-height"
const artifactListDefaultHeightPx = 168
const artifactListMinHeightPx = 96
const artifactPreviewMinHeightPx = 220
const artifactListMaxHeightRatio = 0.55

export interface ResolvedArtifactGroup {
  messageId: string
  group: LocalArtifactGroup
  pack?: LocalArtifactPack
}

export interface ArtifactSelection {
  messageId: string
  group: LocalArtifactGroup
  groups?: ResolvedArtifactGroup[]
  pack?: LocalArtifactPack
  selectedPath?: string
}

interface GeneratedArtifactsProps {
  sources: GeneratedArtifactSource[]
  onOpen: (selection: ArtifactSelection) => void
  onAvailable: (selection: ArtifactSelection) => void
}

interface ArtifactsPanelProps {
  maximized: boolean
  selection: ArtifactSelection | null
  onCollapse: () => void
  onToggleMaximized: () => void
}

interface ArtifactPanelEntry {
  key: string
  messageId: string
  group: LocalArtifactGroup
  item: LocalArtifactItem
  pack?: LocalArtifactPack
}

interface ArtifactBrowseLevel {
  groups: ResolvedArtifactGroup[]
  label: string
  path: string
}

interface ArtifactContextMenuState {
  item: LocalArtifactItem
  x: number
  y: number
}

function artifactSourceCacheKey(source: GeneratedArtifactSource): string {
  return JSON.stringify({
    artifactRoot: source.artifactRoot ?? "",
    requestText: source.requestText,
    sourcePaths: source.sourcePaths,
    text: source.text,
  })
}

function rememberArtifactGroups(
  cache: Map<string, ResolvedArtifactPayload[]>,
  key: string,
  groups: ResolvedArtifactPayload[],
): void {
  cache.set(key, groups)
  while (cache.size > artifactResolveCacheLimit) {
    const oldest = cache.keys().next().value
    if (!oldest) {
      return
    }
    cache.delete(oldest)
  }
}

function useArtifactFileActions(): {
  openPath: (filePath: string | undefined) => void
  showInFolder: (filePath: string | undefined) => void
} {
  const t = useT()
  const chatService = useChatService()

  const openPath = React.useCallback(
    (filePath: string | undefined): void => {
      if (!filePath) {
        return
      }
      void chatService.invoke("openLocalPath", { path: filePath }).catch((cause: unknown) => {
        reportRendererHandledError("generatedArtifacts.openPath", "Failed to open artifact file", cause)
        const error = resolveUserFacingError(cause, { area: "artifact" })
        toast.error(userFacingErrorDescription(error, t))
      })
    },
    [chatService, t],
  )

  const showInFolder = React.useCallback(
    (filePath: string | undefined): void => {
      if (!filePath) {
        return
      }
      void chatService.invoke("showLocalPathInFolder", { path: filePath }).catch((cause: unknown) => {
        reportRendererHandledError("generatedArtifacts.showInFolder", "Failed to reveal artifact file", cause)
        const error = resolveUserFacingError(cause, { area: "artifact" })
        toast.error(userFacingErrorDescription(error, t))
      })
    },
    [chatService, t],
  )

  return { openPath, showInFolder }
}

function ArtifactContextMenu({
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
      <button
        type="button"
        role="menuitem"
        className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground focus-visible:outline-none"
        onClick={() => {
          onOpenPath(menu.item.path)
          onClose()
        }}
      >
        <ExternalLink className="size-3.5 shrink-0" />
        <span>{t("artifacts.openInSystem")}</span>
      </button>
      <button
        type="button"
        role="menuitem"
        className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground focus-visible:outline-none"
        onClick={() => {
          onShowInFolder(menu.item.path)
          onClose()
        }}
      >
        <FolderOpen className="size-3.5 shrink-0" />
        <span>{t("artifacts.openInSystemFolder")}</span>
      </button>
      {onToggleInfo ? (
        <button
          type="button"
          role="menuitem"
          className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground focus-visible:outline-none"
          onClick={() => {
            onToggleInfo(menu.item)
            onClose()
          }}
        >
          {infoActive ? <Eye className="size-3.5 shrink-0" /> : <Info className="size-3.5 shrink-0" />}
          <span>{infoActive ? t("artifacts.previewTab") : t("artifacts.infoTab")}</span>
        </button>
      ) : null}
    </div>,
    document.body,
  )
}

function itemCount(group: LocalArtifactGroup): number {
  return group.root?.kind === "directory" ? group.totalItems : group.items.length
}

function ArtifactIcon({
  item,
  className,
  pack,
}: {
  item: LocalArtifactItem
  className?: string
  pack?: LocalArtifactPack | null
}) {
  return <FileKindIcon source={item} pack={pack} className={cn("size-4 shrink-0", className)} />
}

function artifactPackGroup(pack: LocalArtifactPack): LocalArtifactGroup {
  const visibleSupporting = pack.supporting.filter((item) => item.role !== "metadata")
  const items = pack.items.length > 0 ? pack.items : visibleSupporting
  return {
    root: pack.root,
    items,
    totalItems: pack.totalItems || items.length,
    truncated: pack.truncated,
  }
}

function resolveResultPayloads(result: ResolveLocalArtifactsResult): ResolvedArtifactPayload[] {
  if (result.pack) {
    return [{ group: artifactPackGroup(result.pack), pack: result.pack }]
  }
  return result.groups.map((group) => ({ group }))
}

function packDisplayItems(pack: LocalArtifactPack): LocalArtifactItem[] {
  if (pack.display === "gallery") {
    return pack.items
  }
  const supporting = pack.supporting.filter((item) => item.role !== "metadata")
  return pack.items.length > 0 ? [...pack.items, ...supporting] : supporting
}

function flattenPanelEntries(groups: ResolvedArtifactGroup[]): ArtifactPanelEntry[] {
  return groups.flatMap(({ messageId, group, pack }, groupIndex) => {
    const items = pack ? packDisplayItems(pack) : group.items
    const panelItems = items.length > 0 ? items : group.root ? [group.root] : []
    return panelItems.map((item) => ({
      key: `${messageId}:${group.root?.path ?? groupIndex}:${item.path}`,
      messageId,
      group,
      item,
      ...(pack ? { pack } : {}),
    }))
  })
}

function firstPanelEntryPath(groups: ResolvedArtifactGroup[]): string | null {
  return flattenPanelEntries(groups)[0]?.item.path ?? null
}

function rootArtifactItem(groups: ResolvedArtifactGroup[]): LocalArtifactItem | null {
  return groups.find(({ group }) => group.root)?.group.root ?? null
}

function readArtifactListHeight(): number {
  const value = Number(globalThis.localStorage?.getItem(artifactListHeightStorageKey))
  return Number.isFinite(value) && value > 0 ? value : artifactListDefaultHeightPx
}

function artifactListMaxHeight(panelHeight: number): number {
  return Math.max(artifactListMinHeightPx, panelHeight - artifactPreviewMinHeightPx)
}

function clampArtifactListHeight(height: number, panelHeight: number): number {
  const ratioMax = Math.floor(panelHeight * artifactListMaxHeightRatio)
  const maxHeight = Math.max(artifactListMinHeightPx, Math.min(artifactListMaxHeight(panelHeight), ratioMax))
  return Math.min(Math.max(height, artifactListMinHeightPx), maxHeight)
}

function saveArtifactListHeight(height: number): void {
  try {
    globalThis.localStorage?.setItem(artifactListHeightStorageKey, String(Math.round(height)))
  } catch {
    // 受限环境中 localStorage 可能不可用。
  }
}

function selectionWithContext(
  group: LocalArtifactGroup,
  messageId: string,
  groups: ResolvedArtifactGroup[],
  selectedPath?: string,
  pack?: LocalArtifactPack,
): ArtifactSelection {
  return { messageId, group, groups, ...(pack ? { pack } : {}), selectedPath }
}

function GeneratedArtifactsGroup({
  group,
  groups,
  messageId,
  onContextMenu,
  onOpen,
  pack,
}: {
  group: LocalArtifactGroup
  groups: ResolvedArtifactGroup[]
  messageId: string
  onContextMenu: (item: LocalArtifactItem, x: number, y: number) => void
  onOpen: (selection: ArtifactSelection) => void
  pack?: LocalArtifactPack
}) {
  const t = useT()
  const visibleItems = group.items.slice(0, previewLimit)
  const displayItem = artifactGroupDisplayItem(group, pack)
  const total = itemCount(group)
  const remaining = Math.max(0, total - visibleItems.length)

  if (!displayItem) {
    return null
  }

  return (
    <button
      type="button"
      title={group.root?.path ?? displayItem.path}
      className="oo-border-divider flex min-w-0 flex-col gap-2 rounded-lg border bg-background/70 p-2 text-left shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground"
      onClick={() => onOpen(selectionWithContext(group, messageId, groups, displayItem.path, pack))}
      onContextMenu={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onContextMenu(displayItem, event.clientX, event.clientY)
      }}
    >
      <div className="flex min-w-0 items-center gap-2">
        <FileKindTile source={displayItem} pack={pack} className="size-8" iconClassName="size-4" />
        <div className="min-w-0 flex-1">
          <div className="oo-text-label truncate">{pack?.title ?? readableArtifactTitle(displayItem)}</div>
          <div className="oo-text-caption-compact truncate text-muted-foreground">
            {artifactMetaLabel(t, displayItem, pack)}
            {total > 1 ? ` · ${artifactSummary(t, group)}` : ""}
          </div>
        </div>
        <Badge variant="outline" className="oo-text-micro rounded-md px-1.5 py-0">
          {artifactKindLabel(t, displayItem, pack)}
        </Badge>
      </div>

      {visibleItems.length > 1 ? (
        <div className="flex flex-wrap gap-1.5">
          {visibleItems.map((item) => (
            <span
              key={item.path}
              className="oo-border-divider oo-text-caption-compact flex h-7 max-w-40 min-w-0 items-center gap-1.5 rounded-md border bg-background/70 px-2"
              onContextMenu={(event) => {
                event.preventDefault()
                event.stopPropagation()
                onContextMenu(item, event.clientX, event.clientY)
              }}
            >
              <ArtifactIcon item={item} className="size-3.5 text-muted-foreground" pack={pack} />
              <span className="min-w-0 truncate">{item.name}</span>
            </span>
          ))}
          {remaining > 0 ? (
            <span className="oo-text-caption-compact flex h-7 items-center rounded-md px-2 text-primary">
              {t("artifacts.viewAll", { count: total })}
            </span>
          ) : null}
        </div>
      ) : null}
    </button>
  )
}

export function GeneratedArtifacts({ sources, onOpen, onAvailable }: GeneratedArtifactsProps) {
  const t = useT()
  const chatService = useChatService()
  const { openPath, showInFolder } = useArtifactFileActions()
  const [contextMenu, setContextMenu] = React.useState<ArtifactContextMenuState | null>(null)
  const [groups, setGroups] = React.useState<ResolvedArtifactGroup[]>([])
  const resolvedGroupsCache = React.useRef(new Map<string, ResolvedArtifactPayload[]>())

  React.useEffect(() => {
    if (sources.length === 0) {
      setGroups([])
      return
    }
    let cancelled = false
    const sourceRequests = sources.map(async (source): Promise<ResolvedArtifactGroup[]> => {
      const cacheKey = artifactSourceCacheKey(source)
      const cached = resolvedGroupsCache.current.get(cacheKey)
      if (cached) {
        return cached.map((payload) => ({ messageId: source.messageId, ...payload }))
      }
      const trimmed = source.text.trim()
      if (!source.artifactRoot && !trimmed) {
        rememberArtifactGroups(resolvedGroupsCache.current, cacheKey, [])
        return []
      }
      const requests: Array<Promise<ResolvedArtifactPayload[]>> = []
      if (source.artifactRoot) {
        requests.push(
          chatService
            .invoke("resolveLocalArtifacts", { artifactRoot: source.artifactRoot })
            .then(resolveResultPayloads),
        )
      }
      if (trimmed) {
        requests.push(chatService.invoke("resolveLocalArtifacts", { text: trimmed }).then(resolveResultPayloads))
      }
      const resultGroups = await Promise.all(requests)
      const mergedGroups = mergeArtifactGroups(resultGroups, source)
      rememberArtifactGroups(resolvedGroupsCache.current, cacheKey, mergedGroups)
      return mergedGroups.map((group) => ({
        messageId: source.messageId,
        ...group,
      }))
    })
    void Promise.all(sourceRequests)
      .then((resultGroups) => {
        if (!cancelled) {
          setGroups(dedupeArtifactPayloadsAcrossSources(resultGroups.flat()))
        }
      })
      .catch((error: unknown) => {
        console.warn("[wanta] failed to resolve generated artifacts", { error })
        reportRendererHandledError("generatedArtifacts.resolve", "Failed to resolve generated artifacts", error)
        if (!cancelled) {
          setGroups([])
        }
      })
    return () => {
      cancelled = true
    }
  }, [chatService, sources])

  React.useEffect(() => {
    const resolved = groups.at(-1)
    const selectedPath = resolved ? artifactGroupDisplayItem(resolved.group, resolved.pack)?.path : undefined
    if (resolved && selectedPath) {
      onAvailable(selectionWithContext(resolved.group, resolved.messageId, groups, selectedPath, resolved.pack))
    }
  }, [groups, onAvailable])

  if (groups.length === 0) {
    return null
  }

  return (
    <section className="not-prose -mt-1 grid gap-1.5">
      <div className="oo-text-caption-compact font-medium text-muted-foreground">
        {t("artifacts.generatedSummary", { count: flattenPanelEntries(groups).length })}
      </div>
      <div className="grid gap-1.5">
        {groups.map(({ messageId, group, pack }) => (
          <GeneratedArtifactsGroup
            key={group.root?.path ?? group.items.map((item) => item.path).join("\n")}
            group={group}
            groups={groups}
            messageId={messageId}
            onContextMenu={(item, x, y) => setContextMenu({ item, x, y })}
            onOpen={onOpen}
            pack={pack}
          />
        ))}
      </div>
      <ArtifactContextMenu
        menu={contextMenu}
        onClose={() => setContextMenu(null)}
        onOpenPath={openPath}
        onShowInFolder={showInFolder}
      />
    </section>
  )
}

export function ArtifactsPanel({ maximized, selection, onCollapse, onToggleMaximized }: ArtifactsPanelProps) {
  const t = useT()
  const chatService = useChatService()
  const { openPath, showInFolder } = useArtifactFileActions()
  const [contextMenu, setContextMenu] = React.useState<ArtifactContextMenuState | null>(null)
  const previewCache = React.useRef<LocalArtifactPreviewCache>(new Map()).current
  const shellRef = React.useRef<HTMLElement | null>(null)
  const [artifactListHeight, setArtifactListHeight] = React.useState(readArtifactListHeight)
  const [browseLevels, setBrowseLevels] = React.useState<ArtifactBrowseLevel[]>([])
  const groups = React.useMemo(() => {
    if (selection?.groups?.length) {
      return selection.groups
    }
    return selection
      ? [
          {
            messageId: selection.messageId,
            group: selection.group,
            ...(selection.pack ? { pack: selection.pack } : {}),
          },
        ]
      : []
  }, [selection])
  const activeGroups = browseLevels.at(-1)?.groups ?? groups
  const entries = React.useMemo(() => flattenPanelEntries(activeGroups), [activeGroups])
  const showArtifactList = entries.length > 1 || browseLevels.length > 0
  const hasArtifactBrowser = entries.length > 0 || browseLevels.length > 0
  const fallbackPath =
    browseLevels.at(-1) && entries.length > 0
      ? entries[0]?.item.path
      : (selection?.selectedPath ?? entries[0]?.item.path ?? selection?.group.root?.path ?? null)

  React.useLayoutEffect(() => {
    const panelHeight = shellRef.current?.getBoundingClientRect().height ?? 0
    if (panelHeight <= 0) {
      return
    }
    setArtifactListHeight((current) => {
      const clamped = clampArtifactListHeight(current, panelHeight)
      if (clamped !== current) {
        saveArtifactListHeight(clamped)
      }
      return clamped
    })
  }, [])
  const [selectedPath, setSelectedPath] = React.useState<string | null>(fallbackPath)
  const [previewMode, setPreviewMode] = React.useState<ArtifactPreviewMode>("preview")
  const selectedEntry = entries.find((entry) => entry.item.path === selectedPath) ?? entries[0] ?? null
  const selectedItem = selectedEntry?.item ?? null
  const selectedPack = selectedEntry ? (selectedEntry.pack ?? null) : (selection?.pack ?? null)
  const MaximizeIcon = maximized ? Minimize2 : Maximize2
  const showImageGallery =
    selectedPack?.display === "gallery"
      ? entries.length > 0
      : entries.length > 1 && entries.every((entry) => isImageArtifact(entry.item))
  const baseRoot = rootArtifactItem(groups)
  const baseCrumb = {
    label: selection?.pack?.title ?? baseRoot?.name ?? t("artifacts.title"),
    path: baseRoot?.path ?? selection?.messageId ?? "artifacts-root",
  }

  const showParent = (filePath: string | undefined): void => {
    showInFolder(filePath ?? selectedEntry?.group.root?.path)
  }

  React.useEffect(() => {
    setBrowseLevels([])
  }, [selection])

  React.useEffect(() => {
    setSelectedPath((current) => {
      if (selection?.selectedPath && entries.some((entry) => entry.item.path === selection.selectedPath)) {
        return selection.selectedPath
      }
      if (current && entries.some((entry) => entry.item.path === current)) {
        return current
      }
      return entries[0]?.item.path ?? null
    })
  }, [entries, selection?.selectedPath])

  React.useEffect(() => {
    setPreviewMode("preview")
  }, [selection])

  const selectPreviewPath = React.useCallback((path: string): void => {
    setSelectedPath(path)
    setPreviewMode("preview")
  }, [])

  const enterFolder = React.useCallback(
    async (entry: ArtifactPanelEntry): Promise<void> => {
      if (entry.item.kind !== "directory") {
        openPath(entry.item.path)
        return
      }
      try {
        const result = await chatService.invoke("resolveLocalArtifacts", { artifactRoot: entry.item.path })
        const nextGroups = resolveResultPayloads(result).map((payload) => ({
          messageId: entry.messageId,
          ...payload,
        }))
        if (nextGroups.length === 0) {
          openPath(entry.item.path)
          return
        }
        setBrowseLevels((current) => [
          ...current,
          {
            groups: nextGroups,
            label: entry.item.name,
            path: entry.item.path,
          },
        ])
        setSelectedPath(firstPanelEntryPath(nextGroups))
        setPreviewMode("preview")
      } catch (cause) {
        reportRendererHandledError("generatedArtifacts.enterFolder", "Failed to resolve artifact folder", cause)
        const error = resolveUserFacingError(cause, { area: "artifact" })
        toast.error(userFacingErrorDescription(error, t))
      }
    },
    [chatService, openPath, t],
  )

  const navigateToBreadcrumb = React.useCallback(
    (index: number): void => {
      if (index < 0) {
        const nextSelectedPath = browseLevels[0]?.path ?? firstPanelEntryPath(groups)
        setBrowseLevels([])
        setSelectedPath(nextSelectedPath)
        setPreviewMode("preview")
        return
      }
      const nextLevels = browseLevels.slice(0, index + 1)
      const nextGroups = nextLevels.at(-1)?.groups ?? groups
      const nextSelectedPath = browseLevels[index + 1]?.path ?? firstPanelEntryPath(nextGroups)
      setBrowseLevels(nextLevels)
      setSelectedPath(nextSelectedPath)
      setPreviewMode("preview")
    },
    [browseLevels, groups],
  )

  const updateArtifactListHeight = React.useCallback((nextHeight: number): void => {
    const panelHeight = shellRef.current?.getBoundingClientRect().height ?? 0
    const clamped = panelHeight > 0 ? clampArtifactListHeight(nextHeight, panelHeight) : nextHeight
    setArtifactListHeight(clamped)
    saveArtifactListHeight(clamped)
  }, [])

  const handleArtifactListResizeStart = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>): void => {
      if (event.button !== 0) {
        return
      }
      const panelHeight = shellRef.current?.getBoundingClientRect().height ?? 0
      if (panelHeight <= 0) {
        return
      }
      const startY = event.clientY
      const startHeight = artifactListHeight
      const pointerId = event.pointerId
      event.currentTarget.setPointerCapture(pointerId)
      const handlePointerMove = (moveEvent: PointerEvent): void => {
        const nextHeight = startHeight + moveEvent.clientY - startY
        setArtifactListHeight(clampArtifactListHeight(nextHeight, panelHeight))
      }
      const handlePointerUp = (upEvent: PointerEvent): void => {
        const nextHeight = clampArtifactListHeight(startHeight + upEvent.clientY - startY, panelHeight)
        setArtifactListHeight(nextHeight)
        saveArtifactListHeight(nextHeight)
        window.removeEventListener("pointermove", handlePointerMove)
        window.removeEventListener("pointerup", handlePointerUp)
        window.removeEventListener("pointercancel", handlePointerUp)
      }
      window.addEventListener("pointermove", handlePointerMove)
      window.addEventListener("pointerup", handlePointerUp)
      window.addEventListener("pointercancel", handlePointerUp)
    },
    [artifactListHeight],
  )

  const handleArtifactListResizeKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>): void => {
      if (event.key === "ArrowUp") {
        event.preventDefault()
        updateArtifactListHeight(artifactListHeight - 16)
        return
      }
      if (event.key === "ArrowDown") {
        event.preventDefault()
        updateArtifactListHeight(artifactListHeight + 16)
        return
      }
      if (event.key === "Home") {
        event.preventDefault()
        updateArtifactListHeight(artifactListMinHeightPx)
        return
      }
      if (event.key === "End") {
        event.preventDefault()
        updateArtifactListHeight(artifactListMaxHeight(shellRef.current?.getBoundingClientRect().height ?? 0))
      }
    },
    [artifactListHeight, updateArtifactListHeight],
  )

  return (
    <aside
      ref={shellRef}
      className={cn(
        "oo-border-divider flex h-full min-h-0 w-full flex-col border-l bg-background",
        maximized && "border-l-0",
      )}
    >
      <ArtifactContextMenu
        activeInfoPath={previewMode === "info" ? selectedItem?.path : null}
        menu={contextMenu}
        onClose={() => setContextMenu(null)}
        onOpenPath={openPath}
        onToggleInfo={(item) => {
          if (previewMode === "info" && selectedItem?.path === item.path) {
            setPreviewMode("preview")
            return
          }
          setSelectedPath(item.path)
          setPreviewMode("info")
        }}
        onShowInFolder={showInFolder}
      />
      <header className="oo-titlebar oo-artifacts-titlebar oo-border-divider flex h-[var(--app-titlebar-height)] shrink-0 items-center justify-between gap-3 border-b [-webkit-app-region:drag]">
        <div className="oo-text-title min-w-0 truncate">{selectedPack?.title ?? t("artifacts.title")}</div>
        <div className="flex shrink-0 items-center gap-1 [-webkit-app-region:no-drag]">
          {selectedItem ? (
            <>
              <button
                type="button"
                title={t("artifacts.showInFolder")}
                aria-label={t("artifacts.showInFolder")}
                className="oo-toolbar-button flex size-8 shrink-0 items-center justify-center rounded-md hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground"
                onClick={() => showParent(selectedItem.path)}
              >
                <FolderOpen className="size-4" />
              </button>
              <button
                type="button"
                title={t("artifacts.openFile")}
                aria-label={t("artifacts.openFile")}
                className="oo-toolbar-button flex size-8 shrink-0 items-center justify-center rounded-md hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground"
                onClick={() => openPath(selectedItem.path)}
              >
                <ExternalLink className="size-4" />
              </button>
            </>
          ) : null}
          <button
            type="button"
            title={maximized ? t("artifacts.restore") : t("artifacts.maximize")}
            aria-label={maximized ? t("artifacts.restore") : t("artifacts.maximize")}
            aria-pressed={maximized}
            className="oo-toolbar-button flex size-8 shrink-0 items-center justify-center rounded-md hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground"
            onClick={onToggleMaximized}
          >
            <MaximizeIcon className="size-4" />
          </button>
          <button
            type="button"
            title={t("artifacts.collapse")}
            aria-label={t("artifacts.collapse")}
            className="oo-toolbar-button flex size-8 shrink-0 items-center justify-center rounded-md hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground"
            onClick={onCollapse}
          >
            <PanelRightClose className="size-4" />
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col">
        {hasArtifactBrowser ? (
          showImageGallery ? (
            <ImageGalleryPanel
              entries={entries}
              group={selectedEntry?.group ?? null}
              listHeight={artifactListHeight}
              previewCache={previewCache}
              mode={previewMode}
              baseCrumb={baseCrumb}
              browseLevels={browseLevels}
              selectedItem={selectedItem}
              onOpenPath={openPath}
              onContextMenu={(item, x, y) => setContextMenu({ item, x, y })}
              onEnterFolder={(entry) => void enterFolder(entry)}
              onModeChange={setPreviewMode}
              onNavigateBreadcrumb={navigateToBreadcrumb}
              onResizeDoubleClick={() => updateArtifactListHeight(artifactListDefaultHeightPx)}
              onResizeKeyDown={handleArtifactListResizeKeyDown}
              onResizeStart={handleArtifactListResizeStart}
              onSelect={selectPreviewPath}
            />
          ) : (
            <>
              {showArtifactList ? (
                <ArtifactFileStrip
                  baseCrumb={baseCrumb}
                  browseLevels={browseLevels}
                  entries={entries}
                  listHeight={artifactListHeight}
                  selectedItem={selectedItem}
                  truncated={activeGroups.some(({ group }) => group.truncated)}
                  onContextMenu={(item, x, y) => setContextMenu({ item, x, y })}
                  onEnterFolder={(entry) => void enterFolder(entry)}
                  onOpenPath={openPath}
                  onNavigateBreadcrumb={navigateToBreadcrumb}
                  onResizeDoubleClick={() => updateArtifactListHeight(artifactListDefaultHeightPx)}
                  onResizeKeyDown={handleArtifactListResizeKeyDown}
                  onResizeStart={handleArtifactListResizeStart}
                  onSelect={selectPreviewPath}
                />
              ) : null}
              <ArtifactPreview
                item={selectedItem}
                group={selectedEntry?.group ?? null}
                mode={previewMode}
                onModeChange={setPreviewMode}
                pack={selectedPack}
                previewCache={previewCache}
                showHeader={false}
                onContextMenu={(item, x, y) => setContextMenu({ item, x, y })}
                onOpen={() => openPath(selectedItem?.path)}
              />
            </>
          )
        ) : (
          <ArtifactsEmptyState />
        )}
      </div>
    </aside>
  )
}

function ArtifactFileStrip({
  baseCrumb,
  browseLevels,
  entries,
  listHeight,
  onContextMenu,
  onEnterFolder,
  onNavigateBreadcrumb,
  onResizeDoubleClick,
  onResizeKeyDown,
  onResizeStart,
  selectedItem,
  truncated,
  onOpenPath,
  onSelect,
}: {
  baseCrumb: { label: string; path: string }
  browseLevels: ArtifactBrowseLevel[]
  entries: ArtifactPanelEntry[]
  listHeight: number
  onContextMenu: (item: LocalArtifactItem, x: number, y: number) => void
  onEnterFolder: (entry: ArtifactPanelEntry) => void
  onNavigateBreadcrumb: (index: number) => void
  onResizeDoubleClick: () => void
  onResizeKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void
  onResizeStart: (event: React.PointerEvent<HTMLDivElement>) => void
  selectedItem: LocalArtifactItem | null
  truncated: boolean
  onOpenPath: (path: string | undefined) => void
  onSelect: (path: string) => void
}) {
  const t = useT()
  const selectedIndex = Math.max(
    0,
    entries.findIndex((entry) => entry.item.path === selectedItem?.path),
  )
  const visibleIndex = entries.length > 0 ? selectedIndex + 1 : 0

  return (
    <section className="flex shrink-0 flex-col" style={{ height: listHeight }}>
      <ArtifactBrowserHeader
        baseCrumb={baseCrumb}
        browseLevels={browseLevels}
        count={entries.length}
        index={visibleIndex}
        onNavigate={onNavigateBreadcrumb}
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-1.5">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-1.5 pr-1">
          {entries.map((entry) => (
            <ArtifactFileTile
              key={entry.key}
              entry={entry}
              selected={entry.item.path === selectedItem?.path}
              onClick={() => onSelect(entry.item.path)}
              onContextMenu={(x, y) => onContextMenu(entry.item, x, y)}
              onDoubleClick={() => {
                if (entry.item.kind === "directory") {
                  onEnterFolder(entry)
                } else {
                  onOpenPath(entry.item.path)
                }
              }}
            />
          ))}
        </div>
        {truncated ? (
          <p className="oo-text-caption px-1 pt-2 text-muted-foreground">{t("artifacts.truncated")}</p>
        ) : null}
      </div>
      <ArtifactPanelResizeHandle
        value={listHeight}
        onDoubleClick={onResizeDoubleClick}
        onKeyDown={onResizeKeyDown}
        onPointerDown={onResizeStart}
      />
    </section>
  )
}

function ArtifactBrowserHeader({
  baseCrumb,
  browseLevels,
  count,
  index,
  onNavigate,
}: {
  baseCrumb: { label: string; path: string }
  browseLevels: ArtifactBrowseLevel[]
  count: number
  index: number
  onNavigate: (index: number) => void
}) {
  const t = useT()
  const crumbs = [baseCrumb, ...browseLevels.map((level) => ({ label: level.label, path: level.path }))]

  return (
    <div className="shrink-0 px-2.5 pt-1.5 pb-1">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-1">
          {browseLevels.length > 0 ? (
            <button
              type="button"
              title={t("artifacts.backToParent")}
              aria-label={t("artifacts.backToParent")}
              className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={() => onNavigate(browseLevels.length - 2)}
            >
              <ChevronLeft className="size-4" />
            </button>
          ) : (
            <div
              className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground"
              aria-hidden
            >
              <FolderOpen className="size-4" />
            </div>
          )}
          <div className="oo-text-caption-compact flex min-w-0 items-center gap-1 font-medium text-muted-foreground">
            {crumbs.map((crumb, index) => {
              const active = index === crumbs.length - 1
              const navigateIndex = index - 1
              return (
                <React.Fragment key={`${crumb.path}:${index}`}>
                  {index > 0 ? <ChevronRight className="size-3 shrink-0 text-muted-foreground/60" /> : null}
                  <button
                    type="button"
                    disabled={active}
                    title={crumb.path}
                    className={cn(
                      "min-w-0 truncate rounded px-1 py-0.5 text-left disabled:cursor-default",
                      active ? "text-foreground" : "hover:bg-accent hover:text-foreground",
                    )}
                    onClick={() => onNavigate(navigateIndex)}
                  >
                    {crumb.label}
                  </button>
                </React.Fragment>
              )
            })}
          </div>
        </div>
        <div className="oo-text-caption text-muted-foreground">
          {index}/{count}
        </div>
      </div>
    </div>
  )
}

function ArtifactPanelResizeHandle({
  onDoubleClick,
  onKeyDown,
  onPointerDown,
  value,
}: {
  onDoubleClick: () => void
  onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void
  value: number
}) {
  const t = useT()

  return (
    <div
      role="separator"
      aria-label={t("artifacts.resizeFileBrowser")}
      aria-orientation="horizontal"
      aria-valuemin={artifactListMinHeightPx}
      aria-valuenow={Math.round(value)}
      tabIndex={0}
      title={t("artifacts.resizeFileBrowser")}
      className="group -mb-1 flex h-3 shrink-0 cursor-row-resize items-center outline-none"
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
    >
      <div className="h-px w-full bg-border transition-colors group-hover:bg-ring group-focus-visible:bg-ring" />
    </div>
  )
}

function ArtifactFileTile({
  entry,
  selected,
  onClick,
  onContextMenu,
  onDoubleClick,
}: {
  entry: ArtifactPanelEntry
  selected: boolean
  onClick: () => void
  onContextMenu: (x: number, y: number) => void
  onDoubleClick: () => void
}) {
  const t = useT()

  return (
    <button
      type="button"
      title={entry.item.path}
      className={cn(
        "oo-artifact-selectable relative flex h-12 min-w-0 items-center gap-1.5 rounded-md border px-1.5 text-left shadow-sm hover:text-accent-foreground focus-visible:outline-none",
        selected && "oo-artifact-selected shadow-none",
      )}
      onClick={onClick}
      onContextMenu={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onContextMenu(event.clientX, event.clientY)
      }}
      onDoubleClick={onDoubleClick}
    >
      <FileKindTile source={entry.item} pack={entry.pack} className="size-7" iconClassName="size-3.5" />
      <span className="min-w-0 flex-1">
        <span className="oo-text-caption-compact block truncate font-medium text-foreground">{entry.item.name}</span>
        <span className="oo-text-caption-compact block truncate text-muted-foreground">
          {artifactMetaLabel(t, entry.item, entry.pack)}
        </span>
      </span>
    </button>
  )
}

function ImageGalleryPanel({
  baseCrumb,
  browseLevels,
  entries,
  group,
  listHeight,
  mode,
  onContextMenu,
  onEnterFolder,
  onModeChange,
  onNavigateBreadcrumb,
  previewCache,
  selectedItem,
  onOpenPath,
  onResizeDoubleClick,
  onResizeKeyDown,
  onResizeStart,
  onSelect,
}: {
  baseCrumb: { label: string; path: string }
  browseLevels: ArtifactBrowseLevel[]
  entries: ArtifactPanelEntry[]
  group: LocalArtifactGroup | null
  listHeight: number
  mode: ArtifactPreviewMode
  onContextMenu: (item: LocalArtifactItem, x: number, y: number) => void
  onEnterFolder: (entry: ArtifactPanelEntry) => void
  onModeChange: (mode: ArtifactPreviewMode) => void
  onNavigateBreadcrumb: (index: number) => void
  previewCache: LocalArtifactPreviewCache
  selectedItem: LocalArtifactItem | null
  onOpenPath: (path: string | undefined) => void
  onResizeDoubleClick: () => void
  onResizeKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void
  onResizeStart: (event: React.PointerEvent<HTMLDivElement>) => void
  onSelect: (path: string) => void
}) {
  const selectedIndex = Math.max(
    0,
    entries.findIndex((entry) => entry.item.path === selectedItem?.path),
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <section className="flex shrink-0 flex-col" style={{ height: listHeight }}>
        <ArtifactBrowserHeader
          baseCrumb={baseCrumb}
          browseLevels={browseLevels}
          count={entries.length}
          index={selectedIndex + 1}
          onNavigate={onNavigateBreadcrumb}
        />
        <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-1.5">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(50px,1fr))] gap-1.5 pr-1">
            {entries.map((entry, index) => (
              <ImageThumbnail
                key={entry.key}
                index={index + 1}
                item={entry.item}
                previewCache={previewCache}
                selected={entry.item.path === selectedItem?.path}
                onClick={() => onSelect(entry.item.path)}
                onContextMenu={(x, y) => onContextMenu(entry.item, x, y)}
                onDoubleClick={() => {
                  if (entry.item.kind === "directory") {
                    onEnterFolder(entry)
                  } else {
                    onOpenPath(entry.item.path)
                  }
                }}
              />
            ))}
          </div>
        </div>
        <ArtifactPanelResizeHandle
          value={listHeight}
          onDoubleClick={onResizeDoubleClick}
          onKeyDown={onResizeKeyDown}
          onPointerDown={onResizeStart}
        />
      </section>
      <ImageGalleryPreview
        group={group}
        item={selectedItem}
        mode={mode}
        onModeChange={onModeChange}
        previewCache={previewCache}
        onContextMenu={onContextMenu}
        onOpen={() => onOpenPath(selectedItem?.path)}
      />
    </div>
  )
}

function ImageThumbnail({
  index,
  item,
  previewCache,
  selected,
  onClick,
  onContextMenu,
  onDoubleClick,
}: {
  index: number
  item: LocalArtifactItem
  previewCache: LocalArtifactPreviewCache
  selected: boolean
  onClick: () => void
  onContextMenu: (x: number, y: number) => void
  onDoubleClick: () => void
}) {
  const { preview } = useLocalArtifactPreview(item, previewCache)

  return (
    <button
      type="button"
      title={item.name}
      className={cn(
        "oo-artifact-selectable relative aspect-square overflow-hidden rounded-md border text-muted-foreground shadow-sm focus-visible:outline-none",
        selected && "oo-artifact-selected shadow-none",
      )}
      onClick={onClick}
      onContextMenu={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onContextMenu(event.clientX, event.clientY)
      }}
      onDoubleClick={onDoubleClick}
    >
      {preview?.kind === "image" && preview.dataUrl ? (
        <img
          src={preview.dataUrl}
          alt={item.name}
          className="size-full object-cover"
          draggable={false}
          loading="lazy"
        />
      ) : (
        <span className="flex size-full items-center justify-center">
          <Image className="size-4" />
        </span>
      )}
      <span className="absolute right-1 bottom-1 rounded bg-background/90 px-1 text-[0.625rem] leading-4 text-muted-foreground shadow-sm">
        {index}
      </span>
    </button>
  )
}

function ImageGalleryPreview({
  group,
  item,
  mode,
  onContextMenu,
  onModeChange,
  previewCache,
  onOpen,
}: {
  group: LocalArtifactGroup | null
  item: LocalArtifactItem | null
  mode: ArtifactPreviewMode
  onContextMenu: (item: LocalArtifactItem, x: number, y: number) => void
  onModeChange: (mode: ArtifactPreviewMode) => void
  previewCache: LocalArtifactPreviewCache
  onOpen: () => void
}) {
  const t = useT()
  const { loading, preview } = useLocalArtifactPreview(item, previewCache)

  React.useEffect(() => {
    if (mode === "source") {
      onModeChange("preview")
    }
  }, [mode, onModeChange])

  if (!item) {
    return <ArtifactsEmptyState />
  }

  return (
    <section
      className="flex min-h-0 flex-1 flex-col"
      onContextMenu={(event) => {
        if (!item) {
          return
        }
        event.preventDefault()
        event.stopPropagation()
        onContextMenu(item, event.clientX, event.clientY)
      }}
    >
      <div className="min-h-0 flex-1 overflow-auto">
        {mode === "info" ? (
          <ArtifactInfo item={item} group={group} />
        ) : loading ? (
          <div className="oo-text-body flex min-h-full items-center justify-center px-4 py-8 text-muted-foreground">
            {t("artifacts.previewLoading")}
          </div>
        ) : preview?.kind === "image" && preview.dataUrl ? (
          <div className="flex min-h-full items-center justify-center bg-[var(--oo-artifact-preview-canvas)] p-4">
            <img
              src={preview.dataUrl}
              alt={item.name}
              className="max-h-full max-w-full object-contain drop-shadow-sm"
              draggable={false}
              decoding="async"
              onDoubleClick={onOpen}
            />
          </div>
        ) : (
          <ArtifactConsumablePreview item={item} preview={preview} onOpen={onOpen} />
        )}
      </div>
    </section>
  )
}
