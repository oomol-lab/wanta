import type { SelectedAttachmentPath } from "./attachment-picker.ts"

import { chmod, lstat, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("electron", () => ({
  app: { getPath: vi.fn(() => "/tmp/wanta-user-data") },
  BrowserWindow: { fromWebContents: vi.fn(() => null) },
  dialog: { showOpenDialog: vi.fn() },
  ipcMain: { handle: vi.fn() },
}))

import { prepareSelectedAttachment, snapshotSelectedAttachment } from "./attachment-dialog-handlers.ts"

const temporaryDirectories: string[] = []

async function makeTreeWritable(target: string): Promise<void> {
  const info = await lstat(target).catch(() => null)
  if (!info) return
  if (!info.isDirectory()) {
    await chmod(target, 0o600)
    return
  }
  await chmod(target, 0o700)
  const entries = await readdir(target)
  await Promise.all(entries.map((entry) => makeTreeWritable(path.join(target, entry))))
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directory) => {
      await makeTreeWritable(directory)
      await rm(directory, { force: true, recursive: true })
    }),
  )
})

const workbook: SelectedAttachmentPath = {
  kind: "file",
  mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  name: "inventory.xlsx",
  path: "/tmp/inventory.xlsx",
  size: 100,
}

describe("prepareSelectedAttachment", () => {
  it("keeps the immutable snapshot when spreadsheet preview rejects", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "wanta-attachment-handler-"))
    temporaryDirectories.push(directory)
    const sourcePath = path.join(directory, "inventory.xlsx")
    await writeFile(sourcePath, "workbook")
    const error = new Error("preview failed")
    const reportFailure = vi.fn()

    const result = await prepareSelectedAttachment(
      path.join(directory, "user-data"),
      { ...workbook, path: sourcePath, size: 8 },
      async () => Promise.reject(error),
      vi.fn(),
      reportFailure,
    )

    expect(result).toMatchObject({
      kind: workbook.kind,
      mime: workbook.mime,
      name: workbook.name,
      size: 8,
    })
    expect(result?.path).not.toBe(sourcePath)
    expect(await readFile(result?.path ?? "", "utf8")).toBe("workbook")
    expect(reportFailure).toHaveBeenCalledWith(error)
  })
})

describe("snapshotSelectedAttachment", () => {
  it("creates a private immutable copy without changing the source", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "wanta-attachment-snapshot-"))
    temporaryDirectories.push(directory)
    const sourcePath = path.join(directory, "inventory.xlsx")
    await writeFile(sourcePath, "original-workbook")
    const sourceBefore = await stat(sourcePath)

    const snapshot = await snapshotSelectedAttachment(path.join(directory, "user-data"), {
      ...workbook,
      path: sourcePath,
      size: sourceBefore.size,
    })

    expect(snapshot.name).toBe("inventory.xlsx")
    expect(snapshot.path).not.toBe(sourcePath)
    expect(await readFile(snapshot.path, "utf8")).toBe("original-workbook")
    expect(await readFile(sourcePath, "utf8")).toBe("original-workbook")
    expect((await stat(snapshot.path)).mode & 0o777).toBe(0o400)
    expect((await stat(sourcePath)).mtimeMs).toBe(sourceBefore.mtimeMs)
  })

  it("rejects a stale selection instead of falling back to the mutable source", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "wanta-attachment-stale-"))
    temporaryDirectories.push(directory)
    const sourcePath = path.join(directory, "inventory.xlsx")
    await writeFile(sourcePath, "changed-after-selection")

    await expect(
      snapshotSelectedAttachment(path.join(directory, "user-data"), {
        ...workbook,
        path: sourcePath,
        size: 8,
      }),
    ).rejects.toThrow("changed before")
  })

  it.each([".", ".."])("normalizes the reserved snapshot name %s", async (name) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "wanta-attachment-reserved-name-"))
    temporaryDirectories.push(directory)
    const sourcePath = path.join(directory, "source")
    await writeFile(sourcePath, "attachment")

    const snapshot = await snapshotSelectedAttachment(path.join(directory, "user-data"), {
      ...workbook,
      name,
      path: sourcePath,
      size: 10,
    })

    expect(path.basename(snapshot.path)).toBe("attachment")
    expect(await readFile(snapshot.path, "utf8")).toBe("attachment")
  })
})
