import type {
  LocalArtifactGroup,
  LocalArtifactItem,
  LocalArtifactPreviewResult,
} from "../../../electron/chat/common.ts"
import type { GeneratedArtifactSource } from "./artifact-sources.ts"
import type { TranslateFn } from "@/i18n/i18n"

import {
  Code2,
  Copy,
  ExternalLink,
  File,
  FileCode,
  FileJson,
  FileText,
  FolderOpen,
  Image,
  Info,
  Music,
  Package,
  PanelRightClose,
  Table,
  Video,
} from "lucide-react"
import * as React from "react"
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockCopyButton,
  CodeBlockFilename,
  CodeBlockHeader,
  CodeBlockTitle,
} from "@/components/ai-elements/code-block"
import { MessageResponse } from "@/components/ai-elements/message"
import { useChatService } from "@/components/AppContext"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useT } from "@/i18n/i18n"
import { writeClipboardText } from "@/lib/clipboard"
import { cn } from "@/lib/utils"

const previewLimit = 4
const artifactResolveCacheLimit = 24
const intermediateCodeExtensions = new Set([
  ".bash",
  ".c",
  ".cc",
  ".cjs",
  ".cpp",
  ".cs",
  ".css",
  ".cxx",
  ".dart",
  ".fish",
  ".go",
  ".h",
  ".hpp",
  ".html",
  ".htm",
  ".java",
  ".js",
  ".jsx",
  ".kt",
  ".kts",
  ".less",
  ".lua",
  ".mjs",
  ".php",
  ".pl",
  ".py",
  ".r",
  ".rb",
  ".rs",
  ".sass",
  ".scala",
  ".scss",
  ".sh",
  ".svelte",
  ".swift",
  ".ts",
  ".tsx",
  ".vue",
  ".zsh",
])
const codeRequestPattern =
  /\b(api|app|cli|code|component|css|html|javascript|js|node|program|python|react|script|typescript|ts|website)\b|代码|脚本|程序|网页|网站|应用|组件|前端|后端|接口|库|插件|扩展|源码|项目/i

export interface ResolvedArtifactGroup {
  messageId: string
  group: LocalArtifactGroup
}

export interface ArtifactSelection {
  messageId: string
  group: LocalArtifactGroup
  groups?: ResolvedArtifactGroup[]
  selectedPath?: string
}

interface GeneratedArtifactsProps {
  sources: GeneratedArtifactSource[]
  onOpen: (selection: ArtifactSelection) => void
  onAvailable: (selection: ArtifactSelection) => void
}

interface ArtifactsPanelProps {
  selection: ArtifactSelection | null
  onCollapse: () => void
}

type ArtifactPreviewMode = "preview" | "source" | "info"
type ArtifactDisplayKind =
  | "markdown"
  | "image"
  | "video"
  | "audio"
  | "pdf"
  | "table"
  | "json"
  | "code"
  | "text"
  | "file"

