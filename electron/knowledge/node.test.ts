import { beforeEach, describe, expect, it, vi } from "vitest"

const runner = vi.hoisted(() => ({
  addWikiGraphLibraryArchive: vi.fn(),
  createWikiGraphLibraryFolder: vi.fn(),
  inspectWikiGraph: vi.fn(),
  listWikiGraphLibraryArchives: vi.fn(),
  listWikiGraphLibraryFolders: vi.fn(),
  moveWikiGraphLibraryArchive: vi.fn(),
  prepareWikiGraphArchive: vi.fn(),
  readWikiGraphChapterTree: vi.fn(),
  readWikiGraphCover: vi.fn(),
  readWikiGraphIndex: vi.fn(),
  readWikiGraphMetadata: vi.fn(),
  removeWikiGraphLibraryArchive: vi.fn(),
  removeWikiGraphLibraryFolder: vi.fn(),
  updateWikiGraphMetadata: vi.fn(),
}))

vi.mock("electron", () => ({
  dialog: { showOpenDialog: vi.fn() },
  nativeImage: { createFromBuffer: vi.fn() },
  shell: { showItemInFolder: vi.fn() },
}))

vi.mock("./runner.ts", () => ({
  ...runner,
  wikiGraphCoverageReady: (coverage: { coveredWords?: number; totalWords?: number } | undefined) => {
    return Boolean(coverage && (coverage.coveredWords ?? 0) > 0 && (coverage.totalWords ?? 0) > 0)
  },
}))

const { KnowledgeServiceImpl } = await import("./node.ts")

