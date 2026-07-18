import type { ArtifactBundle } from "./common.ts"
import type { StoredTurnOutputRecord } from "./turn-outputs.ts"

import { lstat, rm, rmdir } from "node:fs/promises"
import path from "node:path"

const turnDirectoryPattern = /^\d{10,17}-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

function sessionDirectorySegment(sessionId: string): string {
  const cleaned = sessionId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 120)
  return cleaned || "session"
}

function samePath(left: string, right: string): boolean {
  return path.resolve(left) === path.resolve(right)
}

async function isPlainDirectory(directory: string): Promise<boolean> {
  const info = await lstat(directory).catch(() => null)
  return Boolean(info?.isDirectory() && !info.isSymbolicLink())
}

async function safeTurnDirectory(
  directory: string,
  sessionId: string,
  localSessionRoot: string,
  allowProjectArtifactRoot: boolean,
): Promise<string | null> {
  const resolved = path.resolve(directory)
  if (!turnDirectoryPattern.test(path.basename(resolved)) || !(await isPlainDirectory(resolved))) {
    return null
  }
  const sessionRoot = path.dirname(resolved)
  if (samePath(sessionRoot, localSessionRoot)) {
    return resolved
  }
  if (!allowProjectArtifactRoot || path.basename(sessionRoot) !== sessionDirectorySegment(sessionId)) {
    return null
  }
  const artifactsRoot = path.dirname(sessionRoot)
  const wantaRoot = path.dirname(artifactsRoot)
  if (
    path.basename(artifactsRoot) !== "artifacts" ||
    path.basename(wantaRoot) !== ".wanta" ||
    !(await isPlainDirectory(sessionRoot)) ||
    !(await isPlainDirectory(artifactsRoot)) ||
    !(await isPlainDirectory(wantaRoot))
  ) {
    return null
  }
  return resolved
}

export async function removeSessionOutputDirectories(input: {
  agentRoot: string
  artifactBundles?: Iterable<ArtifactBundle>
  sessionId: string
  turnOutputs?: Iterable<StoredTurnOutputRecord>
}): Promise<void> {
  const segment = sessionDirectorySegment(input.sessionId)
  const localArtifactSessionRoot = path.resolve(input.agentRoot, "artifacts", segment)
  const localProcessSessionRoot = path.resolve(input.agentRoot, "process", segment)
  const turnDirectories = new Set<string>()
  const projectSessionRoots = new Set<string>()

  for (const record of input.turnOutputs ?? []) {
    if (!record.processRoot) continue
    const directory = await safeTurnDirectory(record.processRoot, input.sessionId, localProcessSessionRoot, false)
    if (directory) turnDirectories.add(directory)
  }
  for (const bundle of input.artifactBundles ?? []) {
    const directory = await safeTurnDirectory(bundle.rootPath, input.sessionId, localArtifactSessionRoot, true)
    if (!directory) continue
    turnDirectories.add(directory)
    const parent = path.dirname(directory)
    if (!samePath(parent, localArtifactSessionRoot)) projectSessionRoots.add(parent)
  }

  await Promise.all([...turnDirectories].map((directory) => rm(directory, { force: true, recursive: true })))
  // App 私有根可按会话整体删除，连同未成功持久化的历史孤儿目录一起回收。
  await Promise.all([
    rm(localArtifactSessionRoot, { force: true, recursive: true }),
    rm(localProcessSessionRoot, { force: true, recursive: true }),
  ])
  await Promise.all([...projectSessionRoots].map((directory) => rmdir(directory).catch(() => undefined)))
}
