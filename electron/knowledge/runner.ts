import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const metadataTimeoutMs = 30_000
const queryTimeoutMs = 60_000
const maxJsonBytes = 8 * 1024 * 1024
const maxCoverBytes = 4 * 1024 * 1024

export interface WikiGraphRuntime {
  executablePath: string
  cliPath: string
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

function runtimeArgs(runtime: WikiGraphRuntime, args: string[]): string[] {
  return [runtime.cliPath, ...args]
}

function runtimeEnv(): NodeJS.ProcessEnv {
  return { ...process.env, ELECTRON_RUN_AS_NODE: "1", NO_COLOR: "1" }
}

function parseJson<T>(stdout: string, label: string): T {
  try {
    return JSON.parse(stdout) as T
  } catch (error) {
    throw new Error(`WikiGraph returned invalid ${label} JSON`, { cause: error })
  }
}

export async function runWikiGraphJson<T>(
  runtime: WikiGraphRuntime,
  args: string[],
  timeout = queryTimeoutMs,
): Promise<T> {
  const { stdout } = await execFileAsync(runtime.executablePath, runtimeArgs(runtime, args), {
    encoding: "utf-8",
    env: runtimeEnv(),
    maxBuffer: maxJsonBytes,
    timeout,
    windowsHide: true,
  })
  return parseJson<T>(stdout, args.join(" "))
}

export async function readWikiGraphMetadata(runtime: WikiGraphRuntime, archiveUri: string): Promise<WikiGraphMetadata> {
  return runWikiGraphJson<WikiGraphMetadata>(runtime, [`${archiveUri}/meta`, "--json"], metadataTimeoutMs)
}

export async function inspectWikiGraph(runtime: WikiGraphRuntime, archiveUri: string): Promise<WikiGraphInspect> {
  return runWikiGraphJson<WikiGraphInspect>(runtime, [archiveUri, "inspect", "--json"], metadataTimeoutMs)
}

export async function readWikiGraphCover(runtime: WikiGraphRuntime, archiveUri: string): Promise<Buffer | null> {
  try {
    const { stdout } = await execFileAsync(runtime.executablePath, runtimeArgs(runtime, [`${archiveUri}/cover`]), {
      encoding: "buffer",
      env: runtimeEnv(),
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
