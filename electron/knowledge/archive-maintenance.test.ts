import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { expect, test, vi } from "vitest"
import { withPreparedArchiveCopy } from "./archive-maintenance.ts"

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>()
  return { ...actual, rm: vi.fn(actual.rm) }
})
vi.mock("wiki-graph-core", () => ({
  ensureWikiGraphArchiveSchemaCurrent: async () => undefined,
  ensureLibraryManagedArchiveHasNoSearchIndex: async () => false,
}))

test.each([false, true])("staging cleanup preserves the operation outcome (failed: %s)", async (failed) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wanta-staging-cleanup-"))
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
  try {
    const source = path.join(root, "source.wikg")
    await writeFile(source, "archive")
    const storage = { stateDir: root, managedLibraryDir: path.join(root, "library") }
    vi.mocked(rm).mockRejectedValueOnce(new Error("cleanup failed"))
    const operation = withPreparedArchiveCopy(
      storage,
      source,
      async () => {},
      async (staged) => {
        expect(await readFile(staged, "utf8")).toBe("archive")
        if (failed) throw new Error("registration failed")
        return { id: "committed" }
      },
    )
    if (failed) await expect(operation).rejects.toThrow("registration failed")
    else await expect(operation).resolves.toEqual({ id: "committed" })
    expect(warn).toHaveBeenCalledWith("[wanta] failed to clean knowledge import staging directory")
  } finally {
    warn.mockRestore()
    await rm(root, { recursive: true, force: true })
  }
})
