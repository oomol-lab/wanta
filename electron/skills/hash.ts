import type { Dirent } from "node:fs"

import crypto from "node:crypto"
import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import { skippedDirectoryNames } from "./constants.ts"

interface HashableFile {
  content: Buffer
  relativePath: string
}

export function isLikelyTextBuffer(buffer: Buffer): boolean {
  if (buffer.includes(0)) {
    return false
  }

  const sample = buffer.subarray(0, Math.min(buffer.length, 4096))
  let suspiciousBytes = 0

  for (const byte of sample) {
    if (byte === 9 || byte === 10 || byte === 13) {
      continue
    }

    if (byte < 32) {
      suspiciousBytes += 1
    }
  }

  return suspiciousBytes / Math.max(sample.length, 1) < 0.02
}

export async function readHashableFiles(rootPath: string): Promise<HashableFile[]> {
  async function walk(directoryPath: string): Promise<HashableFile[]> {
    let entries: Dirent[]

    try {
      entries = await readdir(directoryPath, { withFileTypes: true })
    } catch {
      return []
    }

    const files: HashableFile[] = []

    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        continue
      }

      if (entry.isDirectory()) {
        if (skippedDirectoryNames.has(entry.name)) {
          continue
        }

        files.push(...(await walk(path.join(directoryPath, entry.name))))
        continue
      }

      if (!entry.isFile()) {
        continue
      }

      const filePath = path.join(directoryPath, entry.name)
      let content: Buffer

      try {
        content = await readFile(filePath)
      } catch {
        continue
      }

      if (!isLikelyTextBuffer(content)) {
        continue
      }

      files.push({
        content,
        relativePath: path.relative(rootPath, filePath),
      })
    }

    return files
  }

  return (await walk(rootPath)).sort((left, right) => left.relativePath.localeCompare(right.relativePath))
}

export async function hashTextFiles(rootPath: string): Promise<string | undefined> {
  const files = await readHashableFiles(rootPath)

  if (files.length === 0) {
    return undefined
  }

  const hash = crypto.createHash("sha256")

  for (const file of files) {
    hash.update(file.relativePath)
    hash.update("\0")
    hash.update(file.content)
    hash.update("\0")
  }

  return hash.digest("hex")
}
