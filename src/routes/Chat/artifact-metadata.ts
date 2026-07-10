import type { LocalArtifactGroup, LocalArtifactItem, LocalArtifactPack } from "../../../electron/chat/common.ts"
import type { TranslateFn } from "@/i18n/i18n"

import { fileVisualKind } from "./file-type-kind.ts"

export type ArtifactDisplayKind =
  | "markdown"
  | "web_page"
  | "image"
  | "video"
  | "audio"
  | "archive"
  | "directory"
  | "document"
  | "pdf"
  | "table"
  | "json"
  | "code"
  | "text"
  | "file"

export function fileSizeLabel(size: number | undefined): string {
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

export function fileExtension(name: string): string {
  const index = name.lastIndexOf(".")
  return index > 0 ? name.slice(index).toLowerCase() : ""
}

function filenameWithoutExtension(name: string): string {
  const extension = fileExtension(name)
  return extension ? name.slice(0, -extension.length) : name
}

export function readableArtifactTitle(item: LocalArtifactItem): string {
  const base = filenameWithoutExtension(item.name).replace(/[_-]+/g, " ").trim()
  return base || item.name
}

export function isImageArtifact(item: LocalArtifactItem | undefined): boolean {
  return Boolean(item?.mime.toLowerCase().startsWith("image/"))
}

export function isVideoArtifact(item: LocalArtifactItem | undefined): boolean {
  return Boolean(item?.mime.toLowerCase().startsWith("video/"))
}

export function isAudioArtifact(item: LocalArtifactItem | undefined): boolean {
  return Boolean(item?.mime.toLowerCase().startsWith("audio/"))
}

export function isMarkdownArtifact(item: LocalArtifactItem | undefined): boolean {
  if (!item) {
    return false
  }
  return item.mime === "text/markdown" || [".md", ".markdown", ".mdx"].includes(fileExtension(item.name))
}

export function isCsvArtifact(item: LocalArtifactItem | undefined): boolean {
  return Boolean(
    item &&
    (item.mime === "text/csv" ||
      item.mime === "text/tab-separated-values" ||
      [".csv", ".tsv"].includes(fileExtension(item.name))),
  )
}

export function isHtmlArtifact(item: LocalArtifactItem | undefined): boolean {
  return Boolean(item && ["text/html", "application/xhtml+xml"].includes(item.mime.toLowerCase()))
}

export function artifactDisplayKind(
  item: LocalArtifactItem | undefined,
  pack?: LocalArtifactPack | null,
): ArtifactDisplayKind {
  if (!item) {
    return "file"
  }
  switch (fileVisualKind(item, pack)) {
    case "archive":
      return "archive"
    case "audio":
      return "audio"
    case "code":
      return "code"
    case "directory":
      return "directory"
    case "document":
      return "document"
    case "image":
      return "image"
    case "json":
      return "json"
    case "markdown":
      return "markdown"
    case "pdf":
      return "pdf"
    case "spreadsheet":
      return "table"
    case "text":
      return "text"
    case "video":
      return "video"
    case "web_page":
      return "web_page"
    default:
      return "file"
  }
}

export function artifactKindLabel(
  t: TranslateFn,
  item: LocalArtifactItem | undefined,
  pack?: LocalArtifactPack | null,
): string {
  switch (artifactDisplayKind(item, pack)) {
    case "markdown":
      return t("artifacts.kindMarkdown")
    case "web_page":
      return t("artifacts.kindWebPage")
    case "image":
      return t("artifacts.kindImage")
    case "video":
      return t("artifacts.kindVideo")
    case "audio":
      return t("artifacts.kindAudio")
    case "archive":
      return t("artifacts.kindArchive")
    case "directory":
      return t("artifacts.kindFolder")
    case "document":
      return t("artifacts.kindDocument")
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

export function artifactMetaLabel(t: TranslateFn, item: LocalArtifactItem, pack?: LocalArtifactPack | null): string {
  return [artifactKindLabel(t, item, pack), fileSizeLabel(item.size)].filter(Boolean).join(" · ")
}

export function artifactGroupDisplayItem(
  group: LocalArtifactGroup,
  pack?: LocalArtifactPack | null,
): LocalArtifactItem | undefined {
  if (
    group.root?.kind === "directory" &&
    (pack?.display === "file_list" ||
      pack?.display === "project" ||
      (!pack && group.totalItems > 1 && !group.items.every(isImageArtifact)))
  ) {
    return group.root
  }
  return group.items[0] ?? group.root
}

export function artifactSummary(t: TranslateFn, group: LocalArtifactGroup): string {
  const count = group.root?.kind === "directory" ? group.totalItems : group.items.length
  const imageCount = group.items.filter(isImageArtifact).length
  if (imageCount > 0 && imageCount === group.items.length) {
    return t("artifacts.imageCount", { count })
  }
  return t("artifacts.count", { count })
}

export function previewLanguage(item: LocalArtifactItem): string {
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
