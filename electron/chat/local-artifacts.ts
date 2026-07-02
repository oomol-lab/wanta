import type {
  LocalArtifactDisplayMode,
  LocalArtifactEntry,
  LocalArtifactEntryRole,
  LocalArtifactGroup,
  LocalArtifactItem,
  LocalArtifactPack,
  LocalArtifactPackKind,
} from "./common.ts"

import { readdir, readFile, realpath, stat } from "node:fs/promises"
import path from "node:path"
import { mimeFromPath } from "./artifacts.ts"

const artifactManifestFileName = ".wanta-artifact.json"

const artifactPackKinds = new Set<LocalArtifactPackKind>([
  "image_set",
  "document",
  "spreadsheet",
  "presentation",
  "web_page",
  "code_project",
  "archive",
  "mixed",
])
const artifactDisplayModes = new Set<LocalArtifactDisplayMode>([
  "gallery",
  "document",
  "table",
  "project",
  "file_list",
  "single",
])
const artifactEntryRoles = new Set<LocalArtifactEntryRole>(["primary", "supporting", "summary", "metadata"])

interface ArtifactManifestItem {
  path?: unknown
  title?: unknown
  description?: unknown
  role?: unknown
  order?: unknown
}

interface ArtifactManifest {
  title?: unknown
  kind?: unknown
  display?: unknown
  summary?: unknown
  primary?: unknown
  items?: unknown
  supporting?: unknown
}

function localArtifactName(filePath: string): string {
  return path.basename(filePath.replace(/[\\/]+$/, "")) || filePath
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function normalizeArtifactPackKind(value: unknown): LocalArtifactPackKind {
  return typeof value === "string" && artifactPackKinds.has(value as LocalArtifactPackKind)
    ? (value as LocalArtifactPackKind)
    : "mixed"
}

function normalizeArtifactDisplayMode(value: unknown): LocalArtifactDisplayMode {
  return typeof value === "string" && artifactDisplayModes.has(value as LocalArtifactDisplayMode)
    ? (value as LocalArtifactDisplayMode)
    : "file_list"
}

function normalizeArtifactEntryRole(value: unknown, fallback: LocalArtifactEntryRole): LocalArtifactEntryRole {
  return typeof value === "string" && artifactEntryRoles.has(value as LocalArtifactEntryRole)
    ? (value as LocalArtifactEntryRole)
    : fallback
}

function manifestItems(value: unknown): ArtifactManifestItem[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter((item): item is ArtifactManifestItem => Boolean(item && typeof item === "object"))
}

function primaryPathItems(value: unknown): ArtifactManifestItem[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item, index) => ({ path: item, role: "primary", order: index + 1 }))
}

async function resolveArtifactManifestPath(rootDir: string, value: unknown): Promise<string | null> {
  const relativePath = optionalString(value)
  if (!relativePath || path.isAbsolute(relativePath) || relativePath.startsWith("~")) {
    return null
  }
  const root = path.resolve(rootDir)
  const resolved = path.resolve(root, relativePath)
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    return null
  }
  try {
    const [realRoot, realResolved] = await Promise.all([realpath(root), realpath(resolved)])
    if (realResolved !== realRoot && !realResolved.startsWith(`${realRoot}${path.sep}`)) {
      return null
    }
  } catch {
    return null
  }
  return resolved
}

export async function localArtifactItem(filePath: string): Promise<LocalArtifactItem | null> {
  try {
    const info = await stat(filePath)
    const kind = info.isDirectory() ? "directory" : "file"
    return {
      path: filePath,
      name: localArtifactName(filePath),
      kind,
      mime: kind === "directory" ? "inode/directory" : mimeFromPath(filePath),
      ...(kind === "file" ? { size: info.size } : {}),
      modifiedAt: info.mtimeMs,
    }
  } catch {
    return null
  }
}

async function artifactManifestEntry(
  rootDir: string,
  raw: ArtifactManifestItem,
  fallbackRole: LocalArtifactEntryRole,
  fallbackOrder: number,
  seen: Set<string>,
): Promise<LocalArtifactEntry | null> {
  const filePath = await resolveArtifactManifestPath(rootDir, raw.path)
  if (!filePath || seen.has(filePath)) {
    return null
  }
  const item = await localArtifactItem(filePath)
  if (!item) {
    return null
  }
  seen.add(filePath)
  const order = typeof raw.order === "number" && Number.isFinite(raw.order) ? raw.order : fallbackOrder
  return {
    ...item,
    role: normalizeArtifactEntryRole(raw.role, fallbackRole),
    order,
    ...(optionalString(raw.title) ? { title: optionalString(raw.title) } : {}),
    ...(optionalString(raw.description) ? { description: optionalString(raw.description) } : {}),
  }
}

