import type { WikiGraphRuntime } from "./runner.ts"

import { mkdtemp, mkdir, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, expect, it, vi, beforeEach } from "vitest"
import {
  addWikiGraphLibraryArchive,
  createWikiGraphLibraryFolder,
  inspectWikiGraph,
  listWikiGraphLibraryArchives,
  listWikiGraphLibraryFolders,
  moveWikiGraphLibraryArchive,
  prepareWikiGraphDefaultLibrary,
  readWikiGraphChapterTree,
  readWikiGraphCover,
  readWikiGraphIndex,
  readWikiGraphMetadata,
  removeWikiGraphLibraryArchive,
  removeWikiGraphLibraryFolder,
  updateWikiGraphMetadata,
  wikiGraphCoverageReady,
} from "./runner.ts"

const sdk = vi.hoisted(() => {
  return {
    addRecord: undefined as MockArchiveRecord | undefined,
    archives: [] as MockArchiveRecord[],
    calls: {
      add: [] as unknown[],
      archiveFiles: [] as string[],
      getArchive: [] as unknown[],
      list: [] as unknown[],
      move: [] as unknown[],
      rebind: [] as unknown[],
      remove: [] as unknown[],
      runtimeStateDirs: [] as (string | undefined)[],
      upgrade: [] as string[],
    },
    chapters: [] as MockChapter[],
    cover: undefined as { data: Uint8Array; mediaType: string; path: string } | undefined,
    failCover: false,
    failGetArchive: undefined as Error | undefined,
    failListChapters: undefined as Error | undefined,
    failUpgradeQueue: [] as Error[],
    ftsCurrent: false,
    indexSettings: { ftsEmbedded: false },
    meta: undefined as MockBookMeta | undefined,
    serials: new Map<number, { knowledgeGraphReady?: boolean; topologyReady?: boolean }>(),
  }
})

interface MockArchiveRecord {
  id: number
  publicId: string
  uri: string
  libraryId: number
  libraryUri: string
  relativePath: string
  path: string
  exists: boolean
  status: "conflict" | "missing" | "present"
  createdAt: string
  updatedAt: string
  lastSeenSize?: number
}

interface MockBookMeta {
  version: 1
  sourceFormat: "epub" | "pdf" | "txt" | "markdown"
  title: string | null
  authors: string[]
  language: string | null
  identifier: string | null
  publisher: string | null
  publishedAt: string | null
  description: string | null
}

interface MockChapter {
  chapterId: number
  childCount: number
  depth: number
  documentOrder: number
  fragmentCount: number
  key: string
  path: string
  stage: "planned" | "sourced" | "graphed" | "summarized"
  title: string | null
  tocPath: readonly string[]
  uri: string
  words: number
}

vi.mock("wiki-graph-core", () => {
  return {
    WikiGraphArchiveFile: class {
      private readonly path: string

      public constructor(filePath: string) {
        this.path = filePath
        sdk.calls.archiveFiles.push(filePath)
      }

      public async read<T>(operation: (archive: unknown) => Promise<T> | T): Promise<T> {
        return await operation({
          readCover: async () => {
            if (sdk.failCover) throw new Error("cover failed")
            return sdk.cover
          },
          readMeta: async () => sdk.meta,
        })
      }

      public async readDocument<T>(operation: (document: unknown) => Promise<T> | T): Promise<T> {
        return await operation({
          serials: {
            getById: async (id: number) => sdk.serials.get(id),
          },
        })
      }

      public async write<T>(operation: (document: unknown) => Promise<T> | T): Promise<T> {
        return await operation({
          readBookMeta: async () => sdk.meta,
          replaceBookMeta: async (meta: MockBookMeta) => {
            sdk.meta = meta
          },
        })
      }
    },
    addWikiGraphLibraryArchive: async (input: unknown) => {
      sdk.calls.add.push(input)
      if (!sdk.addRecord) throw new Error("missing add record")
      return sdk.addRecord
    },
    getWikiGraphLibraryArchive: async (target: { uri?: string }) => {
      sdk.calls.getArchive.push(target)
      if (sdk.failGetArchive) throw sdk.failGetArchive
      const record = sdk.archives.find((item) => item.uri === target.uri) ?? sdk.addRecord
      if (!record) throw new Error(`missing archive ${target.uri}`)
      return record
    },
    isArchiveSearchIndexCurrent: async () => sdk.ftsCurrent,
    listChapters: async () => {
      if (sdk.failListChapters) throw sdk.failListChapters
      return sdk.chapters
    },
    listWikiGraphLibraryArchives: async (target: unknown) => {
      sdk.calls.list.push(target)
      return sdk.archives
    },
    parseWikiGraphLibraryUri: (uri: string) => (uri.startsWith("wikg://lib") ? { kind: "mock", uri } : undefined),
    readArchiveIndexSettings: async () => sdk.indexSettings,
    rebindWikiGraphLibrary: async (input: unknown) => {
      sdk.calls.rebind.push(input)
      return { archives: sdk.archives, library: {} }
    },
    removeWikiGraphLibraryArchive: async (input: unknown) => {
      sdk.calls.remove.push(input)
      return sdk.archives[0]
    },
    moveWikiGraphLibraryArchive: async (input: unknown) => {
      sdk.calls.move.push(input)
      return sdk.addRecord ?? sdk.archives[0]
    },
    upgradeWikiGraphMaintenanceTarget: async (target: string) => {
      sdk.calls.upgrade.push(target)
      const error = sdk.failUpgradeQueue.shift()
      if (error) {
        throw error
      }
      return {
        kind: "archive",
        path: target,
        schemaVersionAfter: 2,
        schemaVersionBefore: 1,
        status: "upgraded",
      }
    },
    withWikiGraphRuntimeStateDirectoryPath: async <T>(
      stateDir: string | undefined,
      operation: () => Promise<T> | T,
    ) => {
      sdk.calls.runtimeStateDirs.push(stateDir)
      return await operation()
    },
  }
})

