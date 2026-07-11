import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { test } from "vitest"
import { localArtifactPreview } from "./previews.ts"

test("localArtifactPreview only grants leases for resource-backed previews", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "wanta-preview-leases-"))
  try {
    const textPath = path.join(directory, "notes.txt")
    const imagePath = path.join(directory, "image.png")
    await Promise.all([writeFile(textPath, "hello"), writeFile(imagePath, "image")])
    let grants = 0
    const createResourceUrl = () => {
      grants += 1
      return { expiresAt: 123, url: "wanta-resource://artifact/token" }
    }

    const textPreview = await localArtifactPreview({ path: textPath }, createResourceUrl)
    assert.equal(textPreview.kind, "text")
    assert.equal(grants, 0)

    const imagePreview = await localArtifactPreview({ path: imagePath }, createResourceUrl)
    assert.equal(imagePreview.kind, "image")
    assert.equal(grants, 1)
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})
