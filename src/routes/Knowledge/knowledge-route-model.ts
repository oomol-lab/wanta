import type { KnowledgeBaseSummary } from "../../../electron/knowledge/common.ts"

export interface KnowledgeDirectoryNode {
  kind: "directory"
  name: string
  path: string
  archiveCount: number
}

export interface KnowledgeArchiveNode {
  kind: "archive"
  item: KnowledgeBaseSummary
  name: string
  parentPath: string
  path: string
}

export type KnowledgeFileNode = KnowledgeArchiveNode | KnowledgeDirectoryNode

export interface KnowledgeBreadcrumb {
  label: string
  path: string
}

export interface KnowledgeLibraryView {
  breadcrumbs: KnowledgeBreadcrumb[]
  currentDirectory: string
  directories: KnowledgeDirectoryNode[]
  archives: KnowledgeArchiveNode[]
  query: string
  searchMode: boolean
  totalArchives: number
}

export function isWikiGraphFileName(fileName: string): boolean {
  return fileName.trim().toLocaleLowerCase().endsWith(".wikg")
}

export function stripWikiGraphExtension(fileName: string): string {
  return fileName
    .trim()
    .replace(/(?:\.wikg)+$/giu, "")
    .trim()
}

export function knowledgeArchiveDisplayName(fileName: string): string {
  return stripWikiGraphExtension(knowledgePathBaseName(fileName))
}

export function wikiGraphDropCandidates<T extends { name: string }>(files: Iterable<T>): T[] {
  return Array.from(files).filter((file) => isWikiGraphFileName(file.name))
}

export function normalizeKnowledgePath(value: string | undefined): string {
  const parts: string[] = []
  for (const part of (value ?? "").trim().replace(/\\+/gu, "/").split("/")) {
    if (!part || part === ".") continue
    if (part === "..") parts.pop()
    else parts.push(part)
  }
  return parts.join("/")
}

export function knowledgePathBaseName(value: string): string {
  const normalized = normalizeKnowledgePath(value)
  return normalized.split("/").filter(Boolean).at(-1) ?? ""
}

export function knowledgePathDirectory(value: string): string {
  const parts = normalizeKnowledgePath(value).split("/").filter(Boolean)
  parts.pop()
  return parts.join("/")
}

export function knowledgeBreadcrumbs(currentDirectory: string, rootLabel: string): KnowledgeBreadcrumb[] {
  const parts = normalizeKnowledgePath(currentDirectory).split("/").filter(Boolean)
  const crumbs: KnowledgeBreadcrumb[] = [{ label: rootLabel, path: "" }]
  let path = ""
  for (const part of parts) {
    path = path ? `${path}/${part}` : part
    crumbs.push({ label: part, path })
  }
  return crumbs
}

function archiveNode(item: KnowledgeBaseSummary): KnowledgeArchiveNode {
  const path = normalizeKnowledgePath(item.relativePath || item.sourceFileName || `${item.id}.wikg`)
  return {
    kind: "archive",
    item,
    name: knowledgePathBaseName(path) || item.sourceFileName || item.title,
    parentPath: knowledgePathDirectory(path),
    path,
  }
}

function archiveSearchText(node: KnowledgeArchiveNode): string {
  return [node.item.title, node.item.authors.join(" "), node.item.publisher ?? "", node.item.sourceFileName, node.path]
    .join("\n")
    .toLocaleLowerCase()
}

function directChildName(parentPath: string, childPath: string): string | null {
  if (!parentPath) return childPath.split("/")[0] ?? null
  if (!childPath.startsWith(`${parentPath}/`)) return null
  return childPath.slice(parentPath.length + 1).split("/")[0] ?? null
}

function archiveCountForDirectory(archives: KnowledgeArchiveNode[], directoryPath: string): number {
  const prefix = `${directoryPath}/`
  return archives.filter((archive) => archive.parentPath === directoryPath || archive.parentPath.startsWith(prefix))
    .length
}

function addDirectoryNode(
  directories: Map<string, KnowledgeDirectoryNode>,
  archives: KnowledgeArchiveNode[],
  path: string,
): void {
  const normalized = normalizeKnowledgePath(path)
  if (!normalized || directories.has(normalized)) return
  directories.set(normalized, {
    archiveCount: archiveCountForDirectory(archives, normalized),
    kind: "directory",
    name: knowledgePathBaseName(normalized),
    path: normalized,
  })
}

function directoriesForPath(
  archives: KnowledgeArchiveNode[],
  currentDirectory: string,
  folderPaths: string[],
): KnowledgeDirectoryNode[] {
  const directories = new Map<string, KnowledgeDirectoryNode>()
  for (const archive of archives) {
    const childName = directChildName(currentDirectory, archive.parentPath)
    if (!childName) continue
    const childPath = currentDirectory ? `${currentDirectory}/${childName}` : childName
    addDirectoryNode(directories, archives, childPath)
  }
  for (const folderPath of folderPaths) {
    const normalized = normalizeKnowledgePath(folderPath)
    const childName = directChildName(currentDirectory, normalized)
    if (!childName) continue
    addDirectoryNode(directories, archives, currentDirectory ? `${currentDirectory}/${childName}` : childName)
  }
  return Array.from(directories.values()).sort((left, right) => left.name.localeCompare(right.name))
}

export function buildKnowledgeLibraryView(
  items: KnowledgeBaseSummary[],
  currentDirectory: string,
  query: string,
  rootLabel: string,
  folders: string[] = [],
): KnowledgeLibraryView {
  const normalizedDirectory = normalizeKnowledgePath(currentDirectory)
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const allArchives = items.map((item) => archiveNode(item))
  const folderPaths = folders.map((folder) => normalizeKnowledgePath(folder)).filter(Boolean)
  const visibleArchives = normalizedQuery
    ? allArchives.filter((archive) => archiveSearchText(archive).includes(normalizedQuery))
    : allArchives.filter((archive) => archive.parentPath === normalizedDirectory)

  return {
    archives: visibleArchives.sort(
      (left, right) => left.name.localeCompare(right.name) || left.path.localeCompare(right.path),
    ),
    breadcrumbs: knowledgeBreadcrumbs(normalizedDirectory, rootLabel),
    currentDirectory: normalizedDirectory,
    directories: normalizedQuery ? [] : directoriesForPath(allArchives, normalizedDirectory, folderPaths),
    query: normalizedQuery,
    searchMode: Boolean(normalizedQuery),
    totalArchives: allArchives.length,
  }
}

export function knowledgePathExists(
  items: KnowledgeBaseSummary[],
  folders: string[],
  path: string,
  excludeArchiveId?: string,
): boolean {
  const normalized = normalizeKnowledgePath(path).toLocaleLowerCase()
  if (!normalized) return false
  return (
    items.some((item) => {
      if (item.id === excludeArchiveId) return false
      return normalizeKnowledgePath(item.relativePath || item.sourceFileName).toLocaleLowerCase() === normalized
    }) || folders.some((folder) => normalizeKnowledgePath(folder).toLocaleLowerCase() === normalized)
  )
}
