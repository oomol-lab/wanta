import type { WikiGraphRuntime } from "./runner.ts"

import { mkdtemp, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, expect, it, vi, beforeEach } from "vitest"
import {
  addWikiGraphLibraryArchive,
  inspectWikiGraph,
  listWikiGraphLibraryArchives,
  prepareWikiGraphDefaultLibrary,
  readWikiGraphCover,
  readWikiGraphIndex,
  readWikiGraphMetadata,
  removeWikiGraphLibraryArchive,
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
    upgradeWikiGraphMaintenanceTarget: async (target: string) => {
      sdk.calls.upgrade.push(target)
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

  it("copy-imports archives into a requested managed library directory and returns SDK publicId", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "wanta-wg-adapter-"))
    const source = path.join(dir, "Original Book.wikg")
    await writeFile(source, "archive")
    sdk.addRecord = archiveRecord({
      id: 99,
      publicId: "imported-public-id",
      relativePath: "research/Original-Book-copy.wikg",
      uri: "wikg://lib/arc/imported-public-id",
    })

    const imported = await addWikiGraphLibraryArchive(runtime(dir), source, "research/../research")

    expect(imported).toMatchObject({
      id: "imported-public-id",
      relativePath: "research/Original-Book-copy.wikg",
      uri: "wikg://lib/arc/imported-public-id",
    })
    expect(imported.id).not.toBe("99")
    expect(sdk.calls.upgrade).toEqual(["/managed/library/copy.wikg"])
    expect(sdk.calls.archiveFiles).toEqual(["/managed/library/copy.wikg"])
    expect(sdk.calls.add).toEqual([
      {
        inputPath: source,
        target: { kind: "mock", uri: "wikg://lib/arc" },
        to: expect.stringMatching(/^research\/Original-Book-.+\.wikg$/u),
      },
    ])
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
      chapter(2, "sourced", 10),
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
      content: { chapters: { content: 3, total: 4 }, sourceWords: 60 },
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

  it("requires non-zero covered and total words", () => {
    expect(wikiGraphCoverageReady({ coveredWords: 12, totalWords: 20 })).toBe(true)
    expect(wikiGraphCoverageReady({ coveredWords: 0, totalWords: 20 })).toBe(false)
    expect(wikiGraphCoverageReady(undefined)).toBe(false)
  })
})
