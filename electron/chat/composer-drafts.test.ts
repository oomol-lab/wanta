import type { ComposerDraftRecord } from "./common.ts"

import { mkdir, mkdtemp, readdir, rm, stat, readFile, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { expect, test, vi } from "vitest"
import { ComposerDraftStore, normalizeComposerDraft } from "./composer-drafts.ts"
import { UserAttachmentStore } from "./user-attachments.ts"
const value: ComposerDraftRecord = {
  draft: "notes",
  attachments: [
    {
      id: "image",
      path: "/snapshot/image.png",
      agentPath: "/snapshot/agent.txt",
      name: "image.png",
      size: 20,
      mime: "image/png",
    },
  ],
  contextMentions: [],
  command: null,
  dismissedTriggerKey: null,
  draftSelection: { start: 5, end: 5 },
}
test("round-trips drafts across process restarts, isolates owners and keeps referenced paths", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wanta-draft-"))
  try {
    const store = new ComposerDraftStore(root)
    await Promise.all([
      store.save({ owner: "account-a", key: "new", value }),
      store.save({ owner: "account-b", key: "new", value: { ...value, draft: "other" } }),
    ])
    const restored = new ComposerDraftStore(root)
    expect((await restored.read("account-a")).new).toEqual(value)
    expect((await restored.read("account-b")).new.draft).toBe("other")
    expect(await restored.paths("account-a")).toEqual(["/snapshot/image.png", "/snapshot/agent.txt"])
    expect(await restored.paths("account-a", { includeAgentPaths: false })).toEqual(["/snapshot/image.png"])
    expect((await stat(path.join(root, "composer-drafts.json"))).mode & 0o777).toBe(0o600)
    await restored.save({ owner: "account-a", key: "new", value: null })
    expect(await restored.read("account-a")).toEqual({})
    expect((await restored.read("account-b")).new.draft).toBe("other")
    expect(JSON.parse(await readFile(path.join(root, "composer-drafts.json"), "utf8")).version).toBe(1)
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test.each([
  "{private draft",
  JSON.stringify({ version: 99, owners: {} }),
  JSON.stringify({ version: 1, owners: { a: { new: {} } } }),
])(
  "recovers unreadable drafts while retaining the original store and blocking attachment pruning: %s",
  async (contents) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "wanta-draft-recovery-"))
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    try {
      const file = path.join(root, "composer-drafts.json")
      const snapshot = path.join(root, "attachments", "originals", "orphan", "photo.png")
      await mkdir(path.dirname(snapshot), { recursive: true })
      await writeFile(snapshot, "preserved")
      await writeFile(file, contents)
      const store = new ComposerDraftStore(root)
      const attachments = new UserAttachmentStore(root, { retentionState: () => store.retentionState() })
      expect(await Promise.all([store.read("a"), store.read("a")])).toEqual([{}, {}])
      expect(warn).toHaveBeenCalledTimes(1)
      expect(JSON.stringify(warn.mock.calls)).not.toContain(contents)
      expect(await store.paths("a", { includeAgentPaths: false })).toEqual([])
      await expect(attachments.pruneExpiredUnreferenced(0, Date.now() + 1000)).resolves.toBeUndefined()
      expect(await readFile(snapshot, "utf8")).toBe("preserved")
      expect(await readFile(file, "utf8")).toBe(contents)
      await attachments.record("session", "message", [{ ...value.attachments[0]!, path: snapshot }])
      await expect(attachments.removeSession("session")).resolves.toBeUndefined()
      expect((await new UserAttachmentStore(root).read()).has("session")).toBe(false)
      expect(await readFile(snapshot, "utf8")).toBe("preserved")
      await store.save({ owner: "a", key: "new", value })
      expect((await store.read("a")).new).toEqual(value)
      const backups = await readdir(path.join(root, "composer-drafts-recovery"))
      expect(backups).toHaveLength(1)
      expect(await readFile(path.join(root, "composer-drafts-recovery", backups[0]!), "utf8")).toBe(contents)
      const restarted = new ComposerDraftStore(root)
      expect((await restarted.read("a")).new).toEqual(value)
      expect((await restarted.retentionState()).paused).toBe(true)
      const restartedAttachments = new UserAttachmentStore(root, { retentionState: () => restarted.retentionState() })
      await expect(restartedAttachments.pruneExpiredUnreferenced(0, Date.now() + 1000)).resolves.toBeUndefined()
      expect(await readFile(snapshot, "utf8")).toBe("preserved")
    } finally {
      warn.mockRestore()
      await rm(root, { recursive: true, force: true })
    }
  },
)

test("does not replace an unreadable store if quarantine fails", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wanta-draft-quarantine-"))
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
  try {
    const file = path.join(root, "composer-drafts.json")
    await writeFile(file, "unreadable")
    const store = new ComposerDraftStore(root)
    expect(await store.read("a")).toEqual({})
    await writeFile(path.join(root, "composer-drafts-recovery"), "blocked")
    await expect(store.save({ owner: "a", key: "new", value })).rejects.toThrow()
    expect(await readFile(file, "utf8")).toBe("unreadable")
    expect((await store.retentionState()).paused).toBe(true)
    await rm(path.join(root, "composer-drafts-recovery"))
    await expect(store.save({ owner: "a", key: "new", value })).resolves.toBeUndefined()
  } finally {
    warn.mockRestore()
    await rm(root, { recursive: true, force: true })
  }
})

test("normalizes only supported preference fields and string selections", () => {
  const normalized = normalizeComposerDraft({
    ...value,
    preferences: {
      agentKind: "opencode",
      permissionMode: "full_access",
      knowledgeBaseIds: ["book"],
      modelId: 123,
      effortId: {},
      extra: "discard",
    },
  })
  expect(normalized.preferences).toEqual({
    agentKind: "opencode",
    permissionMode: "default",
    knowledgeBaseIds: ["book"],
  })
  expect(
    normalizeComposerDraft({
      ...value,
      preferences: {
        agentKind: "opencode",
        permissionMode: "default",
        knowledgeBaseIds: [],
        modelId: "model",
        effortId: "high",
      },
    }).preferences,
  ).toMatchObject({ modelId: "model", effortId: "high" })
})

test("clearing keeps a short owner-scoped undo lease without restoring a deleted draft", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wanta-draft-undo-"))
  try {
    const store = new ComposerDraftStore(root)
    await store.save({ owner: "a", key: "new", value })
    await store.save({ owner: "a", key: "new", value: null })
    expect(await store.read("a")).toEqual({})
    expect(await store.paths("a")).toContain("/snapshot/image.png")
    expect(await store.paths("b")).toEqual([])
    expect(await new ComposerDraftStore(root).paths("a")).toEqual([])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test.each(["constructor", "toString", "__proto__"])("treats %s as an own draft and owner key", async (key) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wanta-draft-keys-"))
  try {
    const store = new ComposerDraftStore(root)
    expect(await store.read(key)).toEqual({})
    await store.save({ owner: key, key, value: null })
    expect(await store.retentionState()).toEqual({ paused: false, paths: [] })
    await store.save({ owner: key, key, value })
    const restored = new ComposerDraftStore(root)
    const records = await restored.read(key)
    expect(Object.hasOwn(records, key)).toBe(true)
    expect(records[key]).toEqual(value)
    expect((await restored.retentionState()).paths).toContain(value.attachments[0]!.path)
    await restored.save({ owner: key, key, value: null })
    expect((await restored.retentionState()).paths).toContain(value.attachments[0]!.path)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
