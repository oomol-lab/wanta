import { mkdtemp, writeFile, truncate, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { expect, test } from "vitest"
import { attachmentPreview } from "./previews.ts"

test("distinguishes missing, unsupported and oversized attachments", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wanta-preview-reasons-"))
  try {
    const image = path.join(root, "large.png")
    expect(await attachmentPreview({ path: image, mime: "image/png" })).toEqual({ dataUrl: null, reason: "missing" })
    expect(await attachmentPreview({ path: image, mime: "application/pdf" })).not.toHaveProperty("resourceUrl")
    expect(await attachmentPreview({ path: path.join(root, "document.pdf"), mime: "application/pdf" })).toEqual({
      dataUrl: null,
      reason: "unsupported_type",
    })
    await writeFile(image, "")
    await truncate(image, 16 * 1024 * 1024 + 1)
    expect(await attachmentPreview({ path: image, mime: "image/png" })).toEqual({ dataUrl: null, reason: "too_large" })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
