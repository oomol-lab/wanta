import type { TurnFileDiffResult, TurnOutputChangeKind } from "../chat/common.ts"

import { createTwoFilesPatch, diffLines, FILE_HEADERS_ONLY } from "diff"
import { execFile } from "node:child_process"
import { readFile, stat } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const gitCommandTimeoutMs = 5_000
const maxSnapshotBytes = 1024 * 1024
const maxPatchChars = 220_000
const maxDiffEditLength = 50_000
const snapshotConcurrency = 8

interface GitCommandOutput {
  stdout: string
  stderr: string
}

export interface TextSnapshot {
  binary?: boolean
  content?: string
  exists: boolean
  size?: number
  tooLarge?: boolean
}

export interface GitTurnBaseline {
  repositoryRoot: string
  snapshots: Record<string, TextSnapshot>
}

export interface GitTurnFileDiff {
  changeKind: TurnOutputChangeKind
  diff: TurnFileDiffResult
  path: string
  size?: number
}

async function runGit(
  repositoryRoot: string,
  args: string[],
  maxBuffer = maxSnapshotBytes * 2,
): Promise<GitCommandOutput> {
  const result = await execFileAsync("git", ["-C", repositoryRoot, ...args], {
    encoding: "buffer",
    maxBuffer,
    timeout: gitCommandTimeoutMs,
    windowsHide: true,
  })
  return { stdout: result.stdout.toString("utf8"), stderr: result.stderr.toString("utf8") }
}

function splitZ(output: string): string[] {
  return output
    .split("\0")
    .map((item) => item.trim())
    .filter(Boolean)
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
}

async function mapConcurrent<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = Array.from({ length: values.length })
  let nextIndex = 0
  const runNext = async (): Promise<void> => {
    while (nextIndex < values.length) {
      const index = nextIndex
      nextIndex += 1
      const value = values[index]
      if (value !== undefined) results[index] = await mapper(value, index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => runNext()))
  return results
}

function safeRelativePath(value: string): string | null {
  const normalized = value.replaceAll("\\", "/").replace(/^\/+/, "")
  if (!normalized || normalized.includes("\0") || normalized.split("/").includes("..")) {
    return null
  }
  return normalized
}

async function listDirtyPaths(repositoryRoot: string): Promise<string[]> {
  const [worktree, staged] = await Promise.all([
    runGit(repositoryRoot, ["ls-files", "-m", "-d", "-o", "--exclude-standard", "-z"]),
    runGit(repositoryRoot, ["diff", "--name-only", "--cached", "-z"]),
  ])
  return unique(
    [...splitZ(worktree.stdout), ...splitZ(staged.stdout)].map(safeRelativePath).filter(Boolean) as string[],
  )
}

