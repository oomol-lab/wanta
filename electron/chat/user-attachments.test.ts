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
    await store.record("session-1", "message-1", [workbook()], "Analyze this workbook")

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
    expect(record?.userText).toBe("Analyze this workbook")
    const persisted = (await readFile(path.join(directory, "user-attachments.json"), "utf8")).toString()
    expect(persisted).toContain('"version": 2')
    expect(persisted).not.toContain("agentName")
  })

  it("loads version 1 records without public user text", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "wanta-user-attachments-v1-"))
    temporaryDirectories.push(directory)
    await writeFile(
      path.join(directory, "user-attachments.json"),
      JSON.stringify({
        sessions: {
          "session-1": {
            "message-1": {
              attachments: [
                {
                  id: "attachment-1",
                  kind: "file",
                  mime: "image/png",
                  name: "photo.png",
                  path: "/managed/original/photo.png",
                  size: 100,
                },
              ],
              internalPaths: [],
              messageId: "message-1",
              sessionId: "session-1",
            },
          },
        },
        version: 1,
      }),
    )

    const record = (await new UserAttachmentStore(directory).read()).get("session-1")?.get("message-1")
    expect(record?.attachments[0]?.name).toBe("photo.png")
    expect(record?.userText).toBeUndefined()
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

  it("reconstructs public user text without model-only attachment context", () => {
    const message: ChatMessage = {
      createdAt: 1,
      id: "message-1",
      parts: [
        {
          kind: "text",
          partId: "internal-reference",
          text: [
            "Attached local file: photo.png",
            "Path: /managed/original/photo.png",
            "Media type: image/png; size: 100 B",
            "The file was not embedded in the model request because the selected model does not support image input.",
            "Use an appropriate local tool or script against the exact path when the task requires its contents. Do not use the Read tool on an unsupported binary file.",
          ].join("\n"),
        },
        { kind: "text", partId: "user-text", text: "/bug-report Check the image failure" },
      ],
      role: "user",
    }
    const record = {
      attachments: [
        {
          id: "attachment-1",
          kind: "file" as const,
          mime: "image/png",
          name: "photo.png",
          path: "/managed/original/photo.png",
          size: 100,
        },
      ],
      internalPaths: [],
      messageId: "message-1",
      sessionId: "session-1",
      userText: "/bug-report Check the image failure",
    }

    expect(applyUserAttachmentRecords([message], new Map([["message-1", record]]))[0]?.parts).toEqual([
      {
        attachment: record.attachments[0],
        kind: "attachment",
        partId: "wanta-attachment-attachment-1",
      },
      { kind: "text", partId: "user-text", text: "/bug-report Check the image failure" },
    ])
  })

  it("removes exact legacy attachment references while preserving user-authored text", () => {
    const record = {
      attachments: [
        {
          id: "attachment-1",
          kind: "file" as const,
          mime: "image/png",
          name: "photo.png",
          path: "/managed/original/photo.png",
          size: 100,
        },
      ],
      internalPaths: [],
      messageId: "message-1",
      sessionId: "session-1",
    }
    const legacyReference = [
      "Attached local file: photo.png",
      "Path: /managed/original/photo.png",
      "Media type: image/png; size: 100 B",
      "The file was not embedded in the model request because the selected model does not support image input.",
      "Use an appropriate local tool or script against the exact path when the task requires its contents. Do not use the Read tool on an unsupported binary file.",
    ].join("\n")
    const message: ChatMessage = {
      createdAt: 1,
      id: "message-1",
      parts: [
        { kind: "text", partId: "legacy-reference", text: legacyReference },
        { kind: "text", partId: "user-text", text: "Analyze this image" },
        { kind: "text", partId: "similar-user-text", text: `${legacyReference}\nUser-authored detail` },
      ],
      role: "user",
    }

    expect(applyUserAttachmentRecords([message], new Map([["message-1", record]]))[0]?.parts).toEqual([
      {
        attachment: record.attachments[0],
        kind: "attachment",
        partId: "wanta-attachment-attachment-1",
      },
      { kind: "text", partId: "user-text", text: "Analyze this image" },
      { kind: "text", partId: "similar-user-text", text: `${legacyReference}\nUser-authored detail` },
    ])
  })

  it("removes legacy prepared-copy and attachment-limit context", () => {
    const prepared = workbook()
    const attachments = [
      {
        id: prepared.id,
        kind: prepared.kind,
        mime: prepared.mime,
        name: prepared.name,
        path: prepared.path,
        size: prepared.size,
      },
      ...Array.from({ length: 21 }, (_, index) => ({
        id: `attachment-${index + 2}`,
        kind: "file" as const,
        mime: "text/plain",
        name: `note-${index + 2}.txt`,
        path: `/managed/original/note-${index + 2}.txt`,
        size: 10,
      })),
    ]
    const record = {
      attachments,
      internalPaths: [prepared.agentPath!],
      messageId: "message-1",
      sessionId: "session-1",
    }
    const preparedReference = [
      `Attached local file: ${prepared.name}`,
      `Path: ${prepared.path}`,
      `Media type: ${prepared.mime}; size: 100 B`,
      "The file was not embedded in the model request because it exceeds the safe direct-attachment size budget.",
      `A prepared copy exists at ${prepared.agentPath}, but it was not embedded. Use local tools against the original or prepared path as appropriate.`,
    ].join("\n")
    const omittedReference =
      "2 additional attachments were not embedded because the per-turn limit is 20. Ask the user to split the files across multiple turns if they are required."
    const message: ChatMessage = {
      createdAt: 1,
      id: "message-1",
      parts: [
        { kind: "text", partId: "legacy-prepared", text: preparedReference },
        { kind: "text", partId: "legacy-limit", text: omittedReference },
        { kind: "text", partId: "user-text", text: "Analyze the attachments" },
      ],
      role: "user",
    }

    const parts = applyUserAttachmentRecords([message], new Map([["message-1", record]]))[0]?.parts ?? []
    expect(parts.filter((part) => part.kind === "attachment")).toHaveLength(22)
    expect(parts.filter((part) => part.kind === "text")).toEqual([
      { kind: "text", partId: "user-text", text: "Analyze the attachments" },
    ])
  })
})