interface ArtifactPanelEntry {
  key: string
  messageId: string
  group: LocalArtifactGroup
  item: LocalArtifactItem
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
  cache: Map<string, LocalArtifactGroup[]>,
  key: string,
  groups: LocalArtifactGroup[],
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

function itemCount(group: LocalArtifactGroup): number {
  return group.root?.kind === "directory" ? group.totalItems : group.items.length
}

function fileSizeLabel(size: number | undefined): string {
  if (!Number.isFinite(size) || !size || size <= 0) {
    return ""
  }
  if (size < 1024) {
    return `${size} B`
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`
  }
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

function fileExtension(name: string): string {
  const index = name.lastIndexOf(".")
  return index > 0 ? name.slice(index).toLowerCase() : ""
}

function filenameWithoutExtension(name: string): string {
  const extension = fileExtension(name)
  return extension ? name.slice(0, -extension.length) : name
}

function readableArtifactTitle(item: LocalArtifactItem): string {
  const base = filenameWithoutExtension(item.name).replace(/[_-]+/g, " ").trim()
  return base || item.name
}

function parentPath(filePath: string): string | null {
  const normalized = filePath.replace(/[\\/]+$/, "")
  const index = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"))
  if (index <= 0) {
    return null
  }
  return normalized.slice(0, index)
}

function isImageArtifact(item: LocalArtifactItem | undefined): boolean {
  return Boolean(item?.mime.toLowerCase().startsWith("image/"))
}

function isVideoArtifact(item: LocalArtifactItem | undefined): boolean {
  return Boolean(item?.mime.toLowerCase().startsWith("video/"))
}

function isAudioArtifact(item: LocalArtifactItem | undefined): boolean {
  return Boolean(item?.mime.toLowerCase().startsWith("audio/"))
}

function isMarkdownArtifact(item: LocalArtifactItem | undefined): boolean {
  if (!item) {
    return false
  }
  return item.mime === "text/markdown" || [".md", ".markdown", ".mdx"].includes(fileExtension(item.name))
}

function isCsvArtifact(item: LocalArtifactItem | undefined): boolean {
  return Boolean(item && (item.mime === "text/csv" || fileExtension(item.name) === ".csv"))
}

function isJsonArtifact(item: LocalArtifactItem | undefined): boolean {
  return Boolean(item && (item.mime === "application/json" || fileExtension(item.name) === ".json"))
}

function isTextArtifact(item: LocalArtifactItem | undefined): boolean {
  return Boolean(item?.mime.toLowerCase().startsWith("text/") || item?.mime === "application/json")
}

function artifactDisplayKind(item: LocalArtifactItem | undefined): ArtifactDisplayKind {
  if (!item) {
    return "file"
  }
  if (isMarkdownArtifact(item)) {
    return "markdown"
  }
  if (isImageArtifact(item)) {
    return "image"
  }
  if (isVideoArtifact(item)) {
    return "video"
  }
  if (isAudioArtifact(item)) {
    return "audio"
  }
  if (item.mime === "application/pdf") {
    return "pdf"
  }
  if (isCsvArtifact(item)) {
    return "table"
  }
  if (isJsonArtifact(item)) {
    return "json"
  }
  if (isTextArtifact(item)) {
    const extension = fileExtension(item.name)
    return intermediateCodeExtensions.has(extension) ? "code" : "text"
  }
  return "file"
}

function artifactKindLabel(t: TranslateFn, item: LocalArtifactItem | undefined): string {
  switch (artifactDisplayKind(item)) {
    case "markdown":
      return t("artifacts.kindMarkdown")
    case "image":
      return t("artifacts.kindImage")
    case "video":
      return t("artifacts.kindVideo")
    case "audio":
      return t("artifacts.kindAudio")
    case "pdf":
      return t("artifacts.kindPdf")
    case "table":
      return t("artifacts.kindTable")
    case "json":
      return t("artifacts.kindJson")
    case "code":
      return t("artifacts.kindCode")
    case "text":
      return t("artifacts.kindText")
    default:
      return t("artifacts.kindFile")
  }
}

function artifactMetaLabel(t: TranslateFn, item: LocalArtifactItem): string {
  return [artifactKindLabel(t, item), fileSizeLabel(item.size)].filter(Boolean).join(" · ")
}

function artifactSummary(t: TranslateFn, group: LocalArtifactGroup): string {
  const count = itemCount(group)
  const imageCount = group.items.filter(isImageArtifact).length
  if (imageCount > 0 && imageCount === group.items.length) {
    return t("artifacts.imageCount", { count })
  }
  return t("artifacts.count", { count })
}

function ArtifactIcon({ item, className }: { item: LocalArtifactItem; className?: string }) {
  const iconClassName = cn("size-4 shrink-0", className)
  if (item.kind === "directory") {
    return <FolderOpen className={iconClassName} />
  }
  switch (artifactDisplayKind(item)) {
    case "markdown":
      return <FileText className={iconClassName} />
    case "image":
      return <Image className={iconClassName} />
    case "video":
      return <Video className={iconClassName} />
    case "audio":
      return <Music className={iconClassName} />
    case "table":
      return <Table className={iconClassName} />
    case "json":
      return <FileJson className={iconClassName} />
    case "code":
      return <FileCode className={iconClassName} />
    default:
      return <File className={iconClassName} />
  }
}

function previewLanguage(item: LocalArtifactItem): string {
  const extension = fileExtension(item.name).slice(1)
  switch (extension) {
    case "bash":
    case "fish":
    case "sh":
    case "zsh":
      return "bash"
    case "cjs":
    case "js":
    case "mjs":
      return "javascript"
    case "htm":
    case "html":
      return "html"
    case "json":
      return "json"
    case "md":
      return "markdown"
    case "py":
      return "python"
    case "ts":
      return "typescript"
    case "tsx":
      return "tsx"
    case "txt":
      return "text"
    default:
      return extension || "text"
  }
}

function artifactGroupPaths(group: LocalArtifactGroup): string[] {
  return [group.root?.path, ...group.items.map((item) => item.path)].filter((item): item is string => Boolean(item))
}

function sourceRequestsCode(source: GeneratedArtifactSource): boolean {
  return codeRequestPattern.test(source.requestText)
}

function isIntermediateCodeArtifact(item: LocalArtifactItem, source: GeneratedArtifactSource): boolean {
  return !sourceRequestsCode(source) && intermediateCodeExtensions.has(fileExtension(item.name))
}

function isDisplayableArtifactGroup(group: LocalArtifactGroup): boolean {
  return group.items.length > 0
}

function filterArtifactGroups(groups: LocalArtifactGroup[], source: GeneratedArtifactSource): LocalArtifactGroup[] {
  const sourcePaths = new Set(source.sourcePaths)
  return groups.flatMap((group) => {
    const rootExcluded = Boolean(group.root && sourcePaths.has(group.root.path))
    const items = group.items.filter((item) => !sourcePaths.has(item.path) && !isIntermediateCodeArtifact(item, source))
    if (items.length === 0) {
      return []
    }
    if (rootExcluded) {
      return [{ items, totalItems: items.length, truncated: false }]
    }
    return [{ ...group, items, totalItems: group.root?.kind === "directory" ? items.length : group.totalItems }]
  })
}

function mergeArtifactGroups(groups: LocalArtifactGroup[][], source: GeneratedArtifactSource): LocalArtifactGroup[] {
  const merged: LocalArtifactGroup[] = []
  const seenPaths = new Set<string>()
  for (const groupList of groups) {
    for (const group of filterArtifactGroups(groupList.filter(isDisplayableArtifactGroup), source)) {
      const paths = artifactGroupPaths(group)
      if (paths.length > 0 && paths.every((item) => seenPaths.has(item))) {
        continue
      }
      merged.push(group)
      for (const item of paths) {
        seenPaths.add(item)
      }
    }
  }
  return merged
}

function flattenPanelEntries(groups: ResolvedArtifactGroup[]): ArtifactPanelEntry[] {
  return groups.flatMap(({ messageId, group }, groupIndex) =>
    group.items.map((item) => ({
      key: `${messageId}:${group.root?.path ?? groupIndex}:${item.path}`,
      messageId,
      group,
      item,
    })),
  )
}

function selectionWithContext(
  group: LocalArtifactGroup,
  messageId: string,
  groups: ResolvedArtifactGroup[],
  selectedPath?: string,
): ArtifactSelection {
  return { messageId, group, groups, selectedPath }
}

function ArtifactsEmptyState() {
  const t = useT()

  return (
    <div className="flex min-h-full flex-col items-center justify-center px-6 py-12 text-center">
      <div className="relative mb-4 flex size-14 items-center justify-center rounded-2xl border border-border/70 bg-muted/40 text-muted-foreground shadow-sm">
        <Package className="size-6" />
        <div className="absolute -right-1 -bottom-1 flex size-6 items-center justify-center rounded-full border border-border bg-background shadow-sm">
          <File className="size-3.5" />
        </div>
      </div>
      <div className="oo-text-title text-foreground">{t("artifacts.emptyTitle")}</div>
      <p className="oo-text-caption mt-1 max-w-56 text-muted-foreground">{t("artifacts.emptyDescription")}</p>
    </div>
  )
}

function GeneratedArtifactsGroup({
  group,
  groups,
  messageId,
  onOpen,
}: {
  group: LocalArtifactGroup
  groups: ResolvedArtifactGroup[]
  messageId: string
  onOpen: (selection: ArtifactSelection) => void
}) {
  const t = useT()
  const visibleItems = group.items.slice(0, previewLimit)
  const primaryItem = group.items[0]
  const total = itemCount(group)
  const remaining = Math.max(0, total - visibleItems.length)

  if (!primaryItem) {
    return null
  }

  return (
    <button
      type="button"
      title={group.root?.path ?? primaryItem.path}
      className="oo-border-divider flex min-w-0 flex-col gap-2 rounded-lg border bg-background/70 p-2 text-left shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground"
      onClick={() => onOpen(selectionWithContext(group, messageId, groups, primaryItem.path))}
    >
      <div className="flex min-w-0 items-center gap-2">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <ArtifactIcon item={primaryItem} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{readableArtifactTitle(primaryItem)}</div>
          <div className="truncate text-xs text-muted-foreground">
            {artifactMetaLabel(t, primaryItem)}
            {group.items.length > 1 ? ` · ${artifactSummary(t, group)}` : ""}
          </div>
        </div>
        <Badge variant="outline" className="rounded-md px-1.5 py-0 text-[0.6875rem]">
          {artifactKindLabel(t, primaryItem)}
        </Badge>
      </div>

      {visibleItems.length > 1 ? (
        <div className="flex flex-wrap gap-1.5">
          {visibleItems.map((item) => (
            <span
              key={item.path}
              className="oo-border-divider flex h-7 max-w-40 min-w-0 items-center gap-1.5 rounded-md border bg-background/70 px-2 text-xs"
            >
              <ArtifactIcon item={item} className="size-3.5 text-muted-foreground" />
              <span className="min-w-0 truncate">{item.name}</span>
            </span>
          ))}
          {remaining > 0 ? (
            <span className="flex h-7 items-center rounded-md px-2 text-xs text-primary">
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
  const [groups, setGroups] = React.useState<ResolvedArtifactGroup[]>([])
  const resolvedGroupsCache = React.useRef(new Map<string, LocalArtifactGroup[]>())

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
        return cached.map((group) => ({ messageId: source.messageId, group }))
      }
      const trimmed = source.text.trim()
      if (!source.artifactRoot && !trimmed) {
        rememberArtifactGroups(resolvedGroupsCache.current, cacheKey, [])
        return []
      }
      const requests: Array<Promise<LocalArtifactGroup[]>> = []
      if (source.artifactRoot) {
        requests.push(
          chatService
            .invoke("resolveLocalArtifacts", { artifactRoot: source.artifactRoot })
            .then((result) => result.groups),
        )
      }
      if (trimmed) {
        requests.push(chatService.invoke("resolveLocalArtifacts", { text: trimmed }).then((result) => result.groups))
      }
      const resultGroups = await Promise.all(requests)
      const mergedGroups = mergeArtifactGroups(resultGroups, source)
      rememberArtifactGroups(resolvedGroupsCache.current, cacheKey, mergedGroups)
      return mergedGroups.map((group) => ({
        messageId: source.messageId,
        group,
      }))
    })
    void Promise.all(sourceRequests)
      .then((resultGroups) => {
        if (!cancelled) {
          setGroups(resultGroups.flat())
        }
      })
      .catch(() => {
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
    const selectedPath = resolved?.group.items[0]?.path
    if (resolved && selectedPath) {
      onAvailable(selectionWithContext(resolved.group, resolved.messageId, groups, selectedPath))
    }
  }, [groups, onAvailable])

  if (groups.length === 0) {
    return null
  }

  return (
    <section className="not-prose -mt-1 grid gap-1.5">
      <div className="oo-text-caption font-medium text-muted-foreground">
        {t("artifacts.generatedSummary", { count: flattenPanelEntries(groups).length })}
      </div>
      <div className="grid gap-1.5">
        {groups.map(({ messageId, group }) => (
          <GeneratedArtifactsGroup
            key={group.root?.path ?? group.items.map((item) => item.path).join("\n")}
            group={group}
            groups={groups}
            messageId={messageId}
            onOpen={onOpen}
          />
        ))}
      </div>
    </section>
  )
}

export function ArtifactsPanel({ selection, onCollapse }: ArtifactsPanelProps) {
  const t = useT()
  const chatService = useChatService()
  const groups = React.useMemo(() => {
    if (selection?.groups?.length) {
      return selection.groups
    }
    return selection ? [{ messageId: selection.messageId, group: selection.group }] : []
  }, [selection])
  const entries = React.useMemo(() => flattenPanelEntries(groups), [groups])
  const showArtifactList = entries.length > 1
  const showImageGallery = entries.length > 1 && entries.every((entry) => isImageArtifact(entry.item))
  const fallbackPath = selection?.selectedPath ?? selection?.group.items[0]?.path ?? null
  const [selectedPath, setSelectedPath] = React.useState<string | null>(fallbackPath)
  const selectedEntry = entries.find((entry) => entry.item.path === selectedPath) ?? entries[0] ?? null
  const selectedItem = selectedEntry?.item ?? null

  const openPath = (filePath: string | undefined): void => {
    if (filePath) {
      void chatService.invoke("openLocalPath", { path: filePath }).catch(() => undefined)
    }
  }

  const showParent = (filePath: string | undefined): void => {
    const dirPath = filePath ? parentPath(filePath) : selectedEntry?.group.root?.path
    openPath(dirPath ?? selectedEntry?.group.root?.path)
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

  return (
    <aside className="oo-border-divider flex h-full min-h-0 w-full flex-col border-l bg-background">
      <header className="oo-border-divider flex h-[var(--app-titlebar-height)] shrink-0 items-center justify-between gap-3 border-b px-3 [-webkit-app-region:drag]">
        <div className="oo-text-title min-w-0 truncate">{t("artifacts.title")}</div>
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
              selectedItem={selectedItem}
              onOpenPath={openPath}
              onSelect={(path) => setSelectedPath(path)}
            />
          ) : (
            <>
              {showArtifactList ? (
                <section className="oo-border-divider max-h-[32%] shrink-0 overflow-y-auto border-b px-2 py-2">
                  <div className="grid gap-1">
                    {entries.map((entry) => (
                      <button
                        key={entry.key}
                        type="button"
                        title={entry.item.path}
                        className={cn(
                          "group relative flex min-h-12 min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent hover:text-accent-foreground",
                          entry.item.path === selectedItem?.path &&
                            "bg-accent text-accent-foreground before:absolute before:top-1.5 before:bottom-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-primary",
                        )}
                        onClick={() => setSelectedPath(entry.item.path)}
                        onDoubleClick={() => openPath(entry.item.path)}
                      >
                        <ArtifactIcon item={entry.item} className="text-muted-foreground" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">
                            {readableArtifactTitle(entry.item)}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {artifactMetaLabel(t, entry.item)}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                  {groups.some(({ group }) => group.truncated) ? (
                    <p className="oo-text-caption px-2 pt-2 text-muted-foreground">{t("artifacts.truncated")}</p>
                  ) : null}
                </section>
              ) : null}
              <ArtifactPreview
                item={selectedItem}
                group={selectedEntry?.group ?? null}
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

function useLocalArtifactPreview(item: LocalArtifactItem | null): {
  loading: boolean
  preview: LocalArtifactPreviewResult | null
} {
  const chatService = useChatService()
  const [preview, setPreview] = React.useState<LocalArtifactPreviewResult | null>(null)
  const [loading, setLoading] = React.useState(false)

  React.useEffect(() => {
    if (!item || item.kind !== "file") {
      setPreview(null)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    void chatService
      .invoke("getLocalArtifactPreview", { path: item.path })
      .then((result) => {
        if (!cancelled) {
          setPreview(result)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPreview({ kind: "unsupported", mime: item.mime, size: item.size })
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [chatService, item])

  return { loading, preview }
}

function ImageGalleryPanel({
  entries,
  group,
  selectedItem,
  onOpenPath,
  onSelect,
}: {
  entries: ArtifactPanelEntry[]
  group: LocalArtifactGroup | null
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
      <section className="oo-border-divider shrink-0 border-b px-3 py-2">
        <div className="flex items-center justify-between gap-3">
          <div className="oo-text-caption font-medium text-muted-foreground">
            {t("artifacts.imageCount", { count: entries.length })}
          </div>
          <div className="oo-text-caption text-muted-foreground">
            {selectedIndex + 1}/{entries.length}
          </div>
        </div>
        <div className="mt-2 grid max-h-36 grid-cols-[repeat(auto-fill,minmax(58px,1fr))] gap-2 overflow-y-auto pr-1">
          {entries.map((entry, index) => (
            <ImageThumbnail
              key={entry.key}
              index={index + 1}
              item={entry.item}
              selected={entry.item.path === selectedItem?.path}
              onClick={() => onSelect(entry.item.path)}
              onDoubleClick={() => onOpenPath(entry.item.path)}
            />
          ))}
        </div>
      </section>
      <ImageGalleryPreview group={group} item={selectedItem} onOpen={() => onOpenPath(selectedItem?.path)} />
    </div>
  )
}

function ImageThumbnail({
  index,
  item,
  selected,
  onClick,
  onDoubleClick,
}: {
  index: number
  item: LocalArtifactItem
  selected: boolean
  onClick: () => void
  onDoubleClick: () => void
}) {
  const { preview } = useLocalArtifactPreview(item)

  return (
    <button
      type="button"
      title={item.name}
      className={cn(
        "relative aspect-square overflow-hidden rounded-md border bg-[var(--oo-artifact-preview-canvas)] text-muted-foreground shadow-sm transition-colors hover:border-primary/60",
        selected ? "border-primary ring-2 ring-primary/20" : "border-border",
      )}
      onClick={onClick}
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
  onOpen,
}: {
  group: LocalArtifactGroup | null
  item: LocalArtifactItem | null
  onOpen: () => void
}) {
  const t = useT()
  const [mode, setMode] = React.useState<"preview" | "info">("preview")
  const { loading, preview } = useLocalArtifactPreview(item)

  React.useEffect(() => {
    setMode("preview")
  }, [item?.path])

  if (!item) {
    return <ArtifactsEmptyState />
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="oo-border-divider flex h-10 shrink-0 items-center justify-between gap-3 border-b px-3">
        <div className="min-w-0 truncate text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{item.name}</span>
          {fileSizeLabel(item.size) ? <span> · {fileSizeLabel(item.size)}</span> : null}
        </div>
        <button
          type="button"
          title={t("artifacts.infoTab")}
          aria-label={t("artifacts.infoTab")}
          className={cn(
            "oo-toolbar-button flex size-7 shrink-0 items-center justify-center rounded-md hover:bg-accent hover:text-foreground",
            mode === "info" && "bg-accent text-foreground",
          )}
          onClick={() => setMode((current) => (current === "info" ? "preview" : "info"))}
        >
          <Info className="size-3.5" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {mode === "info" ? (
          <ArtifactInfo item={item} group={group} />
        ) : loading ? (
          <div className="flex min-h-full items-center justify-center px-4 py-8 text-sm text-muted-foreground">
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

function ArtifactPreview({
  group,
  item,
  onOpen,
}: {
  group: LocalArtifactGroup | null
  item: LocalArtifactItem | null
  onOpen: () => void
}) {
  const t = useT()
  const { loading, preview } = useLocalArtifactPreview(item)
  const [mode, setMode] = React.useState<ArtifactPreviewMode>("preview")
  const canShowSource = preview?.kind === "text"

  React.useEffect(() => {
    setMode("preview")
  }, [item?.path])

  if (!item) {
    return <ArtifactsEmptyState />
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="oo-border-divider shrink-0 border-b px-3 py-2">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
              <ArtifactIcon item={item} />
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{readableArtifactTitle(item)}</div>
              <div className="truncate text-xs text-muted-foreground">{artifactMetaLabel(t, item)}</div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            {canShowSource ? <CopyContentButton text={preview.text ?? ""} /> : null}
            {canShowSource ? (
              <button
                type="button"
                title={t("artifacts.sourceTab")}
                aria-label={t("artifacts.sourceTab")}
                className={cn(
                  "oo-toolbar-button flex size-7 items-center justify-center rounded-md hover:bg-accent hover:text-foreground",
                  mode === "source" && "bg-accent text-foreground",
                )}
                onClick={() => setMode((current) => (current === "source" ? "preview" : "source"))}
              >
                <Code2 className="size-3.5" />
              </button>
            ) : null}
            <button
              type="button"
              title={t("artifacts.infoTab")}
              aria-label={t("artifacts.infoTab")}
              className={cn(
                "oo-toolbar-button flex size-7 items-center justify-center rounded-md hover:bg-accent hover:text-foreground",
                mode === "info" && "bg-accent text-foreground",
              )}
              onClick={() => setMode((current) => (current === "info" ? "preview" : "info"))}
            >
              <Info className="size-3.5" />
            </button>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {loading ? (
          <div className="flex min-h-full items-center justify-center px-4 py-8 text-sm text-muted-foreground">
            {t("artifacts.previewLoading")}
          </div>
        ) : mode === "info" ? (
          <ArtifactInfo item={item} group={group} />
        ) : mode === "source" && canShowSource ? (
          <ArtifactSourcePreview item={item} preview={preview} />
        ) : (
          <ArtifactConsumablePreview item={item} preview={preview} onOpen={onOpen} />
        )}
      </div>
    </section>
  )
}

function CopyContentButton({ text }: { text: string }) {
  const t = useT()
  const [copied, setCopied] = React.useState(false)

  const copy = async (): Promise<void> => {
    if (await writeClipboardText(text)) {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    }
  }

  return (
    <button
      type="button"
      title={copied ? t("artifacts.copied") : t("artifacts.copyContent")}
      aria-label={copied ? t("artifacts.copied") : t("artifacts.copyContent")}
      className="oo-toolbar-button flex size-7 items-center justify-center rounded-md hover:bg-accent hover:text-foreground"
      onClick={() => void copy()}
    >
      <Copy className="size-3.5" />
    </button>
  )
}

function ArtifactSourcePreview({
  item,
  preview,
}: {
  item: LocalArtifactItem
  preview: LocalArtifactPreviewResult | null
}) {
  const t = useT()

  return (
    <div className="oo-artifact-code-preview min-h-full p-3">
      <CodeBlock code={preview?.text ?? ""} language={previewLanguage(item)} showLineNumbers>
        <CodeBlockHeader>
          <CodeBlockTitle>
            <CodeBlockFilename>{item.name}</CodeBlockFilename>
          </CodeBlockTitle>
          <CodeBlockActions>
            <CodeBlockCopyButton aria-label={t("chat.copyMessage")} />
          </CodeBlockActions>
        </CodeBlockHeader>
      </CodeBlock>
      {preview?.truncated ? (
        <p className="oo-text-caption mt-2 text-muted-foreground">{t("artifacts.previewTruncated")}</p>
      ) : null}
    </div>
  )
}

function ArtifactConsumablePreview({
  item,
  preview,
  onOpen,
}: {
  item: LocalArtifactItem
  preview: LocalArtifactPreviewResult | null
  onOpen: () => void
}) {
  const t = useT()

  if (preview?.kind === "image" && preview.dataUrl) {
    return (
      <div className="flex min-h-full items-center justify-center bg-[var(--oo-artifact-preview-canvas)] p-4">
        <img
          src={preview.dataUrl}
          alt={item.name}
          className="max-h-full max-w-full rounded-md border border-border bg-background object-contain shadow-sm"
          draggable={false}
          decoding="async"
        />
      </div>
    )
  }

  if (preview?.kind === "media" && preview.dataUrl && isVideoArtifact(item)) {
    return (
      <div className="flex min-h-full items-center justify-center bg-[var(--oo-artifact-preview-canvas)] p-4">
        <video src={preview.dataUrl} controls className="max-h-full max-w-full rounded-md bg-black shadow-sm" />
      </div>
    )
  }

  if (preview?.kind === "media" && preview.dataUrl && isAudioArtifact(item)) {
    return (
      <div className="flex min-h-full flex-col items-center justify-center gap-4 px-6 py-12 text-center">
        <div className="flex size-14 items-center justify-center rounded-2xl border border-border bg-muted/40 text-muted-foreground shadow-sm">
          <Music className="size-6" />
        </div>
        <div className="w-full max-w-sm">
          <audio src={preview.dataUrl} controls className="w-full" />
        </div>
      </div>
    )
  }

  if (preview?.kind === "text" && isMarkdownArtifact(item)) {
    return (
      <div className="min-h-full px-5 py-4">
        <MessageResponse className="oo-markdown max-w-none text-sm leading-6">{preview.text ?? ""}</MessageResponse>
        {preview.truncated ? (
          <p className="oo-text-caption mt-3 text-muted-foreground">{t("artifacts.previewTruncated")}</p>
        ) : null}
      </div>
    )
  }

  if (preview?.kind === "text") {
    return <ArtifactSourcePreview item={item} preview={preview} />
  }

  return (
    <div className="flex min-h-full flex-col items-center justify-center px-6 py-12 text-center">
      <div className="mb-3 flex size-12 items-center justify-center rounded-xl border border-border bg-muted/40 text-muted-foreground">
        <ArtifactIcon item={item} className="size-5" />
      </div>
      <div className="oo-text-title text-foreground">{t("artifacts.previewUnavailable")}</div>
      <p className="oo-text-caption mt-1 max-w-60 text-muted-foreground">
        {t("artifacts.previewUnavailableDescription", { type: preview?.mime ?? item.mime })}
      </p>
      <Button type="button" variant="outline" size="sm" className="mt-4 h-8 gap-1 px-3 text-xs" onClick={onOpen}>
        <ExternalLink className="size-3.5" />
        {t("artifacts.open")}
      </Button>
    </div>
  )
}

function ArtifactInfo({ group, item }: { group: LocalArtifactGroup | null; item: LocalArtifactItem }) {
  const t = useT()
  const rows = [
    [t("artifacts.infoName"), item.name],
    [t("artifacts.infoType"), item.mime],
    [t("artifacts.infoSize"), fileSizeLabel(item.size) || "-"],
    [t("artifacts.infoPath"), item.path],
    ...(group?.root ? ([[t("artifacts.infoFolder"), group.root.path]] as string[][]) : []),
  ]

  return (
    <div className="grid gap-3 p-4">
      {rows.map(([label, value]) => (
        <div key={label} className="grid gap-1">
          <div className="oo-text-caption font-medium text-muted-foreground">{label}</div>
          <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm break-all">{value}</div>
        </div>
      ))}
    </div>
  )
}
