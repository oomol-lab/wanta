import type { BookMeta, ReadonlyDocument, WikiGraphLibraryArchiveRecord } from "wiki-graph-core"

import { chmod, copyFile, mkdir, mkdtemp, readdir, rm, rmdir, stat } from "node:fs/promises"
import path from "node:path"
import {
  addWikiGraphLibraryArchive as addWikiGraphLibraryArchiveWithSDK,
  getWikiGraphLibraryArchive,
  isArchiveSearchIndexCurrent,
  listChapters,
  listWikiGraphLibraryArchives as listWikiGraphLibraryArchivesWithSDK,
  parseWikiGraphLibraryUri,
  readSearchIndexCapabilityStatus,
  rebindWikiGraphLibrary,
  removeWikiGraphLibraryArchive as removeWikiGraphLibraryArchiveWithSDK,
  moveWikiGraphLibraryArchive as moveWikiGraphLibraryArchiveWithSDK,
  upgradeWikiGraphMaintenanceTarget,
  WikiGraphArchiveFile,
  withWikiGraphRuntimeStateDirectoryPath,
} from "wiki-graph-core"

const defaultLibraryUri = "wikg://lib"
const defaultLibraryPreparationByStateDir = new Map<string, Promise<void>>()
const archivePreparationByStateAndPath = new Map<string, Promise<void>>()
const unreadableImportMessage =
  "WANTA_KNOWLEDGE_IMPORT_UNREADABLE: The selected WikiGraph file could not be imported because Wanta cannot make the managed copy readable with the current WikiGraph SDK. The original file was not modified."

export interface WikiGraphRuntime {
  managedLibraryDir: string
  stateDir: string
}

export interface WikiGraphLibraryArchive {
  id: string
  uri: string
  path?: string
  relativePath?: string
  createdAt?: string
  updatedAt?: string
  exists?: boolean
  status?: string
  lastSeenSize?: number
}

export interface WikiGraphMetadata {
  title?: string
  authors?: string[]
  publisher?: string
  publishedAt?: string
  language?: string
}

export interface WikiGraphMetadataUpdate {
  authors?: string[]
  title?: string
}

export interface WikiGraphInspect {
  content?: {
    chapters?: { total?: number; content?: number }
    sourceWords?: number
  }
  index?: { querySupport?: boolean; current?: boolean }
  coverage?: {
    knowledgeGraph?: { coveredWords?: number; totalWords?: number }
    readingGraph?: { coveredWords?: number; totalWords?: number }
    summary?: { coveredWords?: number; totalWords?: number }
  }
}

export interface WikiGraphChapterNode {
  children?: WikiGraphChapterNode[]
  title: string
}

export interface WikiGraphIndexState {
  ftsCurrent?: boolean
  current?: boolean
  querySupport?: boolean
  status?: string
}

interface InspectChapter {
  depth: number
  documentOrder: number
  knowledgeGraphReady: boolean
  readingGraphReady: boolean
  stage: string
  summaryReady: boolean
  title: string
  words: number
}

type WikiGraphListedChapter = Awaited<ReturnType<typeof listChapters>>[number]

