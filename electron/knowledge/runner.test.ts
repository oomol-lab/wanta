import type { WikiGraphRuntime } from "./runner.ts"

import { mkdtemp, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"
import {
  addWikiGraphLibraryArchive,
  listWikiGraphLibraryArchives,
  readWikiGraphCover,
  readWikiGraphIndex,
  readWikiGraphMetadata,
  removeWikiGraphLibraryArchive,
  runWikiGraphJson,
  wikiGraphCoverageReady,
} from "./runner.ts"

function runtime(dir: string): WikiGraphRuntime {
  return {
    command: "/usr/local/bin/wg",
    managedLibraryDir: path.join(dir, "wikigraph-state", "library"),
    stateDir: path.join(dir, "wikigraph-state"),
  }
}

describe("WikiGraph default library command adapter", () => {
  it("sets Wanta's dedicated WIKIGRAPH_STATE_DIR and binds the default lib folder", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "wanta-wg-adapter-"))
    const calls: Array<{ args: string[]; command: string; env?: NodeJS.ProcessEnv }> = []
    const exec = vi.fn(async (command, args, options) => {
      calls.push({
        args: args as string[],
        command: command as string,
        env: (options as { env?: NodeJS.ProcessEnv }).env,
      })
      return { stdout: '{"items":[]}' }
    })

    await runWikiGraphJson(
      runtime(dir),
      ["wikg://lib/path", "set", path.join(dir, "library"), "--json"],
      1000,
      exec as never,
    )

    expect(calls).toEqual([
      {
        args: ["wikg://lib/path", "set", path.join(dir, "library"), "--json"],
        command: "/usr/local/bin/wg",
        env: expect.objectContaining({ NO_COLOR: "1", WIKIGRAPH_STATE_DIR: path.join(dir, "wikigraph-state") }),
      },
    ])
  })

  it("lists default lib archives and filters missing members", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "wanta-wg-adapter-"))
    const commands: string[][] = []
    const exec = vi.fn(async (_command, args) => {
      commands.push(args as string[])
      return commands.length === 1
        ? { stdout: '{"items":[]}' }
        : {
            stdout: JSON.stringify({
              items: [
                { exists: true, id: "present", uri: "wikg://lib/arc/present" },
                { exists: false, id: "missing", uri: "wikg://lib/arc/missing" },
              ],
            }),
          }
    })

    const archives = await listWikiGraphLibraryArchives(runtime(dir), exec as never)

    expect(archives.map((item) => item.id)).toEqual(["present"])
    expect(commands).toContainEqual(["wikg://lib/arc", "--json"])
  })

  it("copy-imports archives without saving the original source path as the source of truth", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "wanta-wg-adapter-"))
    const source = path.join(dir, "original.wikg")
    await writeFile(source, "archive")
    const commands: string[][] = []
    const exec = vi.fn(async (_command, args) => {
      commands.push(args as string[])
      return commands.length === 1
        ? { stdout: '{"items":[]}' }
        : {
            stdout: JSON.stringify({
              id: "imported",
              path: path.join(dir, "wikigraph-state", "library", "copy.wikg"),
              relativePath: "copy.wikg",
              uri: "wikg://lib/arc/imported",
            }),
          }
    })

    const imported = await addWikiGraphLibraryArchive(runtime(dir), source, exec as never)

    expect(imported).toMatchObject({ id: "imported", relativePath: "copy.wikg", uri: "wikg://lib/arc/imported" })
    expect(imported.path).not.toBe(source)
    expect(commands[1]).toEqual([
      "wikg://lib/arc",
      "add",
      "--input",
      source,
      "--to",
      expect.stringMatching(/original-.+\.wikg/u),
      "--json",
    ])
  })

  it("builds remove, inspect, index, query, and missing-cover command arguments", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "wanta-wg-adapter-"))
    const commands: string[][] = []
    const exec = vi.fn(async (_command, args) => {
      commands.push(args as string[])
      return { stdout: "{}" }
    })

    await runWikiGraphJson(runtime(dir), ["wikg://lib/arc/archive", "inspect", "--json"], 1000, exec as never)
    await readWikiGraphMetadata(runtime(dir), "archive", exec as never)
    await readWikiGraphIndex(runtime(dir), "archive", exec as never)
    await runWikiGraphJson(
      runtime(dir),
      ["wikg://lib/arc/archive/chapter", "--query", "term", "--json"],
      1000,
      exec as never,
    )
    await removeWikiGraphLibraryArchive(runtime(dir), "archive", exec as never)
    const cover = await readWikiGraphCover(runtime(dir), "missing", exec as never)

    expect(commands).toContainEqual(["wikg://lib/arc/archive", "inspect", "--json"])
    expect(commands).toContainEqual(["wikg://lib/arc/archive/meta", "--json"])
    expect(commands).toContainEqual(["wikg://lib/arc/archive/chapter", "--query", "term", "--json"])
    expect(commands).toContainEqual(["wikg://lib/arc/archive", "remove", "--confirm", "--json"])
    expect(cover).toBeNull()
  })

  it("requires non-zero covered and total words", () => {
    expect(wikiGraphCoverageReady({ coveredWords: 12, totalWords: 20 })).toBe(true)
    expect(wikiGraphCoverageReady({ coveredWords: 0, totalWords: 20 })).toBe(false)
    expect(wikiGraphCoverageReady(undefined)).toBe(false)
  })

  it("redacts managed storage paths and archive URIs from command errors", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "wanta-wg-adapter-"))
    const exec = vi.fn(async () => {
      const error = new Error(
        `failed at ${path.join(dir, "wikigraph-state", "cache")} and ${path.join(dir, "wikigraph-state", "library", "book.wikg")} for wikg://lib/arc/book`,
      )
      throw error
    })

    await expect(
      runWikiGraphJson(runtime(dir), ["wikg://lib/arc/book", "inspect", "--json"], 1000, exec as never),
    ).rejects.toThrow("[WikiGraph managed storage]")
    await expect(
      runWikiGraphJson(runtime(dir), ["wikg://lib/arc/book", "inspect", "--json"], 1000, exec as never),
    ).rejects.not.toThrow(dir)
    await expect(
      runWikiGraphJson(runtime(dir), ["wikg://lib/arc/book", "inspect", "--json"], 1000, exec as never),
    ).rejects.not.toThrow("wikg://lib/arc/book")
  })
})
