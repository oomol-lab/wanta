import type { WikiGraphCLIRunner, WikiGraphRuntime } from "./runner.ts"
import type { RunWikiGraphCLIInput } from "wiki-graph"

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
    managedLibraryDir: path.join(dir, "wikigraph-state", "library"),
    stateDir: path.join(dir, "wikigraph-state"),
  }
}

describe("WikiGraph SDK adapter", () => {
  it("uses SDK stateDir and strips dangerous WikiGraph runtime env overrides", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "wanta-wg-adapter-"))
    const previousStateDir = process.env.WIKIGRAPH_STATE_DIR
    const previousDev = process.env.WIKIGRAPH_DEV
    process.env.WIKIGRAPH_STATE_DIR = "/unsafe/state"
    process.env.WIKIGRAPH_DEV = "/unsafe/dev"
    const calls: RunWikiGraphCLIInput[] = []
    const runCLI: WikiGraphCLIRunner = vi.fn(async (input) => {
      calls.push(input)
      input.stdout?.write('{"items":[]}')
      return { exitCode: 0 }
    })

    try {
      await runWikiGraphJson(
        runtime(dir),
        ["wikg://lib/path", "set", path.join(dir, "library"), "--json"],
        1000,
        runCLI,
      )
    } finally {
      if (previousStateDir === undefined) delete process.env.WIKIGRAPH_STATE_DIR
      else process.env.WIKIGRAPH_STATE_DIR = previousStateDir
      if (previousDev === undefined) delete process.env.WIKIGRAPH_DEV
      else process.env.WIKIGRAPH_DEV = previousDev
    }

    expect(calls).toEqual([
      expect.objectContaining({
        argv: ["wikg://lib/path", "set", path.join(dir, "library"), "--json"],
        env: expect.objectContaining({
          NO_COLOR: "1",
          WIKIGRAPH_DEV: undefined,
          WIKIGRAPH_ENV_POLICY: undefined,
          WIKIGRAPH_QUEUE_DISABLE_AUTOSTART: undefined,
          WIKIGRAPH_STATE_DIR: undefined,
        }),
        stateDir: path.join(dir, "wikigraph-state"),
      }),
    ])
  })

  it("lists default lib archives and filters missing members", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "wanta-wg-adapter-"))
    const commands: string[][] = []
    const runCLI: WikiGraphCLIRunner = vi.fn(async (input) => {
      const command = [...(input.argv ?? [])]
      commands.push(command)
      if (command[0] === "wikg://lib/path") {
        input.stdout?.write('{"items":[]}')
      } else if (command[0] === "wikg://lib/arc/tree") {
        input.stdout?.write(
          JSON.stringify({
            items: [
              { children: [], name: "present.wikg", path: "present.wikg", uri: "wikg://lib/arc/present" },
              {
                children: [
                  { children: [], name: "missing.wikg", path: "old/missing.wikg", uri: "wikg://lib/arc/missing" },
                ],
                name: "old",
                path: "old",
              },
            ],
          }),
        )
      } else if (command[0] === "wikg://lib/arc/present") {
        input.stdout?.write(JSON.stringify({ exists: true, id: "present", uri: "wikg://lib/arc/present" }))
      } else if (command[0] === "wikg://lib/arc/missing") {
        input.stdout?.write(JSON.stringify({ exists: false, id: "missing", uri: "wikg://lib/arc/missing" }))
      } else {
        input.stdout?.write("{}")
      }
      return { exitCode: 0 }
    })

    const archives = await listWikiGraphLibraryArchives(runtime(dir), runCLI)

    expect(archives.map((item) => item.id)).toEqual(["present"])
    expect(commands).toContainEqual(["wikg://lib/arc/tree", "--json"])
    expect(commands).toContainEqual(["wikg://lib/arc/present", "--json"])
    expect(commands).toContainEqual(["wikg://lib/arc/missing", "--json"])
    expect(commands).not.toContainEqual(["wikg://lib/arc", "scan", "--json"])
  })

  it("copy-imports archives without saving the original source path as the source of truth", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "wanta-wg-adapter-"))
    const source = path.join(dir, "original.wikg")
    await writeFile(source, "archive")
    const commands: string[][] = []
    const runCLI: WikiGraphCLIRunner = vi.fn(async (input) => {
      commands.push([...(input.argv ?? [])])
      input.stdout?.write(
        commands.length === 1
          ? '{"items":[]}'
          : JSON.stringify({
              id: "imported",
              path: path.join(dir, "wikigraph-state", "library", "copy.wikg"),
              relativePath: "copy.wikg",
              uri: "wikg://lib/arc/imported",
            }),
      )
      return { exitCode: 0 }
    })

    const imported = await addWikiGraphLibraryArchive(runtime(dir), source, runCLI)

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

  it("builds remove, inspect, index, query, and cover SDK arguments", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "wanta-wg-adapter-"))
    const commands: string[][] = []
    const runCLIJson: WikiGraphCLIRunner = vi.fn(async (input) => {
      commands.push([...(input.argv ?? [])])
      input.stdout?.write("{}")
      return { exitCode: 0 }
    })
    const runCLI: WikiGraphCLIRunner = vi.fn(async (input) => {
      commands.push([...(input.argv ?? [])])
      input.stdout?.write(Buffer.from([0, 159, 255, 10]))
      return { exitCode: 0 }
    })

    await runWikiGraphJson(runtime(dir), ["wikg://lib/arc/archive", "inspect", "--json"], 1000, runCLIJson)
    await readWikiGraphMetadata(runtime(dir), "archive", runCLIJson)
    await readWikiGraphIndex(runtime(dir), "archive", runCLIJson)
    await runWikiGraphJson(
      runtime(dir),
      ["wikg://lib/arc/archive/chapter", "--query", "term", "--json"],
      1000,
      runCLIJson,
    )
    await removeWikiGraphLibraryArchive(runtime(dir), "archive", runCLIJson)
    const cover = await readWikiGraphCover(runtime(dir), "archive", runCLI)

    expect(commands).toContainEqual(["wikg://lib/arc/archive", "inspect", "--json"])
    expect(commands).toContainEqual(["wikg://lib/arc/archive/meta", "--json"])
    expect(commands).toContainEqual(["wikg://lib/arc/archive/chapter", "--query", "term", "--json"])
    expect(commands).toContainEqual(["wikg://lib/arc/archive", "remove", "--confirm", "--json"])
    expect(commands).toContainEqual(["wikg://lib/arc/archive/cover"])
    expect(cover).toEqual(Buffer.from([0, 159, 255, 10]))
  })

  it("requires non-zero covered and total words", () => {
    expect(wikiGraphCoverageReady({ coveredWords: 12, totalWords: 20 })).toBe(true)
    expect(wikiGraphCoverageReady({ coveredWords: 0, totalWords: 20 })).toBe(false)
    expect(wikiGraphCoverageReady(undefined)).toBe(false)
  })

  it("redacts managed storage paths and archive URIs from SDK errors", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "wanta-wg-adapter-"))
    const runCLI: WikiGraphCLIRunner = vi.fn(async () => {
      throw new Error(
        `failed at ${path.join(dir, "wikigraph-state", "cache")} and ${path.join(dir, "wikigraph-state", "library", "book.wikg")} for wikg://lib/arc/book`,
      )
    })

    await expect(
      runWikiGraphJson(runtime(dir), ["wikg://lib/arc/book", "inspect", "--json"], 1000, runCLI),
    ).rejects.toThrow("[WikiGraph managed storage]")
    await expect(
      runWikiGraphJson(runtime(dir), ["wikg://lib/arc/book", "inspect", "--json"], 1000, runCLI),
    ).rejects.not.toThrow(dir)
    await expect(
      runWikiGraphJson(runtime(dir), ["wikg://lib/arc/book", "inspect", "--json"], 1000, runCLI),
    ).rejects.not.toThrow("wikg://lib/arc/book")
  })

  it("rejects oversized JSON output while the SDK runner is still writing stdout", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "wanta-wg-adapter-"))
    const runCLI: WikiGraphCLIRunner = vi.fn(async (input) => {
      await new Promise<void>((resolve, reject) => {
        input.stdout?.write(Buffer.alloc(8 * 1024 * 1024 + 1, "{"), (error: Error | null | undefined) => {
          if (error) reject(error)
          else resolve()
        })
      })
      return { exitCode: 0 }
    })

    await expect(
      runWikiGraphJson(runtime(dir), ["wikg://lib/arc/book", "inspect", "--json"], 1000, runCLI),
    ).rejects.toThrow("WikiGraph output exceeded the buffer limit")
  })
})
