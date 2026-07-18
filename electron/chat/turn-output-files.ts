import type { GitTurnBaseline } from "../git/turn-diff.ts"
import type { TurnFileDiffResult } from "./common.ts"
import type { StoredTurnOutputFile, StoredTurnOutputRecord } from "./turn-outputs.ts"

import { open, readdir } from "node:fs/promises"
import path from "node:path"
import { WANTA_MANAGED_PYTHON_ENV_DIRNAME } from "../agent/python-environment.ts"
import { buildUnifiedDiff, collectGitTurnDiffs } from "../git/turn-diff.ts"
import { mimeFromPath } from "./artifacts.ts"
import { artifactPackVisiblePaths, localArtifactItem, readArtifactPack } from "./local-artifacts.ts"

export const artifactTextPreviewMaxBytes = 512 * 1024
export const turnOutputPatchBudgetChars = 2_000_000

const maxProcessFiles = 200
const maxProcessEntries = 5_000
const maxProcessDepth = 24
const processScanBudgetMs = 1_500
const intermediateCodeExtensions = new Set([
  ".bash",
  ".c",
  ".cc",
  ".cjs",
  ".cpp",
  ".cs",
  ".css",
  ".cxx",
  ".dart",
  ".fish",
  ".go",
  ".h",
  ".hpp",
  ".html",
  ".htm",
  ".java",
  ".js",
  ".jsx",
  ".kt",
  ".kts",
  ".less",
  ".lua",
  ".mjs",
  ".php",
  ".pl",
  ".py",
  ".r",
  ".rb",
  ".rs",
  ".sass",
  ".scala",
  ".scss",
  ".sh",
  ".svelte",
  ".swift",
  ".ts",
  ".tsx",
  ".vue",
  ".zsh",
])
const codeRequestPattern =
  /\b(api|app|cli|code|component|css|html|javascript|js|node|program|python|react|script|typescript|ts|website)\b|代码|脚本|程序|网页|网站|应用|组件|前端|后端|接口|库|插件|扩展|源码|项目/i

function isProbablyBinary(bytes: Buffer): boolean {
  return bytes.includes(0)
}

export async function readTextPreview(
  filePath: string,
  size: number,
): Promise<{ text: string; truncated: boolean } | null> {
  const length = Math.min(size, artifactTextPreviewMaxBytes)
  if (length <= 0) {
    return { text: "", truncated: false }
  }
  const file = await open(filePath, "r")
  try {
    const bytes = Buffer.alloc(length)
    const { bytesRead } = await file.read(bytes, 0, length, 0)
    const chunk = bytes.subarray(0, bytesRead)
    if (isProbablyBinary(chunk)) {
      return null
    }
    return {
      text: chunk.toString("utf8"),
      truncated: size > bytesRead,
    }
  } finally {
    await file.close()
  }
}

export function isTextArtifactMime(mime: string): boolean {
  return (
    mime.startsWith("text/") ||
    mime === "application/json" ||
    mime === "application/javascript" ||
    mime === "application/x-javascript" ||
    mime === "application/xml" ||
    mime === "application/yaml" ||
    mime === "application/x-yaml"
  )
}

export function turnOutputFileName(filePath: string): string {
  return path.basename(filePath.replace(/[\\/]+$/, "")) || filePath
}

function fileExtension(filePath: string): string {
  const name = turnOutputFileName(filePath)
  const index = name.lastIndexOf(".")
  return index === -1 ? "" : name.slice(index).toLowerCase()
}

function sourceRequestsCode(requestText: string): boolean {
  return codeRequestPattern.test(requestText)
}

export function normalizeProjectPath(projectPath: string): string {
  return projectPath.trim().replace(/[\\/]+$/, "")
}

export function isPathInside(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target))
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

