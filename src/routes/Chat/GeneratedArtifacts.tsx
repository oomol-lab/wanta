import type {
  LocalArtifactGroup,
  LocalArtifactItem,
  LocalArtifactPreviewResult,
} from "../../../electron/chat/common.ts"
import type { GeneratedArtifactSource } from "./artifact-sources.ts"
import type { TranslateFn } from "@/i18n/i18n"

import { ExternalLink, File, FileCode, FileText, FolderOpen, Image, Package, PanelRightClose } from "lucide-react"
import * as React from "react"
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockCopyButton,
  CodeBlockFilename,
  CodeBlockHeader,
  CodeBlockTitle,
} from "@/components/ai-elements/code-block"
import { useChatService } from "@/components/AppContext"
import { Button } from "@/components/ui/button"
import { useT } from "@/i18n/i18n"
import { cn } from "@/lib/utils"

const previewLimit = 4
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

export interface ArtifactSelection {
  messageId: string
  group: LocalArtifactGroup
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

interface ResolvedArtifactGroup {
  messageId: string
  group: LocalArtifactGroup
}

const artifactResolveCacheLimit = 24

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

function isImageArtifact(item: LocalArtifactItem | undefined): boolean {
  return Boolean(item?.mime.toLowerCase().startsWith("image/"))
}

function isTextArtifact(item: LocalArtifactItem | undefined): boolean {
  return Boolean(item?.mime.toLowerCase().startsWith("text/") || item?.mime === "application/json")
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
  if (isImageArtifact(item)) {
    return <Image className={iconClassName} />
  }
  if (isTextArtifact(item)) {
    return <FileCode className={iconClassName} />
  }
  if (item.mime === "application/pdf") {
    return <FileText className={iconClassName} />
  }
  return <File className={iconClassName} />
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
      <p className="oo-text-caption mt-1 max-w-52 text-muted-foreground">{t("artifacts.emptyDescription")}</p>
    </div>
  )
}

