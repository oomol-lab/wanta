import type {
  ArtifactBundleFailure,
  LocalArtifactGroup,
  LocalArtifactItem,
  LocalArtifactPack,
} from "../../../electron/chat/common.ts"
import type { LocalArtifactPreviewCache } from "./artifact-preview-cache.ts"
import type { ResolvedArtifactGroup } from "./artifact-resolution.ts"
import type { ArtifactBrowseLevel, ArtifactPanelEntry } from "./ArtifactBrowser.tsx"
import type { ArtifactContextMenuState } from "./ArtifactContextMenu.tsx"
import type { ArtifactPreviewMode } from "./ArtifactPreviewPane.tsx"

import { ExternalLink, FolderOpen, Maximize2, Minimize2, PanelRightClose, TriangleAlert } from "lucide-react"
import * as React from "react"
import { toast } from "sonner"
import {
  artifactGroupDisplayItem,
  artifactMetaLabel,
  isImageArtifact,
  readableArtifactTitle,
} from "./artifact-metadata.ts"
import {
  artifactListDefaultRatio,
  artifactListHeightForRatio,
  artifactListMaximumHeight,
  artifactListMinimumHeight,
  artifactListRatioForHeight,
} from "./artifact-panel-layout.ts"
import { resolveArtifactResultPayloads } from "./artifact-resolution.ts"
import { shouldRenderGeneratedArtifactsShelf } from "./artifact-shelf-visibility.ts"
import { ArtifactFileStrip, ImageGalleryPanel } from "./ArtifactBrowser.tsx"
import { ArtifactContextMenu } from "./ArtifactContextMenu.tsx"
import { ArtifactPreview, ArtifactsEmptyState } from "./ArtifactPreviewPane.tsx"
import { FileKindTile } from "./file-type-icons.tsx"
import { OutputShelfCard } from "./OutputShelfCard.tsx"
import { useArtifactFileActions } from "./use-artifact-file-actions.ts"
import { useChatService } from "@/components/AppContext"
import { useT } from "@/i18n/i18n"
import { reportRendererHandledError } from "@/lib/renderer-diagnostics"
import { resolveUserFacingError, userFacingErrorDescription } from "@/lib/user-facing-error"
import { cn } from "@/lib/utils"

const artifactListRatioStorageKey = "wanta:artifacts:list-ratio-v2"

export interface ArtifactSelection {
  messageId: string
  group: LocalArtifactGroup
  groups?: ResolvedArtifactGroup[]
  pack?: LocalArtifactPack
  selectedPath?: string
}

interface GeneratedArtifactsProps {
  groups: ResolvedArtifactGroup[]
  onOpen: (selection: ArtifactSelection) => void
  onAvailable: (selection: ArtifactSelection) => void
}

