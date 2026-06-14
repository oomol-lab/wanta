import assert from "node:assert/strict"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { test } from "vitest"
import {
  clipboardAttachmentDisplayName,
  clipboardAttachmentFileName,
  saveClipboardAttachment,
} from "./clipboard-attachment.ts"

test("clipboardAttachmentDisplayName appends an extension from the MIME type", () => {
  assert.equal(clipboardAttachmentDisplayName({ name: "Screenshot", mime: "image/png" }), "Screenshot.png")
  assert.equal(clipboardAttachmentDisplayName({ name: "photo.jpg", mime: "image/jpeg" }), "photo.jpg")
})

test("clipboardAttachmentFileName sanitizes path-like clipboard names", () => {
  const fileName = clipboardAttachmentFileName({ name: "../../bad:name", mime: "image/png" })
  assert.match(fileName, /bad_name\.png$/)
  assert.equal(fileName.includes("/"), false)
  assert.equal(fileName.includes(":"), false)
})

test("saveClipboardAttachment writes bytes under the app attachment directory", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lumo-clipboard-attachment-"))
  try {
    const bytes = new Uint8Array([1, 2, 3]).buffer
    const attachment = await saveClipboardAttachment(root, { name: "pasted-image", mime: "image/png", bytes })

    assert.equal(attachment.name, "pasted-image.png")
    assert.equal(attachment.mime, "image/png")
    assert.equal(attachment.size, 3)
    assert.equal(attachment.kind, "file")
    assert.equal(path.dirname(attachment.path), path.join(root, "attachments", "clipboard"))
    assert.deepEqual(await readFile(attachment.path), Buffer.from([1, 2, 3]))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("saveClipboardAttachment rejects empty data", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lumo-clipboard-attachment-"))
  try {
    await assert.rejects(
      saveClipboardAttachment(root, { name: "empty.png", mime: "image/png", bytes: new ArrayBuffer(0) }),
      /Attachment is empty/,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
