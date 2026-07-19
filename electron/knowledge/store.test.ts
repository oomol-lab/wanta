import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { fileSha256, KnowledgeStore } from "./store.ts"

describe("KnowledgeStore", () => {
  it("copies imports into its managed directory and deduplicates by content", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "wanta-knowledge-"))
    const source = path.join(dir, "西游记.wikg")
    await writeFile(source, "knowledge archive")
    const store = new KnowledgeStore(path.join(dir, "user-data"))
    const first = await store.copyForImport(source)
    expect(first.duplicate).toBeNull()
    expect(await readFile(first.managedPath, "utf-8")).toBe("knowledge archive")
    await store.save({
      id: first.id,
      filePath: first.managedPath,
      fingerprint: first.fingerprint,
      importedAt: 1,
      size: first.size,
      sourceFileName: "西游记.wikg",
      title: "西游记",
      authors: ["吴承恩"],
      capabilities: { fullTextSearch: true, knowledgeGraph: true, readingGraph: true, summary: true },
      statistics: { contentChapters: 100 },
    })
    const second = await store.copyForImport(source)
    expect(second.duplicate?.id).toBe(first.id)
    expect(await fileSha256(source)).toBe(first.fingerprint)
  })

  it("serializes concurrent record mutations without losing updates", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "wanta-knowledge-"))
    const userDataDir = path.join(dir, "user-data")
    const store = new KnowledgeStore(userDataDir)
    const record = (id: string) => ({
      id,
      filePath: path.join(userDataDir, "knowledge-bases", "files", `${id}.wikg`),
      fingerprint: `${id}-fingerprint`,
      importedAt: 1,
      size: 1,
      sourceFileName: `${id}.wikg`,
      title: id,
      authors: [],
      capabilities: { fullTextSearch: true, knowledgeGraph: false, readingGraph: false, summary: false },
      statistics: {},
    })

    await Promise.all([store.save(record("first")), store.save(record("second"))])

    expect((await store.listRecords()).map((item) => item.id).sort()).toEqual(["first", "second"])
  })

  it("deduplicates concurrent imports again when they commit", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "wanta-knowledge-"))
    const source = path.join(dir, "shared.wikg")
    await writeFile(source, "same archive")
    const store = new KnowledgeStore(path.join(dir, "user-data"))
    const [first, second] = await Promise.all([store.copyForImport(source), store.copyForImport(source)])
    const record = (item: typeof first) => ({
      id: item.id,
      filePath: item.managedPath,
      fingerprint: item.fingerprint,
      importedAt: 1,
      size: item.size,
      sourceFileName: "shared.wikg",
      title: "Shared",
      authors: [],
      capabilities: { fullTextSearch: true, knowledgeGraph: false, readingGraph: false, summary: false },
      statistics: {},
    })

    const committed = await Promise.all([store.commitImport(record(first)), store.commitImport(record(second))])

    expect(committed.filter((item) => item === null)).toHaveLength(1)
    expect(committed.filter((item) => item !== null)).toHaveLength(1)
    expect(await store.listRecords()).toHaveLength(1)
  })

  it("fails closed without replacing a corrupt registry", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "wanta-knowledge-"))
    const userDataDir = path.join(dir, "user-data")
    const registryPath = path.join(userDataDir, "knowledge-bases", "library.json")
    await mkdir(path.dirname(registryPath), { recursive: true })
    await writeFile(registryPath, "{broken")
    const store = new KnowledgeStore(userDataDir)
    const record = {
      id: "new",
      filePath: path.join(dir, "new.wikg"),
      fingerprint: "new-fingerprint",
      importedAt: 1,
      size: 1,
      sourceFileName: "new.wikg",
      title: "new",
      authors: [],
      capabilities: { fullTextSearch: true, knowledgeGraph: false, readingGraph: false, summary: false },
      statistics: {},
    }

    await expect(store.commitImport(record)).rejects.toThrow("Knowledge library could not be read safely")
    expect(await readFile(registryPath, "utf-8")).toBe("{broken")
  })

  it("rejects malformed nested records and paths outside the managed directory", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "wanta-knowledge-"))
    const userDataDir = path.join(dir, "user-data")
    const registryPath = path.join(userDataDir, "knowledge-bases", "library.json")
    await mkdir(path.dirname(registryPath), { recursive: true })
    const base = {
      id: "knowledge",
      filePath: path.join(userDataDir, "knowledge-bases", "files", "knowledge.wikg"),
      fingerprint: "knowledge-fingerprint",
      importedAt: 1,
      size: 1,
      sourceFileName: "knowledge.wikg",
      title: "Knowledge",
      authors: [],
      capabilities: { fullTextSearch: true, knowledgeGraph: false, readingGraph: false, summary: false },
      statistics: {},
    }
    const store = new KnowledgeStore(userDataDir)

    await writeFile(registryPath, JSON.stringify({ version: 1, records: [{ ...base, capabilities: {} }] }))
    await expect(store.listRecords()).rejects.toThrow("Knowledge library could not be read safely")

    await writeFile(registryPath, JSON.stringify({ version: 1, records: [{ ...base, filePath: "/tmp/other.wikg" }] }))
    await expect(store.listRecords()).rejects.toThrow("Knowledge library could not be read safely")
  })

  it("updates only records that still exist", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "wanta-knowledge-"))
    const userDataDir = path.join(dir, "user-data")
    const store = new KnowledgeStore(userDataDir)
    const record = {
      id: "knowledge",
      filePath: path.join(userDataDir, "knowledge-bases", "files", "knowledge.wikg"),
      fingerprint: "knowledge-fingerprint",
      importedAt: 1,
      size: 1,
      sourceFileName: "knowledge.wikg",
      title: "before",
      authors: [],
      capabilities: { fullTextSearch: true, knowledgeGraph: false, readingGraph: false, summary: false },
      statistics: {},
    }

    expect(await store.update({ ...record, title: "missing" })).toBe(false)
    await store.save(record)
    expect(await store.update({ ...record, title: "after" })).toBe(true)
    expect((await store.record(record.id))?.title).toBe("after")
  })
})