interface ArtifactsPanelProps {
  maximized: boolean
  selection: ArtifactSelection | null
  showCollapseButton?: boolean
  windowControlsOnRight: boolean
  onCollapse: () => void
  onToggleMaximized: () => void
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

function artifactBrowserHasMultipleRoots(groups: ResolvedArtifactGroup[]): boolean {
  const roots = new Set<string>()
  for (const { group, messageId } of groups) {
    roots.add(group.root?.path ?? `${messageId}:${group.items[0]?.path ?? ""}`)
    if (roots.size > 1) {
      return true
    }
  }
  return false
}

function readArtifactListRatio(): number {
  const value = Number(globalThis.localStorage?.getItem(artifactListRatioStorageKey))
  return Number.isFinite(value) && value > 0 && value < 1 ? value : artifactListDefaultRatio
}

function saveArtifactListRatio(ratio: number): void {
  try {
    globalThis.localStorage?.setItem(artifactListRatioStorageKey, ratio.toFixed(4))
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

function ArtifactPersistenceWarning({ failure }: { failure?: ArtifactBundleFailure }) {
  const t = useT()
  const declarationInvalid = failure === "artifact_declaration_invalid"
  const declarationPartial = failure === "artifact_declaration_partial"
  const projectPublishFailure = failure === "project_output_publish_failed"
  const projectPublishPartial = failure === "project_output_publish_partial"
  const titleKey = declarationInvalid
    ? "artifacts.declarationInvalidTitle"
    : declarationPartial
      ? "artifacts.declarationPartialTitle"
      : projectPublishFailure
        ? "artifacts.projectPublishFailedTitle"
        : projectPublishPartial
          ? "artifacts.projectPublishPartialTitle"
          : "artifacts.persistenceFailedTitle"
  const descriptionKey = declarationInvalid
    ? "artifacts.declarationInvalidDescription"
    : declarationPartial
      ? "artifacts.declarationPartialDescription"
      : projectPublishFailure
        ? "artifacts.projectPublishFailedDescription"
        : projectPublishPartial
          ? "artifacts.projectPublishPartialDescription"
          : "artifacts.persistenceFailedDescription"
  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/8 px-3 py-2.5">
      <div className="flex min-w-0 items-start gap-2.5">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="min-w-0">
          <p className="oo-text-label text-foreground">{t(titleKey)}</p>
          <p className="oo-text-caption mt-0.5 text-muted-foreground">{t(descriptionKey)}</p>
        </div>
      </div>
    </div>
  )
}

function lastDisplayableArtifactGroup(
  groups: readonly ResolvedArtifactGroup[],
): { displayItem: LocalArtifactItem; resolved: ResolvedArtifactGroup } | null {
  for (let index = groups.length - 1; index >= 0; index -= 1) {
    const resolved = groups[index]
    if (!resolved || resolved.status === "failed") {
      continue
    }
    const displayItem = artifactGroupDisplayItem(resolved.group, resolved.pack)
    if (displayItem) {
      return { displayItem, resolved }
    }
  }
  return null
}

export function GeneratedArtifactsShelf({
  groups,
  onContextMenu,
  onOpen,
}: {
  groups: ResolvedArtifactGroup[]
  onContextMenu: (item: LocalArtifactItem, x: number, y: number) => void
  onOpen: (selection: ArtifactSelection) => void
}) {
  const t = useT()
  const entries = flattenPanelEntries(groups)
  const newest = groups.at(-1)
  const displayable = lastDisplayableArtifactGroup(groups)
  const primary = displayable?.resolved
  const primaryDisplayItem = displayable?.displayItem

  if (!shouldRenderGeneratedArtifactsShelf(groups)) {
    return null
  }

  if (!primary || !primaryDisplayItem || entries.length === 0) {
    if (newest?.status !== "failed") {
      return null
    }
    return (
      <section className="not-prose mt-0">
        <ArtifactPersistenceWarning failure={newest.failure} />
      </section>
    )
  }

  const selection = selectionWithContext(
    primary.group,
    primary.messageId,
    groups,
    primaryDisplayItem.path,
    primary.pack,
  )
  const allImages = entries.every((entry) => isImageArtifact(entry.item))
  const itemCount = Math.max(entries.length, primary.group.totalItems)
  const isCollection = itemCount > 1
  const title =
    primary.pack?.title ??
    (allImages && isCollection
      ? t("artifacts.imageCount", { count: itemCount })
      : isCollection
        ? t("artifacts.outputCount", { count: itemCount })
        : readableArtifactTitle(primaryDisplayItem))
  const meta = isCollection
    ? t("artifacts.collectionDescription")
    : artifactMetaLabel(t, primaryDisplayItem, primary.pack)

  return (
    <section className="not-prose mt-0 grid gap-1.5">
      {newest?.status === "failed" ? (
        <ArtifactPersistenceWarning failure={newest.failure} />
      ) : primary.status === "partial" &&
        (primary.failure === "project_output_publish_failed" ||
          primary.failure === "project_output_publish_partial" ||
          primary.failure === "artifact_declaration_partial") ? (
        <ArtifactPersistenceWarning failure={primary.failure} />
      ) : null}
      <OutputShelfCard
        title={title}
        icon={
          <FileKindTile source={primaryDisplayItem} pack={primary.pack} className="size-9" iconClassName="size-4" />
        }
        description={meta}
        onClick={() => onOpen(selection)}
        onContextMenu={(event) => {
          event.preventDefault()
          event.stopPropagation()
          onContextMenu(primaryDisplayItem, event.clientX, event.clientY)
        }}
      />
    </section>
  )
}

export function GeneratedArtifacts({ groups, onOpen, onAvailable }: GeneratedArtifactsProps) {
  const { openPath, showInFolder } = useArtifactFileActions()
  const [contextMenu, setContextMenu] = React.useState<ArtifactContextMenuState | null>(null)

  React.useEffect(() => {
    const displayable = lastDisplayableArtifactGroup(groups)
    if (displayable) {
      const { displayItem, resolved } = displayable
      onAvailable(selectionWithContext(resolved.group, resolved.messageId, groups, displayItem.path, resolved.pack))
    }
  }, [groups, onAvailable])

  if (groups.length === 0) {
    return null
  }

  return (
    <>
      <GeneratedArtifactsShelf
        groups={groups}
        onContextMenu={(item, x, y) => setContextMenu({ item, x, y })}
        onOpen={onOpen}
      />
      <ArtifactContextMenu
        menu={contextMenu}
        onClose={() => setContextMenu(null)}
        onOpenPath={openPath}
        onShowInFolder={showInFolder}
      />
    </>
  )
}

export function ArtifactsPanel({
  maximized,
  selection,
  showCollapseButton = true,
  windowControlsOnRight,
  onCollapse,
  onToggleMaximized,
}: ArtifactsPanelProps) {
  const t = useT()
  const chatService = useChatService()
  const { openPath, showInFolder } = useArtifactFileActions()
  const [contextMenu, setContextMenu] = React.useState<ArtifactContextMenuState | null>(null)
  const previewCache = React.useRef<LocalArtifactPreviewCache>(new Map()).current
  const shellRef = React.useRef<HTMLElement | null>(null)
  const contentRef = React.useRef<HTMLDivElement | null>(null)
  const navigationRequestRef = React.useRef(0)
  const [artifactListRatio, setArtifactListRatio] = React.useState(readArtifactListRatio)
  const [panelHeight, setPanelHeight] = React.useState(0)
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
    const content = contentRef.current
    if (!content) {
      return
    }
    const updatePanelHeight = (): void => setPanelHeight(content.getBoundingClientRect().height)
    updatePanelHeight()
    const observer = new ResizeObserver(updatePanelHeight)
    observer.observe(content)
    return () => observer.disconnect()
  }, [])
  const artifactListHeight = artifactListHeightForRatio(artifactListRatio, panelHeight)
  const artifactListMinHeight = artifactListMinimumHeight(panelHeight)
  const artifactListMaxHeight = artifactListMaximumHeight(panelHeight)
  const [selectedPath, setSelectedPath] = React.useState<string | null>(fallbackPath)
  const [previewMode, setPreviewMode] = React.useState<ArtifactPreviewMode>("preview")
  const selectedEntry = entries.find((entry) => entry.item.path === selectedPath) ?? entries[0] ?? null
  const selectedItem = selectedEntry?.item ?? null
  const selectedPack = selectedEntry ? (selectedEntry.pack ?? null) : (selection?.pack ?? null)
  const MaximizeIcon = maximized ? Minimize2 : Maximize2
  const activeMultipleRoots = artifactBrowserHasMultipleRoots(activeGroups)
  const showImageGallery =
    selectedPack?.display === "gallery" && !activeMultipleRoots
      ? entries.length > 0
      : entries.length > 1 && entries.every((entry) => isImageArtifact(entry.item))
  const baseRoot = rootArtifactItem(groups)
  const multipleRoots = artifactBrowserHasMultipleRoots(groups)
  const baseCrumb = {
    label: multipleRoots ? t("artifacts.title") : (selection?.pack?.title ?? baseRoot?.name ?? t("artifacts.title")),
    path: multipleRoots ? "artifacts-root" : (baseRoot?.path ?? selection?.messageId ?? "artifacts-root"),
  }