function isProbablyBinary(bytes: Buffer): boolean {
  return bytes.includes(0)
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

async function readWorkingSnapshot(repositoryRoot: string, relativePath: string): Promise<TextSnapshot> {
  const safePath = safeRelativePath(relativePath)
  if (!safePath) {
    return { exists: false }
  }
  const filePath = path.resolve(repositoryRoot, safePath)
  if (!isInside(path.resolve(repositoryRoot), filePath)) {
    return { exists: false }
  }
  try {
    const info = await stat(filePath)
    if (!info.isFile()) {
      return { exists: false }
    }
    if (info.size > maxSnapshotBytes) {
      return { exists: true, size: info.size, tooLarge: true }
    }
    const bytes = await readFile(filePath)
    if (isProbablyBinary(bytes)) {
      return { binary: true, exists: true, size: info.size }
    }
    return { content: bytes.toString("utf8"), exists: true, size: info.size }
  } catch {
    return { exists: false }
  }
}

async function readHeadSnapshot(repositoryRoot: string, relativePath: string): Promise<TextSnapshot> {
  const safePath = safeRelativePath(relativePath)
  if (!safePath) {
    return { exists: false }
  }
  try {
    const result = await execFileAsync("git", ["-C", repositoryRoot, "show", `HEAD:${safePath}`], {
      encoding: "buffer",
      maxBuffer: maxSnapshotBytes + 1,
      timeout: gitCommandTimeoutMs,
      windowsHide: true,
    })
    const bytes = result.stdout
    if (bytes.length > maxSnapshotBytes) {
      return { exists: true, size: bytes.length, tooLarge: true }
    }
    if (isProbablyBinary(bytes)) {
      return { binary: true, exists: true, size: bytes.length }
    }
    return { content: bytes.toString("utf8"), exists: true, size: bytes.length }
  } catch {
    return { exists: false }
  }
}

function snapshotEqual(left: TextSnapshot, right: TextSnapshot): boolean {
  return (
    left.exists === right.exists &&
    Boolean(left.binary) === Boolean(right.binary) &&
    Boolean(left.tooLarge) === Boolean(right.tooLarge) &&
    left.content === right.content &&
    left.size === right.size
  )
}

function countChangedLines(value: string): number {
  if (!value) {
    return 0
  }
  const normalized = value.replace(/\r\n/g, "\n")
  const withoutFinalNewline = normalized.endsWith("\n") ? normalized.slice(0, -1) : normalized
  return withoutFinalNewline ? withoutFinalNewline.split("\n").length : 0
}

export function buildUnifiedDiff(
  relativePath: string,
  before: string,
  after: string,
  mime: string,
): TurnFileDiffResult {
  const changes = diffLines(before, after, { maxEditLength: maxDiffEditLength })
  if (!changes) {
    return { kind: "too_large", path: relativePath, mime, additions: 0, deletions: 0, truncated: true }
  }
  const additions = changes.reduce(
    (count, change) => count + (change.added ? (change.count ?? countChangedLines(change.value)) : 0),
    0,
  )
  const deletions = changes.reduce(
    (count, change) => count + (change.removed ? (change.count ?? countChangedLines(change.value)) : 0),
    0,
  )
  const patchBody = createTwoFilesPatch(
    before ? `a/${relativePath}` : "/dev/null",
    after ? `b/${relativePath}` : "/dev/null",
    before,
    after,
    undefined,
    undefined,
    { context: 3, headerOptions: FILE_HEADERS_ONLY, maxEditLength: maxDiffEditLength },
  )
  if (!patchBody) {
    return { kind: "too_large", path: relativePath, mime, additions, deletions, truncated: true }
  }
  const rawPatch = `diff --git a/${relativePath} b/${relativePath}\n${patchBody}`
  const truncated = rawPatch.length > maxPatchChars
  return {
    kind: "text",
    path: relativePath,
    mime,
    additions,
    deletions,
    patch: truncated ? `${rawPatch.slice(0, maxPatchChars)}\n... diff truncated ...` : rawPatch,
    ...(truncated ? { truncated: true } : {}),
  }
}

function missingDiff(relativePath: string, mime: string): TurnFileDiffResult {
  return { kind: "missing", path: relativePath, mime, additions: 0, deletions: 0 }
}

function binaryDiff(relativePath: string, mime: string, before: TextSnapshot, after: TextSnapshot): TurnFileDiffResult {
  return {
    kind: before.tooLarge || after.tooLarge ? "too_large" : "binary",
    path: relativePath,
    mime,
    additions: 0,
    deletions: 0,
    ...(before.tooLarge || after.tooLarge ? { truncated: true } : {}),
  }
}

export async function captureGitTurnBaseline(repositoryRoot: string): Promise<GitTurnBaseline> {
  const root = path.resolve(repositoryRoot)
  const dirtyPaths = await listDirtyPaths(root)
  const snapshots: Record<string, TextSnapshot> = {}
  await mapConcurrent(dirtyPaths, snapshotConcurrency, async (relativePath) => {
    snapshots[relativePath] = await readWorkingSnapshot(root, relativePath)
  })
  return { repositoryRoot: root, snapshots }
}

export async function collectGitTurnDiffs(
  baseline: GitTurnBaseline,
  mimeFromPath: (filePath: string) => string,
): Promise<GitTurnFileDiff[]> {
  const endDirtyPaths = await listDirtyPaths(baseline.repositoryRoot)
  const candidates = unique([...Object.keys(baseline.snapshots), ...endDirtyPaths])
  const candidatesDiffs = await mapConcurrent(candidates, snapshotConcurrency, async (relativePath) => {
    const before = baseline.snapshots[relativePath] ?? (await readHeadSnapshot(baseline.repositoryRoot, relativePath))
    const after = await readWorkingSnapshot(baseline.repositoryRoot, relativePath)
    if (snapshotEqual(before, after)) {
      return null
    }
    const mime = mimeFromPath(relativePath)
    const changeKind: TurnOutputChangeKind = before.exists ? (after.exists ? "modified" : "deleted") : "added"
    const diff =
      !before.exists && !after.exists
        ? missingDiff(relativePath, mime)
        : before.binary || after.binary || before.tooLarge || after.tooLarge
          ? binaryDiff(relativePath, mime, before, after)
          : buildUnifiedDiff(relativePath, before.content ?? "", after.content ?? "", mime)
    return {
      path: relativePath,
      changeKind,
      diff,
      ...((after.size ?? before.size) ? { size: after.size ?? before.size } : {}),
    } satisfies GitTurnFileDiff
  })
  return candidatesDiffs.filter((diff): diff is GitTurnFileDiff => Boolean(diff))
}
