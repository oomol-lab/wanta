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

import { ExternalLink, Eye, FolderOpen, Image, Info, Maximize2, Minimize2, PanelRightClose } from "lucide-react"
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
  const { openPath, showInFolder } = useArtifactFileActions()
  const [contextMenu, setContextMenu] = React.useState<ArtifactContextMenuState | null>(null)
  const previewCache = React.useRef<LocalArtifactPreviewCache>(new Map()).current
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
  const entries = React.useMemo(() => flattenPanelEntries(groups), [groups])
  const showArtifactList = entries.length > 1
  const fallbackPath = selection?.selectedPath ?? entries[0]?.item.path ?? selection?.group.root?.path ?? null
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

  const showParent = (filePath: string | undefined): void => {
    showInFolder(filePath ?? selectedEntry?.group.root?.path)
  }

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

  return (
    <aside
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
        {entries.length > 0 ? (
          showImageGallery ? (
            <ImageGalleryPanel
              entries={entries}
              group={selectedEntry?.group ?? null}
              previewCache={previewCache}
              mode={previewMode}
              selectedItem={selectedItem}
              onOpenPath={openPath}
              onContextMenu={(item, x, y) => setContextMenu({ item, x, y })}
              onModeChange={setPreviewMode}
              onSelect={selectPreviewPath}
            />
          ) : (
            <>
              {showArtifactList ? (
                <ArtifactFileStrip
                  entries={entries}
                  selectedItem={selectedItem}
                  truncated={groups.some(({ group }) => group.truncated)}
                  onContextMenu={(item, x, y) => setContextMenu({ item, x, y })}
                  onOpenPath={openPath}
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
  entries,
  onContextMenu,
  selectedItem,
  truncated,
  onOpenPath,
  onSelect,
}: {
  entries: ArtifactPanelEntry[]
  onContextMenu: (item: LocalArtifactItem, x: number, y: number) => void
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

  return (
    <section className="oo-border-divider shrink-0 border-b px-2.5 py-1.5">
      <div className="flex items-center justify-between gap-3">
        <div className="oo-text-caption-compact font-medium text-muted-foreground">
          {t("artifacts.count", { count: entries.length })}
        </div>
        <div className="oo-text-caption text-muted-foreground">
          {selectedIndex + 1}/{entries.length}
        </div>
      </div>
      <div className="mt-1.5 grid max-h-28 grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-1.5 overflow-y-auto pr-1">
        {entries.map((entry) => (
          <ArtifactFileTile
            key={entry.key}
            entry={entry}
            selected={entry.item.path === selectedItem?.path}
            onClick={() => onSelect(entry.item.path)}
            onContextMenu={(x, y) => onContextMenu(entry.item, x, y)}
            onDoubleClick={() => onOpenPath(entry.item.path)}
          />
        ))}
      </div>
      {truncated ? <p className="oo-text-caption px-1 pt-2 text-muted-foreground">{t("artifacts.truncated")}</p> : null}
    </section>
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
  entries,
  group,
  mode,
  onContextMenu,
  onModeChange,
  previewCache,
  selectedItem,
  onOpenPath,
  onSelect,
}: {
  entries: ArtifactPanelEntry[]
  group: LocalArtifactGroup | null
  mode: ArtifactPreviewMode
  onContextMenu: (item: LocalArtifactItem, x: number, y: number) => void
  onModeChange: (mode: ArtifactPreviewMode) => void
  previewCache: LocalArtifactPreviewCache
  selectedItem: LocalArtifactItem | null
  onOpenPath: (path: string | undefined) => void
  onSelect: (path: string) => void
}) {
  const t = useT()
  const selectedIndex = Math.max(
    0,
    entries.findIndex((entry) => entry.item.path === selectedItem?.path),
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <section className="oo-border-divider shrink-0 border-b px-2.5 py-1.5">
        <div className="flex items-center justify-between gap-3">
          <div className="oo-text-caption-compact font-medium text-muted-foreground">
            {t("artifacts.imageCount", { count: entries.length })}
          </div>
          <div className="oo-text-caption text-muted-foreground">
            {selectedIndex + 1}/{entries.length}
          </div>
        </div>
        <div className="mt-1.5 grid max-h-32 grid-cols-[repeat(auto-fill,minmax(50px,1fr))] gap-1.5 overflow-y-auto pr-1">
          {entries.map((entry, index) => (
            <ImageThumbnail
              key={entry.key}
              index={index + 1}
              item={entry.item}
              previewCache={previewCache}
              selected={entry.item.path === selectedItem?.path}
              onClick={() => onSelect(entry.item.path)}
              onContextMenu={(x, y) => onContextMenu(entry.item, x, y)}
              onDoubleClick={() => onOpenPath(entry.item.path)}
            />
          ))}
        </div>
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
