import type { KnowledgeBaseSummary } from "../../../electron/knowledge/common.ts"

import { describe, expect, it } from "vitest"
import {
  buildKnowledgeLibraryView,
  isWikiGraphFileName,
  knowledgeArchiveDisplayName,
  knowledgePathExists,
  normalizeKnowledgePath,
  stripWikiGraphExtension,
  wikiGraphDropCandidates,
} from "./knowledge-route-model.ts"

function knowledgeBase(id: string, relativePath: string, title = id): KnowledgeBaseSummary {
  return {
    authors: [],
    capabilities: {
      fullTextSearch: true,
      knowledgeGraph: true,
      readingGraph: false,
      summary: true,
    },
    id,
    importedAt: 1,
    relativePath,
    size: 1024,
    sourceFileName: relativePath.split("/").at(-1) ?? `${id}.wikg`,
    statistics: {},
    title,
  }
}

describe("knowledge route model", () => {
  it("recognizes WikiGraph archives case-insensitively", () => {
    expect(isWikiGraphFileName("西游记.wikg")).toBe(true)
    expect(isWikiGraphFileName("Knowledge.WIKG")).toBe(true)
    expect(isWikiGraphFileName("Knowledge.wkig")).toBe(false)
  })

  it("hides repeated WikiGraph archive extensions for user-facing names", () => {
    expect(stripWikiGraphExtension("西游记.wikg")).toBe("西游记")
    expect(stripWikiGraphExtension("西游记.WIKG.wikg")).toBe("西游记")
    expect(knowledgeArchiveDisplayName("classic/西游记.wikg")).toBe("西游记")
  })

  it("keeps only supported files from a drop", () => {
    expect(
      wikiGraphDropCandidates([{ name: "one.wikg" }, { name: "notes.txt" }, { name: "two.WIKG" }]).map(
        (file) => file.name,
      ),
    ).toEqual(["one.wikg", "two.WIKG"])
  })

  it("normalizes library paths without escaping the managed library", () => {
    expect(normalizeKnowledgePath("/fiction/../fiction//classic\\book.wikg")).toBe("fiction/classic/book.wikg")
  })

  it("builds a directory-first file manager view from archive relative paths", () => {
    const view = buildKnowledgeLibraryView(
      [
        knowledgeBase("root", "root.wikg", "Root Book"),
        knowledgeBase("level-one", "fiction/book.wikg", "Book"),
        knowledgeBase("deep", "fiction/classic/book.wikg", "Book"),
        knowledgeBase("work", "work/book.wikg", "Book"),
      ],
      "",
      "",
      "Library",
    )

    expect(view.directories.map((directory) => [directory.name, directory.archiveCount])).toEqual([
      ["fiction", 2],
      ["work", 1],
    ])
    expect(view.archives.map((archive) => archive.path)).toEqual(["root.wikg"])
    expect(view.breadcrumbs).toEqual([{ label: "Library", path: "" }])
  })

  it("enters subdirectories and keeps duplicate basenames separated by path", () => {
    const view = buildKnowledgeLibraryView(
      [
        knowledgeBase("level-one", "fiction/book.wikg", "Book"),
        knowledgeBase("deep", "fiction/classic/book.wikg", "Book"),
      ],
      "fiction",
      "",
      "Library",
    )

    expect(view.directories.map((directory) => directory.path)).toEqual(["fiction/classic"])
    expect(view.archives.map((archive) => [archive.item.id, archive.name, archive.path])).toEqual([
      ["level-one", "book.wikg", "fiction/book.wikg"],
    ])
    expect(view.breadcrumbs).toEqual([
      { label: "Library", path: "" },
      { label: "fiction", path: "fiction" },
    ])
  })

  it("searches archive metadata and path while preserving path context", () => {
    const view = buildKnowledgeLibraryView(
      [knowledgeBase("one", "fiction/book.wikg", "Book"), knowledgeBase("two", "work/book.wikg", "Book")],
      "",
      "work/book",
      "Library",
    )

    expect(view.searchMode).toBe(true)
    expect(view.directories).toEqual([])
    expect(view.archives.map((archive) => [archive.item.id, archive.path])).toEqual([["two", "work/book.wikg"]])
  })

  it("shows explicit empty folders and keeps conflict checks path-scoped", () => {
    const items = [knowledgeBase("one", "fiction/book.wikg", "Book")]
    const folders = ["empty", "fiction/empty-child"]
    const rootView = buildKnowledgeLibraryView(items, "", "", "Library", folders)
    const fictionView = buildKnowledgeLibraryView(items, "fiction", "", "Library", folders)

    expect(rootView.directories.map((directory) => [directory.path, directory.archiveCount])).toEqual([
      ["empty", 0],
      ["fiction", 1],
    ])
    expect(fictionView.directories.map((directory) => [directory.path, directory.archiveCount])).toEqual([
      ["fiction/empty-child", 0],
    ])
    expect(knowledgePathExists(items, folders, "fiction/book.wikg")).toBe(true)
    expect(knowledgePathExists(items, folders, "work/book.wikg")).toBe(false)
    expect(knowledgePathExists(items, folders, "empty")).toBe(true)
  })
})
