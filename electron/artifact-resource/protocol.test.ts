import assert from "node:assert/strict"
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises"
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
