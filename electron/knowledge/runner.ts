import { execFile } from "node:child_process"
import { mkdir, stat } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const metadataTimeoutMs = 30_000
const queryTimeoutMs = 60_000
const maxJsonBytes = 8 * 1024 * 1024
const maxCoverBytes = 4 * 1024 * 1024
const defaultLibraryUri = "wikg://lib"

export interface WikiGraphRuntime {
  command: string
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

export type WikiGraphExec = typeof execFileAsync

function runtimeEnv(runtime: WikiGraphRuntime): NodeJS.ProcessEnv {
  return { ...process.env, NO_COLOR: "1", WIKIGRAPH_STATE_DIR: runtime.stateDir }
}

function parseJson<T>(stdout: string, label: string): T {
  try {
    return JSON.parse(stdout) as T
  } catch (error) {
    throw new Error(`WikiGraph returned invalid ${label} JSON`, { cause: error })
  }
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
  return `${defaultLibraryUri}/arc/${id}`
}

function parseArchiveList(value: unknown): WikiGraphLibraryArchive[] {
  if (Array.isArray(value)) return value.flatMap((item) => (isArchive(item) ? [item] : []))
  const items =
    value && typeof value === "object" ? (value as { items?: unknown; archives?: unknown }).items : undefined
  if (Array.isArray(items)) return items.flatMap((item) => (isArchive(item) ? [item] : []))
  const archives = value && typeof value === "object" ? (value as { archives?: unknown }).archives : undefined
  return Array.isArray(archives) ? archives.flatMap((item) => (isArchive(item) ? [item] : [])) : []
}

function isArchive(value: unknown): value is WikiGraphLibraryArchive {
  if (!value || typeof value !== "object") return false
  const item = value as Partial<WikiGraphLibraryArchive>
  return typeof item.id === "string" && item.id.trim() !== "" && typeof item.uri === "string" && item.uri.trim() !== ""
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

export async function prepareWikiGraphDefaultLibrary(
  runtime: WikiGraphRuntime,
  exec: WikiGraphExec = execFileAsync,
): Promise<void> {
  await mkdir(runtime.stateDir, { recursive: true })
  await mkdir(runtime.managedLibraryDir, { recursive: true })
  await runWikiGraphJson<unknown>(
    runtime,
    ["wikg://lib/path", "set", runtime.managedLibraryDir, "--json"],
    metadataTimeoutMs,
    exec,
  )
}

export async function runWikiGraphJson<T>(
  runtime: WikiGraphRuntime,
  args: string[],
  timeout = queryTimeoutMs,
  exec: WikiGraphExec = execFileAsync,
): Promise<T> {
  try {
    const { stdout } = await exec(runtime.command, args, {
      encoding: "utf-8",
      env: runtimeEnv(runtime),
      maxBuffer: maxJsonBytes,
      timeout,
      windowsHide: true,
    })
    return parseJson<T>(stdout, args.join(" "))
  } catch (error) {
    throw wikiGraphError(runtime, "WikiGraph command failed", error)
  }
}

export async function listWikiGraphLibraryArchives(
  runtime: WikiGraphRuntime,
  exec: WikiGraphExec = execFileAsync,
): Promise<WikiGraphLibraryArchive[]> {
  await prepareWikiGraphDefaultLibrary(runtime, exec)
  const parsed = await runWikiGraphJson<unknown>(
    runtime,
    [`${defaultLibraryUri}/arc`, "--json"],
    metadataTimeoutMs,
    exec,
  )
  return parseArchiveList(parsed).filter((item) => item.exists !== false && item.status !== "missing")
}

export async function addWikiGraphLibraryArchive(
  runtime: WikiGraphRuntime,
  sourcePath: string,
  exec: WikiGraphExec = execFileAsync,
): Promise<WikiGraphLibraryArchive> {
  await prepareWikiGraphDefaultLibrary(runtime, exec)
  let source
  try {
    source = await stat(sourcePath)
  } catch (error) {
    throw new Error("Knowledge base file is unavailable", { cause: error })
  }
  if (!source.isFile()) throw new Error("Knowledge base must be a regular file")
  const imported = await runWikiGraphJson<unknown>(
    runtime,
    [`${defaultLibraryUri}/arc`, "add", "--input", sourcePath, "--to", safeImportTarget(sourcePath), "--json"],
    metadataTimeoutMs,
    exec,
  )
  if (!isArchive(imported)) throw new Error("WikiGraph did not return an imported archive")
  return imported
}

export async function removeWikiGraphLibraryArchive(
  runtime: WikiGraphRuntime,
  id: string,
  exec: WikiGraphExec = execFileAsync,
): Promise<void> {
  const normalizedId = id.trim()
  if (!normalizedId) return
  await prepareWikiGraphDefaultLibrary(runtime, exec)
  await runWikiGraphJson<unknown>(
    runtime,
    [archiveUri(normalizedId), "remove", "--confirm", "--json"],
    metadataTimeoutMs,
    exec,
  )
}

export async function readWikiGraphMetadata(
  runtime: WikiGraphRuntime,
  id: string,
  exec: WikiGraphExec = execFileAsync,
): Promise<WikiGraphMetadata> {
  return runWikiGraphJson<WikiGraphMetadata>(runtime, [`${archiveUri(id)}/meta`, "--json"], metadataTimeoutMs, exec)
}

export async function inspectWikiGraph(
  runtime: WikiGraphRuntime,
  id: string,
  exec: WikiGraphExec = execFileAsync,
): Promise<WikiGraphInspect> {
  return runWikiGraphJson<WikiGraphInspect>(runtime, [archiveUri(id), "inspect", "--json"], metadataTimeoutMs, exec)
}

export async function readWikiGraphIndex(
  runtime: WikiGraphRuntime,
  id: string,
  exec: WikiGraphExec = execFileAsync,
): Promise<WikiGraphIndexState> {
  return runWikiGraphJson<WikiGraphIndexState>(runtime, [`${archiveUri(id)}/index`, "--json"], metadataTimeoutMs, exec)
}

export async function readWikiGraphCover(
  runtime: WikiGraphRuntime,
  id: string,
  exec: WikiGraphExec = execFileAsync,
): Promise<Buffer | null> {
  try {
    const { stdout } = await exec(runtime.command, [`${archiveUri(id)}/cover`], {
      encoding: "buffer",
      env: runtimeEnv(runtime),
      maxBuffer: maxCoverBytes,
      timeout: metadataTimeoutMs,
      windowsHide: true,
    })
    return Buffer.isBuffer(stdout) && stdout.length > 0 ? stdout : null
  } catch {
    return null
  }
}

export function wikiGraphCoverageReady(coverage: { coveredWords?: number; totalWords?: number } | undefined): boolean {
  return Boolean(coverage && (coverage.coveredWords ?? 0) > 0 && (coverage.totalWords ?? 0) > 0)
}
