import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { buildArtifactBundle } from "./artifact-bundles.ts"
import { publishArtifactBundleToProject } from "./project-output-publisher.ts"

const roots: string[] = []

async function temporaryRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix))
  roots.push(root)
  return root
}

async function bundleFor(artifactRoot: string) {
  const bundle = await buildArtifactBundle({
    artifactRoot,
    completedAt: 2,
    createdAt: 1,
    generatedPreviewCount: 0,
    messageId: "assistant-1",
    sessionId: "session-1",
  })
  expect(bundle).not.toBeNull()
  return bundle!
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

describe("publishArtifactBundleToProject", () => {
  it("publishes a single deliverable directly into the visible project folder", async () => {
    const artifactRoot = await temporaryRoot("wanta-managed-output-")
    const projectRoot = await temporaryRoot("wanta-project-output-")
    await writeFile(path.join(artifactRoot, "鸡头人.png"), "image")

    const result = await publishArtifactBundleToProject(await bundleFor(artifactRoot), artifactRoot, projectRoot)
    const resolvedProjectRoot = await realpath(projectRoot)

    expect(result.bundle.status).toBe("ready")
    expect(result.bundle.items[0]?.path).toBe(path.join(resolvedProjectRoot, "鸡头人.png"))
    await expect(readFile(path.join(projectRoot, "鸡头人.png"), "utf8")).resolves.toBe("image")
  })

  it("does not overwrite an existing project file", async () => {
    const artifactRoot = await temporaryRoot("wanta-managed-output-")
    const projectRoot = await temporaryRoot("wanta-project-output-")
    await writeFile(path.join(artifactRoot, "report.pdf"), "new")
    await writeFile(path.join(projectRoot, "report.pdf"), "existing")

    const result = await publishArtifactBundleToProject(await bundleFor(artifactRoot), artifactRoot, projectRoot)
    const resolvedProjectRoot = await realpath(projectRoot)

    expect(result.bundle.items[0]?.path).toBe(path.join(resolvedProjectRoot, "report-2.pdf"))
    await expect(readFile(path.join(projectRoot, "report.pdf"), "utf8")).resolves.toBe("existing")
    await expect(readFile(path.join(projectRoot, "report-2.pdf"), "utf8")).resolves.toBe("new")
  })

  it("preserves Unicode while replacing platform-reserved file names", async () => {
    const artifactRoot = await temporaryRoot("wanta-managed-output-")
    const projectRoot = await temporaryRoot("wanta-project-output-")
    await writeFile(path.join(artifactRoot, "CON.png"), "reserved")
    await writeFile(path.join(artifactRoot, "产品 主图.png"), "unicode")

    const result = await publishArtifactBundleToProject(await bundleFor(artifactRoot), artifactRoot, projectRoot)

    expect(result.bundle.items.map((item) => item.name).sort()).toEqual(["output-1.png", "产品 主图.png"])
  })

  it("preserves a generated directory tree and allocates the collection as one unit", async () => {
    const artifactRoot = await temporaryRoot("wanta-managed-output-")
    const projectRoot = await temporaryRoot("wanta-project-output-")
    await mkdir(path.join(artifactRoot, "产品网站", "assets"), { recursive: true })
    await writeFile(path.join(artifactRoot, "产品网站", "index.html"), "html")
    await writeFile(path.join(artifactRoot, "产品网站", "assets", "hero.png"), "image")
    await mkdir(path.join(projectRoot, "产品网站"))

    const result = await publishArtifactBundleToProject(await bundleFor(artifactRoot), artifactRoot, projectRoot)
    const resolvedProjectRoot = await realpath(projectRoot)

    expect(result.bundle.items.map((item) => path.relative(resolvedProjectRoot, item.path)).sort()).toEqual([
      path.join("产品网站-2", "assets", "hero.png"),
      path.join("产品网站-2", "index.html"),
    ])
  })

  it.runIf(process.platform !== "win32")("refuses a symbolic-link project root", async () => {
    const artifactRoot = await temporaryRoot("wanta-managed-output-")
    const projectRoot = await temporaryRoot("wanta-project-output-")
    const linkedRoot = path.join(os.tmpdir(), `wanta-project-output-link-${Date.now()}`)
    roots.push(linkedRoot)
    await writeFile(path.join(artifactRoot, "result.txt"), "result")
    await symlink(projectRoot, linkedRoot, "dir")

    await expect(
      publishArtifactBundleToProject(await bundleFor(artifactRoot), artifactRoot, linkedRoot),
    ).rejects.toThrow("Project output root is not a plain directory")
  })

  it.runIf(process.platform !== "win32")("refuses a symbolic-link artifact source", async () => {
    const artifactRoot = await temporaryRoot("wanta-managed-output-")
    const projectRoot = await temporaryRoot("wanta-project-output-")
    const outsideRoot = await temporaryRoot("wanta-outside-output-")
    const artifactPath = path.join(artifactRoot, "result.txt")
    await writeFile(path.join(outsideRoot, "secret.txt"), "secret")
    await writeFile(artifactPath, "result")
    const bundle = await bundleFor(artifactRoot)
    await rm(artifactPath)
    await symlink(path.join(outsideRoot, "secret.txt"), artifactPath)

    const result = await publishArtifactBundleToProject(bundle, artifactRoot, projectRoot)

    expect(result.bundle.status).toBe("failed")
    expect(result.bundle.failure).toBe("project_output_publish_failed")
    expect(result.publishedPaths.size).toBe(0)
    await expect(readFile(path.join(projectRoot, "result.txt"), "utf8")).rejects.toMatchObject({ code: "ENOENT" })
  })
})
