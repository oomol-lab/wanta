import { execFile } from "node:child_process"
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { afterEach, describe, expect, it } from "vitest"
import { runWikiGraphCLICaptured } from "wiki-graph"
import {
  getWikiGraphStorage,
  WikiGraph,
  WikiGraphArchiveFile,
  replaceChapterFtsIndexArtifact,
  readWikiGraphArchiveSchemaVersion,
} from "wiki-graph-core"
import { readKnowledgeRecoveryIssues } from "./archive-maintenance.ts"
import { NodeFile, getNodeResourcePath, nodeWikiGraphPlatform } from "./node-platform.ts"
import { WikiGraphQueryRunner } from "./query-runner.ts"
import {
  addWikiGraphLibraryArchive,
  createWikiGraphLibraryFolder,
  inspectWikiGraph,
  listWikiGraphLibraryArchives,
  listKnowledgeRecoveryIssues,
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

async function fixtureArchive(root: string, schemaVersion: number): Promise<NodeFile> {
  const file = new NodeFile(path.join(root, `fixture-v${schemaVersion}.wikg`))
  await withWikiGraphRuntime(path.join(root, "fixture-state"), async () => {
    await new WikiGraph({}).digestTextStreamSession(
      { stream: ["The blue lighthouse guides ships through the harbor."], targetStage: "sourced", title: "Lighthouse" },
      (archive) => archive.saveAs(file),
    )
    await new WikiGraphArchiveFile(file).write((document) => replaceChapterFtsIndexArtifact(document, 1))
  })
  // Exercise legacy manifest migration with a real SDK archive and embedded search artifacts.
  const reader = await nodeWikiGraphPlatform.zip.open(file)
  const entries: { name: string; data: Uint8Array }[] = []
  try {
    for (const name of await reader.listEntries()) {
      entries.push({
        name,
        data:
          name === "manifest.json"
            ? Buffer.from(JSON.stringify({ formatVersion: 1, schemaVersion }))
            : (await reader.readEntry(name))!,
      })
    }
  } finally {
    await reader.close()
  }
  await nodeWikiGraphPlatform.zip.write(file, entries)
  return file
}

describe("WikiGraph 0.6 host integration", () => {
  it("upgrades a legacy import on a copy and preserves chapter and search access", async () => {
    const root = await temporaryDirectory()
    const source = await fixtureArchive(root, 3)
    const original = await readFile(source.path)
    const rt = runtime(root)
    const imported = await addWikiGraphLibraryArchive(rt, source.path)
    expect(
      await withWikiGraphRuntime(rt.stateDir, () => readWikiGraphArchiveSchemaVersion(new NodeFile(imported.path!))),
    ).toBe(4)
    expect(await readWikiGraphChapterTree(rt, imported.id)).toEqual([{ title: "Lighthouse" }])
    const query = new WikiGraphQueryRunner(rt.stateDir)
    await query.run([`${imported.uri}/index`, "sync", "--jsonl"])
    expect(await query.run([imported.uri, "--query", "lighthouse", "--json"])).toContain("lighthouse")
    expect(await readFile(source.path)).toEqual(original)
    expect(await readdir(path.join(rt.stateDir, "wanta-imports"))).toEqual([])
  }, 20_000)

  it("prepares legacy files before scanning and preserves isolated failures across process restarts", async () => {
    const root = await temporaryDirectory()
    const rt = runtime(root)
    const legacy = await fixtureArchive(root, 3)
    const future = await fixtureArchive(root, 999)
    const futureOriginal = await readFile(future.path)
    await mkdir(rt.managedLibraryDir, { recursive: true })
    await copyFile(legacy.path, path.join(rt.managedLibraryDir, "legacy.wikg"))
    await copyFile(future.path, path.join(rt.managedLibraryDir, "future.wikg"))
    await writeFile(path.join(rt.managedLibraryDir, "broken.wikg"), "not a ZIP")
    const [archives, issues] = await Promise.all([listWikiGraphLibraryArchives(rt), listKnowledgeRecoveryIssues(rt)])
    expect(archives.map((archive) => archive.relativePath)).toEqual(["legacy.wikg"])
    expect(await readWikiGraphChapterTree(rt, archives[0]!.id)).toEqual([{ title: "Lighthouse" }])
    expect(issues.map((issue) => issue.relativePath)).toEqual(["broken.wikg", "future.wikg"])
    expect(issues[1]!.message).toContain("999")
    const preserved = path.join(rt.stateDir, "wanta-recovery", issues[1]!.id, "archive.wikg")
    expect(await readFile(preserved)).toEqual(futureOriginal)
    expect(await readKnowledgeRecoveryIssues(rt.stateDir)).toEqual(issues)
    const runnerPath = fileURLToPath(new URL("./runner.ts", import.meta.url))
    const script = `import { listWikiGraphLibraryArchives, listKnowledgeRecoveryIssues } from ${JSON.stringify(runnerPath)};
      const rt = ${JSON.stringify(rt)};
      console.log(JSON.stringify({ archives: await listWikiGraphLibraryArchives(rt), issues: await listKnowledgeRecoveryIssues(rt) }));`
    const restarted = await promisify(execFile)(process.execPath, [
      "--experimental-strip-types",
      "--input-type=module",
      "-e",
      script,
    ])
    const snapshot = JSON.parse(restarted.stdout)
    expect(snapshot.archives.map((archive: { id: string }) => archive.id)).toEqual(
      archives.map((archive) => archive.id),
    )
    expect(snapshot.issues).toEqual(issues)
  }, 20_000)

  it("rejects corrupt and future imports without leaving managed copies or modifying sources", async () => {
    const root = await temporaryDirectory()
    const rt = runtime(root)
    const future = await fixtureArchive(root, 999)
    const corrupt = path.join(root, "broken.wikg")
    await writeFile(corrupt, "not a ZIP")
    for (const sourcePath of [future.path, corrupt]) {
      const original = await readFile(sourcePath)
      await expect(addWikiGraphLibraryArchive(rt, sourcePath)).rejects.toThrow("WANTA_KNOWLEDGE_IMPORT_UNREADABLE")
      expect(await readFile(sourcePath)).toEqual(original)
    }
    expect(await listWikiGraphLibraryArchives(rt)).toEqual([])
    expect(await readdir(rt.managedLibraryDir)).toEqual([])
    expect(await readdir(path.join(rt.stateDir, "wanta-imports"))).toEqual([])
  }, 20_000)

  it("keeps concurrent imports of the same source distinct", async () => {
    const root = await temporaryDirectory()
    const rt = runtime(root)
    const source = await fixtureArchive(root, 4)
    const imports = await Promise.all([
      addWikiGraphLibraryArchive(rt, source.path),
      addWikiGraphLibraryArchive(rt, source.path),
    ])
    expect(new Set(imports.map((archive) => archive.id)).size).toBe(2)
    // Concurrent requests can reach the import queue in either order after asynchronous preparation.
    expect(new Set(imports.map((archive) => archive.relativePath))).toEqual(
      new Set(["fixture-v4.wikg", "fixture-v4 2.wikg"]),
    )
    expect((await listWikiGraphLibraryArchives(rt)).length).toBe(2)
    expect(await readdir(path.join(rt.stateDir, "wanta-imports"))).toEqual([])
  }, 20_000)

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
    const script = fileURLToPath(new URL("./wg.ts", import.meta.url))
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