function runtime(dir: string): WikiGraphRuntime {
  return {
    managedLibraryDir: path.join(dir, "wikigraph-state", "library"),
    stateDir: path.join(dir, "wikigraph-state"),
  }
}

function archiveRecord(overrides: Partial<MockArchiveRecord> = {}): MockArchiveRecord {
  return {
    id: 123,
    publicId: "public-archive",
    uri: "wikg://lib/arc/public-archive",
    libraryId: 1,
    libraryUri: "wikg://lib",
    relativePath: "copy.wikg",
    path: "/managed/library/copy.wikg",
    exists: true,
    status: "present",
    createdAt: "2026-01-02T00:00:00.000Z",
    updatedAt: "2026-01-03T00:00:00.000Z",
    lastSeenSize: 42,
    ...overrides,
  }
}

function bookMeta(overrides: Partial<MockBookMeta> = {}): MockBookMeta {
  return {
    version: 1,
    sourceFormat: "epub",
    title: "Three Kingdoms",
    authors: ["Luo Guanzhong"],
    language: "zh-CN",
    identifier: null,
    publisher: "Publisher",
    publishedAt: "1500",
    description: null,
    ...overrides,
  }
}

function chapter(chapterId: number, stage: MockChapter["stage"], words: number): MockChapter {
  return {
    chapterId,
    childCount: 0,
    depth: 0,
    documentOrder: chapterId,
    fragmentCount: 1,
    key: `chapter-${chapterId}`,
    path: `${chapterId}`,
    stage,
    title: `Chapter ${chapterId}`,
    tocPath: [],
    uri: `wikg://chapter/${chapterId}`,
    words,
  }
}

function childChapter(chapterId: number, stage: MockChapter["stage"], words: number): MockChapter {
  return {
    ...chapter(chapterId, stage, words),
    depth: 1,
    path: `1/${chapterId}`,
    tocPath: ["Chapter 1"],
  }
}

beforeEach(() => {
  sdk.addRecord = archiveRecord()
  sdk.archives = [
    archiveRecord({ publicId: "public-archive", uri: "wikg://lib/arc/public-archive" }),
    archiveRecord({ exists: false, publicId: "missing", status: "missing", uri: "wikg://lib/arc/missing" }),
  ]
  sdk.calls = {
    add: [],
    archiveFiles: [],
    getArchive: [],
    list: [],
    move: [],
    rebind: [],
    remove: [],
    runtimeStateDirs: [],
    upgrade: [],
  }
  sdk.chapters = []
  sdk.cover = undefined
  sdk.failCover = false
  sdk.failGetArchive = undefined
  sdk.failListChapters = undefined
  sdk.failUpgradeQueue = []
  sdk.ftsCurrent = false
  sdk.indexSettings = { ftsEmbedded: false }
  sdk.meta = undefined
  sdk.serials = new Map()
})