function GeneratedArtifactsGroup({
  group,
  messageId,
  onOpen,
}: {
  group: LocalArtifactGroup
  messageId: string
  onOpen: (selection: ArtifactSelection) => void
}) {
  const t = useT()
  const chatService = useChatService()
  const visibleItems = group.items.slice(0, previewLimit)
  const total = itemCount(group)
  const remaining = Math.max(0, total - visibleItems.length)

  const openRoot = async (event: React.MouseEvent): Promise<void> => {
    event.stopPropagation()
    if (!group.root) {
      onOpen({ messageId, group })
      return
    }
    await chatService.invoke("openLocalPath", { path: group.root.path }).catch(() => undefined)
  }

  return (
    <div className="grid gap-1.5">
      {group.root ? (
        <div className="flex min-w-0 items-center gap-1.5">
          <button
            type="button"
            title={group.root.path}
            className="oo-border-divider flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md border bg-background/70 px-2 text-left text-xs hover:bg-accent hover:text-accent-foreground"
            onClick={() => onOpen({ messageId, group })}
          >
            <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">{group.root.name}</span>
            <span className="shrink-0 text-muted-foreground">{artifactSummary(t, group)}</span>
          </button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            title={t("artifacts.openFolder")}
            className="h-7 shrink-0 gap-1 px-2 text-xs"
            onClick={(event) => void openRoot(event)}
          >
            <FolderOpen className="size-3.5" />
            {t("artifacts.open")}
          </Button>
        </div>
      ) : null}

      {visibleItems.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {visibleItems.map((item) => (
            <button
              key={item.path}
              type="button"
              title={item.path}
              className="oo-border-divider flex h-7 max-w-44 min-w-0 items-center gap-1.5 rounded-md border bg-background/70 px-2 text-left text-xs hover:bg-accent hover:text-accent-foreground"
              onClick={() => onOpen({ messageId, group })}
            >
              <ArtifactIcon item={item} className="text-muted-foreground" />
              <span className="min-w-0 truncate">{item.name}</span>
            </button>
          ))}
          {remaining > 0 ? (
            <button
              type="button"
              className="flex h-7 items-center gap-1 rounded-md px-2 text-xs text-primary hover:bg-accent"
              onClick={() => onOpen({ messageId, group })}
            >
              {t("artifacts.viewAll", { count: total })}
              <span aria-hidden>→</span>
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function artifactGroupPaths(group: LocalArtifactGroup): string[] {
  return [group.root?.path, ...group.items.map((item) => item.path)].filter((item): item is string => Boolean(item))
}

function fileExtension(name: string): string {
  const index = name.lastIndexOf(".")
  return index > 0 ? name.slice(index).toLowerCase() : ""
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
          setGroups(resultGroups.findLast((group) => group.length > 0) ?? [])
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
    const resolved = groups[0]
    if (resolved) {
      onAvailable(resolved)
    }
  }, [groups, onAvailable])

  if (groups.length === 0) {
    return null
  }

  return (
    <section className="not-prose -mt-1 grid gap-1.5">
      <div className="oo-text-caption font-medium text-muted-foreground">{t("artifacts.title")}</div>
      <div className="grid gap-1.5">
        {groups.map(({ messageId, group }) => (
          <GeneratedArtifactsGroup
            key={group.root?.path ?? group.items.map((item) => item.path).join("\n")}
            group={group}
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
  const group = selection?.group ?? null
  const [selectedPath, setSelectedPath] = React.useState<string | null>(null)
  const selectedItem = group?.items.find((item) => item.path === selectedPath) ?? group?.items[0] ?? null

  const openPath = (filePath: string | undefined): void => {
    if (filePath) {
      void chatService.invoke("openLocalPath", { path: filePath }).catch(() => undefined)
    }
  }

  React.useEffect(() => {
    setSelectedPath((current) => {
      if (current && group?.items.some((item) => item.path === current)) {
        return current
      }
      return group?.items[0]?.path ?? null
    })
  }, [group])

  return (
    <aside className="oo-border-divider flex h-full min-h-0 w-full flex-col border-l bg-background">
      <header className="oo-border-divider flex h-[var(--app-titlebar-height)] shrink-0 items-center justify-between gap-3 border-b px-3 [-webkit-app-region:drag]">
        <div className="min-w-0">
          <div className="oo-text-title truncate">{t("artifacts.title")}</div>
        </div>
        <div className="flex shrink-0 items-center gap-1 [-webkit-app-region:no-drag]">
          {group?.root ? (
            <button
              type="button"
              title={t("artifacts.openFolder")}
              aria-label={t("artifacts.openFolder")}
              className="oo-toolbar-button flex size-8 shrink-0 items-center justify-center rounded-md hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground"
              onClick={() => openPath(group.root?.path)}
            >
              <FolderOpen className="size-4" />
            </button>
          ) : null}
          {selectedItem ? (
            <button
              type="button"
              title={t("artifacts.openFile")}
              aria-label={t("artifacts.openFile")}
              className="oo-toolbar-button flex size-8 shrink-0 items-center justify-center rounded-md hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground"
              onClick={() => openPath(selectedItem.path)}
            >
              <ExternalLink className="size-4" />
            </button>
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
        {group && group.items.length > 0 ? (
          <>
            <section className="oo-border-divider max-h-[34%] shrink-0 overflow-y-auto border-b px-2 py-2">
              <div className="grid gap-1">
                {group.items.map((item) => (
                  <button
                    key={item.path}
                    type="button"
                    title={item.path}
                    className={cn(
                      "group flex h-10 min-w-0 items-center gap-2 rounded-md px-2 text-left hover:bg-accent hover:text-accent-foreground",
                      item.path === selectedItem?.path && "bg-accent text-accent-foreground",
                    )}
                    onClick={() => setSelectedPath(item.path)}
                  >
                    <ArtifactIcon item={item} className="text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate text-sm">{item.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {fileSizeLabel(item.size) || item.mime}
                    </span>
                  </button>
                ))}
              </div>
              {group.truncated ? (
                <p className="oo-text-caption px-2 pt-2 text-muted-foreground">{t("artifacts.truncated")}</p>
              ) : null}
            </section>
            <ArtifactPreview item={selectedItem} onOpen={() => openPath(selectedItem?.path)} />
          </>
        ) : (
          <ArtifactsEmptyState />
        )}
      </div>
    </aside>
  )
}

function ArtifactPreview({ item, onOpen }: { item: LocalArtifactItem | null; onOpen: () => void }) {
  const t = useT()
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

  if (!item) {
    return <ArtifactsEmptyState />
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="oo-border-divider flex min-h-11 shrink-0 items-center justify-between gap-2 border-b px-3">
        <div className="flex min-w-0 items-center gap-2">
          <ArtifactIcon item={item} className="text-muted-foreground" />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{item.name}</div>
            <div className="truncate text-xs text-muted-foreground">{fileSizeLabel(item.size) || item.mime}</div>
          </div>
        </div>
        <Button type="button" variant="outline" size="sm" className="h-7 shrink-0 gap-1 px-2 text-xs" onClick={onOpen}>
          <ExternalLink className="size-3.5" />
          {t("artifacts.open")}
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {loading ? (
          <div className="flex min-h-full items-center justify-center px-4 py-8 text-sm text-muted-foreground">
            {t("artifacts.previewLoading")}
          </div>
        ) : preview?.kind === "image" && preview.dataUrl ? (
          <div className="flex min-h-full items-center justify-center bg-[var(--oo-artifact-preview-canvas)] p-4">
            <img
              src={preview.dataUrl}
              alt={item.name}
              className="max-h-full max-w-full rounded-md border border-border bg-background object-contain shadow-sm"
              draggable={false}
              decoding="async"
            />
          </div>
        ) : preview?.kind === "text" ? (
          <div className="oo-artifact-code-preview min-h-full p-3">
            <CodeBlock code={preview.text ?? ""} language={previewLanguage(item)} showLineNumbers>
              <CodeBlockHeader>
                <CodeBlockTitle>
                  <CodeBlockFilename>{item.name}</CodeBlockFilename>
                </CodeBlockTitle>
                <CodeBlockActions>
                  <CodeBlockCopyButton aria-label={t("chat.copyMessage")} />
                </CodeBlockActions>
              </CodeBlockHeader>
            </CodeBlock>
            {preview.truncated ? (
              <p className="oo-text-caption mt-2 text-muted-foreground">{t("artifacts.previewTruncated")}</p>
            ) : null}
          </div>
        ) : (
          <div className="flex min-h-full flex-col items-center justify-center px-6 py-12 text-center">
            <div className="mb-3 flex size-12 items-center justify-center rounded-xl border border-border bg-muted/40 text-muted-foreground">
              <ArtifactIcon item={item} className="size-5" />
            </div>
            <div className="oo-text-title text-foreground">{t("artifacts.previewUnavailable")}</div>
            <p className="oo-text-caption mt-1 max-w-56 text-muted-foreground">
              {t("artifacts.previewUnavailableDescription", { type: preview?.mime ?? item.mime })}
            </p>
          </div>
        )}
      </div>
    </section>
  )
}
