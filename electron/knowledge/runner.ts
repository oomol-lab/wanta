import type { BookMeta, ReadonlyDocument, WikiGraphLibraryArchiveRecord } from "wiki-graph-core"

import { mkdir, stat } from "node:fs/promises"
import path from "node:path"
import {
  addWikiGraphLibraryArchive as addWikiGraphLibraryArchiveWithSDK,
  getWikiGraphLibraryArchive,
  isArchiveSearchIndexCurrent,
  listChapters,
  listWikiGraphLibraryArchives as listWikiGraphLibraryArchivesWithSDK,
  parseWikiGraphLibraryUri,
  readArchiveIndexSettings,
  rebindWikiGraphLibrary,
  removeWikiGraphLibraryArchive as removeWikiGraphLibraryArchiveWithSDK,
  upgradeWikiGraphMaintenanceTarget,
  WikiGraphArchiveFile,
  withWikiGraphRuntimeStateDirectoryPath,
} from "wiki-graph-core"

const defaultLibraryUri = "wikg://lib"
const defaultLibraryPreparationByStateDir = new Map<string, Promise<void>>()
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

export interface WikiGraphIndexState {
  ftsCurrent?: boolean
  current?: boolean
  querySupport?: boolean
  status?: string
}

interface InspectChapter {
  knowledgeGraphReady: boolean
  readingGraphReady: boolean
  stage: string
  summaryReady: boolean
  words: number
}

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

function safeImportTarget(sourcePath: string): string {
  const parsed = path.parse(sourcePath)
  const base = parsed.name
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 80)
  return `${base || "archive"}-${Date.now().toString(36)}.wikg`
}

function safeLibraryDirectory(targetDirectory: string | undefined): string {
  const parts: string[] = []
  for (const part of (targetDirectory ?? "").trim().replace(/\\+/gu, "/").split("/")) {
    if (!part || part === ".") continue
    if (part === "..") {
      parts.pop()
      continue
    }
    const sanitized = part
      .normalize("NFKD")
      .replace(/[^a-zA-Z0-9._ -]+/gu, "-")
      .replace(/^[-. ]+|[-. ]+$/gu, "")
      .slice(0, 80)
    if (sanitized) parts.push(sanitized)
  }
  return parts.join("/")
}

function safeImportRelativePath(sourcePath: string, targetDirectory: string | undefined): string {
  const fileName = safeImportTarget(sourcePath)
  const directory = safeLibraryDirectory(targetDirectory)
  return directory ? `${directory}/${fileName}` : fileName
}

async function withRuntime<T>(runtime: WikiGraphRuntime, fallback: string, operation: () => Promise<T>): Promise<T> {
  try {
    return await withWikiGraphRuntimeStateDirectoryPath(runtime.stateDir, operation)
  } catch (error) {
    throw wikiGraphError(runtime, fallback, error)
  }
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
    const imported = await addWikiGraphLibraryArchiveWithSDK({
      inputPath: sourcePath,
      target: requireLibraryTarget(`${defaultLibraryUri}/arc`),
      to: safeImportRelativePath(sourcePath, targetDirectory),
    })
    try {
      await prepareImportedArchiveForUse(imported)
    } catch (error) {
      await removeWikiGraphLibraryArchiveWithSDK({ target: requireLibraryTarget(imported.uri) }).catch(
        (cleanupError: unknown) => {
          console.warn("[wanta] failed to clean unreadable WikiGraph import:", cleanupError)
        },
      )
      throw new Error(unreadableImportMessage, { cause: error })
    }
    return archiveFromRecord(imported)
  })
}

async function prepareImportedArchiveForUse(record: WikiGraphLibraryArchiveRecord): Promise<void> {
  await upgradeWikiGraphMaintenanceTarget(record.path)
  // wiki-graph-core@0.4.0 has no separate repair API for current-schema archives whose TOC is still
  // structurally unreadable. Keep this validation boundary explicit so a future SDK repair call can
  // be inserted before the checks without treating a copied file as a completed product import.
  await validateImportedArchive(record.path)
}

async function validateImportedArchive(archivePath: string): Promise<void> {
  const file = new WikiGraphArchiveFile(archivePath)
  await file.read(async (archive) => {
    await archive.readMeta()
  })
  await file.readDocument(async (document) => {
    await listChapters(document)
    await readArchiveIndexSettings(document)
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

export async function readWikiGraphMetadata(runtime: WikiGraphRuntime, id: string): Promise<WikiGraphMetadata> {
  const file = await archiveFile(runtime, id)
  return await withRuntime(runtime, "Failed to read WikiGraph metadata", async () => {
    return await file.read(async (archive) => metadataFromBookMeta(await archive.readMeta()))
  })
}

export async function inspectWikiGraph(runtime: WikiGraphRuntime, id: string): Promise<WikiGraphInspect> {
  const file = await archiveFile(runtime, id)
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

export async function readWikiGraphIndex(runtime: WikiGraphRuntime, id: string): Promise<WikiGraphIndexState> {
  const file = await archiveFile(runtime, id)
  return await withRuntime(runtime, "Failed to read WikiGraph index state", async () => {
    return await file.readDocument(async (document) => {
      await readArchiveIndexSettings(document)
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

async function archiveFile(runtime: WikiGraphRuntime, id: string): Promise<WikiGraphArchiveFile> {
  await prepareWikiGraphDefaultLibrary(runtime)
  return await withRuntime(runtime, "Failed to resolve WikiGraph archive", async () => {
    const archive = await getWikiGraphLibraryArchive(requireLibraryTarget(archiveUri(id.trim())))
    return new WikiGraphArchiveFile(archive.path)
  })
}

async function readInspectChapters(document: ReadonlyDocument): Promise<InspectChapter[]> {
  return await Promise.all(
    (await listChapters(document)).map(async (chapter) => {
      const serial = await document.serials.getById(chapter.chapterId)
      return {
        knowledgeGraphReady: serial?.knowledgeGraphReady === true,
        readingGraphReady: serial?.topologyReady === true,
        stage: chapter.stage,
        summaryReady: chapter.stage === "summarized",
        words: chapter.words,
      }
    }),
  )
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
