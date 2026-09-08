import type { KnowledgeRecoveryIssue } from "./common.ts"

import { constants } from "node:fs"
import { copyFile, mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import {
  ensureLibraryManagedArchiveHasNoSearchIndex,
  ensureWikiGraphArchiveSchemaCurrent,
  readWikiGraphArchiveSchemaVersion,
  upgradeWikiGraphArchiveSchema,
} from "wiki-graph-core"
import { NodeFile } from "./node-platform.ts"

interface ArchiveStorage {
  stateDir: string
  managedLibraryDir: string
}

export class ArchivePreparationError extends Error {
  constructor(cause: unknown) {
    super("Knowledge archive validation or migration failed", { cause })
  }
}

function isTemporaryStorageFailure(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false
  const failure = error as { code?: string; message?: string; cause?: unknown }
  return (
    ["EACCES", "EPERM", "ENOSPC", "EIO", "EBUSY", "EMFILE", "ENFILE", "SQLITE_BUSY", "SQLITE_LOCKED"].includes(
      failure.code ?? "",
    ) ||
    /Cannot upgrade archive with (?:active coordinator|non-derived overlay) state/u.test(failure.message ?? "") ||
    (failure.cause !== undefined && failure.cause !== error && isTemporaryStorageFailure(failure.cause))
  )
}

export async function prepareArchiveCopy(filePath: string, validate: (file: NodeFile) => Promise<void>): Promise<void> {
  const file = new NodeFile(filePath)
  // The SDK explicitly separates version checks from migration. Never bypass its manifest validation.
  try {
    await ensureWikiGraphArchiveSchemaCurrent(file)
  } catch (error) {
    if (isTemporaryStorageFailure(error)) throw error
    // A malformed manifest must not be treated as an old archive.
    await readWikiGraphArchiveSchemaVersion(file)
    await upgradeWikiGraphArchiveSchema(file)
    await ensureWikiGraphArchiveSchemaCurrent(file)
  }
  await ensureLibraryManagedArchiveHasNoSearchIndex(file)
  await validate(file)
}

export async function withPreparedArchiveCopy<T>(
  storage: ArchiveStorage,
  sourcePath: string,
  validate: (file: NodeFile) => Promise<void>,
  operation: (filePath: string) => Promise<T>,
): Promise<T> {
  const stagingRoot = path.join(storage.stateDir, "wanta-imports")
  await mkdir(stagingRoot, { recursive: true })
  const staging = await mkdtemp(path.join(stagingRoot, "archive-"))
  try {
    const stagedPath = path.join(staging, "archive.wikg")
    await copyFile(sourcePath, stagedPath, constants.COPYFILE_EXCL)
    try {
      await prepareArchiveCopy(stagedPath, validate)
    } catch (error) {
      if (isTemporaryStorageFailure(error)) throw error
      throw new ArchivePreparationError(error)
    }
    return await operation(stagedPath)
  } finally {
    await rm(staging, { recursive: true, force: true }).catch(() => {
      console.warn("[wanta] failed to clean knowledge import staging directory")
    })
  }
}

export async function prepareManagedArchives(
  storage: ArchiveStorage,
  validate: (file: NodeFile) => Promise<void>,
  describeError: (error: unknown) => string,
): Promise<void> {
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const filePath = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        await walk(filePath)
      } else if (entry.isFile() && entry.name.endsWith(".wikg")) {
        try {
          await prepareArchiveCopy(filePath, validate)
        } catch (error) {
          // Busy archives and storage failures are retryable; moving their files can lose live SDK state.
          if (isTemporaryStorageFailure(error)) throw error
          // Preserve unreadable files outside the SDK scan root. Persist the reason across restarts.
          const recoveryRoot = path.join(storage.stateDir, "wanta-recovery")
          await mkdir(recoveryRoot, { recursive: true })
          const recovery = await mkdtemp(path.join(recoveryRoot, "archive-"))
          const issue: KnowledgeRecoveryIssue = {
            id: path.basename(recovery),
            relativePath: path.relative(storage.managedLibraryDir, filePath).split(path.sep).join("/"),
            message: describeError(error),
          }
          await writeFile(path.join(recovery, "issue.json"), JSON.stringify(issue), { flag: "wx" })
          await rename(filePath, path.join(recovery, "archive.wikg"))
          console.warn("[wanta] isolated unreadable knowledge archive:", issue.relativePath, issue.message)
        }
      }
    }
  }
  await walk(storage.managedLibraryDir)
}

export async function readKnowledgeRecoveryIssues(stateDir: string): Promise<KnowledgeRecoveryIssue[]> {
  const root = path.join(stateDir, "wanta-recovery")
  const entries = await readdir(root, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return []
    throw error
  })
  const issues: KnowledgeRecoveryIssue[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    try {
      const files = await readdir(path.join(root, entry.name))
      if (!files.includes("archive.wikg")) continue
      const issue: unknown = JSON.parse(await readFile(path.join(root, entry.name, "issue.json"), "utf8"))
      if (
        typeof issue === "object" &&
        issue !== null &&
        "relativePath" in issue &&
        typeof issue.relativePath === "string" &&
        "message" in issue &&
        typeof issue.message === "string"
      )
        issues.push({ id: entry.name, relativePath: issue.relativePath, message: issue.message })
      else throw new Error("Invalid recovery details")
    } catch {
      // A damaged recovery record must not prevent healthy archives from loading.
      issues.push({ id: entry.name, relativePath: entry.name, message: "Recovery details are unavailable." })
    }
  }
  return issues.sort((left, right) => left.relativePath.localeCompare(right.relativePath))
}
