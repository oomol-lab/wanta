import type { LocalArtifactGroup, LocalArtifactItem } from "../../../electron/chat/common.ts"
import type { TranslateFn } from "@/i18n/i18n"

import { File, FileText, FolderOpen, Image, Package, PanelRightClose } from "lucide-react"
import * as React from "react"
import { useChatService } from "@/components/AppContext"
import { Button } from "@/components/ui/button"
import { useT } from "@/i18n/i18n"
import { cn } from "@/lib/utils"

const previewLimit = 4

export interface ArtifactSelection {
  group: LocalArtifactGroup
}

interface GeneratedArtifactsProps {
  messageId: string
  text: string
  onOpen: (selection: ArtifactSelection) => void
  onAvailable: (selection: ArtifactSelection) => void
}

interface ArtifactsPanelProps {
  selection: ArtifactSelection | null
  onCollapse: () => void
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
  if (item.mime === "application/pdf") {
    return <FileText className={iconClassName} />
  }
  return <File className={iconClassName} />
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
  onOpen,
}: {
  group: LocalArtifactGroup
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
      onOpen({ group })
      return
    }
    await chatService.invoke("openLocalPath", { path: group.root.path }).catch(() => undefined)
  }

  return (
    <div className="grid gap-2">
      {group.root ? (
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            title={group.root.path}
            className="oo-border-divider flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md border bg-background/70 px-2 text-left text-xs hover:bg-accent hover:text-accent-foreground"
            onClick={() => onOpen({ group })}
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
            className="h-8 shrink-0 gap-1 px-2"
            onClick={(event) => void openRoot(event)}
          >
            <FolderOpen className="size-3.5" />
            {t("artifacts.open")}
          </Button>
        </div>
      ) : null}

      {visibleItems.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {visibleItems.map((item) => (
            <button
              key={item.path}
              type="button"
              title={item.path}
              className="oo-border-divider flex h-8 max-w-48 min-w-0 items-center gap-2 rounded-md border bg-background/70 px-2 text-left text-xs hover:bg-accent hover:text-accent-foreground"
              onClick={() => onOpen({ group })}
            >
              <ArtifactIcon item={item} className="text-muted-foreground" />
              <span className="min-w-0 truncate">{item.name}</span>
            </button>
          ))}
          {remaining > 0 ? (
            <button
              type="button"
              className="flex h-8 items-center gap-1 rounded-md px-2 text-xs text-primary hover:bg-accent"
              onClick={() => onOpen({ group })}
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

export function GeneratedArtifacts({ messageId, text, onOpen, onAvailable }: GeneratedArtifactsProps) {
  const t = useT()
  const chatService = useChatService()
  const [groups, setGroups] = React.useState<LocalArtifactGroup[]>([])

  React.useEffect(() => {
    const trimmed = text.trim()
    if (!trimmed) {
      setGroups([])
      return
    }
    let cancelled = false
    void chatService
      .invoke("resolveLocalArtifacts", { text: trimmed })
      .then((result) => {
        if (!cancelled) {
          setGroups(result.groups)
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
  }, [chatService, messageId, text])

  React.useEffect(() => {
    const group = groups[0]
    if (group) {
      onAvailable({ group })
    }
  }, [groups, onAvailable])

  if (groups.length === 0) {
    return null
  }

  return (
    <section className="not-prose mt-3 grid gap-2">
      <div className="oo-text-caption font-medium text-muted-foreground">{t("artifacts.title")}</div>
      <div className="grid gap-2">
        {groups.map((group) => (
          <GeneratedArtifactsGroup
            key={group.root?.path ?? group.items.map((item) => item.path).join("\n")}
            group={group}
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
  const openRootPath = group?.root?.path ?? group?.items[0]?.path

  const openPath = (filePath: string | undefined): void => {
    if (filePath) {
      void chatService.invoke("openLocalPath", { path: filePath }).catch(() => undefined)
    }
  }

  return (
    <aside className="oo-border-divider flex h-full min-h-0 w-full flex-col border-l bg-background">
      <header className="oo-border-divider flex h-[var(--app-titlebar-height)] shrink-0 items-center justify-between gap-3 border-b px-3 [-webkit-app-region:drag]">
        <div className="min-w-0">
          <div className="oo-text-title truncate">{t("artifacts.title")}</div>
        </div>
        <div className="flex shrink-0 items-center gap-1 [-webkit-app-region:no-drag]">
          {openRootPath ? (
            <button
              type="button"
              title={group?.root ? t("artifacts.openFolder") : t("artifacts.openFile")}
              aria-label={group?.root ? t("artifacts.openFolder") : t("artifacts.openFile")}
              className="oo-toolbar-button flex size-8 shrink-0 items-center justify-center rounded-md hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground"
              onClick={() => openPath(openRootPath)}
            >
              <FolderOpen className="size-4" />
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

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {group && group.items.length > 0 ? (
          <section className="grid gap-2">
            <div className="grid gap-1">
              {group.items.map((item) => (
                <button
                  key={item.path}
                  type="button"
                  title={item.path}
                  className="group flex h-10 min-w-0 items-center gap-2 rounded-md px-2 text-left hover:bg-accent hover:text-accent-foreground"
                  onClick={() => openPath(item.path)}
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
              <p className="oo-text-caption text-muted-foreground">{t("artifacts.truncated")}</p>
            ) : null}
          </section>
        ) : (
          <ArtifactsEmptyState />
        )}
      </div>
    </aside>
  )
}