describe("WikiGraph SDK adapter", () => {
  it("uses SDK stateDir and binds the default library to Wanta managed storage", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "wanta-wg-adapter-"))
    const rt = runtime(dir)

    await Promise.all([prepareWikiGraphDefaultLibrary(rt), prepareWikiGraphDefaultLibrary(rt)])

    expect(sdk.calls.runtimeStateDirs).toEqual([rt.stateDir])
    expect(sdk.calls.rebind).toEqual([
      {
        folderPath: rt.managedLibraryDir,
        target: { kind: "mock", uri: "wikg://lib" },
      },
    ])
  })

  it("lists default library archives using SDK publicId as the Wanta-facing id", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "wanta-wg-adapter-"))

    const archives = await listWikiGraphLibraryArchives(runtime(dir))

    expect(archives).toEqual([
      expect.objectContaining({
        id: "public-archive",
        path: "/managed/library/copy.wikg",
        uri: "wikg://lib/arc/public-archive",
      }),
    ])
    expect(archives[0]?.id).not.toBe("123")
    expect(sdk.calls.list).toEqual([{ kind: "mock", uri: "wikg://lib/arc" }])
  })

  it("copy-imports archives into a requested managed library directory using the original file name", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "wanta-wg-adapter-"))
    const source = path.join(dir, "Original Book.wikg")
    await writeFile(source, "archive")
    sdk.addRecord = archiveRecord({
      id: 99,
      publicId: "imported-public-id",
      relativePath: "research/Original Book.wikg",
      uri: "wikg://lib/arc/imported-public-id",
    })

    const imported = await addWikiGraphLibraryArchive(runtime(dir), source, "research")

    expect(imported).toMatchObject({
      id: "imported-public-id",
      relativePath: "research/Original Book.wikg",
      uri: "wikg://lib/arc/imported-public-id",
    })
    expect(imported.id).not.toBe("99")
    expect(sdk.calls.upgrade).toEqual(["/managed/library/copy.wikg"])
    expect(sdk.calls.archiveFiles).toEqual(["/managed/library/copy.wikg"])
    expect(sdk.calls.add).toEqual([
      {
        inputPath: source,
        target: { kind: "mock", uri: "wikg://lib/arc" },
        to: "research/Original Book.wikg",
      },
    ])
  })

  it("deduplicates imported archive file names in the target directory", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "wanta-wg-adapter-"))
    const source = path.join(dir, "三国演义.wikg")
    await writeFile(source, "archive")
    sdk.archives = [
      archiveRecord({ publicId: "first", relativePath: "books/三国演义.wikg", uri: "wikg://lib/arc/first" }),
      archiveRecord({ publicId: "second", relativePath: "books/三国演义 2.wikg", uri: "wikg://lib/arc/second" }),
    ]
    sdk.addRecord = archiveRecord({
      publicId: "third",
      relativePath: "books/三国演义 3.wikg",
      uri: "wikg://lib/arc/third",
    })

    const imported = await addWikiGraphLibraryArchive(runtime(dir), source, "books")

    expect(imported.relativePath).toBe("books/三国演义 3.wikg")
    expect(sdk.calls.add).toEqual([
      {
        inputPath: source,
        target: { kind: "mock", uri: "wikg://lib/arc" },
        to: "books/三国演义 3.wikg",
      },
    ])
  })

  it("deduplicates imports against unregistered physical archive files", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "wanta-wg-adapter-"))
    const rt = runtime(dir)
    const source = path.join(dir, "三国演义.wikg")
    await writeFile(source, "archive")
    await mkdir(path.join(rt.managedLibraryDir, "books"), { recursive: true })
    await writeFile(path.join(rt.managedLibraryDir, "books", "三国演义.wikg"), "orphan")
    sdk.addRecord = archiveRecord({
      publicId: "deduped",
      relativePath: "books/三国演义 2.wikg",
      uri: "wikg://lib/arc/deduped",
    })

    const imported = await addWikiGraphLibraryArchive(rt, source, "books")

    expect(imported.relativePath).toBe("books/三国演义 2.wikg")
    expect(sdk.calls.add).toEqual([
      {
        inputPath: source,
        target: { kind: "mock", uri: "wikg://lib/arc" },
        to: "books/三国演义 2.wikg",
      },
    ])
  })

  it("retries imports blocked by stale overlay state with an isolated upgraded copy", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "wanta-wg-adapter-"))
    const source = path.join(dir, "主义主义-哲学意识形态大全.wikg")
    await writeFile(source, "archive")
    sdk.addRecord = archiveRecord({
      path: "/managed/library/主义主义-哲学意识形态大全.wikg",
      publicId: "overlay-blocked",
      relativePath: "主义主义-哲学意识形态大全.wikg",
      uri: "wikg://lib/arc/overlay-blocked",
    })
    sdk.failUpgradeQueue = [
      new Error("Cannot upgrade archive with non-derived overlay state: archive-key."),
      new Error("Cannot upgrade archive with non-derived overlay state: archive-key."),
    ]

    await addWikiGraphLibraryArchive(runtime(dir), source)

    expect(sdk.calls.add).toHaveLength(2)
    expect(sdk.calls.add[0]).toMatchObject({ inputPath: source, to: "主义主义-哲学意识形态大全.wikg" })
    expect(sdk.calls.add[1]).toMatchObject({ to: "主义主义-哲学意识形态大全.wikg" })
    expect((sdk.calls.add[1] as { inputPath: string }).inputPath).not.toBe(source)
    expect(sdk.calls.remove).toEqual([{ target: { kind: "mock", uri: "wikg://lib/arc/overlay-blocked" } }])
    expect(sdk.calls.upgrade).toEqual(
      expect.arrayContaining(["/managed/library/主义主义-哲学意识形态大全.wikg", "wikg://lib"]),
    )
  })

  it("fails and removes the managed copy when post-upgrade validation cannot read chapters", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "wanta-wg-adapter-"))
    const source = path.join(dir, "Broken Book.wikg")
    await writeFile(source, "archive")
    sdk.addRecord = archiveRecord({
      path: "/managed/library/broken-copy.wikg",
      publicId: "broken-public-id",
      uri: "wikg://lib/arc/broken-public-id",
    })
    sdk.failListChapters = new Error("Missing chapter key in TOC")

    let importError: unknown
    try {
      await addWikiGraphLibraryArchive(runtime(dir), source)
    } catch (error) {
      importError = error
    }

    expect(importError).toBeInstanceOf(Error)
    expect((importError as Error).message).toContain("WANTA_KNOWLEDGE_IMPORT_UNREADABLE")
    expect((importError as Error).message).not.toContain("Missing chapter key in TOC")

    expect(sdk.calls.add).toEqual([
      expect.objectContaining({
        inputPath: source,
        target: { kind: "mock", uri: "wikg://lib/arc" },
      }),
    ])
    expect(sdk.calls.upgrade).toEqual(["/managed/library/broken-copy.wikg"])
    expect(sdk.calls.upgrade).not.toContain(source)
    expect(sdk.calls.archiveFiles).toEqual(["/managed/library/broken-copy.wikg"])
    expect(sdk.calls.remove).toEqual([{ target: { kind: "mock", uri: "wikg://lib/arc/broken-public-id" } }])
  })

  it("rejects unsafe import target directories", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "wanta-wg-adapter-"))
    const source = path.join(dir, "Original Book.wikg")
    await writeFile(source, "archive")

    await expect(addWikiGraphLibraryArchive(runtime(dir), source, "research//deep")).rejects.toThrow("stay inside")
    await expect(addWikiGraphLibraryArchive(runtime(dir), source, "research/../deep")).rejects.toThrow("stay inside")
    await expect(addWikiGraphLibraryArchive(runtime(dir), source, "research\\deep")).rejects.toThrow("/ separators")
  })

  it("removes archives by the public archive URI", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "wanta-wg-adapter-"))

    await removeWikiGraphLibraryArchive(runtime(dir), "public-archive")

    expect(sdk.calls.remove).toEqual([{ target: { kind: "mock", uri: "wikg://lib/arc/public-archive" } }])
  })

  it("reads metadata, cover, inspect capabilities, statistics, and index state through SDK APIs", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "wanta-wg-adapter-"))
    sdk.meta = bookMeta()
    sdk.cover = { data: Uint8Array.from([1, 2, 3]), mediaType: "image/png", path: "cover.png" }
    sdk.chapters = [
      chapter(1, "planned", 100),
      childChapter(2, "sourced", 10),
      chapter(3, "graphed", 20),
      chapter(4, "summarized", 30),
    ]
    sdk.serials = new Map([
      [2, { topologyReady: true }],
      [3, { knowledgeGraphReady: true }],
      [4, { knowledgeGraphReady: true, topologyReady: true }],
    ])
    sdk.ftsCurrent = true
    sdk.indexSettings = { ftsEmbedded: true }
    const rt = runtime(dir)

    await expect(readWikiGraphMetadata(rt, "public-archive")).resolves.toEqual({
      authors: ["Luo Guanzhong"],
      language: "zh-CN",
      publishedAt: "1500",
      publisher: "Publisher",
      title: "Three Kingdoms",
    })
    await expect(readWikiGraphCover(rt, "public-archive")).resolves.toEqual(Buffer.from([1, 2, 3]))
    await expect(inspectWikiGraph(rt, "public-archive")).resolves.toEqual({
      content: {
        chapters: { content: 3, total: 4 },
        sourceWords: 60,
      },
      coverage: {
        knowledgeGraph: { coveredWords: 50, totalWords: 60 },
        readingGraph: { coveredWords: 40, totalWords: 60 },
        summary: { coveredWords: 30, totalWords: 60 },
      },
      index: { current: true, querySupport: true },
    })
    await expect(readWikiGraphIndex(rt, "public-archive")).resolves.toEqual({
      current: true,
      ftsCurrent: true,
      querySupport: true,
      status: "current",
    })
    expect(sdk.calls.upgrade).toEqual(["/managed/library/copy.wikg"])
  })

  it("reads a chapter title tree on demand", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "wanta-wg-adapter-"))
    sdk.chapters = [chapter(1, "planned", 100), childChapter(2, "sourced", 10), chapter(3, "graphed", 20)]

    await expect(readWikiGraphChapterTree(runtime(dir), "public-archive")).resolves.toEqual([
      { children: [{ title: "Chapter 2" }], title: "Chapter 1" },
      { title: "Chapter 3" },
    ])
  })

  it("updates archive title and authors while preserving the rest of book metadata", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "wanta-wg-adapter-"))
    sdk.meta = bookMeta({
      authors: ["Old Author"],
      language: "zh-CN",
      publishedAt: "1500",
      publisher: "Old Publisher",
      title: "Old Title",
    })

    await expect(
      updateWikiGraphMetadata(runtime(dir), "public-archive", {
        authors: ["New Author"],
        title: "New Title",
      }),
    ).resolves.toEqual({
      authors: ["New Author"],
      language: "zh-CN",
      publishedAt: "1500",
      publisher: "Old Publisher",
      title: "New Title",
    })
    expect(sdk.meta).toMatchObject({
      authors: ["New Author"],
      language: "zh-CN",
      publishedAt: "1500",
      publisher: "Old Publisher",
      sourceFormat: "epub",
      title: "New Title",
      version: 1,
    })
  })

  it("coalesces lazy upgrades for concurrent read-only document inspection", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "wanta-wg-adapter-"))
    sdk.chapters = [chapter(1, "sourced", 10)]
    const rt = runtime(dir)

    await Promise.all([inspectWikiGraph(rt, "public-archive"), readWikiGraphIndex(rt, "public-archive")])

    expect(sdk.calls.upgrade).toEqual(["/managed/library/copy.wikg"])
  })

  it("downgrades missing or failed cover reads to null", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "wanta-wg-adapter-"))
    sdk.failCover = true

    await expect(readWikiGraphCover(runtime(dir), "public-archive")).resolves.toBeNull()
  })

  it("propagates archive resolution failures when reading covers", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "wanta-wg-adapter-"))
    sdk.failGetArchive = new Error("archive missing")

    await expect(readWikiGraphCover(runtime(dir), "public-archive")).rejects.toThrow("archive missing")
  })

  it("redacts managed storage paths and archive handles from SDK errors", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "wanta-wg-adapter-"))
    const rt = runtime(dir)
    sdk.failGetArchive = new Error(
      `failed at ${path.join(rt.stateDir, "cache")} and ${path.join(rt.managedLibraryDir, "book.wikg")} for wikg://lib/arc/book`,
    )

    await expect(readWikiGraphMetadata(rt, "book")).rejects.toThrow("[WikiGraph managed storage]")
    await expect(readWikiGraphMetadata(rt, "book")).rejects.not.toThrow(dir)
    await expect(readWikiGraphMetadata(rt, "book")).rejects.not.toThrow("wikg://lib/arc/book")
  })

  it("lists managed folders from the filesystem", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "wanta-wg-adapter-"))
    const rt = runtime(dir)
    await mkdir(path.join(rt.managedLibraryDir, "science", "physics"), { recursive: true })

    await expect(listWikiGraphLibraryFolders(rt)).resolves.toEqual(["science", "science/physics"])
  })

  it("moves archives to a new relative path without changing their public id", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "wanta-wg-adapter-"))
    const rt = runtime(dir)
    sdk.archives = [
      archiveRecord({
        publicId: "public-archive",
        relativePath: "source/book.wikg",
        uri: "wikg://lib/arc/public-archive",
      }),
    ]
    sdk.addRecord = archiveRecord({
      publicId: "public-archive",
      relativePath: "target/renamed.wikg",
      uri: "wikg://lib/arc/public-archive",
    })

    const moved = await moveWikiGraphLibraryArchive(rt, "public-archive", "target", "renamed.wikg")

    expect(moved.id).toBe("public-archive")
    expect(moved.relativePath).toBe("target/renamed.wikg")
    expect(sdk.calls.move).toEqual([
      {
        target: { kind: "mock", uri: "wikg://lib/arc/public-archive" },
        to: "target/renamed.wikg",
      },
    ])
  })

  it("creates and removes empty managed folders", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "wanta-wg-adapter-"))
    const rt = runtime(dir)

    await expect(createWikiGraphLibraryFolder(rt, "notes/archive")).resolves.toBe("notes/archive")
    await expect(listWikiGraphLibraryFolders(rt)).resolves.toEqual(["notes", "notes/archive"])
    await expect(removeWikiGraphLibraryFolder(rt, "notes/archive")).resolves.toBeUndefined()
  })

  it("rejects folder deletion when a knowledge file lives underneath", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "wanta-wg-adapter-"))
    const rt = runtime(dir)
    sdk.archives = [
      archiveRecord({
        publicId: "public-archive",
        relativePath: "notes/archive/book.wikg",
        uri: "wikg://lib/arc/public-archive",
      }),
    ]
    await mkdir(path.join(rt.managedLibraryDir, "notes", "archive"), { recursive: true })

    await expect(removeWikiGraphLibraryFolder(rt, "notes/archive")).rejects.toThrow("not empty")
  })

  it("rejects moving archives into conflicting targets", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "wanta-wg-adapter-"))
    const rt = runtime(dir)
    sdk.archives = [
      archiveRecord({ publicId: "source", relativePath: "source/book.wikg", uri: "wikg://lib/arc/source" }),
      archiveRecord({ publicId: "conflict", relativePath: "target/book.wikg", uri: "wikg://lib/arc/conflict" }),
    ]

    await expect(moveWikiGraphLibraryArchive(rt, "source", "target", "book.wikg")).rejects.toThrow("already exists")
  })

  it("rejects unsafe managed library paths for folder and archive operations", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "wanta-wg-adapter-"))
    const rt = runtime(dir)
    sdk.archives = [
      archiveRecord({ publicId: "source", relativePath: "source/book.wikg", uri: "wikg://lib/arc/source" }),
    ]

    await expect(createWikiGraphLibraryFolder(rt, "../outside")).rejects.toThrow("stay inside")
    await expect(createWikiGraphLibraryFolder(rt, "/absolute/path")).rejects.toThrow("stay inside")
    await expect(createWikiGraphLibraryFolder(rt, "bad//path")).rejects.toThrow("stay inside")
    await expect(createWikiGraphLibraryFolder(rt, "bad\\path")).rejects.toThrow("/ separators")
    await expect(removeWikiGraphLibraryFolder(rt, "folder/../outside")).rejects.toThrow("stay inside")
    await expect(moveWikiGraphLibraryArchive(rt, "source", "target", "../bad.wikg")).rejects.toThrow("stay inside")
  })

  it("requires non-zero covered and total words", () => {
    expect(wikiGraphCoverageReady({ coveredWords: 12, totalWords: 20 })).toBe(true)
    expect(wikiGraphCoverageReady({ coveredWords: 0, totalWords: 20 })).toBe(false)
    expect(wikiGraphCoverageReady(undefined)).toBe(false)
  })
})
