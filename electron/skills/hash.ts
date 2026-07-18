import type { Dirent } from "node:fs"

import crypto from "node:crypto"
import { open, readdir, readFile, stat } from "node:fs/promises"
import path from "node:path"
import { skippedDirectoryNames } from "./constants.ts"

interface HashCandidateFile {
  path: string
  relativePath: string
  size: number
}

const maxHashableFileBytes = 512 * 1024

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

async function readFileSample(filePath: string, size: number): Promise<Buffer> {
  if (size <= maxHashableFileBytes) {
    return readFile(filePath)
  }

  const headLength = Math.floor(maxHashableFileBytes / 2)
  const tailLength = maxHashableFileBytes - headLength
  const file = await open(filePath, "r")
  try {
    const head = Buffer.alloc(headLength)
    const tail = Buffer.alloc(tailLength)
    const headRead = await file.read(head, 0, headLength, 0)
    const tailRead = await file.read(tail, 0, tailLength, size - tailLength)
    return Buffer.concat([head.subarray(0, headRead.bytesRead), tail.subarray(0, tailRead.bytesRead)])
  } finally {
    await file.close()
  }
}

async function readHashCandidateFiles(rootPath: string): Promise<HashCandidateFile[]> {
  async function walk(directoryPath: string): Promise<HashCandidateFile[]> {
    let entries: Dirent[]

    try {
      entries = await readdir(directoryPath, { withFileTypes: true })
    } catch {
      return []
    }

    const files: HashCandidateFile[] = []

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
      let fileSize: number

      try {
        fileSize = (await stat(filePath)).size
      } catch {
        continue
      }

      files.push({
        path: filePath,
        relativePath: path.relative(rootPath, filePath),
        size: fileSize,
      })
    }

    return files
  }

  return (await walk(rootPath)).sort((left, right) => left.relativePath.localeCompare(right.relativePath))
}

export async function hashTextFiles(rootPath: string): Promise<string | undefined> {
  const files = await readHashCandidateFiles(rootPath)
  const hash = crypto.createHash("sha256")
  let hashedFileCount = 0

  for (const file of files) {
    let content: Buffer
    try {
      content = await readFileSample(file.path, file.size)
    } catch {
      continue
    }
    if (!isLikelyTextBuffer(content)) {
      continue
    }

    hash.update(file.relativePath)
    hash.update("\0")
    hash.update(String(file.size))
    hash.update("\0")
    hash.update(file.size > content.length ? "truncated" : "full")
    hash.update("\0")
    hash.update(content)
    hash.update("\0")
    hashedFileCount += 1
  }

  return hashedFileCount > 0 ? hash.digest("hex") : undefined
}
