import assert from "node:assert/strict"
import { mkdir, mkdtemp, open, rename, rm, stat, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { test } from "vitest"
import { ArtifactResourceLeaseStore } from "./lease-store.ts"
import { artifactResourceResponse, artifactResourceUrl, parseSingleByteRange } from "./protocol.ts"

test("parseSingleByteRange accepts bounded, open, and suffix ranges", () => {
  assert.deepEqual(parseSingleByteRange("bytes=10-19", 100), { start: 10, end: 19 })
  assert.deepEqual(parseSingleByteRange("bytes=90-", 100), { start: 90, end: 99 })
  assert.deepEqual(parseSingleByteRange("bytes=-10", 100), { start: 90, end: 99 })
  assert.deepEqual(parseSingleByteRange("bytes=90-200", 100), { start: 90, end: 99 })
})

test("parseSingleByteRange rejects invalid and multi-part ranges", () => {
  assert.equal(parseSingleByteRange("bytes=100-101", 100), "invalid")
  assert.equal(parseSingleByteRange("bytes=20-10", 100), "invalid")
  assert.equal(parseSingleByteRange("bytes=0-1,4-5", 100), "invalid")
  assert.equal(parseSingleByteRange(null, 100), null)
})

test("artifact resource response streams full and ranged file content", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "wanta-resource-"))
  try {
    const filePath = path.join(directory, "sample.txt")
    await writeFile(filePath, "0123456789")
    const info = await stat(filePath)
    const store = new ArtifactResourceLeaseStore()
    const lease = store.grant({
      dev: info.dev,
      ino: info.ino,
      mime: "text/plain",
      modifiedAt: info.mtimeMs,
      path: filePath,
      size: info.size,
    })
    const url = artifactResourceUrl(lease.token)
    const full = await artifactResourceResponse(new Request(url), store)
    assert.equal(full.status, 200)
    assert.equal(await full.text(), "0123456789")

    const partial = await artifactResourceResponse(new Request(url, { headers: { Range: "bytes=2-5" } }), store)
    assert.equal(partial.status, 206)
    assert.equal(partial.headers.get("content-range"), "bytes 2-5/10")
    assert.equal(await partial.text(), "2345")
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})

test.skipIf(process.platform === "win32")(
  "artifact resource response rejects a parent-directory symlink swap",
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), "wanta-resource-swap-"))
    try {
      const artifactDirectory = path.join(root, "artifacts")
      const movedArtifactDirectory = path.join(root, "artifacts-original")
      const outsideDirectory = path.join(root, "outside")
      await Promise.all([mkdir(artifactDirectory), mkdir(outsideDirectory)])
      const filePath = path.join(artifactDirectory, "report.txt")
      await writeFile(filePath, "safe")
      await writeFile(path.join(outsideDirectory, "report.txt"), "outside")
      const info = await stat(filePath)
      const store = new ArtifactResourceLeaseStore()
      const lease = store.grant({
        dev: info.dev,
        ino: info.ino,
        mime: "text/plain",
        modifiedAt: info.mtimeMs,
        path: filePath,
        size: info.size,
      })

      await rename(artifactDirectory, movedArtifactDirectory)
      await symlink(outsideDirectory, artifactDirectory, "dir")

      const response = await artifactResourceResponse(new Request(artifactResourceUrl(lease.token)), store)
      assert.equal(response.status, 404)
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  },
)

test.skipIf(process.platform === "win32")(
  "artifact resource response streams from a retained verified handle after a parent-directory swap",
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), "wanta-resource-handle-"))
    const store = new ArtifactResourceLeaseStore()
    try {
      const artifactDirectory = path.join(root, "artifacts")
      const movedArtifactDirectory = path.join(root, "artifacts-original")
      const outsideDirectory = path.join(root, "outside")
      await Promise.all([mkdir(artifactDirectory), mkdir(outsideDirectory)])
      const filePath = path.join(artifactDirectory, "report.txt")
      await writeFile(filePath, "safe")
      await writeFile(path.join(outsideDirectory, "report.txt"), "outside")
      const handle = await open(filePath, "r")
      const info = await handle.stat()
      const lease = store.grant({
        dev: info.dev,
        handle,
        ino: info.ino,
        mime: "text/plain",
        modifiedAt: info.mtimeMs,
        path: filePath,
        size: info.size,
      })

      await rename(artifactDirectory, movedArtifactDirectory)
      await symlink(outsideDirectory, artifactDirectory, "dir")

      const response = await artifactResourceResponse(new Request(artifactResourceUrl(lease.token)), store)
      assert.equal(response.status, 200)
      assert.equal(await response.text(), "safe")
    } finally {
      store.clear()
      await rm(root, { force: true, recursive: true })
    }
  },
)
