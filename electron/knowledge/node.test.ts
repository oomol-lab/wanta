import { beforeEach, describe, expect, it, vi } from "vitest"

const runner = vi.hoisted(() => ({
  addWikiGraphLibraryArchive: vi.fn(),
  inspectWikiGraph: vi.fn(),
  listWikiGraphLibraryArchives: vi.fn(),
  readWikiGraphCover: vi.fn(),
  readWikiGraphIndex: vi.fn(),
  readWikiGraphMetadata: vi.fn(),
  removeWikiGraphLibraryArchive: vi.fn(),
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
    runner.readWikiGraphCover.mockReset()
    runner.readWikiGraphIndex.mockReset()
    runner.readWikiGraphMetadata.mockReset()
    runner.removeWikiGraphLibraryArchive.mockReset()
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
})