function redactWikiGraphRuntimePaths(runtime: WikiGraphRuntime, value: string): string {
  let message = value
  for (const pathValue of [runtime.stateDir, runtime.managedLibraryDir]) {
    if (pathValue) message = message.replaceAll(pathValue, "[WikiGraph managed storage]")
  }
  return message
    .replace(/\/[^\s"']+\.wikg/giu, "[managed knowledge archive]")
    .replace(/wikg:\/\/[^\s"']+/giu, "[managed knowledge archive]")
}

function wikiGraphError(runtime: WikiGraphRuntime, fallback: string, error: unknown): Error {
  const source = error as { message?: unknown; stderr?: unknown }
  const raw = typeof source.stderr === "string" && source.stderr.trim() ? source.stderr : source.message
  const message = redactWikiGraphRuntimePaths(runtime, String(raw || fallback).trim() || fallback).slice(0, 500)
  return new Error(message || fallback, { cause: error })
}

function archiveUri(id: string): string {
  return `${defaultLibraryUri}/arc/${encodeURIComponent(id)}`
}

function requireLibraryTarget(uri: string) {
  const target = parseWikiGraphLibraryUri(uri)
  if (!target) throw new Error(`Invalid WikiGraph library URI: ${uri}`)
  return target
}

function archiveFromRecord(record: WikiGraphLibraryArchiveRecord): WikiGraphLibraryArchive {
  return {
    id: record.publicId,
    uri: record.uri,
    path: record.path,
    relativePath: record.relativePath,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    exists: record.exists,
    status: record.status,
    lastSeenSize: record.lastSeenSize,
  }
}

function metadataFromBookMeta(meta: BookMeta | undefined): WikiGraphMetadata {
  if (!meta) return {}
  return {
    ...(meta.title ? { title: meta.title } : {}),
    authors: meta.authors,
    ...(meta.publisher ? { publisher: meta.publisher } : {}),
    ...(meta.publishedAt ? { publishedAt: meta.publishedAt } : {}),
    ...(meta.language ? { language: meta.language } : {}),
  }
}

function importFileName(sourcePath: string): string {
  const baseName = path.basename(sourcePath)
  if (!baseName || baseName === "." || baseName === "..") return "archive.wikg"
  return normalizeKnowledgeFileName(baseName)
}

function normalizeLibraryPathSegments(value: string, fallbackLabel: string): string {
  const raw = value.trim()
  if (!raw) throw new Error(fallbackLabel)
  if (raw.includes("\\")) throw new Error("Knowledge library paths must use / separators")
  if (path.isAbsolute(raw)) throw new Error("Knowledge library paths must stay inside the managed library")

  const parts: string[] = []
  for (const part of raw.split("/")) {
    const segment = part.trim()
    if (!segment || segment === "." || segment === "..") {
      throw new Error("Knowledge library paths must stay inside the managed library")
    }
    if (segment.includes(":")) throw new Error("Knowledge library paths contain invalid characters")
    parts.push(segment)
  }
  return parts.join("/")
}

function normalizeKnowledgeFileName(fileName: string): string {
  const normalized = normalizeLibraryPathSegments(fileName, "Knowledge library file name is required")
  if (normalized.includes("/")) throw new Error("Knowledge library file names cannot include folders")
  return normalized.toLowerCase().endsWith(".wikg") ? normalized : `${normalized}.wikg`
}

function normalizeKnowledgeDirectory(directory: string | undefined, fallbackLabel: string): string {
  if (!directory) return ""
  return normalizeLibraryPathSegments(directory, fallbackLabel)
}

function normalizeKnowledgeTargetPath(targetDirectory: string | undefined, fileName: string): string {
  const directory = normalizeKnowledgeDirectory(targetDirectory, "Knowledge library target directory is invalid")
  const baseName = normalizeKnowledgeFileName(fileName)
  return directory ? `${directory}/${baseName}` : baseName
}

function ensureKnowledgePathWithinLibrary(runtime: WikiGraphRuntime, relativePath: string): void {
  const target = path.resolve(runtime.managedLibraryDir, relativePath)
  const managedRoot = path.resolve(runtime.managedLibraryDir)
  const prefix = `${managedRoot}${path.sep}`
  if (target !== managedRoot && !target.startsWith(prefix)) {
    throw new Error("Knowledge library paths must stay inside the managed library")
  }
}

function pathEquals(left: string, right: string): boolean {
  return left.localeCompare(right, undefined, { sensitivity: "accent" }) === 0
}

function pathMatchesPrefix(value: string, prefix: string): boolean {
  return value === prefix || value.startsWith(`${prefix}/`)
}

function importCandidatePath(sourcePath: string, targetDirectory: string | undefined, duplicateIndex?: number): string {
  const fileName = importFileName(sourcePath)
  const candidateFileName =
    duplicateIndex && duplicateIndex > 1
      ? `${path.basename(fileName, path.extname(fileName))} ${duplicateIndex}${path.extname(fileName) || ".wikg"}`
      : fileName
  const directory = normalizeKnowledgeDirectory(targetDirectory, "Knowledge library target directory is invalid")
  return directory ? `${directory}/${candidateFileName}` : candidateFileName
}

async function importRelativePath(runtime: WikiGraphRuntime, sourcePath: string, targetDirectory: string | undefined) {
  const archives = await listWikiGraphLibraryArchives(runtime)
  const folders = await listKnowledgeLibraryFolders(runtime)
  for (let index = 1; index <= 1000; index += 1) {
    const candidate = importCandidatePath(sourcePath, targetDirectory, index === 1 ? undefined : index)
    ensureKnowledgePathWithinLibrary(runtime, candidate)
    const physicalPathExists = Boolean(await stat(path.join(runtime.managedLibraryDir, candidate)).catch(() => null))
    const archiveConflict = archives.some((archive) => {
      const archivePath = archive.relativePath || archive.path || `${archive.id}.wikg`
      return pathEquals(archivePath, candidate)
    })
    const folderConflict = folders.some((folder) => pathEquals(folder, candidate))
    if (!physicalPathExists && !archiveConflict && !folderConflict) return candidate
  }
  throw new Error("Knowledge library path already exists")
}

async function withRuntime<T>(runtime: WikiGraphRuntime, fallback: string, operation: () => Promise<T>): Promise<T> {
  try {
    return await withWikiGraphRuntimeStateDirectoryPath(runtime.stateDir, operation)
  } catch (error) {
    throw wikiGraphError(runtime, fallback, error)
  }
}

async function listKnowledgeLibraryFolders(runtime: WikiGraphRuntime): Promise<string[]> {
  await prepareWikiGraphDefaultLibrary(runtime)
  const folders = new Set<string>()
  const root = path.resolve(runtime.managedLibraryDir)

  const walk = async (directory: string, relativeDirectory = ""): Promise<void> => {
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const childRelativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name
      ensureKnowledgePathWithinLibrary(runtime, childRelativePath)
      folders.add(childRelativePath)
      await walk(path.join(directory, entry.name), childRelativePath)
    }
  }

  await walk(root)
  return Array.from(folders.values()).sort((left, right) => left.localeCompare(right))
}

async function archiveRelativePaths(runtime: WikiGraphRuntime): Promise<string[]> {
  const archives = await listWikiGraphLibraryArchives(runtime)
  return archives.map((archive) => archive.relativePath || archive.path || `${archive.id}.wikg`)
}

async function ensureFolderCreateable(runtime: WikiGraphRuntime, relativePath: string): Promise<void> {
  ensureKnowledgePathWithinLibrary(runtime, relativePath)
  const archives = await archiveRelativePaths(runtime)
  const folders = await listKnowledgeLibraryFolders(runtime)
  if (
    archives.some((item) => pathEquals(item, relativePath) || pathMatchesPrefix(relativePath, item)) ||
    folders.some((item) => pathEquals(item, relativePath) || pathMatchesPrefix(item, relativePath))
  ) {
    throw new Error("Knowledge library path already exists")
  }
  let current = ""
  for (const segment of relativePath.split("/")) {
    current = current ? `${current}/${segment}` : segment
    ensureKnowledgePathWithinLibrary(runtime, current)
  }
  await mkdir(path.join(runtime.managedLibraryDir, relativePath), { recursive: true }).catch((error: unknown) => {
    if ((error as { code?: string }).code === "EEXIST") throw new Error("Knowledge library path already exists")
    throw error
  })
}

async function ensureArchiveTargetAvailable(
  runtime: WikiGraphRuntime,
  relativePath: string,
  excludeId?: string,
): Promise<void> {
  ensureKnowledgePathWithinLibrary(runtime, relativePath)
  const archives = await listWikiGraphLibraryArchives(runtime)
  const folders = await listKnowledgeLibraryFolders(runtime)
  for (const archive of archives) {
    if (excludeId && archive.id === excludeId) continue
    const archivePath = archive.relativePath || archive.path || `${archive.id}.wikg`
    if (pathEquals(archivePath, relativePath)) throw new Error("Knowledge library path already exists")
  }
  if (folders.some((item) => pathEquals(item, relativePath))) throw new Error("Knowledge library path already exists")
}

export async function prepareWikiGraphDefaultLibrary(runtime: WikiGraphRuntime): Promise<void> {
  const cached = defaultLibraryPreparationByStateDir.get(runtime.stateDir)
  if (cached) return await cached

  const preparation = withRuntime(runtime, "Failed to prepare WikiGraph library", async () => {
    await mkdir(runtime.stateDir, { recursive: true })
    await mkdir(runtime.managedLibraryDir, { recursive: true })
    await rebindWikiGraphLibrary({
      folderPath: runtime.managedLibraryDir,
      target: requireLibraryTarget(defaultLibraryUri),
    })
  }).catch((error: unknown) => {
    defaultLibraryPreparationByStateDir.delete(runtime.stateDir)
    throw error
  })
  defaultLibraryPreparationByStateDir.set(runtime.stateDir, preparation)
  return await preparation
}

export async function listWikiGraphLibraryArchives(runtime: WikiGraphRuntime): Promise<WikiGraphLibraryArchive[]> {
  await prepareWikiGraphDefaultLibrary(runtime)
  return await withRuntime(runtime, "Failed to list WikiGraph library archives", async () => {
    const records = await listWikiGraphLibraryArchivesWithSDK(requireLibraryTarget(`${defaultLibraryUri}/arc`))
    return records
      .filter((item) => item.exists !== false && item.status !== "missing")
      .map((item) => archiveFromRecord(item))
  })
}

export async function listWikiGraphLibraryFolders(runtime: WikiGraphRuntime): Promise<string[]> {
  return await withRuntime(runtime, "Failed to list WikiGraph library folders", async () => {
    return await listKnowledgeLibraryFolders(runtime)
  })
}

export async function addWikiGraphLibraryArchive(
  runtime: WikiGraphRuntime,
  sourcePath: string,
  targetDirectory?: string,
): Promise<WikiGraphLibraryArchive> {
  await prepareWikiGraphDefaultLibrary(runtime)
  let source
  try {
    source = await stat(sourcePath)
  } catch (error) {
    throw new Error("Knowledge base file is unavailable", { cause: error })
  }
  if (!source.isFile()) throw new Error("Knowledge base must be a regular file")
  return await withRuntime(runtime, "Failed to import WikiGraph archive", async () => {
    const targetPath = await importRelativePath(runtime, sourcePath, targetDirectory)
    const imported = await importPreparedWikiGraphArchive(runtime, sourcePath, targetPath)
    return archiveFromRecord(imported)
  })
}

async function importPreparedWikiGraphArchive(
  runtime: WikiGraphRuntime,
  inputPath: string,
  targetPath: string,
): Promise<WikiGraphLibraryArchiveRecord> {
  const imported = await addWikiGraphLibraryArchiveWithSDK({
    inputPath,
    target: requireLibraryTarget(`${defaultLibraryUri}/arc`),
    to: targetPath,
  })
  try {
    await prepareImportedArchiveForUse(imported)
  } catch (error) {
    await removeUnreadableImportedArchive(imported)
    if (!isNonDerivedOverlayStateError(error)) throw new Error(unreadableImportMessage, { cause: error })
    return await retryImportWithIsolatedUpgrade(runtime, inputPath, targetPath, error)
  }
  return imported
}

async function retryImportWithIsolatedUpgrade(
  runtime: WikiGraphRuntime,
  inputPath: string,
  targetPath: string,
  cause: unknown,
): Promise<WikiGraphLibraryArchiveRecord> {
  const prepared = await prepareIsolatedImportCopy(runtime, inputPath)
  try {
    const imported = await addWikiGraphLibraryArchiveWithSDK({
      inputPath: prepared.path,
      target: requireLibraryTarget(`${defaultLibraryUri}/arc`),
      to: targetPath,
    })
    try {
      await prepareImportedArchiveForUse(imported)
    } catch (error) {
      await removeUnreadableImportedArchive(imported)
      throw new Error(unreadableImportMessage, { cause: error })
    }
    return imported
  } catch (error) {
    if (error instanceof Error && error.message === unreadableImportMessage) throw error
    throw new Error(unreadableImportMessage, { cause: error instanceof Error ? error : cause })
  } finally {
    await rm(prepared.directory, { force: true, recursive: true }).catch(() => undefined)
  }
}

async function prepareIsolatedImportCopy(
  runtime: WikiGraphRuntime,
  sourcePath: string,
): Promise<{ directory: string; path: string }> {
  const directory = await mkdtemp(path.join(runtime.stateDir, "import-"))
  const archivePath = path.join(directory, path.basename(sourcePath) || "archive.wikg")
  try {
    await copyFile(sourcePath, archivePath)
    await chmod(archivePath, 0o600).catch(() => undefined)
    await withWikiGraphRuntimeStateDirectoryPath(path.join(directory, "state"), async () => {
      await upgradeWikiGraphMaintenanceTarget(archivePath)
    })
    return { directory, path: archivePath }
  } catch (error) {
    await rm(directory, { force: true, recursive: true }).catch(() => undefined)
    throw error
  }
}

async function removeUnreadableImportedArchive(imported: WikiGraphLibraryArchiveRecord): Promise<void> {
  await removeWikiGraphLibraryArchiveWithSDK({ target: requireLibraryTarget(imported.uri) }).catch(
    (cleanupError: unknown) => {
      console.warn("[wanta] failed to clean unreadable WikiGraph import:", cleanupError)
    },
  )
}

async function prepareImportedArchiveForUse(record: WikiGraphLibraryArchiveRecord): Promise<void> {
  await prepareArchivePathForUse(record.path)
  await validateImportedArchive(record.path)
}

async function prepareArchivePathForUse(archivePath: string): Promise<void> {
  try {
    await upgradeWikiGraphMaintenanceTarget(archivePath)
  } catch (error) {
    if (!isNonDerivedOverlayStateError(error)) throw error
    await upgradeWikiGraphMaintenanceTarget(defaultLibraryUri)
    await upgradeWikiGraphMaintenanceTarget(archivePath)
  }
}

function isNonDerivedOverlayStateError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("non-derived overlay state")
}

async function validateImportedArchive(archivePath: string): Promise<void> {
  const file = new WikiGraphArchiveFile(archivePath)
  await file.read(async (archive) => {
    await archive.readMeta()
  })
  await file.readDocument(async (document) => {
    await listChapters(document)
    await readSearchIndexCapabilityStatus(document)
    await isArchiveSearchIndexCurrent(document)
  })
}

export async function removeWikiGraphLibraryArchive(runtime: WikiGraphRuntime, id: string): Promise<void> {
  const normalizedId = id.trim()
  if (!normalizedId) return
  await prepareWikiGraphDefaultLibrary(runtime)
  await withRuntime(runtime, "Failed to remove WikiGraph archive", async () => {
    await removeWikiGraphLibraryArchiveWithSDK({ target: requireLibraryTarget(archiveUri(normalizedId)) })
  })
}

export async function moveWikiGraphLibraryArchive(
  runtime: WikiGraphRuntime,
  id: string,
  targetDirectory?: string,
  fileName?: string,
): Promise<WikiGraphLibraryArchive> {
  await prepareWikiGraphDefaultLibrary(runtime)
  const normalizedId = id.trim()
  const archive = await withRuntime(runtime, "Failed to resolve WikiGraph archive", async () => {
    return await getWikiGraphLibraryArchive(requireLibraryTarget(archiveUri(normalizedId)))
  })
  const currentRelativePath = archive.relativePath || archive.path || `${archive.id}.wikg`
  const nextRelativePath = normalizeKnowledgeTargetPath(targetDirectory, fileName ?? path.basename(currentRelativePath))
  if (pathEquals(currentRelativePath, nextRelativePath)) {
    return archiveFromRecord(archive)
  }
  await ensureArchiveTargetAvailable(runtime, nextRelativePath, normalizedId)
  return await withRuntime(runtime, "Failed to move WikiGraph archive", async () => {
    const moved = await moveWikiGraphLibraryArchiveWithSDK({
      target: requireLibraryTarget(archiveUri(normalizedId)),
      to: nextRelativePath,
    })
    return archiveFromRecord(moved)
  })
}

export async function createWikiGraphLibraryFolder(runtime: WikiGraphRuntime, relativePath: string): Promise<string> {
  const normalizedPath = normalizeKnowledgeDirectory(relativePath, "Knowledge library folder path is required")
  if (!normalizedPath) throw new Error("Knowledge library folder path is required")
  await prepareWikiGraphDefaultLibrary(runtime)
  await withRuntime(runtime, "Failed to create WikiGraph folder", async () => {
    await ensureFolderCreateable(runtime, normalizedPath)
  })
  return normalizedPath
}

export async function removeWikiGraphLibraryFolder(runtime: WikiGraphRuntime, relativePath: string): Promise<void> {
  const normalizedPath = normalizeKnowledgeDirectory(relativePath, "Knowledge library folder path is required")
  if (!normalizedPath) throw new Error("Knowledge library folder path is required")
  await prepareWikiGraphDefaultLibrary(runtime)
  ensureKnowledgePathWithinLibrary(runtime, normalizedPath)
  const archives = await archiveRelativePaths(runtime)
  if (archives.some((item) => pathMatchesPrefix(item, normalizedPath))) {
    throw new Error("Knowledge library folder is not empty")
  }
  const folders = await listKnowledgeLibraryFolders(runtime)
  if (!folders.some((item) => pathEquals(item, normalizedPath))) {
    throw new Error("Knowledge library folder not found")
  }
  const target = path.join(runtime.managedLibraryDir, normalizedPath)
  const entries = await readdir(target)
  if (entries.length > 0) throw new Error("Knowledge library folder is not empty")
  await rmdir(target)
}

export async function readWikiGraphMetadata(runtime: WikiGraphRuntime, id: string): Promise<WikiGraphMetadata> {
  const file = await archiveFile(runtime, id)
  return await withRuntime(runtime, "Failed to read WikiGraph metadata", async () => {
    return await file.read(async (archive) => metadataFromBookMeta(await archive.readMeta()))
  })
}

export async function updateWikiGraphMetadata(
  runtime: WikiGraphRuntime,
  id: string,
  update: WikiGraphMetadataUpdate,
): Promise<WikiGraphMetadata> {
  const file = await archiveFile(runtime, id)
  return await withRuntime(runtime, "Failed to update WikiGraph metadata", async () => {
    return await file.write(async (document) => {
      const current = await document.readBookMeta()
      const next: BookMeta = {
        authors: update.authors ?? current?.authors ?? [],
        description: current?.description ?? null,
        identifier: current?.identifier ?? null,
        language: current?.language ?? null,
        publishedAt: current?.publishedAt ?? null,
        publisher: current?.publisher ?? null,
        sourceFormat: current?.sourceFormat ?? "txt",
        title: update.title ?? current?.title ?? null,
        version: 1,
      }
      await document.replaceBookMeta(next)
      return metadataFromBookMeta(next)
    })
  })
}

export async function inspectWikiGraph(runtime: WikiGraphRuntime, id: string): Promise<WikiGraphInspect> {
  const file = await preparedDocumentArchiveFile(runtime, id)
  return await withRuntime(runtime, "Failed to inspect WikiGraph archive", async () => {
    return await file.readDocument(async (document) => {
      const [chapters, ftsCurrent] = await Promise.all([
        readInspectChapters(document),
        isArchiveSearchIndexCurrent(document),
      ])
      const contentChapters = chapters.filter((chapter) => chapter.stage !== "planned")
      const readingGraphCovered = contentChapters.filter((chapter) => chapter.readingGraphReady)
      const knowledgeGraphCovered = contentChapters.filter((chapter) => chapter.knowledgeGraphReady)
      const summaryCovered = contentChapters.filter((chapter) => chapter.summaryReady)
      return {
        content: {
          chapters: { content: contentChapters.length, total: chapters.length },
          sourceWords: sumWords(contentChapters),
        },
        index: { current: ftsCurrent, querySupport: ftsCurrent },
        coverage: {
          knowledgeGraph: inspectCoverage(knowledgeGraphCovered, contentChapters),
          readingGraph: inspectCoverage(readingGraphCovered, contentChapters),
          summary: inspectCoverage(summaryCovered, contentChapters),
        },
      }
    })
  })
}

export async function readWikiGraphChapterTree(runtime: WikiGraphRuntime, id: string): Promise<WikiGraphChapterNode[]> {
  const file = await preparedDocumentArchiveFile(runtime, id)
  return await withRuntime(runtime, "Failed to read WikiGraph chapter tree", async () => {
    return await file.readDocument(async (document) => chapterTree(await readChapterTreeEntries(document)))
  })
}

export async function readWikiGraphIndex(runtime: WikiGraphRuntime, id: string): Promise<WikiGraphIndexState> {
  const file = await preparedDocumentArchiveFile(runtime, id)
  return await withRuntime(runtime, "Failed to read WikiGraph index state", async () => {
    return await file.readDocument(async (document) => {
      await readSearchIndexCapabilityStatus(document)
      const ftsCurrent = await isArchiveSearchIndexCurrent(document)
      return {
        current: ftsCurrent,
        ftsCurrent,
        querySupport: ftsCurrent,
        status: ftsCurrent ? "current" : "missing-or-outdated",
      }
    })
  })
}

export async function readWikiGraphCover(runtime: WikiGraphRuntime, id: string): Promise<Buffer | null> {
  const file = await archiveFile(runtime, id)
  try {
    return await withRuntime(runtime, "Failed to read WikiGraph cover", async () => {
      return await file.read(async (archive) => {
        const cover = await archive.readCover()
        return cover ? Buffer.from(cover.data) : null
      })
    })
  } catch {
    return null
  }
}

export async function prepareWikiGraphArchive(runtime: WikiGraphRuntime, id: string): Promise<void> {
  await preparedDocumentArchiveFile(runtime, id)
}

async function archiveFile(runtime: WikiGraphRuntime, id: string): Promise<WikiGraphArchiveFile> {
  const { file } = await resolveArchiveFile(runtime, id)
  return file
}

async function preparedDocumentArchiveFile(runtime: WikiGraphRuntime, id: string): Promise<WikiGraphArchiveFile> {
  const { file, path: archivePath } = await resolveArchiveFile(runtime, id)
  const preparationKey = `${runtime.stateDir}\0${archivePath}`
  const cached = archivePreparationByStateAndPath.get(preparationKey)
  if (cached) {
    await cached
    return file
  }
  const preparation = withRuntime(runtime, "Failed to prepare WikiGraph archive", async () => {
    await prepareArchivePathForUse(archivePath)
  }).catch((error: unknown) => {
    archivePreparationByStateAndPath.delete(preparationKey)
    throw error
  })
  archivePreparationByStateAndPath.set(preparationKey, preparation)
  await preparation
  return file
}

async function resolveArchiveFile(
  runtime: WikiGraphRuntime,
  id: string,
): Promise<{ file: WikiGraphArchiveFile; path: string }> {
  await prepareWikiGraphDefaultLibrary(runtime)
  return await withRuntime(runtime, "Failed to resolve WikiGraph archive", async () => {
    const archive = await getWikiGraphLibraryArchive(requireLibraryTarget(archiveUri(id.trim())))
    return { file: new WikiGraphArchiveFile(archive.path), path: archive.path }
  })
}

function inspectChapterBase(
  chapter: WikiGraphListedChapter,
): Pick<InspectChapter, "depth" | "documentOrder" | "stage" | "title" | "words"> {
  const title =
    typeof chapter.title === "string" && chapter.title.trim()
      ? chapter.title.trim()
      : (chapter.tocPath ?? []).at(-1)?.trim() || chapter.key || chapter.path
  return {
    depth: typeof chapter.depth === "number" && Number.isFinite(chapter.depth) ? Math.max(0, chapter.depth) : 0,
    documentOrder:
      typeof chapter.documentOrder === "number" && Number.isFinite(chapter.documentOrder)
        ? chapter.documentOrder
        : chapter.chapterId,
    stage: chapter.stage,
    title,
    words: chapter.words,
  }
}

async function readInspectChapters(document: ReadonlyDocument): Promise<InspectChapter[]> {
  return await Promise.all(
    (await listChapters(document)).map(async (chapter) => {
      const serial = await document.serials.getById(chapter.chapterId)
      return {
        ...inspectChapterBase(chapter),
        knowledgeGraphReady: serial?.knowledgeGraphReady === true,
        readingGraphReady: serial?.topologyReady === true,
        summaryReady: chapter.stage === "summarized",
      }
    }),
  )
}

async function readChapterTreeEntries(document: ReadonlyDocument): Promise<InspectChapter[]> {
  return (await listChapters(document)).map((chapter) => {
    return {
      ...inspectChapterBase(chapter),
      knowledgeGraphReady: false,
      readingGraphReady: false,
      summaryReady: false,
    }
  })
}

function chapterTree(chapters: InspectChapter[]): WikiGraphChapterNode[] {
  const roots: WikiGraphChapterNode[] = []
  const stack: WikiGraphChapterNode[] = []
  for (const chapter of [...chapters].sort((left, right) => left.documentOrder - right.documentOrder)) {
    const node: WikiGraphChapterNode = { title: chapter.title }
    const depth = Math.min(chapter.depth, stack.length)
    const parent = depth > 0 ? stack[depth - 1] : undefined
    if (parent) {
      parent.children = [...(parent.children ?? []), node]
    } else {
      roots.push(node)
    }
    stack[depth] = node
    stack.length = depth + 1
  }
  return roots
}

function inspectCoverage(
  covered: InspectChapter[],
  total: InspectChapter[],
): { coveredWords: number; totalWords: number } {
  return { coveredWords: sumWords(covered), totalWords: sumWords(total) }
}

function sumWords(chapters: InspectChapter[]): number {
  return chapters.reduce((sum, chapter) => sum + chapter.words, 0)
}

export function wikiGraphCoverageReady(coverage: { coveredWords?: number; totalWords?: number } | undefined): boolean {
  return Boolean(coverage && (coverage.coveredWords ?? 0) > 0 && (coverage.totalWords ?? 0) > 0)
}
