import type { ArtifactBundle, ArtifactBundleFailure, ArtifactItem } from "./common.ts"
import type { FileHandle } from "node:fs/promises"

import { constants } from "node:fs"
import { lstat, mkdir, open, realpath, rm } from "node:fs/promises"
import path from "node:path"
import { localArtifactItem } from "./local-artifacts.ts"

export interface ProjectOutputPublishResult {
  bundle: ArtifactBundle
  publishedPaths: ReadonlySet<string>
}

function pathInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

function safeOutputName(value: string, fallback: string): string {
  const normalized = [...value.normalize("NFC")]
    .map((character) => ((character.codePointAt(0) ?? 0) < 32 ? "-" : character))
    .join("")
    .replace(/[<>:"/\\|?*]/gu, "-")
    .replace(/\s+/gu, " ")
    .replace(/[ .]+$/gu, "")
    .trim()
  const originalExtension = path.extname(normalized || value)
  const fallbackExtension = path.extname(fallback)
  const fallbackName = fallbackExtension || !originalExtension ? fallback : `${fallback}${originalExtension}`
  const safe =
    normalized && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu.test(normalized) ? normalized : fallbackName
  if (Buffer.byteLength(safe, "utf8") <= 180) return safe
  const extension = path.extname(safe)
  const base = path.basename(safe, extension)
  let shortened = ""
  for (const character of base) {
    if (Buffer.byteLength(`${shortened}${character}${extension}`, "utf8") > 180) break
    shortened += character
  }
  const fallbackBase = path.basename(fallbackName, path.extname(fallbackName))
  return `${shortened || fallbackBase}${extension}`
}

function suffixedName(name: string, suffix: number): string {
  const extension = path.extname(name)
  const base = path.basename(name, extension)
  return `${base}-${suffix}${extension}`
}

async function plainProjectRoot(projectRoot: string): Promise<string> {
  const requested = path.resolve(projectRoot)
  const requestedInfo = await lstat(requested)
  if (!requestedInfo.isDirectory() || requestedInfo.isSymbolicLink()) {
    throw new Error("Project output root is not a plain directory.")
  }
  const resolved = await realpath(requested)
  const resolvedInfo = await lstat(resolved)
  if (!resolvedInfo.isDirectory() || resolvedInfo.isSymbolicLink()) {
    throw new Error("Project output root is not a plain directory.")
  }
  return resolved
}

async function plainArtifactFile(artifactRoot: string, filePath: string): Promise<string | null> {
  const [root, source, requestedInfo] = await Promise.all([
    realpath(artifactRoot).catch(() => null),
    realpath(filePath).catch(() => null),
    lstat(filePath).catch(() => null),
  ])
  if (!root || !source || !requestedInfo?.isFile() || requestedInfo.isSymbolicLink() || !pathInside(root, source)) {
    return null
  }
  const info = await lstat(source).catch(() => null)
  return info?.isFile() && !info.isSymbolicLink() ? source : null
}

async function createUniqueDirectory(parent: string, requestedName: string): Promise<string> {
  for (let suffix = 1; suffix < 10_000; suffix += 1) {
    const name = suffix === 1 ? requestedName : suffixedName(requestedName, suffix)
    const candidate = path.join(parent, name)
    try {
      await mkdir(candidate)
      return candidate
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error
    }
  }
  throw new Error("Could not allocate a unique project output directory.")
}

async function ensureNewSubdirectory(parent: string, name: string): Promise<string> {
  const directory = path.join(parent, name)
  try {
    await mkdir(directory)
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error
  }
  const info = await lstat(directory)
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error("Project output path contains a non-directory or symbolic link.")
  }
  return directory
}

async function openPlainArtifactFile(artifactRoot: string, source: string): Promise<FileHandle> {
  const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0
  const handle = await open(source, constants.O_RDONLY | noFollow)
  try {
    const [root, resolved, pathInfo, openedInfo] = await Promise.all([
      realpath(artifactRoot),
      realpath(source),
      lstat(source),
      handle.stat(),
    ])
    if (
      !pathInside(root, resolved) ||
      !pathInfo.isFile() ||
      pathInfo.isSymbolicLink() ||
      !openedInfo.isFile() ||
      pathInfo.dev !== openedInfo.dev ||
      pathInfo.ino !== openedInfo.ino
    ) {
      throw new Error("Artifact source changed before publication.")
    }
    return handle
  } catch (error) {
    await handle.close()
    throw error
  }
}

async function copyUniqueFile(
  artifactRoot: string,
  source: string,
  parent: string,
  requestedName: string,
): Promise<string> {
  const sourceHandle = await openPlainArtifactFile(artifactRoot, source)
  try {
    for (let suffix = 1; suffix < 10_000; suffix += 1) {
      const name = suffix === 1 ? requestedName : suffixedName(requestedName, suffix)
      const target = path.join(parent, name)
      let targetHandle: FileHandle
      try {
        targetHandle = await open(target, "wx")
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "EEXIST") continue
        throw error
      }
      try {
        const buffer = Buffer.allocUnsafe(64 * 1024)
        let position = 0
        while (true) {
          const { bytesRead } = await sourceHandle.read(buffer, 0, buffer.length, position)
          if (bytesRead === 0) break
          let bytesWritten = 0
          while (bytesWritten < bytesRead) {
            const result = await targetHandle.write(
              buffer,
              bytesWritten,
              bytesRead - bytesWritten,
              position + bytesWritten,
            )
            bytesWritten += result.bytesWritten
          }
          position += bytesRead
        }
        return target
      } catch (error) {
        await rm(target, { force: true })
        throw error
      } finally {
        await targetHandle.close()
      }
    }
  } finally {
    await sourceHandle.close()
  }
  throw new Error("Could not allocate a unique project output file.")
}

