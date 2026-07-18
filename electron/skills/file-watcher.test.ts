import { mkdir, mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { listWatchDirectories } from "./file-watcher.ts"

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

describe("listWatchDirectories", () => {
  it("discovers nested skill directories without descending into dependency stores", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "wanta-skill-watch-"))
    temporaryRoots.push(root)
    await Promise.all([
      mkdir(path.join(root, "skill-a", "references"), { recursive: true }),
      mkdir(path.join(root, "skill-a", "node_modules", "package"), { recursive: true }),
      mkdir(path.join(root, "skill-b", ".git", "objects"), { recursive: true }),
    ])

    const directories = await listWatchDirectories(root)

    expect(directories).toContain(root)
    expect(directories).toContain(path.join(root, "skill-a"))
    expect(directories).toContain(path.join(root, "skill-a", "references"))
    expect(directories).toContain(path.join(root, "skill-b"))
    expect(directories.some((directory) => directory.includes("node_modules"))).toBe(false)
    expect(directories.some((directory) => directory.includes(`${path.sep}.git${path.sep}`))).toBe(false)
  })
})