function artifactPackVisibleCount(primaryItems: LocalArtifactEntry[], supportingItems: LocalArtifactEntry[]): number {
  const supportingVisibleCount = supportingItems.filter((item) => item.role !== "metadata").length
  return primaryItems.length + supportingVisibleCount
}

function normalizeArtifactManifestEntries(
  primaryItems: LocalArtifactEntry[],
  supportingItems: LocalArtifactEntry[],
): { primaryItems: LocalArtifactEntry[]; supportingItems: LocalArtifactEntry[] } {
  if (primaryItems.length > 0) {
    return { primaryItems, supportingItems }
  }
  const visibleSupportingItems = supportingItems.filter((item) => item.role !== "metadata")
  if (visibleSupportingItems.length !== 1) {
    return { primaryItems, supportingItems }
  }
  const promoted = { ...visibleSupportingItems[0], role: "primary" as const, order: 1 }
  return {
    primaryItems: [promoted],
    supportingItems: supportingItems.filter((item) => item.path !== promoted.path),
  }
}

export function artifactPackVisiblePaths(pack: LocalArtifactPack | null): Set<string> {
  if (!pack) {
    return new Set()
  }
  return new Set(
    [...pack.items, ...pack.supporting.filter((item) => item.role !== "metadata")].map((item) => item.path),
  )
}

export async function directoryArtifacts(dirPath: string, maxItems: number): Promise<LocalArtifactGroup | null> {
  const root = await localArtifactItem(dirPath)
  if (!root || root.kind !== "directory") {
    return null
  }
  let entries
  try {
    entries = await readdir(dirPath, { withFileTypes: true })
  } catch {
    return { root, items: [], totalItems: 0, truncated: false }
  }
  const sorted = entries
    .filter((entry) => !entry.name.startsWith("."))
    .sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) {
        return a.isDirectory() ? -1 : 1
      }
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })
    })
  const selected = sorted.slice(0, maxItems)
  const items = (await Promise.all(selected.map((entry) => localArtifactItem(path.join(dirPath, entry.name))))).filter(
    (item): item is LocalArtifactItem => Boolean(item),
  )
  return {
    root,
    items,
    totalItems: sorted.length,
    truncated: sorted.length > selected.length,
  }
}

export async function fileArtifact(filePath: string): Promise<LocalArtifactGroup | null> {
  const item = await localArtifactItem(filePath)
  if (!item || item.kind !== "file") {
    return null
  }
  return { items: [item], totalItems: 1, truncated: false }
}

export async function readArtifactPack(rootDir: string): Promise<LocalArtifactPack | null> {
  const root = await localArtifactItem(rootDir)
  if (!root || root.kind !== "directory") {
    return null
  }
  let manifest: ArtifactManifest
  try {
    manifest = JSON.parse(await readFile(path.join(rootDir, artifactManifestFileName), "utf-8")) as ArtifactManifest
  } catch {
    return null
  }
  if (!manifest || typeof manifest !== "object") {
    return null
  }
  const seen = new Set<string>()
  const primaryRawItems = manifestItems(manifest.items)
  const fallbackPrimaryItems = primaryRawItems.length > 0 ? [] : primaryPathItems(manifest.primary)
  const supportingRawItems = manifestItems(manifest.supporting)
  const resolvedItems = await Promise.all(
    [...primaryRawItems, ...fallbackPrimaryItems].map((item, index) =>
      artifactManifestEntry(rootDir, item, "primary", index + 1, seen),
    ),
  )
  const primaryItems = resolvedItems
    .filter((item): item is LocalArtifactEntry => Boolean(item))
    .filter((item) => item.role === "primary")
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, undefined, { numeric: true }))
  const secondaryFromItems = resolvedItems
    .filter((item): item is LocalArtifactEntry => Boolean(item))
    .filter((item) => item.role !== "primary")
  const resolvedSupporting = await Promise.all(
    supportingRawItems.map((item, index) => artifactManifestEntry(rootDir, item, "supporting", index + 1, seen)),
  )
  const supportingItems = [
    ...secondaryFromItems,
    ...resolvedSupporting.filter((item): item is LocalArtifactEntry => Boolean(item)),
  ].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, undefined, { numeric: true }))
  const normalized = normalizeArtifactManifestEntries(primaryItems, supportingItems)
  if (normalized.primaryItems.length === 0 && normalized.supportingItems.length === 0) {
    return null
  }
  return {
    root,
    title: optionalString(manifest.title) ?? root.name,
    kind: normalizeArtifactPackKind(manifest.kind),
    display: normalizeArtifactDisplayMode(manifest.display),
    ...(optionalString(manifest.summary) ? { summary: optionalString(manifest.summary) } : {}),
    items: normalized.primaryItems,
    supporting: normalized.supportingItems,
    totalItems: artifactPackVisibleCount(normalized.primaryItems, normalized.supportingItems),
    truncated: false,
  }
}
