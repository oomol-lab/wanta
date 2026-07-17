import type { ChatAttachment, ChatMessage } from "./common.ts"

import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { applyUserAttachmentRecords, UserAttachmentStore } from "./user-attachments.ts"

const temporaryDirectories: string[] = []

afterEach(async () => {
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
