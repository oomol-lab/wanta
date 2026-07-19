import type { ChatAttachment, ChatMessage } from "./common.ts"

import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { applyUserAttachmentRecords, UserAttachmentStore } from "./user-attachments.ts"

const temporaryDirectories: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })))
})

function workbook(): ChatAttachment {
  return {
    agentMime: "text/plain",
    agentName: "inventory-extracted.txt",
    agentPath: "/managed/internal/inventory-extracted.txt",
    agentSize: 50,
    id: "attachment-1",
    kind: "file",
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    name: "inventory.xlsx",
    path: "/managed/original/inventory.xlsx",
    size: 100,
  }
}

describe("UserAttachmentStore", () => {
  it("persists public originals separately from internal model representations", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "wanta-user-attachments-"))
    temporaryDirectories.push(directory)
    const store = new UserAttachmentStore(directory)
    await store.record("session-1", "message-1", [workbook()])

    const restarted = new UserAttachmentStore(directory)
    const record = (await restarted.read()).get("session-1")?.get("message-1")
    expect(record?.attachments).toEqual([
      {
        id: "attachment-1",
        kind: "file",
        mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        name: "inventory.xlsx",
        path: "/managed/original/inventory.xlsx",
        size: 100,
      },
    ])
    expect(record?.internalPaths).toEqual(["/managed/internal/inventory-extracted.txt"])
    expect((await readFile(path.join(directory, "user-attachments.json"), "utf8")).toString()).not.toContain(
      "agentName",
    )
  })

  it("removes unreferenced managed snapshots with their session record", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "wanta-user-attachment-cleanup-"))
    temporaryDirectories.push(directory)
    const snapshotDirectory = path.join(directory, "attachments", "originals", "attachment-1")
    const snapshotPath = path.join(snapshotDirectory, "inventory.xlsx")
    await mkdir(snapshotDirectory, { recursive: true })
    await writeFile(snapshotPath, "workbook", { mode: 0o400 })
    await chmod(snapshotDirectory, 0o500)
    const store = new UserAttachmentStore(directory)
    await store.record("session-1", "message-1", [{ ...workbook(), path: snapshotPath }])

    await store.removeSession("session-1")

    await expect(access(snapshotDirectory)).rejects.toThrow()
    expect((await store.read()).has("session-1")).toBe(false)
  })

  it("keeps a managed snapshot referenced by a concurrent queued record", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "wanta-user-attachment-rereference-"))
    temporaryDirectories.push(directory)
    const snapshotDirectory = path.join(directory, "attachments", "originals", "attachment-1")
    const snapshotPath = path.join(snapshotDirectory, "inventory.xlsx")
    await mkdir(snapshotDirectory, { recursive: true })
    await writeFile(snapshotPath, "workbook", { mode: 0o400 })
    await chmod(snapshotDirectory, 0o500)
    const store = new UserAttachmentStore(directory)
    await store.record("session-1", "message-1", [{ ...workbook(), path: snapshotPath }])

    const rereference = store.record("session-2", "message-2", [{ ...workbook(), path: snapshotPath }])
    const removal = store.removeSession("session-1")
    await Promise.all([rereference, removal])

    expect(await readFile(snapshotPath, "utf8")).toBe("workbook")
    const records = await store.read()
    expect(records.has("session-1")).toBe(false)
    expect(records.get("session-2")?.get("message-2")?.attachments[0]?.path).toBe(snapshotPath)
    await chmod(snapshotDirectory, 0o700)
  })

  it("removes one unsubmitted message without touching other session attachments", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "wanta-user-attachment-message-rollback-"))
    temporaryDirectories.push(directory)
    const removedDirectory = path.join(directory, "attachments", "originals", "removed")
    const retainedDirectory = path.join(directory, "attachments", "originals", "retained")
    const removedPath = path.join(removedDirectory, "removed.xlsx")
    const retainedPath = path.join(retainedDirectory, "retained.xlsx")
    await Promise.all([mkdir(removedDirectory, { recursive: true }), mkdir(retainedDirectory, { recursive: true })])
    await Promise.all([writeFile(removedPath, "removed"), writeFile(retainedPath, "retained")])
    const store = new UserAttachmentStore(directory)
    await store.record("session-1", "message-1", [{ ...workbook(), path: removedPath }])
    await store.record("session-1", "message-2", [{ ...workbook(), id: "attachment-2", path: retainedPath }])

    await store.removeMessage("session-1", "message-1")

    await expect(access(removedDirectory)).rejects.toThrow()
    expect(await readFile(retainedPath, "utf8")).toBe("retained")
    const records = await store.read()
    expect(records.get("session-1")?.has("message-1")).toBe(false)
    expect(records.get("session-1")?.has("message-2")).toBe(true)
  })

  it("commits message rollback when managed-file cleanup needs a later retry", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "wanta-user-attachment-message-cleanup-"))
    temporaryDirectories.push(directory)
    const snapshotDirectory = path.join(directory, "attachments", "originals", "attachment-1")
    const snapshotPath = path.join(snapshotDirectory, "inventory.xlsx")
    await mkdir(snapshotDirectory, { recursive: true })
    await writeFile(snapshotPath, "workbook")
    const removeManagedPath = vi
      .fn<(target: string, options: { force: boolean; recursive?: boolean }) => Promise<void>>()
      .mockRejectedValueOnce(new Error("cleanup failed"))
      .mockImplementation((target, options) => rm(target, options))
    const store = new UserAttachmentStore(directory, { removeManagedPath })
    await store.record("session-1", "message-1", [{ ...workbook(), path: snapshotPath }])
    vi.spyOn(console, "warn").mockImplementation(() => undefined)

    await store.removeMessage("session-1", "message-1")

    expect((await store.read()).has("session-1")).toBe(false)
    expect(await readFile(snapshotPath, "utf8")).toBe("workbook")

    await store.pruneExpiredUnreferenced(1, Date.now() + 10_000)

    await expect(access(snapshotDirectory)).rejects.toThrow()
  })

  it("retains the session record when cleanup fails and retries safely", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "wanta-user-attachment-retry-"))
    temporaryDirectories.push(directory)
    const snapshotDirectory = path.join(directory, "attachments", "originals", "attachment-1")
    const snapshotPath = path.join(snapshotDirectory, "inventory.xlsx")
    await mkdir(snapshotDirectory, { recursive: true })
    await writeFile(snapshotPath, "workbook", { mode: 0o400 })
    await chmod(snapshotDirectory, 0o500)
    const removeManagedPath = vi
      .fn<(target: string, options: { force: boolean; recursive?: boolean }) => Promise<void>>()
      .mockRejectedValueOnce(new Error("cleanup failed"))
      .mockImplementation((target, options) => rm(target, options))
    const store = new UserAttachmentStore(directory, { removeManagedPath })
    await store.record("session-1", "message-1", [{ ...workbook(), path: snapshotPath }])

    await expect(store.removeSession("session-1")).rejects.toThrow("cleanup failed")
    expect((await store.read()).has("session-1")).toBe(true)
    expect(await readFile(snapshotPath, "utf8")).toBe("workbook")

    await store.removeSession("session-1")

    expect(removeManagedPath).toHaveBeenCalledTimes(2)
    await expect(access(snapshotDirectory)).rejects.toThrow()
    expect((await store.read()).has("session-1")).toBe(false)
  })

  it("prunes old unreferenced drafts while retaining sent attachment snapshots", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "wanta-user-attachment-prune-"))
    temporaryDirectories.push(directory)
    const retainedDirectory = path.join(directory, "attachments", "originals", "retained")
    const orphanDirectory = path.join(directory, "attachments", "originals", "orphan")
    const retainedPath = path.join(retainedDirectory, "retained.pdf")
    const orphanPath = path.join(orphanDirectory, "orphan.pdf")
    await Promise.all([mkdir(retainedDirectory, { recursive: true }), mkdir(orphanDirectory, { recursive: true })])
    await Promise.all([writeFile(retainedPath, "retained"), writeFile(orphanPath, "orphan")])
    const store = new UserAttachmentStore(directory)
    await store.record("session-1", "message-1", [
      { id: "retained", kind: "file", mime: "application/pdf", name: "retained.pdf", path: retainedPath, size: 8 },
    ])

    await store.pruneExpiredUnreferenced(1, Date.now() + 10_000)

    expect(await readFile(retainedPath, "utf8")).toBe("retained")
    await expect(access(orphanPath)).rejects.toThrow()
  })
})