export function summarizeTurnFiles(files: StoredTurnOutputFile[]): StoredTurnOutputRecord["summary"] {
  return {
    processFileCount: files.filter((file) => file.role === "process").length,
    changedFileCount: files.filter((file) => file.role === "project_change").length,
    additions: files.reduce((sum, file) => sum + file.additions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
  }
}

export function boundTurnOutputPatchPayloads(
  files: StoredTurnOutputFile[],
  budgetChars = turnOutputPatchBudgetChars,
): StoredTurnOutputFile[] {
  let remaining = Math.max(0, budgetChars)
  return files.map((file) => {
    const patch = file.diff.patch
    if (!patch) return file
    if (patch.length <= remaining) {
      remaining -= patch.length
      return file
    }
    const { patch: _patch, ...diff } = file.diff
    return {
      ...file,
      truncated: true,
      diff: { ...diff, kind: "too_large", truncated: true },
    }
  })
}

async function listProcessFiles(rootDir: string): Promise<string[]> {
  const root = path.resolve(rootDir)
  const found: string[] = []
  let visitedEntries = 0
  const deadline = Date.now() + processScanBudgetMs
  async function visit(dir: string, depth: number): Promise<void> {
    if (
      found.length >= maxProcessFiles ||
      visitedEntries >= maxProcessEntries ||
      depth > maxProcessDepth ||
      Date.now() >= deadline
    ) {
      return
    }
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))) {
      visitedEntries += 1
      if (
        found.length >= maxProcessFiles ||
        visitedEntries > maxProcessEntries ||
        Date.now() >= deadline ||
        entry.name === ".DS_Store" ||
        entry.name === WANTA_MANAGED_PYTHON_ENV_DIRNAME
      ) {
        continue
      }
      const absolute = path.join(dir, entry.name)
      if (!isPathInside(root, absolute)) {
        continue
      }
      if (entry.isDirectory()) {
        await visit(absolute, depth + 1)
        continue
      }
      if (entry.isFile()) {
        found.push(path.relative(root, absolute))
      }
    }
  }
  await visit(root, 0)
  return found
}

async function processFileEntry(rootDir: string, relativePath: string): Promise<StoredTurnOutputFile | null> {
  const absolutePath = path.join(rootDir, relativePath)
  const item = await localArtifactItem(absolutePath)
  if (!item || item.kind !== "file") {
    return null
  }
  const preview = await readTextPreview(absolutePath, item.size ?? 0).catch(() => null)
  const diff = preview
    ? buildUnifiedDiff(relativePath, "", preview.text, item.mime)
    : ({
        kind: item.size && item.size > artifactTextPreviewMaxBytes ? "too_large" : "binary",
        path: relativePath,
        mime: item.mime,
        additions: 0,
        deletions: 0,
        ...(item.size && item.size > artifactTextPreviewMaxBytes ? { truncated: true } : {}),
      } satisfies TurnFileDiffResult)
  return {
    path: absolutePath,
    name: turnOutputFileName(relativePath),
    role: "process",
    changeKind: "added",
    mime: item.mime,
    additions: diff.additions,
    deletions: diff.deletions,
    ...(diff.kind === "binary" ? { binary: true } : {}),
    ...(item.size !== undefined ? { size: item.size } : {}),
    ...(diff.truncated ? { truncated: true } : {}),
    diff: { ...diff, path: absolutePath },
  }
}

export async function processOutputFiles(processRoot: string): Promise<StoredTurnOutputFile[]> {
  const entries = await Promise.all(
    (await listProcessFiles(processRoot)).map((relativePath) => processFileEntry(processRoot, relativePath)),
  )
  return entries.filter((entry): entry is StoredTurnOutputFile => Boolean(entry))
}

export async function intermediateArtifactProcessFiles(
  artifactRoot: string,
  requestText: string,
): Promise<StoredTurnOutputFile[]> {
  if (sourceRequestsCode(requestText)) {
    return []
  }
  const pack = await readArtifactPack(artifactRoot)
  const visiblePaths = artifactPackVisiblePaths(pack)
  const relativePaths = (await listProcessFiles(artifactRoot)).filter((relativePath) => {
    const absolutePath = path.join(artifactRoot, relativePath)
    return !visiblePaths.has(absolutePath) && intermediateCodeExtensions.has(fileExtension(relativePath))
  })
  const entries = await Promise.all(relativePaths.map((relativePath) => processFileEntry(artifactRoot, relativePath)))
  return entries.filter((entry): entry is StoredTurnOutputFile => Boolean(entry))
}

export async function projectOutputFiles(
  baseline: GitTurnBaseline | undefined,
  projectRoot: string | undefined,
): Promise<StoredTurnOutputFile[]> {
  if (!baseline || !projectRoot) {
    return []
  }
  const diffs = await collectGitTurnDiffs(baseline, mimeFromPath).catch((error: unknown) => {
    console.warn("[wanta] failed to collect project diff", error)
    return []
  })
  return diffs.map((item): StoredTurnOutputFile => {
    const absolutePath = path.join(projectRoot, item.path)
    return {
      path: absolutePath,
      name: turnOutputFileName(item.path),
      role: "project_change",
      changeKind: item.changeKind,
      mime: item.diff.mime,
      additions: item.diff.additions,
      deletions: item.diff.deletions,
      ...(item.diff.kind === "binary" ? { binary: true } : {}),
      ...(item.size !== undefined ? { size: item.size } : {}),
      ...(item.diff.truncated ? { truncated: true } : {}),
      diff: { ...item.diff, path: absolutePath },
    }
  })
}