describe("KnowledgeServiceImpl", () => {
  beforeEach(() => {
    runner.addWikiGraphLibraryArchive.mockReset()
    runner.inspectWikiGraph.mockReset()
    runner.listWikiGraphLibraryArchives.mockReset()
    runner.prepareWikiGraphArchive.mockReset()
    runner.readWikiGraphChapterTree.mockReset()
    runner.readWikiGraphCover.mockReset()
    runner.readWikiGraphIndex.mockReset()
    runner.readWikiGraphMetadata.mockReset()
    runner.removeWikiGraphLibraryArchive.mockReset()
    runner.updateWikiGraphMetadata.mockReset()
  })

  it("downgrades inspect and index SDK failures while preserving metadata summary", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    runner.listWikiGraphLibraryArchives.mockResolvedValue([
      {
        id: "public-id",
        uri: "wikg://lib/arc/public-id",
        relativePath: "book.wikg",
        createdAt: "2026-01-02T00:00:00.000Z",
        exists: true,
        lastSeenSize: 123,
        status: "present",
      },
    ])
    runner.readWikiGraphMetadata.mockResolvedValue({
      authors: ["Author"],
      language: "zh",
      title: "Book Title",
    })
    runner.inspectWikiGraph.mockRejectedValue(new Error("inspect failed"))
    runner.readWikiGraphIndex.mockRejectedValue(new Error("index failed"))
    runner.readWikiGraphCover.mockResolvedValue(null)
    const service = new KnowledgeServiceImpl({
      runtime: { managedLibraryDir: "/tmp/wanta/library", stateDir: "/tmp/wanta/state" },
    })

    try {
      await expect(service.list()).resolves.toEqual([
        {
          authors: ["Author"],
          capabilities: {
            fullTextSearch: false,
            knowledgeGraph: false,
            readingGraph: false,
            summary: false,
          },
          id: "public-id",
          importedAt: Date.parse("2026-01-02T00:00:00.000Z"),
          language: "zh",
          relativePath: "book.wikg",
          size: 123,
          sourceFileName: "book.wikg",
          statistics: {},
          title: "Book Title",
        },
      ])
      expect(warn).toHaveBeenCalledWith("[wanta] failed to inspect knowledge base:", expect.any(Error))
    } finally {
      warn.mockRestore()
    }
  })

  it("prepares the archive before reading summary details", async () => {
    runner.listWikiGraphLibraryArchives.mockResolvedValue([
      {
        id: "public-id",
        uri: "wikg://lib/arc/public-id",
        relativePath: "book.wikg",
        createdAt: "2026-01-02T00:00:00.000Z",
        exists: true,
        lastSeenSize: 123,
        status: "present",
      },
    ])
    runner.prepareWikiGraphArchive.mockResolvedValue(undefined)
    runner.readWikiGraphMetadata.mockResolvedValue({ title: "Book Title" })
    runner.inspectWikiGraph.mockResolvedValue({})
    runner.readWikiGraphIndex.mockResolvedValue({})
    runner.readWikiGraphCover.mockResolvedValue(null)
    const service = new KnowledgeServiceImpl({
      runtime: { managedLibraryDir: "/tmp/wanta/library", stateDir: "/tmp/wanta/state" },
    })

    await service.list()

    expect(runner.prepareWikiGraphArchive).toHaveBeenCalledWith(
      { managedLibraryDir: "/tmp/wanta/library", stateDir: "/tmp/wanta/state" },
      "public-id",
    )
    expect(runner.prepareWikiGraphArchive.mock.invocationCallOrder[0]).toBeLessThan(
      runner.readWikiGraphMetadata.mock.invocationCallOrder[0],
    )
    expect(runner.prepareWikiGraphArchive.mock.invocationCallOrder[0]).toBeLessThan(
      runner.inspectWikiGraph.mock.invocationCallOrder[0],
    )
  })

  it("preserves inspect coverage metrics in the renderer summary", async () => {
    runner.listWikiGraphLibraryArchives.mockResolvedValue([
      {
        id: "public-id",
        uri: "wikg://lib/arc/public-id",
        relativePath: "book.wikg",
        createdAt: "2026-01-02T00:00:00.000Z",
        exists: true,
        lastSeenSize: 123,
        status: "present",
      },
    ])
    runner.prepareWikiGraphArchive.mockResolvedValue(undefined)
    runner.readWikiGraphMetadata.mockResolvedValue({ title: "Book Title" })
    runner.inspectWikiGraph.mockResolvedValue({
      coverage: {
        knowledgeGraph: { coveredWords: 80, totalWords: 100 },
        readingGraph: { coveredWords: 20, totalWords: 100 },
        summary: { coveredWords: 100, totalWords: 100 },
      },
    })
    runner.readWikiGraphIndex.mockResolvedValue({})
    runner.readWikiGraphCover.mockResolvedValue(null)
    const service = new KnowledgeServiceImpl({
      runtime: { managedLibraryDir: "/tmp/wanta/library", stateDir: "/tmp/wanta/state" },
    })

    await expect(service.list()).resolves.toMatchObject([
      {
        capabilities: {
          knowledgeGraph: true,
          readingGraph: true,
          summary: true,
        },
        coverage: {
          knowledgeGraph: { coveredWords: 80, totalWords: 100 },
          readingGraph: { coveredWords: 20, totalWords: 100 },
          summary: { coveredWords: 100, totalWords: 100 },
        },
      },
    ])
  })

  it("keeps listing other knowledge bases when one archive cannot be prepared", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    runner.listWikiGraphLibraryArchives.mockResolvedValue([
      {
        id: "broken-id",
        uri: "wikg://lib/arc/broken-id",
        relativePath: "broken.wikg",
        createdAt: "2026-01-01T00:00:00.000Z",
        exists: true,
        lastSeenSize: 1,
        status: "present",
      },
      {
        id: "good-id",
        uri: "wikg://lib/arc/good-id",
        relativePath: "good.wikg",
        createdAt: "2026-01-02T00:00:00.000Z",
        exists: true,
        lastSeenSize: 2,
        status: "present",
      },
    ])
    runner.prepareWikiGraphArchive.mockImplementation(async (_runtime: unknown, id: string) => {
      if (id === "broken-id") throw new Error("prepare failed")
    })
    runner.readWikiGraphMetadata.mockResolvedValue({ title: "Good Book" })
    runner.inspectWikiGraph.mockResolvedValue({})
    runner.readWikiGraphIndex.mockResolvedValue({})
    runner.readWikiGraphCover.mockResolvedValue(null)
    const service = new KnowledgeServiceImpl({
      runtime: { managedLibraryDir: "/tmp/wanta/library", stateDir: "/tmp/wanta/state" },
    })

    try {
      await expect(service.list()).resolves.toMatchObject([
        { id: "good-id", title: "Good Book" },
        { id: "broken-id", title: "broken" },
      ])
      expect(runner.readWikiGraphMetadata).toHaveBeenCalledTimes(1)
      expect(runner.readWikiGraphMetadata).toHaveBeenCalledWith(expect.anything(), "good-id")
      expect(warn).toHaveBeenCalledWith("[wanta] failed to prepare knowledge base:", expect.any(Error))
    } finally {
      warn.mockRestore()
    }
  })
})