describe("applyUserAttachmentRecords", () => {
  it("replaces OpenCode representation attachments with the user original", () => {
    const message: ChatMessage = {
      createdAt: 1,
      id: "message-1",
      parts: [
        {
          attachment: {
            id: "opencode-file",
            kind: "file",
            mime: "text/plain",
            name: "inventory-extracted.txt",
            path: "/managed/internal/inventory-extracted.txt",
            size: 0,
          },
          kind: "attachment",
          partId: "opencode-file",
        },
        { kind: "text", partId: "user-text", text: "Analyze this workbook" },
      ],
      role: "user",
    }
    const record = {
      attachments: [
        {
          id: "attachment-1",
          kind: "file" as const,
          mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          name: "inventory.xlsx",
          path: "/managed/original/inventory.xlsx",
          size: 100,
        },
      ],
      internalPaths: ["/managed/internal/inventory-extracted.txt"],
      messageId: "message-1",
      sessionId: "session-1",
    }

    expect(applyUserAttachmentRecords([message], new Map([["message-1", record]]))[0]?.parts).toEqual([
      {
        attachment: record.attachments[0],
        kind: "attachment",
        partId: "wanta-attachment-attachment-1",
      },
      { kind: "text", partId: "user-text", text: "Analyze this workbook" },
    ])
  })
})