interface PublishGroup {
  directoryName?: string
  items: Array<{ item: ArtifactItem; relativeSegments: string[]; source: string }>
}

async function publishGroups(
  bundle: ArtifactBundle,
  artifactRoot: string,
  projectRoot: string,
): Promise<{
  failures: number
  items: ArtifactItem[]
  publishedPaths: Set<string>
}> {
  const groups = new Map<string, PublishGroup>()
  let failures = 0
  for (const item of bundle.items) {
    const source = await plainArtifactFile(artifactRoot, item.path)
    if (!source) {
      failures += 1
      continue
    }
    const relative = path.relative(path.resolve(artifactRoot), path.resolve(item.path))
    const rawSegments = relative.split(path.sep).filter(Boolean)
    if (rawSegments.length === 0 || rawSegments.some((segment) => segment === "." || segment === "..")) {
      failures += 1
      continue
    }
    const segments = rawSegments.map((segment, index) =>
      safeOutputName(segment, index === rawSegments.length - 1 ? `output-${groups.size + 1}` : "output"),
    )
    const directoryName = segments.length > 1 ? segments[0] : undefined
    const key = directoryName ? `directory:${directoryName}` : `file:${item.id}`
    const group = groups.get(key) ?? { ...(directoryName ? { directoryName } : {}), items: [] }
    group.items.push({ item, relativeSegments: directoryName ? segments.slice(1) : segments, source })
    groups.set(key, group)
  }

  const published = new Map<string, ArtifactItem>()
  const publishedPaths = new Set<string>()
  for (const group of groups.values()) {
    try {
      let groupRoot = projectRoot
      if (group.directoryName) groupRoot = await createUniqueDirectory(projectRoot, group.directoryName)
      for (const entry of group.items) {
        try {
          let parent = groupRoot
          for (const segment of entry.relativeSegments.slice(0, -1)) {
            parent = await ensureNewSubdirectory(parent, segment)
          }
          const requestedName = entry.relativeSegments.at(-1) ?? safeOutputName(entry.item.name, "output")
          const target = await copyUniqueFile(artifactRoot, entry.source, parent, requestedName)
          const visibleItem = await localArtifactItem(target)
          if (!visibleItem || visibleItem.kind !== "file") throw new Error("Published project output is unavailable.")
          published.set(entry.item.id, { ...entry.item, ...visibleItem })
          publishedPaths.add(visibleItem.path)
        } catch {
          failures += 1
        }
      }
    } catch {
      failures += group.items.length
    }
  }
  return {
    failures,
    items: bundle.items.map((item) => published.get(item.id) ?? item),
    publishedPaths,
  }
}

function publishFailure(successes: number, failures: number): ArtifactBundleFailure | undefined {
  if (failures === 0) return undefined
  return successes === 0 ? "project_output_publish_failed" : "project_output_publish_partial"
}

/** 将本轮托管制成品发布为项目中的普通可见文件；托管目录仍用于索引和安全清理。 */
export async function publishArtifactBundleToProject(
  bundle: ArtifactBundle,
  artifactRoot: string,
  projectRoot: string,
): Promise<ProjectOutputPublishResult> {
  if (bundle.items.length === 0) return { bundle, publishedPaths: new Set() }
  const root = await plainProjectRoot(projectRoot)
  const result = await publishGroups(bundle, artifactRoot, root)
  const failure = publishFailure(result.publishedPaths.size, result.failures)
  return {
    bundle: {
      ...bundle,
      items: result.items,
      ...(failure
        ? { failure, status: failure === "project_output_publish_failed" ? ("failed" as const) : ("partial" as const) }
        : {}),
    },
    publishedPaths: result.publishedPaths,
  }
}
