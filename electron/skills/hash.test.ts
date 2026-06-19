import assert from "node:assert/strict"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { test } from "vitest"
import { hashTextFiles, isLikelyTextBuffer } from "./hash.ts"

test("isLikelyTextBuffer rejects binary buffers", () => {
  assert.equal(isLikelyTextBuffer(Buffer.from([0, 1, 2, 3])), false)
  assert.equal(isLikelyTextBuffer(Buffer.from("hello\nworld\n")), true)
})

test("hashTextFiles ignores binary files and skipped directories", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "oo-desktop-hash-"))

  try {
    await writeFile(path.join(rootPath, "SKILL.md"), "hello\n", "utf8")
    await writeFile(path.join(rootPath, "asset.bin"), Buffer.from([0, 1, 2, 3]))
    await mkdir(path.join(rootPath, "node_modules"), { recursive: true })
    await writeFile(path.join(rootPath, "node_modules", "ignored.txt"), "ignored\n", "utf8")

    const firstHash = await hashTextFiles(rootPath)
    await writeFile(path.join(rootPath, "asset.bin"), Buffer.from([0, 9, 9, 9]))
    const secondHash = await hashTextFiles(rootPath)

    assert.equal(firstHash, secondHash)
  } finally {
    await rm(rootPath, { force: true, recursive: true })
  }
})

test("hashTextFiles samples large text file tails without reading full content", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "oo-desktop-hash-large-"))

  try {
    const largeText = "a".repeat(600 * 1024)
    await writeFile(path.join(rootPath, "SKILL.md"), largeText, "utf8")
    const firstHash = await hashTextFiles(rootPath)
    await writeFile(path.join(rootPath, "SKILL.md"), `${largeText.slice(0, -1)}b`, "utf8")
    const secondHash = await hashTextFiles(rootPath)

    assert.notEqual(firstHash, secondHash)
  } finally {
    await rm(rootPath, { force: true, recursive: true })
  }
})
