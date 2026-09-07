import { execFile } from "node:child_process"
import { mkdtemp, readFile, rm, stat } from "node:fs/promises"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { afterEach, describe, expect, it } from "vitest"
import { runWikiGraphCLICaptured } from "wiki-graph"
import { getWikiGraphStorage, WikiGraph, WikiGraphArchiveFile, replaceChapterFtsIndexArtifact } from "wiki-graph-core"
import { NodeFile, getNodeResourcePath } from "./node-platform.ts"
import { WikiGraphQueryRunner } from "./query-runner.ts"
import {
  addWikiGraphLibraryArchive,
  createWikiGraphLibraryFolder,
  inspectWikiGraph,
  listWikiGraphLibraryArchives,
  moveWikiGraphLibraryArchive,
  prepareWikiGraphDefaultLibrary,
  readWikiGraphChapterTree,
  readWikiGraphCover,
  readWikiGraphIndex,
  readWikiGraphMetadata,
  removeWikiGraphLibraryArchive,
  removeWikiGraphLibraryFolder,
  updateWikiGraphMetadata,
} from "./runner.ts"
import { withWikiGraphRuntime } from "./runtime.ts"

const temporaryDirectories: string[] = []
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})
async function temporaryDirectory() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "wanta-wikigraph-runtime-"))
  temporaryDirectories.push(dir)
  return dir
}
function runtime(dir: string) {
  return { stateDir: path.join(dir, "state"), managedLibraryDir: path.join(dir, "library") }
}

describe("WikiGraph 0.6 host integration", () => {
  it("isolates concurrent CLI storage overrides and restores nested contexts after failure", async () => {
    const root = await temporaryDirectory()
    const outer = path.join(root, "outer")
    const left = path.join(root, "left")
    const right = path.join(root, "right")
    await withWikiGraphRuntime(outer, async () => {
      const results = await Promise.all(
        [left, right].map((stateDir) =>
          runWikiGraphCLICaptured({
            argv: ["wikg://lib/arc", "--json"],
            stateDir,
            stdin: "",
          }),
        ),
      )
      expect(results.map((result) => result.exitCode)).toEqual([0, 0])
      expect(getNodeResourcePath(getWikiGraphStorage().library)).toBe(outer)
      await expect(
        withWikiGraphRuntime(left, async () => {
          await Promise.resolve()
          expect(getNodeResourcePath(getWikiGraphStorage().library)).toBe(left)
          throw new Error("nested failure")
        }),
      ).rejects.toThrow("nested failure")
      expect(getNodeResourcePath(getWikiGraphStorage().library)).toBe(outer)
    })
    await expect(stat(path.join(outer, "core.sqlite"))).rejects.toMatchObject({ code: "ENOENT" })
    for (const dir of [left, right]) expect((await stat(path.join(dir, "core.sqlite"))).isFile()).toBe(true)
    expect(() => getWikiGraphStorage()).toThrow("No WikiGraph storage roots")
  })

  it("imports current archives and shares edits, metadata, search, moves and deletion with the CLI", async () => {
    const root = await temporaryDirectory()
    const rt = runtime(root)
    const source = new NodeFile(path.join(root, "新知识库.wikg"))
    await withWikiGraphRuntime(path.join(root, "source-state"), async () => {
      await new WikiGraph({}).digestTextStreamSession(
        {
          stream: ["The blue lighthouse guides ships through the harbor."],
          targetStage: "sourced",
          title: "Lighthouse",
        },
        (archive) => archive.saveAs(source),
      )
      await new WikiGraphArchiveFile(source).write((document) => replaceChapterFtsIndexArtifact(document, 1))
    })
    const original = await readFile(source.path)
    await prepareWikiGraphDefaultLibrary(rt)
    const imported = await addWikiGraphLibraryArchive(rt, source.path)
    expect(imported.path).toBe(path.join(rt.managedLibraryDir, source.name))
    expect(await readWikiGraphMetadata(rt, imported.id)).toMatchObject({ title: "Lighthouse" })
    expect(await readWikiGraphChapterTree(rt, imported.id)).toEqual([{ title: "Lighthouse" }])
    expect(await readWikiGraphCover(rt, imported.id)).toBeNull()
    expect((await inspectWikiGraph(rt, imported.id)).content?.chapters?.total).toBe(1)
    const query = new WikiGraphQueryRunner(rt.stateDir)
    expect(JSON.parse(await query.run([`${imported.uri}/meta`, "--json"]))).toMatchObject({ title: "Lighthouse" })
    await query.run([`${imported.uri}/index`, "sync", "--jsonl"])
    expect((await readWikiGraphIndex(rt, imported.id)).current).toBe(true)
    expect(await query.run([imported.uri, "--query", "lighthouse", "--json"])).toContain("lighthouse")
    await updateWikiGraphMetadata(rt, imported.id, { title: "Updated lighthouse", authors: ["Wanta"] })
    expect(JSON.parse(await query.run([`${imported.uri}/meta`, "--json"]))).toMatchObject({
      title: "Updated lighthouse",
      authors: ["Wanta"],
    })
    await createWikiGraphLibraryFolder(rt, "books")
    const moved = await moveWikiGraphLibraryArchive(rt, imported.id, "books", "renamed.wikg")
    expect(moved.id).toBe(imported.id)
    expect(moved.relativePath).toBe("books/renamed.wikg")
    expect(await query.run(["wikg://lib/arc", "--json"])).toContain("books/renamed.wikg")
    await removeWikiGraphLibraryArchive(rt, imported.id)
    await removeWikiGraphLibraryFolder(rt, "books")
    expect(await listWikiGraphLibraryArchives(rt)).toEqual([])
    expect(await readFile(source.path)).toEqual(original)
  }, 20_000)

  it("initializes the managed wg in a fresh process and preserves command exit failures", async () => {
    const root = await temporaryDirectory()
    const script = path.resolve("electron/knowledge/wg.ts")
    const run = promisify(execFile)
    const args = ["--experimental-strip-types", script, "--wanta-state-dir", path.join(root, "state"), "--"]
    const result = await run(process.execPath, [...args, "--help"], { cwd: root })
    expect(result.stdout).toContain("Wiki Graph CLI")
    await expect(run(process.execPath, [...args, "not-a-command"], { cwd: root })).rejects.toMatchObject({ code: 1 })
  })

  it("shares the storage override with the CommonJS CLI entry too", async () => {
    const root = await temporaryDirectory()
    const require = createRequire(import.meta.url)
    const script = `
      const { AsyncLocalStorage } = require('node:async_hooks');
      const core = require(${JSON.stringify(require.resolve("wiki-graph-core"))});
      const cli = require(${JSON.stringify(require.resolve("wiki-graph"))});
      core.installWikiGraphPlatform({
        asyncContext: { create: () => new AsyncLocalStorage() },
        templates: { createEnvironment: () => ({ render: () => {
          if (core.getWikiGraphStorage().library.path !== stateDir) throw new Error('CLI storage override missing');
          return 'Wiki Graph CLI';
        } }) },
      });
      const outer = { library: { identity: 'outer' } };
      const stateDir = ${JSON.stringify(root)};
      core.withWikiGraphStorage(outer, async () => {
        const result = await cli.runWikiGraphCLICaptured({ argv: ['--help'], stateDir, stdin: '' });
        if (result.exitCode !== 0 || core.getWikiGraphStorage() !== outer) throw new Error(JSON.stringify(result));
      }).catch(error => { console.error(error); process.exitCode = 1; });
    `
    await promisify(execFile)(process.execPath, ["-e", script])
  })
})