  const showParent = (filePath: string | undefined): void => {
    navigationRequestRef.current += 1
    showInFolder(filePath ?? selectedEntry?.group.root?.path)
  }

  const openArtifactPath = React.useCallback(
    (path: string | undefined): void => {
      navigationRequestRef.current += 1
      openPath(path)
    },
    [openPath],
  )

  React.useLayoutEffect(() => {
    navigationRequestRef.current += 1
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
    navigationRequestRef.current += 1
    setSelectedPath(path)
    setPreviewMode("preview")
  }, [])

  const enterFolder = React.useCallback(
    async (entry: ArtifactPanelEntry): Promise<void> => {
      const requestId = navigationRequestRef.current + 1
      navigationRequestRef.current = requestId
      if (entry.item.kind !== "directory") {
        openPath(entry.item.path)
        return
      }
      try {
        const result = await chatService.invoke("resolveLocalArtifacts", { artifactRoot: entry.item.path })
        if (navigationRequestRef.current !== requestId) {
          return
        }
        const nextGroups = resolveArtifactResultPayloads(result).map((payload) => ({
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
        if (navigationRequestRef.current !== requestId) {
          return
        }
        reportRendererHandledError("generatedArtifacts.enterFolder", "Failed to resolve artifact folder", cause)
        const error = resolveUserFacingError(cause, { area: "artifact" })
        toast.error(userFacingErrorDescription(error, t))
      }
    },
    [chatService, openPath, t],
  )

  const navigateToBreadcrumb = React.useCallback(
    (index: number): void => {
      navigationRequestRef.current += 1
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

  const updateArtifactListHeight = React.useCallback(
    (nextHeight: number): void => {
      if (panelHeight <= 0) {
        return
      }
      const ratio = artifactListRatioForHeight(nextHeight, panelHeight)
      setArtifactListRatio(ratio)
      saveArtifactListRatio(ratio)
    },
    [panelHeight],
  )

  const handleArtifactListResizeStart = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>): void => {
      if (event.button !== 0 || panelHeight <= 0) {
        return
      }
      const startY = event.clientY
      const startHeight = artifactListHeight
      const pointerId = event.pointerId
      event.currentTarget.setPointerCapture(pointerId)
      const removeResizeListeners = (): void => {
        window.removeEventListener("pointermove", handlePointerMove)
        window.removeEventListener("pointerup", handlePointerUp)
        window.removeEventListener("pointercancel", handlePointerCancel)
      }
      const handlePointerMove = (moveEvent: PointerEvent): void => {
        const nextHeight = startHeight + moveEvent.clientY - startY
        setArtifactListRatio(artifactListRatioForHeight(nextHeight, panelHeight))
      }
      const handlePointerUp = (upEvent: PointerEvent): void => {
        const ratio = artifactListRatioForHeight(startHeight + upEvent.clientY - startY, panelHeight)
        setArtifactListRatio(ratio)
        saveArtifactListRatio(ratio)
        removeResizeListeners()
      }
      const handlePointerCancel = (): void => {
        setArtifactListRatio(artifactListRatioForHeight(startHeight, panelHeight))
        removeResizeListeners()
      }
      window.addEventListener("pointermove", handlePointerMove)
      window.addEventListener("pointerup", handlePointerUp)
      window.addEventListener("pointercancel", handlePointerCancel)
    },
    [artifactListHeight, panelHeight],
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
        updateArtifactListHeight(artifactListMinHeight)
        return
      }
      if (event.key === "End") {
        event.preventDefault()
        updateArtifactListHeight(artifactListMaxHeight)
      }
    },
    [artifactListHeight, artifactListMaxHeight, artifactListMinHeight, updateArtifactListHeight],
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
        onOpenPath={openArtifactPath}
        onToggleInfo={(item) => {
          navigationRequestRef.current += 1
          if (previewMode === "info" && selectedItem?.path === item.path) {
            setPreviewMode("preview")
            return
          }
          setSelectedPath(item.path)
          setPreviewMode("info")
        }}
        onShowInFolder={showInFolder}
      />
      <header
        className={cn(
          "oo-titlebar oo-artifacts-titlebar oo-border-divider flex h-[var(--app-titlebar-height)] shrink-0 items-center justify-between gap-3 border-b [-webkit-app-region:drag]",
          windowControlsOnRight && "oo-titlebar-window-controls",
        )}
      >
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
          {showCollapseButton ? (
            <button
              type="button"
              title={t("artifacts.collapse")}
              aria-label={t("artifacts.collapse")}
              className="oo-toolbar-button flex size-8 shrink-0 items-center justify-center rounded-md hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground"
              onClick={onCollapse}
            >
              <PanelRightClose className="size-4" />
            </button>
          ) : null}
        </div>
      </header>

      <div ref={contentRef} className="flex min-h-0 flex-1 flex-col">
        {hasArtifactBrowser ? (
          showImageGallery ? (
            <ImageGalleryPanel
              entries={entries}
              group={selectedEntry?.group ?? null}
              listHeight={artifactListHeight}
              listMaxHeight={artifactListMaxHeight}
              listMinHeight={artifactListMinHeight}
              previewCache={previewCache}
              mode={previewMode}
              baseCrumb={baseCrumb}
              browseLevels={browseLevels}
              selectedItem={selectedItem}
              onOpenPath={openArtifactPath}
              onContextMenu={(item, x, y) => setContextMenu({ item, x, y })}
              onEnterFolder={(entry) => void enterFolder(entry)}
              onModeChange={setPreviewMode}
              onNavigateBreadcrumb={navigateToBreadcrumb}
              onResizeDoubleClick={() => updateArtifactListHeight(panelHeight * artifactListDefaultRatio)}
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
                  listMaxHeight={artifactListMaxHeight}
                  listMinHeight={artifactListMinHeight}
                  selectedItem={selectedItem}
                  truncated={activeGroups.some(({ group }) => group.truncated)}
                  onContextMenu={(item, x, y) => setContextMenu({ item, x, y })}
                  onEnterFolder={(entry) => void enterFolder(entry)}
                  onOpenPath={openArtifactPath}
                  onNavigateBreadcrumb={navigateToBreadcrumb}
                  onResizeDoubleClick={() => updateArtifactListHeight(panelHeight * artifactListDefaultRatio)}
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
                onOpen={() => openArtifactPath(selectedItem?.path)}
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
