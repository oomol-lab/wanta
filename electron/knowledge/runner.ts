import type { RunWikiGraphCLIInput } from "wiki-graph"

import { mkdir, stat } from "node:fs/promises"
import path from "node:path"
import { Writable } from "node:stream"
import { runWikiGraphCLI } from "wiki-graph"

const metadataTimeoutMs = 30_000
const queryTimeoutMs = 60_000
const maxJsonBytes = 8 * 1024 * 1024
const maxCoverBytes = 4 * 1024 * 1024
const defaultLibraryUri = "wikg://lib"
const dangerousWikiGraphEnvNames = [
  "WIKIGRAPH_DEV",
  "WIKIGRAPH_ENV_POLICY",
  "WIKIGRAPH_QUEUE_DISABLE_AUTOSTART",
  "WIKIGRAPH_STATE_DIR",
] as const

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

export type WikiGraphCLIRunner = (input: RunWikiGraphCLIInput) => Promise<{ exitCode: number }>

function runtimeEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: "1" }
  for (const name of dangerousWikiGraphEnvNames) env[name] = undefined
  return env
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
  runCLI: WikiGraphCLIRunner = runWikiGraphCLI,
): Promise<void> {
  await mkdir(runtime.stateDir, { recursive: true })
  await mkdir(runtime.managedLibraryDir, { recursive: true })
  await runWikiGraphJson<unknown>(
    runtime,
    ["wikg://lib/path", "set", runtime.managedLibraryDir, "--json"],
    metadataTimeoutMs,
    runCLI,
  )
}

export async function runWikiGraphJson<T>(
  runtime: WikiGraphRuntime,
  args: string[],
  timeout = queryTimeoutMs,
  runCLI: WikiGraphCLIRunner = runWikiGraphCLI,
): Promise<T> {
  try {
    const stdout = new LimitedBufferWritable(maxJsonBytes)
    const stderr = new LimitedBufferWritable(maxJsonBytes)
    const result = await runWithTimeout(timeout, (signal) => {
      return runCLI({
        argv: args,
        env: runtimeEnv(),
        signal,
        stateDir: runtime.stateDir,
        stderr,
        stdout,
      })
    })
    const stdoutText = stdout.text
    const stderrText = stderr.text
    if (result.exitCode !== 0) throw new Error(stderrText.trim() || stdoutText.trim() || "WikiGraph command failed")
    return parseJson<T>(stdoutText, args.join(" "))
  } catch (error) {
    throw wikiGraphError(runtime, "WikiGraph command failed", error)
  }
}

export async function listWikiGraphLibraryArchives(
  runtime: WikiGraphRuntime,
  runCLI: WikiGraphCLIRunner = runWikiGraphCLI,
): Promise<WikiGraphLibraryArchive[]> {
  await prepareWikiGraphDefaultLibrary(runtime, runCLI)
  const parsed = await runWikiGraphJson<unknown>(
    runtime,
    [`${defaultLibraryUri}/arc`, "scan", "--json"],
    metadataTimeoutMs,
    runCLI,
  )
  return parseArchiveList(parsed).filter((item) => item.exists !== false && item.status !== "missing")
}

export async function addWikiGraphLibraryArchive(
  runtime: WikiGraphRuntime,
  sourcePath: string,
  runCLI: WikiGraphCLIRunner = runWikiGraphCLI,
): Promise<WikiGraphLibraryArchive> {
  await prepareWikiGraphDefaultLibrary(runtime, runCLI)
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
    runCLI,
  )
  if (!isArchive(imported)) throw new Error("WikiGraph did not return an imported archive")
  return imported
}

export async function removeWikiGraphLibraryArchive(
  runtime: WikiGraphRuntime,
  id: string,
  runCLI: WikiGraphCLIRunner = runWikiGraphCLI,
): Promise<void> {
  const normalizedId = id.trim()
  if (!normalizedId) return
  await prepareWikiGraphDefaultLibrary(runtime, runCLI)
  await runWikiGraphJson<unknown>(
    runtime,
    [archiveUri(normalizedId), "remove", "--confirm", "--json"],
    metadataTimeoutMs,
    runCLI,
  )
}

export async function readWikiGraphMetadata(
  runtime: WikiGraphRuntime,
  id: string,
  runCLI: WikiGraphCLIRunner = runWikiGraphCLI,
): Promise<WikiGraphMetadata> {
  return runWikiGraphJson<WikiGraphMetadata>(runtime, [`${archiveUri(id)}/meta`, "--json"], metadataTimeoutMs, runCLI)
}

export async function inspectWikiGraph(
  runtime: WikiGraphRuntime,
  id: string,
  runCLI: WikiGraphCLIRunner = runWikiGraphCLI,
): Promise<WikiGraphInspect> {
  return runWikiGraphJson<WikiGraphInspect>(runtime, [archiveUri(id), "inspect", "--json"], metadataTimeoutMs, runCLI)
}

export async function readWikiGraphIndex(
  runtime: WikiGraphRuntime,
  id: string,
  runCLI: WikiGraphCLIRunner = runWikiGraphCLI,
): Promise<WikiGraphIndexState> {
  return runWikiGraphJson<WikiGraphIndexState>(
    runtime,
    [`${archiveUri(id)}/index`, "--json"],
    metadataTimeoutMs,
    runCLI,
  )
}

export async function readWikiGraphCover(
  runtime: WikiGraphRuntime,
  id: string,
  runCLI: WikiGraphCLIRunner = runWikiGraphCLI,
): Promise<Buffer | null> {
  try {
    const stdout = new LimitedBufferWritable(maxCoverBytes)
    const result = await runWithTimeout(metadataTimeoutMs, (signal) => {
      return runCLI({
        argv: [`${archiveUri(id)}/cover`],
        env: runtimeEnv(),
        signal,
        stateDir: runtime.stateDir,
        stdout,
      })
    })
    const buffer = stdout.buffer
    return result.exitCode === 0 && buffer.length > 0 ? buffer : null
  } catch {
    return null
  }
}

async function runWithTimeout<T>(timeout: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error("WikiGraph command timed out")), timeout)
  try {
    return await run(controller.signal)
  } finally {
    clearTimeout(timer)
  }
}

class LimitedBufferWritable extends Writable {
  private readonly maxBytes: number
  readonly #chunks: Buffer[] = []
  #size = 0

  public constructor(maxBytes: number) {
    super()
    this.maxBytes = maxBytes
  }

  public get buffer(): Buffer {
    return Buffer.concat(this.#chunks, this.#size)
  }

  public get text(): string {
    return this.buffer.toString("utf8")
  }

  public override _write(
    chunk: Buffer | string,
    encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding)
    this.#size += buffer.length
    if (this.#size > this.maxBytes) {
      callback(new Error("WikiGraph output exceeded the buffer limit"))
      return
    }
    this.#chunks.push(buffer)
    callback()
  }
}

export function wikiGraphCoverageReady(coverage: { coveredWords?: number; totalWords?: number } | undefined): boolean {
  return Boolean(coverage && (coverage.coveredWords ?? 0) > 0 && (coverage.totalWords ?? 0) > 0)
}
